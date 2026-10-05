// A force-directed layout for the co-occurrence network (Fruchterman–Reingold with a cooling
// schedule). Deterministic: the start positions come from a seeded generator, so the same
// matrix always gives the same picture, and a reload does not reshuffle what the researcher
// has learnt to read.

export interface NetNode {
  id: string;
  /** Segments of the code: sets the node's size. */
  weight: number;
}

export interface NetEdge {
  /** Node indexes. */
  a: number;
  b: number;
  weight: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  iterations?: number;
  seed?: number;
  /** Kept free around the border (labels need room). */
  padding?: number;
}

/** Mulberry32: a small, good-enough seeded generator. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Edges of a symmetric matrix (upper triangle, values > 0), heaviest first. */
export function edgesOf(matrix: readonly (readonly number[])[], minWeight = 1): NetEdge[] {
  const out: NetEdge[] = [];
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i]!;
    for (let j = i + 1; j < row.length; j++) {
      const w = row[j]!;
      if (w >= minWeight && w > 0) out.push({ a: i, b: j, weight: w });
    }
  }
  return out.sort((p, q) => q.weight - p.weight || p.a - q.a || p.b - q.b);
}

/**
 * Positions for the nodes inside [padding, width − padding] × [padding, height − padding].
 * Connected codes attract in proportion to how often they co-occur; every pair repels.
 * Isolated nodes drift to the edge, which reads correctly: they co-occur with nothing.
 */
export function forceLayout(nodes: readonly NetNode[], edges: readonly NetEdge[], opts: LayoutOptions): Point[] {
  const n = nodes.length;
  const pad = opts.padding ?? 40;
  const W = Math.max(1, opts.width - 2 * pad);
  const H = Math.max(1, opts.height - 2 * pad);
  if (n === 0) return [];
  if (n === 1) return [{ x: opts.width / 2, y: opts.height / 2 }];
  const rnd = seeded(opts.seed ?? 7);
  // Start on a circle with a little jitter: a stable, untangled beginning.
  const pos = nodes.map((_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: W / 2 + (W / 3) * Math.cos(a) + (rnd() - 0.5) * 10, y: H / 2 + (H / 3) * Math.sin(a) + (rnd() - 0.5) * 10 };
  });
  const k = 0.9 * Math.sqrt((W * H) / n);
  const maxW = edges.reduce((m, e) => Math.max(m, e.weight), 0) || 1;
  const iterations = opts.iterations ?? 300;
  // Gravity balances the repulsion of the whole cloud at about this radius, so codes that
  // co-occur with nothing settle in a ring around the connected ones instead of drifting off.
  const R0 = 0.42 * Math.min(W, H);
  const gravity = (n * k * k) / (R0 * R0 * R0);
  let temp = Math.min(W, H) / 6;
  const cool = temp / (iterations + 1);
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      const p = pos[i]!;
      for (let j = i + 1; j < n; j++) {
        const q = pos[j]!;
        let ex = p.x - q.x;
        let ey = p.y - q.y;
        let d2 = ex * ex + ey * ey;
        if (d2 < 0.01) {
          // Same spot: nudge apart deterministically.
          ex = ((i - j) % 3) + 0.1;
          ey = ((j * 7) % 5) - 2 + 0.1;
          d2 = ex * ex + ey * ey;
        }
        const d = Math.sqrt(d2);
        const f = (k * k) / d;
        dx[i]! += (ex / d) * f;
        dy[i]! += (ey / d) * f;
        dx[j]! -= (ex / d) * f;
        dy[j]! -= (ey / d) * f;
      }
    }
    for (const e of edges) {
      const p = pos[e.a]!;
      const q = pos[e.b]!;
      const ex = p.x - q.x;
      const ey = p.y - q.y;
      const d = Math.sqrt(ex * ex + ey * ey) || 0.01;
      const f = ((d * d) / k) * (0.4 + 1.6 * (e.weight / maxW));
      dx[e.a]! -= (ex / d) * f;
      dy[e.a]! -= (ey / d) * f;
      dx[e.b]! += (ex / d) * f;
      dy[e.b]! += (ey / d) * f;
    }
    for (let i = 0; i < n; i++) {
      const gx = W / 2 - pos[i]!.x;
      const gy = H / 2 - pos[i]!.y;
      const gd = Math.sqrt(gx * gx + gy * gy);
      dx[i]! += gx * gravity * gd;
      dy[i]! += gy * gravity * gd;
      const d = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!) || 1;
      const step = Math.min(d, temp);
      pos[i]!.x += (dx[i]! / d) * step;
      pos[i]!.y += (dy[i]! / d) * step;
    }
    temp = Math.max(0.5, temp - cool);
  }
  return fit(pos, W, H).map((p) => ({ x: p.x + pad, y: p.y + pad }));
}

/**
 * Scales the cloud of points into the box. The simulation is radial, so the cloud comes out
 * round; in a wide box it is stretched (at most 1.7 times more on one axis) so it uses the
 * width without distorting distances much.
 */
function fit(pos: Point[], W: number, H: number): Point[] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pos) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const w = Math.max(1e-9, x1 - x0);
  const h = Math.max(1e-9, y1 - y0);
  const s = Math.min(W / w, H / h);
  const sx = Math.min(W / w, s * 1.7);
  const sy = Math.min(H / h, s * 1.7);
  const ox = (W - w * sx) / 2;
  const oy = (H - h * sy) / 2;
  return pos.map((p) => ({ x: ox + (p.x - x0) * sx, y: oy + (p.y - y0) * sy }));
}

/** Node radius for a weight, by area (sqrt), between rMin and rMax. */
export function nodeRadius(weight: number, maxWeight: number, rMin = 6, rMax = 26): number {
  if (maxWeight <= 0 || weight <= 0) return rMin;
  return rMin + (rMax - rMin) * Math.sqrt(Math.min(1, weight / maxWeight));
}

export interface LabelBox {
  /** Node centre. */
  x: number;
  y: number;
  /** Extent around the centre: left, right, up, down (a node with its label beside it). */
  l: number;
  r: number;
  u: number;
  d: number;
}

/**
 * Nudges nodes apart until no node-and-label box overlaps another (or `iterations` run out),
 * moving along the axis that needs the smaller push, within [0, W] × [0, H]. Deterministic.
 */
export function separateBoxes(boxes: readonly LabelBox[], W: number, H: number, iterations = 80, gap = 4): Point[] {
  const p = boxes.map((b) => ({ x: b.x, y: b.y }));
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const ax0 = p[i]!.x - a.l - gap;
        const ax1 = p[i]!.x + a.r + gap;
        const bx0 = p[j]!.x - b.l;
        const bx1 = p[j]!.x + b.r;
        const ay0 = p[i]!.y - a.u - gap;
        const ay1 = p[i]!.y + a.d + gap;
        const by0 = p[j]!.y - b.u;
        const by1 = p[j]!.y + b.d;
        const ox = Math.min(ax1, bx1) - Math.max(ax0, bx0);
        const oy = Math.min(ay1, by1) - Math.max(ay0, by0);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        // Vertical pushes are cheaper to read than horizontal ones (labels run sideways), unless
        // the border leaves no room to move up or down.
        const up = p[i]!.y <= p[j]!.y ? i : j;
        const down = up === i ? j : i;
        const roomUp = p[up]!.y - boxes[up]!.u;
        const roomDown = H - boxes[down]!.d - p[down]!.y;
        if (oy <= ox * 1.5 && roomUp + roomDown > oy) {
          // Share the push, giving the side with less room only what it has.
          const u = Math.min(roomUp, Math.max(oy / 2, oy - roomDown)) + 0.25;
          p[up]!.y -= u;
          p[down]!.y += oy - u + 0.5;
        } else {
          const s = (ox / 2 + 0.5) * (p[i]!.x <= p[j]!.x ? -1 : 1);
          p[i]!.x += s;
          p[j]!.x -= s;
        }
      }
    }
    for (let i = 0; i < p.length; i++) {
      const b = boxes[i]!;
      p[i]!.x = Math.max(b.l, Math.min(W - b.r, p[i]!.x));
      p[i]!.y = Math.max(b.u, Math.min(H - b.d, p[i]!.y));
    }
    if (!moved) break;
  }
  return p;
}
