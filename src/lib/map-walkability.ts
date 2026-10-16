import type { Point } from "./office-map";
import type { MapOverrides } from "./map-overrides";
export const AVATAR_RADIUS = 0.014;
const EPS = 1e-12;
type Rect = { x1: number; y1: number; x2: number; y2: number };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const finitePoint = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);
export function pointSegmentDistanceSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / length, 0, 1) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}
function pointRectDistanceSq(p: Point, r: Rect) {
  return (p.x - clamp(p.x, r.x1, r.x2)) ** 2 + (p.y - clamp(p.y, r.y1, r.y2)) ** 2;
}
function intersectsRect(a: Point, b: Point, r: Rect) {
  let lo = 0,
    hi = 1;
  for (const [start, delta, min, max] of [
    [a.x, b.x - a.x, r.x1, r.x2],
    [a.y, b.y - a.y, r.y1, r.y2],
  ]) {
    if (delta === 0) {
      if (start < min || start > max) return false;
      continue;
    }
    const t1 = (min - start) / delta,
      t2 = (max - start) / delta;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
    if (lo > hi) return false;
  }
  return true;
}
/** Exact swept-circle vs cell, including tangency; no shoulder sampling or tunneling. */
export function footprintClear(a: Point, b: Point, radius: number, r: Rect): boolean {
  if (intersectsRect(a, b, r)) return false;
  let distance = Math.min(pointRectDistanceSq(a, r), pointRectDistanceSq(b, r));
  for (const p of [
    { x: r.x1, y: r.y1 },
    { x: r.x2, y: r.y1 },
    { x: r.x1, y: r.y2 },
    { x: r.x2, y: r.y2 },
  ])
    distance = Math.min(distance, pointSegmentDistanceSq(p, a, b));
  return distance > radius * radius + EPS;
}
export function footprintInPolygon(p: Point, radius: number, poly: Point[]): boolean {
  if (!finitePoint(p) || !Number.isFinite(radius) || radius < 0) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j],
      b = poly[i];
    if (pointSegmentDistanceSq(p, a, b) <= radius * radius + EPS) return false;
    if (b.y > p.y !== a.y > p.y && p.x < ((a.x - b.x) * (p.y - b.y)) / (a.y - b.y) + b.x)
      inside = !inside;
  }
  return inside;
}
/** Only cells intersecting the path's expanded bounding box are inspected. */
export function isGridPathWalkable(
  map: MapOverrides,
  a: Point,
  b: Point,
  radius = AVATAR_RADIUS,
): boolean {
  if (!finitePoint(a) || !finitePoint(b) || !Number.isFinite(radius) || radius < 0) return false;
  for (const p of [a, b])
    if (p.x - radius <= 0 || p.y - radius <= 0 || p.x + radius >= 1 || p.y + radius >= 1)
      return false;
  const minC = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius - EPS) * map.cols));
  const maxC = Math.min(map.cols - 1, Math.floor((Math.max(a.x, b.x) + radius + EPS) * map.cols));
  const minR = Math.max(0, Math.floor((Math.min(a.y, b.y) - radius - EPS) * map.rows));
  const maxR = Math.min(map.rows - 1, Math.floor((Math.max(a.y, b.y) + radius + EPS) * map.rows));
  for (let r = minR; r <= maxR; r++)
    for (let c = minC; c <= maxC; c++) {
      if (
        map.blocked[r * map.cols + c] === 1 &&
        !footprintClear(a, b, radius, {
          x1: c / map.cols,
          y1: r / map.rows,
          x2: (c + 1) / map.cols,
          y2: (r + 1) / map.rows,
        })
      )
        return false;
    }
  return true;
}
export function isGridWalkable(map: MapOverrides, p: Point, radius = AVATAR_RADIUS): boolean {
  return isGridPathWalkable(map, p, p, radius);
}
