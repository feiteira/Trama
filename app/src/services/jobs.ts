// Long jobs (imports, exports, backups) stop when Trama locks, before its keys are wiped: each
// one is handed a `shouldStop` and asks it before every step that reads or writes. A lock that
// lands in the middle of a step (the project's file operations then throw LOCKED, see
// `isLocked` in services/project.ts) stops the job the same way.

/** The job stopped because Trama is locking; nothing more was written after it was asked to. */
export class JobStopped extends Error {
  constructor() {
    super('stopped: Trama is locking');
  }
}

/** A function that throws `JobStopped` once `shouldStop` says yes. */
export function stopper(shouldStop?: () => boolean): () => void {
  return () => {
    if (shouldStop?.()) throw new JobStopped();
  };
}
