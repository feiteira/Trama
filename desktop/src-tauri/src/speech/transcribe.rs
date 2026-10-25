//! Turns 16 kHz audio into timed text with whisper.cpp, on this computer. A voice-activity
//! model (Silero) finds the stretches with speech first; only those are passed to the speech
//! model, joined with a short pause between them, so the silences of an interview (and the
//! other side's turns, on a call's separate tracks) cost no time and do not come back as
//! invented sentences. The timestamps are then mapped back onto the whole recording.

use std::ffi::c_void;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use whisper_rs::{
    DtwMode, DtwModelPreset, DtwParameters, FullParams, SamplingStrategy, WhisperContext,
    WhisperContextParameters, WhisperVadContext, WhisperVadContextParams, WhisperVadParams,
};

use super::{stopped, Job, RATE};
use crate::error::{AppError, AppResult};

#[derive(Serialize, Debug, Clone)]
pub struct Segment {
    /// Milliseconds from the start of the recording.
    pub start: u64,
    pub end: u64,
    pub text: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct Track {
    pub segments: Vec<Segment>,
    /// The language the model heard (ISO 639-1), when it was left to tell.
    pub language: Option<String>,
}

/// All processors but two (one on small machines, at most eight): the researcher goes on
/// working, perhaps on a call, while a recording is written out.
fn threads() -> i32 {
    let n = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2);
    let keep = if n > 4 { 2 } else { 1 };
    n.saturating_sub(keep).clamp(1, 8) as i32
}

const MS: usize = RATE as usize / 1000;
/// Each stretch runs on a little into the next pause, as whisper.cpp's own detection does, so
/// a last syllable is not cut.
const OVERLAP: usize = 100 * MS;
/// The pause put between stretches: enough for the model to hear a break.
const GAP: usize = 100 * MS;
/// Each stretch starts a little before the detected speech, and the joined audio with a moment
/// of silence: a short first word ("Sure.") said right at the start is easily lost.
const LEAD: usize = 200 * MS;
const START: usize = 500 * MS;

/// Where a stretch of speech sits in the joined audio and in the recording (samples).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Piece {
    joined: usize,
    original: usize,
    len: usize,
}

/// Joins the stretches of `speech` (sample ranges) into one buffer with a pause between them.
pub fn join(samples: &[f32], speech: &[(usize, usize)]) -> (Vec<f32>, Vec<Piece>) {
    let mut out = vec![0.0; START];
    let mut pieces: Vec<Piece> = Vec::with_capacity(speech.len());
    for (i, &(a, b)) in speech.iter().enumerate() {
        let after = pieces.last().map_or(0, |p| p.original + p.len);
        let a = a.saturating_sub(LEAD).max(after).min(samples.len());
        let b = if i + 1 < speech.len() { b + OVERLAP } else { b }.min(samples.len());
        if b <= a {
            continue;
        }
        if !pieces.is_empty() {
            out.extend(std::iter::repeat_n(0.0, GAP));
        }
        pieces.push(Piece {
            joined: out.len(),
            original: a,
            len: b - a,
        });
        out.extend_from_slice(&samples[a..b]);
    }
    (out, pieces)
}

/// A time in the joined audio (samples) back on the recording. In a pause between stretches a
/// start belongs to the stretch after it and an end to the one before: the model dates a turn
/// that follows a pause from the end of the pause, or from the end of the speech before it.
pub fn place(t: usize, pieces: &[Piece], is_start: bool) -> usize {
    let Some(first) = pieces.first() else {
        return t;
    };
    let mut prev = first;
    for p in pieces {
        if t < p.joined {
            // In the pause before `p`.
            return if is_start {
                p.original
            } else {
                prev.original + prev.len
            };
        }
        if t < p.joined + p.len {
            return p.original + (t - p.joined);
        }
        prev = p;
    }
    prev.original + prev.len
}

/// A pause at least this long on the recording, between two stretches, ends a segment: a turn
/// on a call, or a new thought in an interview.
const SPLIT: usize = 1000 * MS;

/// A piece of text the model wrote, with its times in the joined audio (samples).
#[derive(Debug, Clone)]
pub struct Word {
    pub t0: usize,
    pub t1: usize,
    pub text: String,
}

/// The stretch a word was said in: the one it starts in, or the next after a pause.
fn piece_of(w: &Word, pieces: &[Piece]) -> usize {
    pieces
        .iter()
        .position(|p| w.t0 < p.joined + p.len)
        .unwrap_or(pieces.len().saturating_sub(1))
}

/// One of the model's segments back on the recording, cut wherever its words cross a real
/// pause. The model may run a question, the silence while the other side answers and the next
/// question into one segment, and dates a segment that follows a pause from the end of the
/// speech before it; words, placed one by one, show where each turn began.
pub fn place_words(words: &[Word], pieces: &[Piece]) -> Vec<Segment> {
    let mut out: Vec<Segment> = Vec::new();
    let mut current: Option<(usize, Segment)> = None;
    for w in words {
        let i = piece_of(w, pieces);
        // Punctuation ends what it follows; the model dates a closing full stop late.
        let word_like = w.text.chars().any(char::is_alphanumeric);
        let new_turn = match &current {
            None => true,
            Some((j, _)) => {
                word_like
                    && i != *j
                    && pieces
                        .get(i)
                        .zip(pieces.get(i.wrapping_sub(1)))
                        .is_some_and(|(p, before)| {
                            p.original - (before.original + before.len) + OVERLAP >= SPLIT
                        })
            }
        };
        if new_turn {
            if let Some((_, seg)) = current.take() {
                out.push(seg);
            }
            // Never before the stretch the word belongs to: the model's first time is often
            // the end of the word before it.
            let start = place(w.t0, pieces, true).max(pieces.get(i).map_or(0, |p| p.original));
            current = Some((
                i,
                Segment {
                    start: (start / MS) as u64,
                    end: (start / MS) as u64,
                    text: String::new(),
                },
            ));
        }
        if let Some((j, seg)) = current.as_mut() {
            seg.text.push_str(&w.text);
            if word_like {
                *j = i;
                seg.end = seg.end.max((place(w.t1, pieces, false) / MS) as u64);
            }
        }
    }
    out.extend(current.map(|(_, s)| s));
    for s in &mut out {
        s.text = s.text.trim().to_string();
    }
    out.retain(|s| !s.text.is_empty());
    out
}

unsafe extern "C" fn abort_if_cancelled(flag: *mut c_void) -> bool {
    // SAFETY: the flag is the job's, which outlives the transcription it was handed to.
    unsafe { (*(flag as *const AtomicBool)).load(Ordering::Relaxed) }
}

pub struct Engine {
    ctx: WhisperContext,
    vad: String,
}

impl Engine {
    pub fn load(model: &Path, vad: &Path) -> AppResult<Self> {
        let params = WhisperContextParameters {
            use_gpu: false,
            // Slower than plain attention on the processor, and it would rule out DTW.
            flash_attn: false,
            // Word times from the model's alignment heads (dynamic time warping): where each
            // turn begins rests on them.
            dtw_parameters: DtwParameters {
                mode: DtwMode::ModelPreset {
                    model_preset: DtwModelPreset::LargeV3Turbo,
                },
                ..Default::default()
            },
            ..Default::default()
        };
        let ctx = WhisperContext::new_with_params(model, params)
            .map_err(|e| AppError::Coded("MODEL_UNREADABLE", e.to_string()))?;
        Ok(Engine {
            ctx,
            vad: vad.to_string_lossy().into_owned(),
        })
    }

    /// The stretches of speech in `samples` (sample ranges).
    fn speech(&self, samples: &[f32]) -> AppResult<Vec<(usize, usize)>> {
        let mut params = WhisperVadContextParams::new();
        params.set_n_threads(threads());
        params.set_use_gpu(false);
        let mut vad = WhisperVadContext::new(&self.vad, params)
            .map_err(|e| AppError::Coded("MODEL_UNREADABLE", e.to_string()))?;
        let found = vad
            .segments_from_samples(WhisperVadParams::default(), samples)
            .map_err(|e| AppError::Other(format!("voice detection failed: {e}")))?;
        // Hundredths of a second.
        let cs = RATE as f32 / 100.0;
        Ok(found
            .map(|s| {
                (
                    (s.start.max(0.0) * cs) as usize,
                    (s.end.max(0.0) * cs) as usize,
                )
            })
            .collect())
    }

    /// Transcribes one track. `track`/`tracks` place its progress within the whole job.
    pub fn run(
        &self,
        samples: &[f32],
        language: Option<&str>,
        job: &Job,
        track: usize,
        tracks: usize,
    ) -> AppResult<Track> {
        let progress = job.progress.clone();
        let base = 100 * track as i32;
        let span = tracks.max(1) as i32;
        let report =
            move |pct: i32| progress.store((base + pct.clamp(0, 100)) / span, Ordering::Relaxed);
        // A track without speech (the other side never spoke, a silent microphone) is empty.
        let speech = self.speech(samples)?;
        let (joined, pieces) = join(samples, &speech);
        if pieces.is_empty() {
            report(100);
            return Ok(Track {
                segments: Vec::new(),
                language: None,
            });
        }
        if job.cancel.load(Ordering::Relaxed) {
            return Err(stopped());
        }

        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| AppError::Other(e.to_string()))?;
        // A language the model knows, else it tells from the first half minute of speech.
        let language = language.filter(|l| whisper_rs::get_lang_id(l).is_some());
        // Greedy decoding: as accurate as a beam search on speech like this, and the time goes
        // to the encoder either way.
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(threads());
        params.set_language(Some(language.unwrap_or("auto")));
        params.set_translate(false);
        // Each stretch on its own: a misheard phrase is not carried into the next one.
        params.set_no_context(true);
        params.set_suppress_blank(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_token_timestamps(true);
        params.set_progress_callback_safe(report);
        // Not whisper-rs's set_abort_callback_safe: in 0.16 its trampoline reads the closure
        // as the wrong type, so the answer is whatever memory it lands on.
        // SAFETY: the flag lives in the job, which outlives `full` below.
        unsafe {
            params.set_abort_callback(Some(abort_if_cancelled));
            params.set_abort_callback_user_data(job.cancel.as_ptr() as *mut c_void);
        }

        let result = state.full(params, &joined);
        if job.cancel.load(Ordering::Relaxed) {
            return Err(stopped());
        }
        result.map_err(|e| AppError::Other(format!("transcription failed: {e}")))?;

        let eot = self.ctx.token_eot();
        // whisper.cpp counts in hundredths of a second.
        let at = |cs: i64| cs.max(0) as usize * 10 * MS;
        let mut segments = Vec::new();
        for seg in state.as_iter() {
            let mut words = Vec::new();
            for k in 0..seg.n_tokens() {
                let Some(tok) = seg.get_token(k) else {
                    continue;
                };
                // Timestamps, the start of a transcript and the like are not words.
                if tok.token_id() >= eot {
                    continue;
                }
                let data = tok.token_data();
                // DTW gives the moment each word is said; t0/t1 are only the fallback.
                let t = if data.t_dtw >= 0 { data.t_dtw } else { data.t0 };
                words.push(Word {
                    t0: at(t),
                    t1: at(data.t1.max(t)),
                    text: tok
                        .to_str_lossy()
                        .map(|t| t.into_owned())
                        .unwrap_or_default(),
                });
            }
            segments.extend(place_words(&words, &pieces));
        }
        let language = if language.is_some() {
            None
        } else {
            whisper_rs::get_lang_str(state.full_lang_id_from_state()).map(str::to_string)
        };
        Ok(Track { segments, language })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_the_stretches_with_a_pause() {
        let samples: Vec<f32> = (0..30 * RATE as usize).map(|i| i as f32).collect();
        let s = RATE as usize;
        let (joined, pieces) = join(&samples, &[(s / 2, 6 * s), (17 * s, 20 * s)]);
        assert_eq!(
            pieces,
            vec![
                Piece {
                    joined: START,
                    original: s / 2 - LEAD,
                    len: 6 * s - s / 2 + LEAD + OVERLAP,
                },
                Piece {
                    joined: START + 6 * s - s / 2 + LEAD + OVERLAP + GAP,
                    original: 17 * s - LEAD,
                    len: 3 * s + LEAD,
                },
            ]
        );
        assert_eq!(joined.len(), pieces[1].joined + 3 * s + LEAD);
        assert_eq!(joined[pieces[1].joined], (17 * s - LEAD) as f32);
        // A lead-in never reaches back into the stretch before.
        let (_, close) = join(&samples, &[(s, 2 * s), (2 * s + 50 * MS, 3 * s)]);
        assert_eq!(close[1].original, 2 * s + OVERLAP);
    }

    #[test]
    fn places_times_back_on_the_recording() {
        let s = RATE as usize;
        let pieces = [
            Piece {
                joined: 0,
                original: s / 2,
                len: 6 * s,
            },
            Piece {
                joined: 6 * s + GAP,
                original: 17 * s,
                len: 3 * s,
            },
        ];
        // Within a stretch: shifted to where it was said.
        assert_eq!(place(s, &pieces, true), s + s / 2);
        assert_eq!(place(6 * s + GAP + s, &pieces, true), 18 * s);
        // In the pause: a start goes to the next stretch, an end to the one before.
        assert_eq!(place(6 * s + GAP / 2, &pieces, true), 17 * s);
        assert_eq!(place(6 * s + GAP / 2, &pieces, false), 6 * s + s / 2);
        // Past the end: the end of the last stretch.
        assert_eq!(place(60 * s, &pieces, false), 20 * s);
    }

    fn word(t0: usize, t1: usize, text: &str) -> Word {
        Word {
            t0,
            t1,
            text: text.into(),
        }
    }

    #[test]
    fn cuts_a_segment_at_a_pause_and_dates_each_turn() {
        let s = RATE as usize;
        let pieces = [
            Piece {
                joined: 0,
                original: s / 2,
                len: 6 * s,
            },
            Piece {
                joined: 6 * s + GAP,
                original: 17 * s,
                len: 3 * s,
            },
        ];
        // One segment from the model: two questions ten seconds apart, the second dated from
        // the end of the first.
        let words = [
            word(0, s, " Thank"),
            word(s, 5 * s, " you"),
            // A full stop dated after the pause stays with its sentence.
            word(6 * s + GAP + s / 20, 6 * s + GAP + s / 20, "."),
            word(6 * s + GAP + s / 10, 6 * s + GAP + s, " What"),
            word(6 * s + GAP + s, 6 * s + GAP + 2 * s, " made you stay?"),
        ];
        let out = place_words(&words, &pieces);
        assert_eq!(out.len(), 2);
        assert_eq!((out[0].start, out[0].text.as_str()), (500, "Thank you."));
        assert_eq!(
            (out[1].start, out[1].text.as_str()),
            (17_100, "What made you stay?")
        );
        assert_eq!(out[1].end, 19_000);
    }

    #[test]
    fn keeps_a_segment_across_a_short_breath() {
        let s = RATE as usize;
        let pieces = [
            Piece {
                joined: 0,
                original: 0,
                len: 2 * s,
            },
            Piece {
                joined: 2 * s + GAP,
                original: 2 * s + s / 4,
                len: 2 * s,
            },
        ];
        let words = [
            word(0, s, " One"),
            word(2 * s + GAP + s / 2, 3 * s, " two."),
        ];
        let out = place_words(&words, &pieces);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "One two.");
    }
}
