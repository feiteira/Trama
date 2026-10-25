//! On-device speech: recording a call (capture.rs) and transcribing recordings with whisper.cpp
//! (decode.rs, transcribe.rs). The speech model ships with the app: nothing is downloaded and
//! no audio leaves the computer. Like the rest of the shell this knows nothing of projects or
//! keys: the UI hands over a recording's bytes (decrypted in memory) and takes back text, and it
//! takes recorded audio from here to encrypt and store it.

mod capture;
mod decode;
mod resample;
mod transcribe;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::{Request, Response};
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::{body_bytes, header};

/// The sample rate of everything here: recordings and what the model hears.
pub const RATE: u32 = 16_000;

/// The model files, as `tools/fetch-speech-models.mjs` puts them in `resources/speech`. The
/// sizes are checked when Trama starts (the hashes when the app is built).
const MODEL: (&str, u64) = ("ggml-large-v3-turbo-q5_0.bin", 574_041_195);
const VAD: (&str, u64) = ("ggml-silero-v5.1.2.bin", 885_098);
/// What the audit trail records as having written a transcript.
pub const ENGINE: &str = "whisper.cpp 1.8, large-v3-turbo (q5_0), Silero VAD 5.1.2";

fn stopped() -> AppError {
    AppError::Coded("CANCELLED", "stopped".into())
}

/// Whether this processor can run the speech engine as built (see .cargo/config.toml).
fn cpu_supported() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        std::arch::is_x86_feature_detected!("avx2")
            && std::arch::is_x86_feature_detected!("fma")
            && std::arch::is_x86_feature_detected!("f16c")
    }
    #[cfg(target_arch = "aarch64")]
    {
        true
    }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    {
        false
    }
}

fn has_models(dir: &Path) -> bool {
    [MODEL, VAD].iter().all(|(name, size)| {
        std::fs::metadata(dir.join(name)).is_ok_and(|m| m.is_file() && m.len() == *size)
    })
}

/// The folder with the model files: the app's resources, or TRAMA_SPEECH_DIR (development and
/// tests), or, in a debug build, the folder the fetch script fills.
pub fn locate(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::var_os("TRAMA_SPEECH_DIR").filter(|d| !d.is_empty()) {
        candidates.push(PathBuf::from(dir));
    }
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("speech"));
    }
    if cfg!(debug_assertions) {
        candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/speech"));
    }
    candidates.into_iter().find(|d| has_models(d))
}

pub struct Speech {
    dir: Option<PathBuf>,
    job: Mutex<Option<Arc<Job>>>,
    recorder: Mutex<Option<capture::Recorder>>,
}

impl Speech {
    pub fn new(dir: Option<PathBuf>) -> Self {
        whisper_rs::install_logging_hooks();
        Speech {
            dir,
            job: Mutex::new(None),
            recorder: Mutex::new(None),
        }
    }

    /// Stops whatever runs (the app is closing).
    pub fn shutdown(&self) {
        if let Some(job) = self.job.lock().unwrap().as_ref() {
            job.cancel.store(true, Ordering::Relaxed);
        }
        if let Some(mut r) = self.recorder.lock().unwrap().take() {
            r.stop();
        }
    }
}

#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Decoding,
    Transcribing,
    Done,
    Failed,
    Cancelled,
}

#[derive(Serialize, Clone)]
pub struct Transcript {
    tracks: Vec<transcribe::Track>,
    /// The recording's length in milliseconds.
    duration: u64,
    engine: &'static str,
}

pub struct Job {
    progress: Arc<AtomicI32>,
    cancel: Arc<AtomicBool>,
    phase: Mutex<Phase>,
    outcome: Mutex<Option<Result<Transcript, (String, String)>>>,
}

// ── The model ────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct SpeechInfo {
    /// Recordings can be transcribed here.
    transcribe: bool,
    /// Why not: `NO_MODEL` (a build without the model), `UNSUPPORTED_CPU`.
    reason: Option<&'static str>,
    engine: &'static str,
}

#[tauri::command]
pub async fn speech_info(speech: State<'_, Speech>) -> AppResult<SpeechInfo> {
    let reason = if speech.dir.is_none() {
        Some("NO_MODEL")
    } else if !cpu_supported() {
        Some("UNSUPPORTED_CPU")
    } else {
        None
    };
    Ok(SpeechInfo {
        transcribe: reason.is_none(),
        reason,
        engine: ENGINE,
    })
}

// ── Transcription ────────────────────────────────────────────────────────────────────────

/// Starts transcribing the recording in the body. Headers: `x-ext` (the file's extension, a
/// hint), `x-language` (ISO 639-1, or empty to let the model tell), `x-channels` (`mix`, or
/// `split` for a call recorded by Trama). One at a time; progress via `transcribe_status`.
#[tauri::command]
pub async fn transcribe_start(speech: State<'_, Speech>, request: Request<'_>) -> AppResult<()> {
    let dir = speech
        .dir
        .clone()
        .filter(|_| cpu_supported())
        .ok_or_else(|| AppError::Coded("UNAVAILABLE", "transcription is not available".into()))?;
    let ext = header(&request, "x-ext")?.to_ascii_lowercase();
    let language = header(&request, "x-language")?;
    let channels = match header(&request, "x-channels")?.as_str() {
        "split" => decode::Channels::Split,
        _ => decode::Channels::Mix,
    };
    let job = {
        let mut slot = speech.job.lock().unwrap();
        if let Some(j) = slot.as_ref() {
            if matches!(
                *j.phase.lock().unwrap(),
                Phase::Decoding | Phase::Transcribing
            ) {
                return Err(AppError::Coded("BUSY", "a transcription is running".into()));
            }
        }
        let job = Arc::new(Job {
            progress: Arc::new(AtomicI32::new(0)),
            cancel: Arc::new(AtomicBool::new(false)),
            phase: Mutex::new(Phase::Decoding),
            outcome: Mutex::new(None),
        });
        *slot = Some(job.clone());
        job
    };
    let bytes = body_bytes(&request)?;
    std::thread::Builder::new()
        .name("trama-transcribe".into())
        .spawn(move || {
            let language = Some(language.as_str()).filter(|l| !l.is_empty());
            let result = run_job(&dir, bytes, &ext, channels, language, &job);
            let phase = match &result {
                Ok(_) => Phase::Done,
                Err(e) if e.code() == "CANCELLED" => Phase::Cancelled,
                Err(_) => Phase::Failed,
            };
            *job.outcome.lock().unwrap() =
                Some(result.map_err(|e| (e.code().to_string(), e.to_string())));
            *job.phase.lock().unwrap() = phase;
        })?;
    Ok(())
}

fn run_job(
    dir: &Path,
    bytes: Vec<u8>,
    ext: &str,
    channels: decode::Channels,
    language: Option<&str>,
    job: &Job,
) -> AppResult<Transcript> {
    let tracks = decode::decode(bytes, ext, channels, &|| job.cancel.load(Ordering::Relaxed))?;
    let duration = tracks[0].len() as u64 * 1000 / RATE as u64;
    *job.phase.lock().unwrap() = Phase::Transcribing;
    let engine = transcribe::Engine::load(&dir.join(MODEL.0), &dir.join(VAD.0))?;
    let mut out = Vec::with_capacity(tracks.len());
    for (i, samples) in tracks.iter().enumerate() {
        if job.cancel.load(Ordering::Relaxed) {
            return Err(stopped());
        }
        out.push(engine.run(samples, language, job, i, tracks.len())?);
    }
    Ok(Transcript {
        tracks: out,
        duration,
        engine: ENGINE,
    })
}

#[derive(Serialize)]
pub struct JobStatus {
    /// `idle` when nothing was started (or the result was taken).
    state: &'static str,
    percent: i32,
    error: Option<ErrorInfo>,
}

#[derive(Serialize)]
pub struct ErrorInfo {
    code: String,
    message: String,
}

#[tauri::command]
pub async fn transcribe_status(speech: State<'_, Speech>) -> AppResult<JobStatus> {
    let slot = speech.job.lock().unwrap();
    let Some(job) = slot.as_ref() else {
        return Ok(JobStatus {
            state: "idle",
            percent: 0,
            error: None,
        });
    };
    let phase = *job.phase.lock().unwrap();
    let error = match job.outcome.lock().unwrap().as_ref() {
        Some(Err((code, message))) => Some(ErrorInfo {
            code: code.clone(),
            message: message.clone(),
        }),
        _ => None,
    };
    Ok(JobStatus {
        state: match phase {
            Phase::Decoding => "decoding",
            Phase::Transcribing => "transcribing",
            Phase::Done => "done",
            Phase::Failed => "failed",
            Phase::Cancelled => "cancelled",
        },
        percent: job.progress.load(Ordering::Relaxed),
        error,
    })
}

/// The finished transcript, once; the job is then forgotten. None until it is done.
#[tauri::command]
pub async fn transcribe_take(speech: State<'_, Speech>) -> AppResult<Option<Transcript>> {
    let mut slot = speech.job.lock().unwrap();
    let done = slot.as_ref().is_some_and(|j| {
        !matches!(
            *j.phase.lock().unwrap(),
            Phase::Decoding | Phase::Transcribing
        )
    });
    if !done {
        return Ok(None);
    }
    let Some(job) = slot.take() else {
        return Ok(None);
    };
    let outcome = job.outcome.lock().unwrap().take();
    Ok(outcome.and_then(Result::ok))
}

#[tauri::command]
pub async fn transcribe_cancel(speech: State<'_, Speech>) -> AppResult<()> {
    if let Some(job) = speech.job.lock().unwrap().as_ref() {
        job.cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

// ── Recording ────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn recorder_start(speech: State<'_, Speech>) -> AppResult<capture::Status> {
    let mut slot = speech.recorder.lock().unwrap();
    if slot.is_some() {
        return Err(AppError::Coded("BUSY", "already recording".into()));
    }
    let recorder = capture::Recorder::start()?;
    let status = recorder.status();
    *slot = Some(recorder);
    Ok(status)
}

#[tauri::command]
pub async fn recorder_status(speech: State<'_, Speech>) -> AppResult<Option<capture::Status>> {
    Ok(speech.recorder.lock().unwrap().as_ref().map(|r| r.status()))
}

/// The audio recorded since the last call: 16-bit little-endian stereo at 16 kHz.
#[tauri::command]
pub async fn recorder_take(speech: State<'_, Speech>) -> AppResult<Response> {
    let bytes = speech
        .recorder
        .lock()
        .unwrap()
        .as_ref()
        .map(|r| r.take())
        .unwrap_or_default();
    Ok(Response::new(bytes))
}

/// Stops recording and returns the last of the audio.
#[tauri::command]
pub async fn recorder_stop(speech: State<'_, Speech>) -> AppResult<Response> {
    let Some(mut recorder) = speech.recorder.lock().unwrap().take() else {
        return Ok(Response::new(Vec::new()));
    };
    let bytes = crate::blocking(move || {
        recorder.stop();
        Ok(recorder.take())
    })
    .await?;
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The whole path on a real recording with the real model, when asked for:
    /// TRAMA_SPEECH_SAMPLE=<file> [TRAMA_SPEECH_CHANNELS=split] cargo test -- --ignored
    /// (the model files from tools/fetch-speech-models.mjs, or TRAMA_SPEECH_DIR).
    #[test]
    #[ignore]
    fn transcribes_a_sample() {
        let sample = std::env::var("TRAMA_SPEECH_SAMPLE").expect("TRAMA_SPEECH_SAMPLE");
        let dir = std::env::var_os("TRAMA_SPEECH_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/speech"));
        assert!(has_models(&dir), "no model files in {}", dir.display());
        let channels = match std::env::var("TRAMA_SPEECH_CHANNELS").as_deref() {
            Ok("split") => decode::Channels::Split,
            _ => decode::Channels::Mix,
        };
        let ext = Path::new(&sample)
            .extension()
            .map(|e| e.to_string_lossy().into_owned())
            .unwrap_or_default();
        let language = std::env::var("TRAMA_SPEECH_LANGUAGE").ok();
        let job = Job {
            progress: Arc::new(AtomicI32::new(0)),
            cancel: Arc::new(AtomicBool::new(false)),
            phase: Mutex::new(Phase::Decoding),
            outcome: Mutex::new(None),
        };
        let started = std::time::Instant::now();
        let t = run_job(
            &dir,
            std::fs::read(&sample).unwrap(),
            &ext,
            channels,
            language.as_deref(),
            &job,
        )
        .unwrap();
        let secs = started.elapsed().as_secs_f64();
        for (i, track) in t.tracks.iter().enumerate() {
            println!("track {i} ({:?}):", track.language);
            for s in &track.segments {
                println!("  [{:>6} – {:>6}] {}", s.start, s.end, s.text);
            }
        }
        println!(
            "{} ms of audio in {secs:.1} s ({:.1}× real time)",
            t.duration,
            t.duration as f64 / 1000.0 / secs
        );
        assert!(t.tracks.iter().any(|t| !t.segments.is_empty()));
    }
}
