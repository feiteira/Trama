import type { Kdf } from '../core/crypto/kdf';
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

  /** Sets the window title, where there is one. */
  setTitle(title: string): Promise<void>;

  /** Called when the window is about to close (final save and backup). */
  onBeforeExit(handler: () => Promise<void>): () => void;
}
