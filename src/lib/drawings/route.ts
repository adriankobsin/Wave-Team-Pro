/**
 * Cable runs on a drawing: polylines with points as fractions of the page (0–1, top-left origin).
 * "Straight" runs only use horizontal and vertical segments, like a line schematic.
 * A point may be pinned to a marker (`m`), so the run follows the marker when it moves.
 */
export type Pt = { x: number; y: number; m?: string };
export type Tol = { x: number; y: number };

const EPS = 1e-6;
const horizontal = (a: Pt, b: Pt) => Math.abs(a.y - b.y) < EPS;
const vertical = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < EPS;
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const pt = (x: number, y: number, m?: string): Pt => (m ? { x: clamp(x), y: clamp(y), m } : { x: clamp(x), y: clamp(y) });

/** Which way to go first from `from` to `to`: along the longer distance, unless told otherwise. */
export const longerFirst = (from: Pt, to: Pt, aspect = 1) => Math.abs(to.x - from.x) * aspect >= Math.abs(to.y - from.y);

/**
 * The points to add to reach `to` from `from`. Straight runs bend once at a right angle; when the
 * target is nearly in line (within `tol`) and isn't pinned to a marker, it is lined up exactly instead.
 */
export function routeTo(from: Pt, to: Pt, opts: { straight: boolean; horizontalFirst: boolean; tol: Tol }): Pt[] {
  const target = pt(to.x, to.y, to.m);
  if (!opts.straight) return [target];
  const dx = Math.abs(target.x - from.x), dy = Math.abs(target.y - from.y);
  if (dx < EPS || dy < EPS) return [target];
  if (!target.m && dx <= opts.tol.x) return [pt(from.x, target.y)];
  if (!target.m && dy <= opts.tol.y) return [pt(target.x, from.y)];
  const corner = opts.horizontalFirst ? pt(target.x, from.y) : pt(from.x, target.y);
  return [corner, target];
}

/** Drops repeated points and bends that aren't bends (three points in a line), keeping pinned points. */
export function normalize(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) {
      if (p.m && !last.m) out[out.length - 1] = p; // keep the pin
      continue;
    }
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    if (b.m) continue;
    if ((horizontal(a, b) && horizontal(b, c)) || (vertical(a, b) && vertical(b, c))) out.splice(i, 1);
  }
  return out;
}

/**
 * Moves point `i` to `to`. In a straight run the neighbouring segments stay horizontal / vertical:
 * a free neighbour slides along with it; a run's end or a pinned point stays put and the run gets an
 * extra bend instead.
 */
export function moveVertex(points: Pt[], i: number, to: { x: number; y: number }, straight: boolean): Pt[] {
  const old = points[i];
  const p = pt(to.x, to.y, old.m);
  const out = points.map((q) => ({ ...q }));
  out[i] = p;
  if (!straight) return out;
  const fixed = (j: number) => j === 0 || j === points.length - 1 || Boolean(points[j].m);
  // After (higher index) first so an inserted bend doesn't shift the index of the one before.
  for (const j of [i + 1, i - 1]) {
    if (j < 0 || j >= points.length) continue;
    const n = points[j];
    const h = horizontal(old, n), v = vertical(old, n);
    if (h === v) continue; // a sloped segment (or a zero-length one): nothing to keep straight
    if (!fixed(j)) {
      out[j] = h ? { ...out[j], y: p.y } : { ...out[j], x: p.x };
      continue;
    }
    const bend = h ? pt(p.x, n.y) : pt(n.x, p.y);
    out.splice(j > i ? i + 1 : i, 0, bend);
  }
  return out;
}

/** Moves every point pinned to `markerId` to the marker's new place. */
export function followMarker(points: Pt[], markerId: string, to: { x: number; y: number }, straight: boolean): Pt[] {
  let out = points;
  for (let i = points.length - 1; i >= 0; i--) if (points[i].m === markerId) out = moveVertex(out, i, to, straight);
  return normalize(out);
}

/** True when every segment is horizontal or vertical. */
export const isStraight = (points: Pt[]) => points.every((p, i) => i === 0 || horizontal(points[i - 1], p) || vertical(points[i - 1], p));

/** Length along the run, in the same units as the coordinates once scaled by `w` and `h`. */
export const runLength = (points: Pt[], w = 1, h = 1) =>
  points.reduce((s, p, i) => (i ? s + Math.hypot((p.x - points[i - 1].x) * w, (p.y - points[i - 1].y) * h) : 0), 0);

/**
 * Drags segment `i` (from point i-1 to point i) by (dx, dy). A horizontal segment moves only up or
 * down and a vertical one only sideways, so the run stays square; an end of the segment that is the
 * run's end or pinned to a marker stays where it is and a short straight stub is added to reach it.
 * A sloped segment gets a new bend in its middle instead.
 */
export function moveSegment(points: Pt[], i: number, dx: number, dy: number, straight: boolean): Pt[] {
  const a = points[i - 1], b = points[i];
  if (!a || !b) return points;
  const h = horizontal(a, b), v = vertical(a, b);
  if (!straight || h === v) {
    const mid = pt((a.x + b.x) / 2 + dx, (a.y + b.y) / 2 + dy);
    return [...points.slice(0, i), mid, ...points.slice(i)];
  }
  const ddx = v ? dx : 0, ddy = h ? dy : 0;
  const fixed = (j: number) => j === 0 || j === points.length - 1 || Boolean(points[j].m);
  const shift = (p: Pt) => pt(p.x + ddx, p.y + ddy);
  const before = points.slice(0, i - 1), after = points.slice(i + 1);
  const left = fixed(i - 1) ? [a, shift({ x: a.x, y: a.y })] : [shift(a)];
  const right = fixed(i) ? [shift({ x: b.x, y: b.y }), b] : [shift(b)];
  return [...before, ...left, ...right, ...after];
}
