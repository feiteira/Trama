import React, { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CHROME, type Theme } from '../lib/heat';
import { forceLayout, nodeRadius, type NetEdge, type Point, separateBoxes } from '../lib/network';
import { ChartTip } from './ChartTip';
import { fitText, textWidth } from './measure';
import { useSize } from './useSize';

export interface NetworkNode {
  id: string;
  label: string;
  color: string;
  weight: number;
}

export interface NetworkProps {
  nodes: readonly NetworkNode[];
  edges: readonly NetEdge[];
  theme: Theme;
  label: string;
  nodeTip: (i: number) => ReactNode;
  edgeTip: (e: NetEdge) => ReactNode;
  onEdge?: (e: NetEdge) => void;
  /** Changes when the layout should start afresh (a new query). */
  layoutKey: string;
}

// The layout is computed once per query in unit coordinates and drawn at the frame's pixel
// size, so labels keep their size whatever the width.
const LW = 1000;
const LH = 600;
const PAD_Y = 40;
const LABEL_MAX = 150;

/**
 * Codes as nodes (area by segments, in the code's colour) and co-occurrence as links (width by
 * count). The layout is computed once per query (deterministic); nodes can be dragged, by
 * pointer, or moved with the arrow keys once focused.
 */
export const Network = forwardRef<SVGSVGElement, NetworkProps>(function Network({ nodes, edges, theme, label, nodeTip, edgeTip, onEdge, layoutKey }, svgRef) {
  const c = CHROME[theme];
  const [frame, size] = useSize<HTMLDivElement>();
  const initial = useMemo(
    () =>
      forceLayout(nodes.map((n) => ({ id: n.id, weight: n.weight })), edges, { width: LW, height: LH, iterations: 320, seed: 11, padding: 0 }).map((p) => ({ x: p.x / LW, y: p.y / LH })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutKey],
  );
  const W = Math.max(420, size.width || 800);
  const H = Math.round(Math.max(420, Math.min(620, W * 0.6)));
  // Room for labels at the sides, less of it in a narrow frame (the separation pass keeps
  // labels inside anyway).
  const PAD_X = Math.round(Math.max(48, Math.min(120, W * 0.12)));
  const maxW = Math.max(1, ...nodes.map((n) => n.weight));
  // Labels must not sit on each other: nudge nodes apart (in pixels) once per layout and size.
  const placed = useMemo(() => {
    const iw = W - 2 * PAD_X;
    const ih = H - 2 * PAD_Y;
    const sides = initial.map((q) => q.x < 0.62);
    const boxes = initial.map((q, i) => {
      const r = nodeRadius(nodes[i]?.weight ?? 0, maxW, 6, 22);
      const lw = textWidth(fitText(nodes[i]?.label ?? '', LABEL_MAX, 12, 520), 12, 520) + 8;
      const right = sides[i];
      return { x: PAD_X + q.x * iw, y: PAD_Y + q.y * ih, l: right ? r : r + lw, r: right ? r + lw : r, u: Math.max(r, 9), d: Math.max(r, 9) };
    });
    return { pos: separateBoxes(boxes, W, H, 240).map((p) => ({ x: (p.x - PAD_X) / iw, y: (p.y - PAD_Y) / ih })), sides };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, W, H, PAD_X]);
  const [pos, setPos] = useState<Point[]>(placed.pos);
  useEffect(() => setPos(placed.pos), [placed]);
  const [hover, setHover] = useState<{ kind: 'node'; i: number } | { kind: 'edge'; e: NetEdge } | null>(null);
  const [focusNode, setFocusNode] = useState<number | null>(null);
  const drag = useRef<{ i: number; id: number; moved: boolean } | null>(null);
  const svgEl = useRef<SVGSVGElement | null>(null);
  const maxE = Math.max(1, ...edges.map((e) => e.weight));
  const px = (p: Point): Point => ({ x: PAD_X + p.x * (W - 2 * PAD_X), y: PAD_Y + p.y * (H - 2 * PAD_Y) });

  const toSvg = (ev: React.PointerEvent): Point | null => {
    const svg = svgEl.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    const clamp = (v: number) => Math.max(-0.08, Math.min(1.08, v));
    return { x: clamp((p.x - PAD_X) / (W - 2 * PAD_X)), y: clamp((p.y - PAD_Y) / (H - 2 * PAD_Y)) };
  };

  const lit = (i: number) => {
    const h = hover ?? (focusNode !== null ? { kind: 'node' as const, i: focusNode } : null);
    if (!h) return true;
    if (h.kind === 'node') return h.i === i || edges.some((e) => (e.a === h.i && e.b === i) || (e.b === h.i && e.a === i));
    return h.e.a === i || h.e.b === i;
  };
  const edgeLit = (e: NetEdge) => {
    const h = hover ?? (focusNode !== null ? { kind: 'node' as const, i: focusNode } : null);
    if (!h) return true;
    if (h.kind === 'node') return e.a === h.i || e.b === h.i;
    return h.e === e;
  };

  const tipAt = (): { x: number; y: number; body: ReactNode } | null => {
    const h = hover ?? (focusNode !== null ? { kind: 'node' as const, i: focusNode } : null);
    if (!h) return null;
    if (h.kind === 'node') {
      const p = pos[h.i];
      return p ? { ...px(p), body: nodeTip(h.i) } : null;
    }
    const a = pos[h.e.a];
    const b = pos[h.e.b];
    return a && b ? { x: (px(a).x + px(b).x) / 2, y: (px(a).y + px(b).y) / 2, body: edgeTip(h.e) } : null;
  };
  const tip = tipAt();

  return (
    <div className="an-chart an-net" ref={frame} data-testid="network">
      <svg
        ref={(el) => {
          svgEl.current = el;
          if (typeof svgRef === 'function') svgRef(el);
          else if (svgRef) svgRef.current = el;
        }}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="an-net__svg"
        role="img"
        aria-label={label}
        fontSize={12}
        onPointerMove={(ev) => {
          const d = drag.current;
          if (!d) return;
          const p = toSvg(ev);
          if (!p) return;
          d.moved = true;
          setPos((cur) => cur.map((q, k) => (k === d.i ? p : q)));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          if (!drag.current) setHover(null);
        }}
      >
        <g>
          {edges.map((e) => {
            const pa = pos[e.a];
            const pb = pos[e.b];
            if (!pa || !pb) return null;
            const a = px(pa);
            const b = px(pb);
            const on = edgeLit(e);
            const w = 1 + 7 * (e.weight / maxE);
            return (
              <g key={`${e.a}-${e.b}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c.edge} strokeWidth={w} strokeLinecap="round" opacity={on ? 0.35 + 0.45 * (e.weight / maxE) : 0.08} />
                {/* A wide transparent line: the hit target is bigger than the mark. */}
                <line
                  data-export="skip"
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="transparent"
                  strokeWidth={Math.max(14, w + 8)}
                  onPointerEnter={() => !drag.current && setHover({ kind: 'edge', e })}
                  onPointerLeave={() => !drag.current && setHover(null)}
                  onClick={() => onEdge?.(e)}
                  style={{ cursor: onEdge ? 'pointer' : undefined }}
                  data-testid="network-edge"
                />
              </g>
            );
          })}
        </g>
        <g>
          {nodes.map((n, i) => {
            const q = pos[i];
            if (!q) return null;
            const p = px(q);
            const r = nodeRadius(n.weight, maxW, 6, 22);
            const on = lit(i);
            // The side chosen when labels were laid out; a dragged node flips near the right edge.
            const right = placed.sides[i] ? q.x < 0.86 : q.x < 0.1;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                opacity={on ? 1 : 0.25}
                tabIndex={0}
                role="button"
                aria-label={`${n.label}: ${n.weight}`}
                className="an-net__node"
                onFocus={() => setFocusNode(i)}
                onBlur={() => setFocusNode(null)}
                onKeyDown={(ev) => {
                  const step = ev.shiftKey ? 0.06 : 0.015;
                  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
                  if (!d) return;
                  ev.preventDefault();
                  setPos((cur) => cur.map((o, k) => (k === i ? { x: Math.max(-0.08, Math.min(1.08, o.x + d[0]!)), y: Math.max(-0.08, Math.min(1.08, o.y + d[1]!)) } : o)));
                }}
                onPointerDown={(ev) => {
                  (ev.currentTarget.ownerSVGElement ?? ev.currentTarget).setPointerCapture?.(ev.pointerId);
                  drag.current = { i, id: ev.pointerId, moved: false };
                }}
                onPointerEnter={() => !drag.current && setHover({ kind: 'node', i })}
                onPointerLeave={() => !drag.current && setHover(null)}
                style={{ cursor: 'grab' }}
                data-testid="network-node"
              >
                <circle r={r + 2} fill={c.surface} />
                <circle r={r} fill={n.color} />
                <text
                  x={right ? r + 6 : -(r + 6)}
                  y={0}
                  textAnchor={right ? 'start' : 'end'}
                  dominantBaseline="central"
                  fill={c.ink}
                  stroke={c.surface}
                  strokeWidth={4}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                  fontWeight={520}
                >
                  {fitText(n.label, LABEL_MAX, 12, 520)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {tip ? (
        <ChartTip x={tip.x} y={tip.y} bounds={size}>
          {tip.body}
        </ChartTip>
      ) : null}
    </div>
  );
});
