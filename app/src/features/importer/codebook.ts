// "Import a codebook (.qdc)": the file's codes go into the codebook in their hierarchy. A code
// whose name is already used at the same place (same parent) is kept as it is, and the file's
// children of it go under the existing one, so importing the same codebook twice adds nothing.

import type { QdcImport } from '../../core/export/refi';
import type { Code } from '../../core/model/types';
import { nameKey } from './model';

export interface QdcPlanItem {
  /** The file's id for this code (parents refer to it). */
  fileId: string;
  name: string;
  depth: number;
  codable: boolean;
  color: string;
  /** The live code that already has this name at this place, or null: created. */
  existingId: string | null;
  /** The file's id of its parent, or null at the top. */
  parentFileId: string | null;
  draft: QdcImport['codes'][number];
}

export function planQdc(imported: QdcImport, existing: readonly Pick<Code, 'id' | 'name' | 'parent_id' | 'deleted'>[]): QdcPlanItem[] {
  const live = existing.filter((c) => !c.deleted);
  // Existing codes by parent and name.
  const byPlace = new Map<string, string>();
  for (const c of live) byPlace.set(`${c.parent_id ?? ''}\u0000${nameKey(c.name)}`, c.id);
  // File id → the existing code it lands on (for children of codes that already exist).
  const landed = new Map<string, string | null>();
  const depthOf = new Map<string, number>();
  const out: QdcPlanItem[] = [];
  for (const d of imported.codes) {
    const parentFileId = d.parent_id ?? null;
    const depth = parentFileId ? (depthOf.get(parentFileId) ?? 0) + 1 : 0;
    depthOf.set(d.id, depth);
    // Only a parent that exists can hold an existing child.
    const parentExisting = parentFileId ? landed.get(parentFileId) ?? null : null;
    const canMatch = !parentFileId || parentExisting !== null;
    const existingId = canMatch ? byPlace.get(`${parentExisting ?? ''}\u0000${nameKey(d.name)}`) ?? null : null;
    landed.set(d.id, existingId);
    out.push({ fileId: d.id, name: d.name, depth, codable: d.codable, color: d.color, existingId, parentFileId, draft: d });
  }
  return out;
}

export const freshCount = (plan: readonly QdcPlanItem[]): number => plan.filter((p) => !p.existingId).length;
