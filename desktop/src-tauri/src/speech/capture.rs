//! Recording a call: the microphone (the researcher) and what the computer plays (everyone else
//! on the call) as two tracks, kept apart so the transcript can tell who spoke. Works with any
//! call app, since it records the computer's sound output rather than the app:
//! - Linux: the output's monitor source, over the PulseAudio protocol (PipeWire serves it too);
//! - Windows: WASAPI loopback of the default output;
//! - macOS 14.6+: a Core Audio process tap of the default output.
//!
//! The streams live on their own thread (on some systems they may not move between threads); a
//! second thread converts both to 16 kHz, keeps them in step with the clock and interleaves them
//! as 16-bit stereo (left: microphone, right: the computer's sound). The UI takes that audio
//! every moment, encrypts it and stores it: nothing here touches the disk.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};
use serde::Serialize;

use super::resample::Resampler;
use super::RATE;
use crate::error::{AppError, AppResult};

const MIC: usize = 0;
const SYSTEM: usize = 1;

/// How far a track may fall behind the clock or run ahead of it before it is put back in step.
/// A device delivers in bursts, so a little either way is normal.
const TOLERANCE: u64 = RATE as u64 / 2;
/// Where a track that fell behind is padded to: just short of the clock, so audio that was only
/// late is not pushed ahead of it.
const SLACK: u64 = RATE as u64 / 4;

/// What the UI shows of one track while recording.
#[derive(Default)]
pub struct TrackLive {
    /// The loudest sample of the last moment, 0–1, as f32 bits.
    level: AtomicU32,
    /// The device's name, once open.
    device: Mutex<Option<String>>,
    /// Why the track is not recording (no device, refused, unplugged).
    error: Mutex<Option<String>>,
    open: AtomicBool,
}

#[derive(Serialize)]
pub struct TrackStatus {
    open: bool,
    level: f32,
    device: Option<String>,
    error: Option<String>,
}

impl TrackLive {
    fn status(&self) -> TrackStatus {
        TrackStatus {
            open: self.open.load(Ordering::Relaxed),
            level: f32::from_bits(self.level.load(Ordering::Relaxed)),
            device: self.device.lock().unwrap().clone(),
            error: self.error.lock().unwrap().clone(),
        }
    }

    fn fail(&self, e: impl std::fmt::Display) {
        let mut slot = self.error.lock().unwrap();
        if slot.is_none() {
            *slot = Some(e.to_string());
        }
    }
}

#[derive(Default)]
struct Shared {
    tracks: [TrackLive; 2],
    /// Interleaved 16-bit little-endian stereo, waiting for the UI to take it.
    out: Mutex<Vec<u8>>,
    /// Stereo frames produced so far.
    frames: AtomicU64,
}

#[derive(Serialize)]
pub struct Status {
    recording: bool,
    /// Milliseconds of audio produced so far.
    ms: u64,
    mic: TrackStatus,
    system: TrackStatus,
}

pub struct Recorder {
    shared: Arc<Shared>,
    stop: mpsc::Sender<()>,
    capture: Option<JoinHandle<()>>,
    mixer: Option<JoinHandle<()>>,
}

type Block = (usize, Vec<f32>);

fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    track: usize,
    tx: mpsc::Sender<Block>,
    shared: Arc<Shared>,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    let channels = config.channels.max(1) as usize;
    device.build_input_stream::<T, _, _>(
        *config,
        move |data: &[T], _| {
            let mono: Vec<f32> = data
                .chunks(channels)
                .map(|frame| {
                    frame.iter().map(|s| f32::from_sample(*s)).sum::<f32>() / frame.len() as f32
                })
                .collect();
            let _ = tx.send((track, mono));
        },
        move |e| {
            // A glitch, a new default device or no real-time priority: the stream goes on.
            if !matches!(
                e.kind(),
                cpal::ErrorKind::Xrun
                    | cpal::ErrorKind::DeviceChanged
                    | cpal::ErrorKind::RealtimeDenied
            ) {
                shared.tracks[track].fail(e);
            }
        },
        None,
    )
}

fn open_on(
    device: &cpal::Device,
    loopback: bool,
    track: usize,
    tx: mpsc::Sender<Block>,
    shared: &Arc<Shared>,
) -> Result<(cpal::Stream, u32), String> {
    let supported = if loopback {
        device.default_output_config()
    } else {
        device.default_input_config()
    }
    .map_err(|e| e.to_string())?;
    let config = supported.config();
    let rate = config.sample_rate;
    let s = shared.clone();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(device, &config, track, tx, s),
        SampleFormat::I16 => build::<i16>(device, &config, track, tx, s),
        SampleFormat::U16 => build::<u16>(device, &config, track, tx, s),
        SampleFormat::I32 => build::<i32>(device, &config, track, tx, s),
        SampleFormat::I8 => build::<i8>(device, &config, track, tx, s),
        SampleFormat::U8 => build::<u8>(device, &config, track, tx, s),
        SampleFormat::F64 => build::<f64>(device, &config, track, tx, s),
        other => return Err(format!("unsupported sample format {other:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    if let Ok(d) = device.description() {
        *shared.tracks[track].device.lock().unwrap() = Some(d.to_string());
    }
    Ok((stream, rate))
}

/// The host whose devices are used, and the device that hears what the computer plays (with
/// whether it is an output used as an input, which is how WASAPI and Core Audio do loopback).
fn devices() -> (
    cpal::Host,
    Option<cpal::Device>,
    Option<(cpal::Device, bool)>,
) {
    #[cfg(target_os = "linux")]
    {
        if let Ok(host) = cpal::host_from_id(cpal::HostId::PulseAudio) {
            let mic = host.default_input_device();
            // Every output (a sink) has a monitor source named after it.
            let monitor = host
                .default_output_device()
                .and_then(|sink| sink.id().ok())
                .map(|id| {
                    cpal::DeviceId::new(cpal::HostId::PulseAudio, format!("{}.monitor", id.id()))
                })
                .and_then(|id| host.device_by_id(&id))
                .map(|d| (d, false));
            if mic.is_some() || monitor.is_some() {
                return (host, mic, monitor);
            }
        }
        // No sound server answering: plain ALSA, the microphone only.
        let host = cpal::default_host();
        let mic = host.default_input_device();
        (host, mic, None)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let host = cpal::default_host();
        let mic = host.default_input_device();
        let out = host.default_output_device().map(|d| (d, true));
        (host, mic, out)
    }
}

/// Where a track stands against the clock, and what to do about it.
#[derive(Debug, PartialEq, Eq)]
pub enum Adjust {
    Keep,
    /// Add this much silence: the device delivered nothing (Windows sends no loopback audio
    /// while nothing plays) or fell behind.
    Pad(u64),
    /// Leave out this much: the device's clock runs fast.
    Drop(u64),
}

pub fn adjust(produced: u64, expected: u64) -> Adjust {
    if produced + TOLERANCE < expected {
        Adjust::Pad(expected - SLACK - produced)
    } else if produced > expected + TOLERANCE {
        Adjust::Drop(produced - expected - SLACK)
    } else {
        Adjust::Keep
    }
}

fn to_i16(x: f32) -> i16 {
    (x.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

/// Brings in the blocks of both tracks, keeps them in step and interleaves what both have.
struct Mixer {
    resamplers: [Option<Resampler>; 2],
    pending: [std::collections::VecDeque<f32>; 2],
    /// 16 kHz samples each track has delivered (or been padded with) since the start.
    produced: [u64; 2],
    scratch: Vec<f32>,
}

impl Mixer {
    fn new(rates: [Option<u32>; 2]) -> Self {
        Mixer {
            resamplers: rates.map(|r| r.map(|r| Resampler::new(r, RATE))),
            pending: Default::default(),
            produced: [0, 0],
            scratch: Vec::new(),
        }
    }

    fn push(&mut self, track: usize, block: &[f32], live: &TrackLive) {
        let Some(rs) = self.resamplers[track].as_mut() else {
            return;
        };
        self.scratch.clear();
        rs.push(block, &mut self.scratch);
        let peak = self.scratch.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        let shown = f32::from_bits(live.level.load(Ordering::Relaxed));
        // Rises at once, falls gently, so the meter is readable.
        live.level
            .store(peak.max(shown * 0.85).min(1.0).to_bits(), Ordering::Relaxed);
        self.produced[track] += self.scratch.len() as u64;
        self.pending[track].extend(self.scratch.iter().copied());
    }

    /// Puts each track back in step with `expected` samples since the start, then moves what
    /// both tracks have into `out`. A track without a device is silence.
    fn mix(&mut self, expected: u64, live: &[TrackLive; 2], out: &mut Vec<u8>) -> u64 {
        for t in [MIC, SYSTEM] {
            if self.resamplers[t].is_none() {
                let missing = expected.saturating_sub(self.produced[t]);
                self.pending[t].extend(std::iter::repeat_n(0.0, missing as usize));
                self.produced[t] = self.produced[t].max(expected);
                continue;
            }
            match adjust(self.produced[t], expected) {
                Adjust::Keep => {}
                Adjust::Pad(n) => {
                    self.pending[t].extend(std::iter::repeat_n(0.0, n as usize));
                    self.produced[t] += n;
                }
                Adjust::Drop(n) => {
                    let n = (n as usize).min(self.pending[t].len());
                    self.pending[t].drain(..n);
                    self.produced[t] -= n as u64;
                }
            }
            if !live[t].open.load(Ordering::Relaxed) {
                live[t].level.store(0f32.to_bits(), Ordering::Relaxed);
            }
        }
        let n = self.pending[MIC].len().min(self.pending[SYSTEM].len());
        out.reserve(n * 4);
        let [mic, system] = &mut self.pending;
        for (l, r) in mic.drain(..n).zip(system.drain(..n)) {
            out.extend_from_slice(&to_i16(l).to_le_bytes());
            out.extend_from_slice(&to_i16(r).to_le_bytes());
        }
        n as u64
    }
}

impl Recorder {
    /// Opens the microphone and the computer's sound and starts recording. Fails only when
    /// neither can be opened; a track that cannot is silence, and its status says why.
    pub fn start() -> AppResult<Self> {
        let shared = Arc::new(Shared::default());
        let (audio_tx, audio_rx) = mpsc::channel::<Block>();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::channel::<[Option<u32>; 2]>();

        let sh = shared.clone();
        let capture = std::thread::Builder::new()
            .name("trama-capture".into())
            .spawn(move || {
                let (_host, mic, system) = devices();
                let mut streams = Vec::new();
                let mut rates = [None, None];
                match mic {
                    Some(d) => match open_on(&d, false, MIC, audio_tx.clone(), &sh) {
                        Ok((s, r)) => {
                            streams.push(s);
                            rates[MIC] = Some(r);
                        }
                        Err(e) => sh.tracks[MIC].fail(e),
                    },
                    None => sh.tracks[MIC].fail("no microphone"),
                }
                match system {
                    Some((d, loopback)) => match open_on(&d, loopback, SYSTEM, audio_tx, &sh) {
                        Ok((s, r)) => {
                            streams.push(s);
                            rates[SYSTEM] = Some(r);
                        }
                        Err(e) => sh.tracks[SYSTEM].fail(e),
                    },
                    None => sh.tracks[SYSTEM].fail("no way to record the computer's sound"),
                }
                for (t, r) in rates.iter().enumerate() {
                    sh.tracks[t].open.store(r.is_some(), Ordering::Relaxed);
                }
                let _ = ready_tx.send(rates);
                let _ = stop_rx.recv();
                drop(streams);
            })?;

        let rates = ready_rx
            .recv()
            .map_err(|_| AppError::Other("the recording thread stopped".into()))?;
        if rates.iter().all(Option::is_none) {
            let _ = stop_tx.send(());
            let _ = capture.join();
            let mic = shared.tracks[MIC].error.lock().unwrap().clone();
            return Err(AppError::Coded(
                "NO_AUDIO_DEVICE",
                mic.unwrap_or_else(|| "no microphone".into()),
            ));
        }

        let started = Instant::now();
        let sh = shared.clone();
        let mixer = std::thread::Builder::new()
            .name("trama-mixer".into())
            .spawn(move || {
                let mut mixer = Mixer::new(rates);
                let mut buf = Vec::new();
                let mut done = false;
                while !done {
                    match audio_rx.recv_timeout(Duration::from_millis(100)) {
                        Ok((t, block)) => mixer.push(t, &block, &sh.tracks[t]),
                        // The streams were dropped: one last mix, then the end.
                        Err(mpsc::RecvTimeoutError::Disconnected) => done = true,
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    // Everything already delivered first, then the clock.
                    while let Ok((t, block)) = audio_rx.try_recv() {
                        mixer.push(t, &block, &sh.tracks[t]);
                    }
                    let expected = (started.elapsed().as_secs_f64() * RATE as f64) as u64;
                    buf.clear();
                    let n = mixer.mix(expected, &sh.tracks, &mut buf);
                    if n > 0 {
                        sh.out.lock().unwrap().extend_from_slice(&buf);
                        sh.frames.fetch_add(n, Ordering::Relaxed);
                    }
                }
            })?;

        Ok(Recorder {
            shared,
            stop: stop_tx,
            capture: Some(capture),
            mixer: Some(mixer),
        })
    }

    /// The audio produced since the last call (16-bit stereo, 16 kHz).
    pub fn take(&self) -> Vec<u8> {
        std::mem::take(&mut *self.shared.out.lock().unwrap())
    }

    pub fn status(&self) -> Status {
        Status {
            recording: self.capture.is_some(),
            ms: self.shared.frames.load(Ordering::Relaxed) * 1000 / RATE as u64,
            mic: self.shared.tracks[MIC].status(),
            system: self.shared.tracks[SYSTEM].status(),
        }
    }

    /// Closes the devices. What was recorded until now is still to be taken.
    pub fn stop(&mut self) {
        let _ = self.stop.send(());
        if let Some(c) = self.capture.take() {
            let _ = c.join();
        }
        if let Some(m) = self.mixer.take() {
            let _ = m.join();
        }
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_track_that_is_roughly_on_time() {
        assert_eq!(adjust(16_000, 16_000), Adjust::Keep);
        assert_eq!(adjust(16_000 - TOLERANCE, 16_000), Adjust::Keep);
        assert_eq!(adjust(16_000 + TOLERANCE, 16_000), Adjust::Keep);
    }

    #[test]
    fn pads_silence_and_drops_a_fast_clock() {
        // Nothing for two seconds (Windows loopback while nothing plays).
        assert_eq!(adjust(0, 32_000), Adjust::Pad(32_000 - SLACK));
        assert_eq!(adjust(41_000, 32_000), Adjust::Drop(9_000 - SLACK));
    }

    #[test]
    fn interleaves_both_tracks_in_step() {
        let live: [TrackLive; 2] = Default::default();
        let mut m = Mixer::new([Some(16_000), Some(16_000)]);
        // The microphone delivers a second; the computer's sound nothing at all.
        m.push(MIC, &vec![0.5; 16_000], &live[MIC]);
        let mut out = Vec::new();
        let n = m.mix(16_000, &live, &mut out);
        // The silent track was padded to just short of the clock.
        assert_eq!(n, 16_000 - SLACK);
        assert_eq!(out.len() as u64, n * 4);
        let l = i16::from_le_bytes([out[400], out[401]]);
        let r = i16::from_le_bytes([out[402], out[403]]);
        assert!(l > 16_000);
        assert_eq!(r, 0);
    }

    #[test]
    fn a_missing_device_is_silence() {
        let live: [TrackLive; 2] = Default::default();
        let mut m = Mixer::new([Some(16_000), None]);
        m.push(MIC, &vec![0.25; 8_000], &live[MIC]);
        let mut out = Vec::new();
        assert_eq!(m.mix(8_000, &live, &mut out), 7_999);
    }
}

#[cfg(test)]
mod device_tests {
    use super::*;

    /// Records a few seconds from the real devices, when asked for:
    /// cargo test record_from_devices -- --ignored --nocapture (play something meanwhile).
    #[test]
    #[ignore]
    fn record_from_devices() {
        let mut r = Recorder::start().unwrap();
        let mut bytes = Vec::new();
        for _ in 0..8 {
            std::thread::sleep(Duration::from_millis(500));
            bytes.extend(r.take());
            let s = r.status();
            println!(
                "{} ms  mic {:.2} {:?} {:?}  system {:.2} {:?} {:?}",
                s.ms,
                s.mic.level,
                s.mic.device,
                s.mic.error,
                s.system.level,
                s.system.device,
                s.system.error
            );
        }
        r.stop();
        bytes.extend(r.take());
        let frames = bytes.len() / 4;
        let peak = |ch: usize| {
            bytes
                .as_chunks::<4>()
                .0
                .iter()
                .map(|f| i16::from_le_bytes([f[ch * 2], f[ch * 2 + 1]]).unsigned_abs())
                .max()
                .unwrap_or(0)
        };
        println!(
            "{frames} frames ({:.2} s), peaks: mic {} system {}",
            frames as f64 / RATE as f64,
            peak(0),
            peak(1)
        );
        assert!(frames as u32 > 3 * RATE);
    }
}
