// Hybrid logical clock. Every write is stamped with one, so that edits made on different
// devices (or restored from a backup) can be ordered without trusting wall clocks alone.
// Format: 15-digit milliseconds, 5-digit base-36 counter, device id — fixed width, so plain
// string comparison orders stamps correctly.

export interface HlcParts {
  ms: number;
  counter: number;
  device: string;
}

const MS_WIDTH = 15;
const COUNTER_WIDTH = 5;

export function formatHlc({ ms, counter, device }: HlcParts): string {
  return `${String(ms).padStart(MS_WIDTH, '0')}-${counter.toString(36).padStart(COUNTER_WIDTH, '0')}-${device}`;
}

export function parseHlc(s: string): HlcParts {
  const m = /^(\d{15})-([0-9a-z]{5})-([0-9a-z]+)$/.exec(s);
  if (!m) throw new Error(`invalid HLC: ${s}`);
  return { ms: Number(m[1]), counter: parseInt(m[2]!, 36), device: m[3]! };
}

export const compareHlc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class Hlc {
  private ms = 0;
  private counter = 0;

  constructor(
    readonly device: string,
    private readonly now: () => number = Date.now,
  ) {
    if (!/^[0-9a-z]+$/.test(device)) throw new Error('device id must be lowercase alphanumeric');
  }

  /** A new stamp, strictly greater than every stamp this clock has issued or observed. */
  tick(): string {
    const pt = this.now();
    if (pt > this.ms) {
      this.ms = pt;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return formatHlc({ ms: this.ms, counter: this.counter, device: this.device });
  }

  /** Advances the clock past a stamp that came from elsewhere (an import, later sync). */
  observe(remote: string): void {
    const r = parseHlc(remote);
    const pt = this.now();
    const max = Math.max(pt, this.ms, r.ms);
    if (max === this.ms && max === r.ms) this.counter = Math.max(this.counter, r.counter) + 1;
    else if (max === this.ms) this.counter++;
    else if (max === r.ms) this.counter = r.counter + 1;
    else this.counter = 0;
    this.ms = max;
  }
}
