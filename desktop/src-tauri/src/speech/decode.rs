//! Reads a recording (the bytes of an audio or video file, already decrypted by the UI) into
//! 16 kHz samples for the speech model, with Symphonia: WAV, MP3, AAC (M4A, MP4, MOV), FLAC,
//! Ogg Vorbis, ALAC and the audio of Matroska/WebM files. Opus is not among them.

use std::io::Cursor;

use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;

use super::resample::Resampler;
use super::RATE;
use crate::error::{AppError, AppResult};

/// How the channels of a recording become what is transcribed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channels {
    /// Everyone together: all channels mixed into one.
    Mix,
    /// The first two channels apart: a call recorded by Trama keeps the microphone on the left
    /// and what the computer played on the right.
    Split,
}

fn unsupported(detail: impl std::fmt::Display) -> AppError {
    AppError::Coded(
        "UNSUPPORTED_AUDIO",
        format!("the recording could not be read: {detail}"),
    )
}

/// Decodes `bytes` into one 16 kHz track (Mix) or two (Split). `ext` is a hint (the file's
/// extension); the content decides. `stop` is asked between packets.
pub fn decode(
    bytes: Vec<u8>,
    ext: &str,
    channels: Channels,
    stop: &dyn Fn() -> bool,
) -> AppResult<Vec<Vec<f32>>> {
    let mss = MediaSourceStream::new(
        Box::new(Cursor::new(bytes)),
        MediaSourceStreamOptions::default(),
    );
    let mut hint = Hint::new();
    if !ext.is_empty() {
        hint.with_extension(ext);
    }
    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(unsupported)?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| unsupported("no sound track"))?;
    let track_id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or_else(|| unsupported("unknown sound format"))?
        .clone();
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .map_err(unsupported)?;

    let tracks = match channels {
        Channels::Mix => 1,
        Channels::Split => 2,
    };
    let mut out: Vec<Vec<f32>> = vec![Vec::new(); tracks];
    let mut resamplers: Option<(u32, Vec<Resampler>)> = None;
    let mut planes: Vec<Vec<f32>> = Vec::new();
    let mut mixed: Vec<Vec<f32>> = vec![Vec::new(); tracks];
    loop {
        if stop() {
            return Err(super::stopped());
        }
        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            // Some files end without a clean end-of-stream: what was read is kept.
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(unsupported(e)),
        };
        if packet.track_id != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            // A damaged packet is skipped, as players do.
            Err(SymError::DecodeError(_)) => continue,
            Err(e) => return Err(unsupported(e)),
        };
        let rate = decoded.spec().rate();
        decoded.copy_to_vecs_planar::<f32>(&mut planes);
        if planes.is_empty() || planes[0].is_empty() {
            continue;
        }
        // The rate can only be known from decoded audio for some formats; it does not change.
        let rs = resamplers.get_or_insert_with(|| {
            (
                rate,
                (0..tracks).map(|_| Resampler::new(rate, RATE)).collect(),
            )
        });
        if rs.0 != rate {
            return Err(unsupported("the sample rate changes"));
        }
        match channels {
            Channels::Mix => {
                let n = planes.len() as f32;
                let m = &mut mixed[0];
                m.clear();
                m.extend(
                    (0..planes[0].len()).map(|i| planes.iter().map(|p| p[i]).sum::<f32>() / n),
                );
            }
            Channels::Split => {
                // A mono file has one voice; both tracks get it and the second finds nothing new.
                for (t, m) in mixed.iter_mut().enumerate() {
                    m.clear();
                    m.extend_from_slice(&planes[t.min(planes.len() - 1)]);
                }
            }
        }
        for (t, m) in mixed.iter().enumerate() {
            rs.1[t].push(m, &mut out[t]);
        }
    }
    if out[0].is_empty() {
        return Err(unsupported("no sound"));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 16-bit PCM WAV file, as Trama's recorder writes them.
    fn wav(rate: u32, channels: &[Vec<f32>]) -> Vec<u8> {
        let n = channels[0].len();
        let ch = channels.len() as u16;
        let data_len = (n * channels.len() * 2) as u32;
        let mut b = Vec::new();
        b.extend_from_slice(b"RIFF");
        b.extend_from_slice(&(36 + data_len).to_le_bytes());
        b.extend_from_slice(b"WAVEfmt ");
        b.extend_from_slice(&16u32.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&ch.to_le_bytes());
        b.extend_from_slice(&rate.to_le_bytes());
        b.extend_from_slice(&(rate * ch as u32 * 2).to_le_bytes());
        b.extend_from_slice(&(ch * 2).to_le_bytes());
        b.extend_from_slice(&16u16.to_le_bytes());
        b.extend_from_slice(b"data");
        b.extend_from_slice(&data_len.to_le_bytes());
        for i in 0..n {
            for c in channels {
                b.extend_from_slice(&((c[i].clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
            }
        }
        b
    }

    fn tone(rate: u32, hz: f32, secs: f32, amp: f32) -> Vec<f32> {
        (0..(rate as f32 * secs) as usize)
            .map(|i| (2.0 * std::f32::consts::PI * hz * i as f32 / rate as f32).sin() * amp)
            .collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    #[test]
    fn splits_a_two_sided_recording() {
        let left = tone(16_000, 300.0, 1.0, 0.5);
        let right = vec![0.0; 16_000];
        let bytes = wav(16_000, &[left, right]);
        let tracks = decode(bytes, "wav", Channels::Split, &|| false).unwrap();
        assert_eq!(tracks.len(), 2);
        assert!((tracks[0].len() as i64 - 16_000).abs() < 4);
        assert!(rms(&tracks[0]) > 0.3);
        assert!(rms(&tracks[1]) < 0.001);
    }

    #[test]
    fn mixes_and_resamples_to_sixteen_kilohertz() {
        let a = tone(48_000, 440.0, 2.0, 0.4);
        let bytes = wav(48_000, &[a.clone(), a]);
        let tracks = decode(bytes, "", Channels::Mix, &|| false).unwrap();
        assert_eq!(tracks.len(), 1);
        assert!((tracks[0].len() as i64 - 32_000).abs() < 8);
        assert!((rms(&tracks[0][1000..]) - 0.4 / 2f32.sqrt()).abs() < 0.02);
    }

    #[test]
    fn refuses_what_is_not_audio() {
        let e = decode(b"not a recording".to_vec(), "mp3", Channels::Mix, &|| false).unwrap_err();
        assert_eq!(e.code(), "UNSUPPORTED_AUDIO");
    }

    #[test]
    fn stops_when_asked() {
        let bytes = wav(16_000, &[tone(16_000, 300.0, 1.0, 0.5)]);
        let e = decode(bytes, "wav", Channels::Mix, &|| true).unwrap_err();
        assert_eq!(e.code(), "CANCELLED");
    }
}
