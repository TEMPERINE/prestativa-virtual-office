/** Legacy adapter uses the same painted map geometry; no RTC/messaging logic. */
import type { Point, ZoneId } from "./office-map";
import { loadOverrides } from "./map-overrides";
import { mapZoneId } from "./workspace-zones";
export function legacyCallZoneAt(p: Point): ZoneId {
  return mapZoneId(loadOverrides(), p) as ZoneId;
}
