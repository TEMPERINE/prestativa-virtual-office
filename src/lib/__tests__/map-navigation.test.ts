import { expect, it } from "vitest";
import { newOverrides } from "../map-overrides";
import { isMapWalkable } from "../office-map";
import { workspaceZonesForMap, pointInMapZone } from "../workspace-zones";
import {
  nearestWalkablePoint,
  walkablePointInZone,
  positionRecoveryDecision,
} from "../map-navigation";
const openMap = () => ({
  ...newOverrides(),
  customZones: [{ id: "custom-a", label: "Área", color: "#ff00ff" }],
});
it("only workspace zones with painted cells are claimable, using the same kind rule as editor", () => {
  const map = openMap();
  map.zones[40 * 128 + 64] = "custom-a" as never;
  expect(workspaceZonesForMap(map).map((z) => z.id)).toEqual(["custom-a"]);
  map.zoneKinds = { "custom-a": "common" };
  expect(workspaceZonesForMap(map)).toEqual([]);
});
it("zone landing tests actual painted cells instead of the bounding box", () => {
  const map = openMap();
  for (let r = 30; r < 40; r++)
    for (let c = 40; c < 50; c++) map.zones[r * 128 + c] = "custom-a" as never;
  const p = walkablePointInZone(map, "custom-a", { x: 0.8, y: 0.7 })!;
  expect(pointInMapZone(map, "custom-a", p)).toBe(true);
  expect(isMapWalkable(map, p)).toBe(true);
});
it("recovers a saved blocked position to an adjacent walkable point, leaving valid positions alone", () => {
  const map = openMap();
  const point = { x: 64.5 / 128, y: 40.5 / 80 };
  map.blocked[40 * 128 + 64] = 1;
  const safe = nearestWalkablePoint(map, point)!;
  expect(safe).not.toEqual(point);
  expect(isMapWalkable(map, safe)).toBe(true);
  expect(Math.hypot(safe.x - point.x, safe.y - point.y)).toBeLessThan(0.04);
  expect(nearestWalkablePoint(map, safe)).toBe(safe);
});
it("recovery waits for the canonical fetch and READY, then reacts to a map version change", () => {
  const point = { x: 0.5, y: 0.5 },
    map = openMap();
  const snapshot = { state: "READY" as const, version: 1, map, error: null };
  expect(positionRecoveryDecision(snapshot, point, true, false).kind).toBe("waiting");
  expect(positionRecoveryDecision({ ...snapshot, state: "SYNCING" }, point, true, true).kind).toBe(
    "waiting",
  );
  expect(positionRecoveryDecision(snapshot, point, false, true).kind).toBe("waiting");
  expect(positionRecoveryDecision(snapshot, point, true, true).kind).toBe("valid");
  const next = { ...map, blocked: map.blocked.slice() };
  next.blocked[40 * 128 + 64] = 1;
  const result = positionRecoveryDecision(
    { ...snapshot, version: 2, map: next },
    point,
    true,
    true,
  );
  expect(result.kind).toBe("recovered");
  if (result.kind === "recovered") expect(isMapWalkable(next, result.point)).toBe(true);
});
it("unusable maps never return an unsafe spawn or cause an arbitrary teleport", () => {
  const map = openMap();
  map.blocked.fill(1);
  expect(nearestWalkablePoint(map, { x: 0.5, y: 0.5 })).toBeNull();
});
