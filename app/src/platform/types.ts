import type { Kdf } from '../core/crypto/kdf';
import type { Transcription } from '../core/speech/types';
import type { Db } from '../core/store/db';

// Everything the app needs from the device, behind one interface. The desktop shell (Tauri),
// the browser demo and tests (memory) each provide an implementation; the phone apps will
// use the same Tauri implementation. Trama makes no network connections: there is no http
// here on purpose.
//
// On disk (desktop), inside the app data directory:
//   prefs.json                      device preferences (language, theme) — no research data
//   keyring.json                    the library key, wrapped by passphrase and recovery phrase
//   library.json                    the project list, encrypted by the caller (services/library)
//   projects/<id>/project.db        one SQLCipher database per project (+ -wal, -shm)
//   projects/<id>/blobs/<blobId>    original files and media, encrypted by the caller

export interface FileEntry {
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
  modified_ms: number;
  depth: number;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface AppInfo {
  version: string;
  /** linux | macos | windows | android | ios | web */
  os: string;
  data_dir: string;
  /** Started as the example library (`--example`), which resets at every start. */
  example: boolean;
}

export type { SpeechSegment, SpeechTrack, Transcription } from '../core/speech/types';

/** What on-device speech can do here (desktop only). */
export interface SpeechInfo {
  /** Recordings can be transcribed on this computer. */
  transcribe: boolean;
  /** Why not: a build without the speech model, or a processor the engine cannot run on. */
  reason: 'NO_MODEL' | 'UNSUPPORTED_CPU' | null;
  /** The engine and model, as the audit trail names them. */
  engine: string;
}

export interface TranscribeOptions {
  /** The file's extension, a hint for the decoder. */
  ext: string;
  /** ISO 639-1, or null to let the model tell. */
  language: string | null;
  /** 'split': the left and right channels are two speakers (a call recorded by Trama). */
  channels: 'mix' | 'split';
}

export interface TranscribeStatus {
  state: 'idle' | 'decoding' | 'transcribing' | 'done' | 'failed' | 'cancelled';
  percent: number;
  error: { code: string; message: string } | null;
}

export interface RecorderTrackStatus {
  open: boolean;
  /** The loudest sound of the last moment, 0–1. */
  level: number;
  device: string | null;
  error: string | null;
}

export interface RecorderStatus {
  recording: boolean;
  /** Milliseconds of audio recorded. */
  ms: number;
  /** The researcher's microphone (left channel). */
  mic: RecorderTrackStatus;
  /** What the computer plays: everyone else on the call (right channel). */
  system: RecorderTrackStatus;
}

/** Recorded audio: 16-bit little-endian stereo PCM at this rate. */
export const RECORDING_RATE = 16_000;

export class PlatformError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Platform {
  kind: 'desktop' | 'demo';
  info(): Promise<AppInfo>;

  /** Device preferences readable before unlock (language, theme). Never research content. */
  prefs: {
    get(): Promise<Record<string, string>>;
    set(values: Record<string, string>): Promise<void>;
  };

  /** keyring.json, which holds only wrapped keys. */
  keyring: {
    read(): Promise<string | null>;
    write(json: string): Promise<void>;
  };

  /** library.json: the project list, already encrypted by the caller. */
  libraryFile: {
    read(): Promise<string | null>;
    write(text: string): Promise<void>;
  };

  /** Removes everything: keyring, library file and every project. */
  eraseAll(): Promise<void>;

  projects: {
    /** Ids of the project folders on disk. */
    list(): Promise<string[]>;
    exists(id: string): Promise<boolean>;
    /** Opens a project's encrypted database. Throws PlatformError('WRONG_KEY') for a wrong key. */
    open(id: string, key: Uint8Array, create: boolean): Promise<Db>;
    /** Removes the project folder (database and blobs). Closes it first if it is open. */
    erase(id: string): Promise<void>;
  };

  kdf: Kdf;

  /** A project's file storage. Bytes arrive already encrypted. Ids match [a-z0-9][a-z0-9._-]*. */
  blobs: {
    write(project: string, id: string, bytes: Uint8Array): Promise<void>;
    read(project: string, id: string): Promise<Uint8Array>;
    remove(project: string, id: string): Promise<void>;
    /** Ids of the blobs stored for a project (to find files nothing points to any more). */
    list(project: string): Promise<string[]>;
    // A blob that grows as it is made (a recording): each write is durable on its own.
    /** Adds bytes at the end (creating the blob); returns its new length. */
    append(project: string, id: string, bytes: Uint8Array): Promise<number>;
    /** Overwrites from `offset` (within the blob); `truncate` ends the blob after the bytes. */
    writeAt(project: string, id: string, offset: number, bytes: Uint8Array, truncate?: boolean): Promise<void>;
    /** Up to `length` bytes from `offset`. */
    readRange(project: string, id: string, offset: number, length: number): Promise<Uint8Array>;
    size(project: string, id: string): Promise<number>;
  };

  /** Files and folders the researcher picked (absolute paths). */
  files: {
    read(path: string): Promise<Uint8Array>;
    write(path: string, bytes: Uint8Array): Promise<void>;
    list(path: string, recursive: boolean): Promise<FileEntry[]>;
    remove(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    join(dir: string, name: string): string;
  };

  dialogs: {
    pickFolder(title: string): Promise<string | null>;
    pickFiles(title: string, filters: FileFilter[], multiple: boolean): Promise<string[]>;
    saveFile(title: string, defaultName: string, filters: FileFilter[]): Promise<string | null>;
  };

  /**
   * On-device speech: transcribing recordings with the bundled model and recording a call (the
   * microphone and what the computer plays). Desktop only; absent elsewhere. Audio and text stay
   * in memory here: the caller encrypts and stores what it keeps.
   */
  speech?: {
    info(): Promise<SpeechInfo>;
    transcribe: {
      /** Starts transcribing a recording (its decrypted bytes). One at a time. */
      start(bytes: Uint8Array, opts: TranscribeOptions): Promise<void>;
      status(): Promise<TranscribeStatus>;
      /** The finished transcription, once; null until it is done. */
      take(): Promise<Transcription | null>;
      cancel(): Promise<void>;
    };
    recorder: {
      start(): Promise<RecorderStatus>;
      /** Null when not recording. */
      status(): Promise<RecorderStatus | null>;
      /** The audio recorded since the last take (see RECORDING_RATE). */
      take(): Promise<Uint8Array>;
      /** Stops and returns the rest of the audio. */
      stop(): Promise<Uint8Array>;
    };
  };

  /** Sets the window title, where there is one. */
  setTitle(title: string): Promise<void>;

  /** Called when the window is about to close (final save and backup). */
  onBeforeExit(handler: () => Promise<void>): () => void;
}
