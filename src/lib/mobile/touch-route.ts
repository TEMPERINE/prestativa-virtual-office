import { canMoveOnMap, isMapWalkable, type Point } from "@/lib/office-map";
import type { MapOverrides } from "@/lib/map-overrides";
import { navigationDimensions } from "@/lib/map-navigation";

/**
 * Click-to-move (touch only): deterministic A* over the same half-cell
 * navigation samples used for position recovery. Every edge is validated by
 * the canonical `canMoveOnMap` (walls, footprint, map bounds) and by an
 * optional gate predicate (doors). The route is only a list of waypoints —
 * the existing movement loop walks it through tryMove, never teleporting.
 */
export type RouteOptions = {
  /** returns true when moving a→b crosses a closed door/gate. */
  isGated?: (a: Point, b: Point) => boolean;
  /** max distance (normalized) to look for a walkable spot near an invalid tap. */
  snapTolerance?: number;
  /** safety cap on expanded nodes. */
  maxExpanded?: number;
};

export type RouteResult = { waypoints: Point[]; goal: Point; blockedByGate: boolean } | null;

/** Só horizontal/vertical: caminhada em pernas longas, sem zigue-zague diagonal. */
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
/** Custo extra por curva (em células): prefere poucas curvas e trechos longos. */
const TURN_PENALTY_CELLS = 4;

/** Nearest walkable navigation sample to `p` within `tolerance`, or null. */
export function snapToWalkable(map: MapOverrides | null, p: Point, tolerance: number): Point | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  if (isMapWalkable(map, p)) return p;
  const { cols, rows } = navigationDimensions(map);
  const c0 = Math.round(p.x * cols), r0 = Math.round(p.y * rows);
  const span = Math.ceil(tolerance * Math.max(cols, rows));
  let best: Point | null = null, bestD = Infinity;
  for (let r = r0 - span; r <= r0 + span; r++)
    for (let c = c0 - span; c <= c0 + span; c++) {
      if (c < 0 || r < 0 || c > cols || r > rows) continue;
      const q = { x: c / cols, y: r / rows };
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > tolerance || d >= bestD || !isMapWalkable(map, q)) continue;
      best = q; bestD = d;
    }
  return best;
}

function astar(map: MapOverrides | null, start: Point, goal: Point, gated: ((a: Point, b: Point) => boolean) | null, maxExpanded: number): Point[] | null {
  const { cols, rows } = navigationDimensions(map);
  const W = cols + 1;
  const key = (c: number, r: number) => r * W + c;
  const pt = (k: number) => ({ x: (k % W) / cols, y: Math.floor(k / W) / rows });
  const ok = (a: Point, b: Point) => canMoveOnMap(map, a, b) && !(gated && gated(a, b));
  // Connect real start/goal to nearby samples (they are rarely exactly on one).
  const near = (p: Point) => {
    const out: number[] = [];
    const c0 = Math.round(p.x * cols), r0 = Math.round(p.y * rows);
    for (let r = r0 - 2; r <= r0 + 2; r++)
      for (let c = c0 - 2; c <= c0 + 2; c++) {
        if (c < 0 || r < 0 || c > cols || r > rows) continue;
        out.push(key(c, r));
      }
    return out;
  };
  if (ok(start, goal) && Math.hypot(goal.x - start.x, goal.y - start.y) < 3 / cols) return [goal];
  const goalKeys = new Set(near(goal).filter((k) => ok(pt(k), goal)));
  if (goalKeys.size === 0) return null;
  const h = (p: Point) => Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y);
  const g = new Map<number, number>();
  const parent = new Map<number, number>();
  const closed = new Set<number>();
  // Small binary heap keyed by f, tie-broken by key for determinism.
  const heap: [number, number][] = [];
  const push = (f: number, k: number) => {
    heap.push([f, k]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] < f || (heap[p][0] === f && heap[p][1] <= k)) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        const less = (a: number, b: number) => heap[a][0] < heap[b][0] || (heap[a][0] === heap[b][0] && heap[a][1] < heap[b][1]);
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  for (const k of near(start)) {
    const p = pt(k);
    if (!ok(start, p)) continue;
    const d = Math.hypot(p.x - start.x, p.y - start.y);
    g.set(k, d); parent.set(k, -1); push(d + h(p), k);
  }
  let expanded = 0;
  while (heap.length && expanded < maxExpanded) {
    const [, k] = pop();
    if (closed.has(k)) continue;
    closed.add(k); expanded++;
    const p = pt(k);
    if (goalKeys.has(k)) {
      const path: Point[] = [goal];
      let cur = k;
      while (cur !== -1) { path.unshift(pt(cur)); cur = parent.get(cur)!; }
      return path;
    }
    const c = k % W, r = Math.floor(k / W);
    for (const [dc, dr] of DIRS) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc > cols || nr > rows) continue;
      const nk = key(nc, nr);
      if (closed.has(nk)) continue;
      const q = pt(nk);
      if (!ok(p, q)) continue;
      const pk = parent.get(k);
      let turn = 0;
      if (pk != null && pk !== -1) {
        const pc = pk % W, pr = Math.floor(pk / W);
        if (c - pc !== dc || r - pr !== dr) turn = TURN_PENALTY_CELLS / cols;
      }
      const ng = g.get(k)! + Math.hypot(q.x - p.x, q.y - p.y) + turn;
      if (ng >= (g.get(nk) ?? Infinity)) continue;
      g.set(nk, ng); parent.set(nk, k); push(ng + h(q), nk);
    }
  }
  return null;
}

/** Keeps only the corners of the axis-aligned path (long straight legs, no diagonal shortcuts). */
function smooth(_start: Point, path: Point[], _ok?: (a: Point, b: Point) => boolean): Point[] {
  if (path.length <= 2) return path.slice();
  const eps = 1e-9;
  const dir = (a: Point, b: Point) => `${Math.sign(Math.abs(b.x - a.x) > eps ? b.x - a.x : 0)},${Math.sign(Math.abs(b.y - a.y) > eps ? b.y - a.y : 0)}`;
  const out: Point[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    if (dir(path[i - 1], path[i]) !== dir(path[i], path[i + 1])) out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  return out;
}

export function findTouchRoute(map: MapOverrides | null, start: Point, target: Point, opts: RouteOptions = {}): RouteResult {
  const tol = opts.snapTolerance ?? 0.04;
  const max = opts.maxExpanded ?? 60000;
  const goal = snapToWalkable(map, target, tol);
  if (!goal) return null;
  const gated = opts.isGated ?? null;
  const full = (a: Point, b: Point) => canMoveOnMap(map, a, b) && !(gated && gated(a, b));
  const path = astar(map, start, goal, gated, max);
  if (path) return { waypoints: smooth(start, path, full), goal, blockedByGate: false };
  if (!gated) return null;
  // A closed door separates us from the goal: walk the open route and let the
  // existing tryMove gate stop the avatar before the door (never crosses it).
  const walls = (a: Point, b: Point) => canMoveOnMap(map, a, b);
  const open = astar(map, start, goal, null, max);
  if (!open) return null;
  const pre: Point[] = [];
  let prev = start;
  for (const p of open) { if (gated(prev, p)) break; pre.push(p); prev = p; }
  if (pre.length === 0) return null;
  return { waypoints: smooth(start, pre, walls), goal: pre[pre.length - 1], blockedByGate: true };
}
