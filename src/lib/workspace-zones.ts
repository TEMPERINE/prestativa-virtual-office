import { ZONES, zoneAt, type Point } from "./office-map";
import type { MapOverrides } from "./map-overrides";
import { resolveZoneKind } from "./map-zone-kind";
export type ZoneRect = { x1: number; y1: number; x2: number; y2: number };
export function mapZoneId(map: MapOverrides | null, p: Point): string {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x >= 1 || p.y >= 1)
    return "lobby";
  if (!map) return zoneAt(p).id;
  const id = map.zones[Math.floor(p.y * map.rows) * map.cols + Math.floor(p.x * map.cols)];
  return id &&
    id !== "lobby" &&
    (ZONES.some((z) => z.id === id) || map.customZones?.some((z) => z.id === id))
    ? id
    : "lobby";
}
export const pointInMapZone = (map: MapOverrides | null, id: string, p: Point) =>
  mapZoneId(map, p) === id;
/** Bounds are visual metadata only, never a membership predicate. */
export function zoneRectForMap(map: MapOverrides | null, id: string): ZoneRect | null {
  if (!map) return ZONES.find((z) => z.id === id)?.rect ?? null;
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (let i = 0; i < map.zones.length; i++)
    if (map.zones[i] === id) {
      const c = i % map.cols,
        r = Math.floor(i / map.cols);
      x1 = Math.min(x1, c / map.cols);
      y1 = Math.min(y1, r / map.rows);
      x2 = Math.max(x2, (c + 1) / map.cols);
      y2 = Math.max(y2, (r + 1) / map.rows);
    }
  return Number.isFinite(x1) ? { x1, y1, x2, y2 } : null;
}
/** SVG union of painted row runs, normalized within the visual bounds. */
export function zoneHitPath(map: MapOverrides | null, id: string, rect: ZoneRect): string {
  if (!map) return "M0 0H1V1H0Z";
  const parts: string[] = [];
  const w = rect.x2 - rect.x1,
    h = rect.y2 - rect.y1;
  for (let r = 0; r < map.rows; r++)
    for (let c = 0; c < map.cols; c++)
      if (map.zones[r * map.cols + c] === id) {
        const start = c;
        while (c + 1 < map.cols && map.zones[r * map.cols + c + 1] === id) c++;
        const x = (start / map.cols - rect.x1) / w,
          y = (r / map.rows - rect.y1) / h,
          right = ((c + 1) / map.cols - rect.x1) / w,
          bottom = ((r + 1) / map.rows - rect.y1) / h;
        parts.push(`M${x} ${y}H${right}V${bottom}H${x}Z`);
      }
  return parts.join("");
}
export function workspaceZonesForMap(
  map: MapOverrides | null,
): { id: string; label: string; rect: ZoneRect; path: string }[] {
  const definitions = new Map<string, { id: string; label: string }>();
  for (const zone of ZONES)
    if (zone.id !== "lobby")
      definitions.set(zone.id, { id: zone.id, label: map?.zoneLabels?.[zone.id] || zone.label });
  for (const zone of map?.customZones ?? []) definitions.set(zone.id, zone);
  const result: { id: string; label: string; rect: ZoneRect; path: string }[] = [];
  for (const zone of definitions.values())
    if (zone.id !== "lobby" && resolveZoneKind(map, zone.id) === "workspace") {
      const rect = zoneRectForMap(map, zone.id);
      if (rect) result.push({ ...zone, rect, path: zoneHitPath(map, zone.id, rect) });
    }
  return result;
}
