// Turns drafts into full records (base fields filled) for a ProjectBundle read from a file.
import { Hlc } from '../../hlc';
import { uuid } from '../../ids';
import type { Draft, Entity, Kind } from '../../model/types';
import { validate } from '../../model/validate';
import type { BundleRecord } from '../bundle';

/** Device id stamped on records read from REFI-QDA files (lower-case alphanumeric, as Hlc requires). */
export const IMPORT_DEVICE = 'qdpx';

export class RecordFactory {
  readonly records: BundleRecord[] = [];
  private readonly hlc: Hlc;

  constructor(private readonly now: () => Date) {
    this.hlc = new Hlc(IMPORT_DEVICE, () => now().getTime());
  }

  /**
   * Validates a draft and stores it as a live record. `created` is an ISO time from the file
   * (creationDateTime) or null for now. Throws ValidationError like Store.put would.
   */
  make<K extends Kind>(kind: K, draft: Draft<K>, created?: string | null): Entity<K> {
    const clean = validate(kind, draft);
    const record = {
      ...clean,
      id: clean.id ?? uuid(),
      created_at: created ?? this.now().toISOString(),
      updated_at_hlc: this.hlc.tick(),
      deleted: false,
    } as Entity<K>;
    this.records.push({ kind, record } as BundleRecord);
    return record;
  }
}
