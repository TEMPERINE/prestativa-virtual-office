import { SPAWN, isMapWalkable, type Point } from "./office-map";
import type { MapOverrides } from "./map-overrides";
import type { MapSnapshot } from "./map-sync";
import { mapZoneId, pointInMapZone, zoneRectForMap } from "./workspace-zones";

/** Half-cell samples include valid narrow passages between original cell centres. */
export function navigationDimensions(map: MapOverrides | null) {
  return { cols: (map?.cols ?? 128) * 2, rows: (map?.rows ?? 80) * 2 };
}
function nearestCandidates(map: MapOverrides | null, origin: Point, filter?: string) {
  const { cols, rows } = navigationDimensions(map);
  let best: Point | null = null,
    bestDistance = Infinity;
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= cols; c++) {
      const p = { x: c / cols, y: r / rows },
        distance = (p.x - origin.x) ** 2 + (p.y - origin.y) ** 2;
      if (
        distance >= bestDistance ||
        (filter !== undefined && !pointInMapZone(map, filter, p)) ||
        !isMapWalkable(map, p)
      )
        continue;
      best = p;
      bestDistance = distance;
    }
  return best ? { point: best, distance: Math.sqrt(bestDistance) } : null;
}
export function walkablePointInZone(
  map: MapOverrides | null,
  id: string,
  anchor?: Point,
): Point | null {
  const spawn = map?.spawnPoints?.[id];
  if (spawn && pointInMapZone(map, id, spawn) && isMapWalkable(map, spawn)) return spawn;
  const rect = zoneRectForMap(map, id);
  if (!rect) return null;
  const origin = anchor ?? { x: (rect.x1 + rect.x2) / 2, y: (rect.y1 + rect.y2) / 2 };
  return nearestCandidates(map, origin, id)?.point ?? null;
}
export function nearestWalkablePoint(
  map: MapOverrides | null,
  p: Point,
  preferredZone = mapZoneId(map, p),
): Point | null {
  if (isMapWalkable(map, p)) return p;
  const origin = Number.isFinite(p.x) && Number.isFinite(p.y) ? p : SPAWN;
  const any = nearestCandidates(map, origin);
  const same = nearestCandidates(map, origin, preferredZone);
  const { cols, rows } = navigationDimensions(map);
  if (same && (!any || same.distance <= any.distance + 4 * Math.hypot(1 / cols, 1 / rows)))
    return same.point;
  if (any) return any.point;
  // Last resort may be a precise spawn not represented by a navigation sample.
  for (const fallback of [map?.spawnPoints?.lobby, SPAWN])
    if (fallback && isMapWalkable(map, fallback)) return fallback;
  return null;
}
export type PositionRecoveryDecision =
  { kind: "waiting" | "valid" | "unavailable" } | { kind: "recovered"; point: Point };
export function positionRecoveryDecision(
  snapshot: MapSnapshot,
  p: Point,
  hydrated: boolean,
  initialFetchComplete: boolean,
): PositionRecoveryDecision {
  if (!hydrated || !initialFetchComplete || snapshot.state !== "READY") return { kind: "waiting" };
  if (isMapWalkable(snapshot.map, p)) return { kind: "valid" };
  const point = nearestWalkablePoint(snapshot.map, p);
  return point ? { kind: "recovered", point } : { kind: "unavailable" };
}
