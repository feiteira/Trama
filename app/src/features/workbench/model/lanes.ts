// Lanes for things that overlap along one axis: the coding stripes in the margin (vertical
// pixel extents) and the underline bands of highlights (text offsets). Greedy interval
// colouring: items in order of start (longer first on ties), each taking the lowest lane free
// at its start. A lone item always gets lane 0, and the number of lanes used never exceeds
// the deepest overlap, which is the least possible.

export interface LaneItem {
  id: string;
  lo: number;
  hi: number;
}

export interface Lanes {
  lane: Map<string, number>;
  /** Lanes used (0 when there are no items). */
  count: number;
}

/**
 * Assigns lanes. Two items share a lane only when one ends at least `gap` before the other
 * starts (gap 0: touching items, such as adjacent text spans, may share).
 */
export function assignLanes(items: readonly LaneItem[], gap = 0): Lanes {
  const sorted = [...items].sort((a, b) => a.lo - b.lo || b.hi - a.hi || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ends: number[] = [];
  const lane = new Map<string, number>();
  for (const it of sorted) {
    let k = 0;
    while (k < ends.length && it.lo < ends[k]! + gap) k++;
    ends[k] = Math.max(it.hi, it.lo);
    lane.set(it.id, k);
  }
  return { lane, count: ends.length };
}

/**
 * For each item, how many lanes its overlap cluster uses (a cluster is a chain of overlapping
 * items). The margin uses it to give a stripe more room where its neighbourhood is sparse.
 */
export function clusterWidths(items: readonly LaneItem[], lanes: Lanes, gap = 0): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.lo - b.lo || b.hi - a.hi);
  const out = new Map<string, number>();
  let cluster: LaneItem[] = [];
  let reach = -Infinity;
  const flush = () => {
    let max = 0;
    for (const it of cluster) max = Math.max(max, (lanes.lane.get(it.id) ?? 0) + 1);
    for (const it of cluster) out.set(it.id, max);
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.lo >= reach + gap) {
      flush();
      reach = -Infinity;
    }
    cluster.push(it);
    reach = Math.max(reach, it.hi);
  }
  flush();
  return out;
}
