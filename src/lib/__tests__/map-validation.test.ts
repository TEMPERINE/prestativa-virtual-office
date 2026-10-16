import { expect, it } from "vitest";
import { newOverrides, type MapOverrides } from "../map-overrides";
import { validateMap } from "../map-validation";
function fixture(): MapOverrides {
  const m = newOverrides();
  m.customZones = [{ id: "custom-a", label: "Área A", color: "#fff", kind: "workspace" }];
  for (let r = 30; r <= 40; r++)
    for (let c = 50; c <= 65; c++) m.zones[r * 128 + c] = "custom-a" as never;
  m.spawnPoints = { "custom-a": { x: 58 / 128, y: 35 / 80 } };
  return m;
}
it("accepts a usable workspace with a walkable route outside its painted area", () => {
  expect(validateMap(fixture()).valid).toBe(true);
});
it("blocks a declared area with no painted cells", () => {
  const m = fixture();
  m.zones.fill(null);
  expect(validateMap(m).issues.some((i) => i.code === "ZONE_EMPTY" && i.severity === "error")).toBe(
    true,
  );
});
it("detects blocked and outside-zone spawns independently", () => {
  const m = fixture();
  m.blocked[35 * 128 + 58] = 1;
  expect(validateMap(m).issues.some((i) => i.code === "SPAWN_BLOCKED")).toBe(true);
  const n = fixture();
  n.spawnPoints!["custom-a"] = { x: 0.8, y: 0.6 };
  expect(validateMap(n).issues.some((i) => i.code === "SPAWN_OUTSIDE")).toBe(true);
});
it("detects a fully blocked workspace without claiming its bbox is usable", () => {
  const m = fixture();
  for (let i = 0; i < m.zones.length; i++) if (m.zones[i]) m.blocked[i] = 1;
  const result = validateMap(m);
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "ZONE_BLOCKED")).toBe(true);
});
it("detects a walkable workspace sealed off from the corridor", () => {
  const m = fixture();
  for (let r = 28; r <= 42; r++)
    for (let c = 48; c <= 67; c++)
      if (r === 28 || r === 42 || c === 48 || c === 67) m.blocked[r * 128 + c] = 1;
  for (let r = 29; r <= 41; r++)
    for (let c = 49; c <= 66; c++) m.zones[r * 128 + c] = "custom-a" as never;
  expect(validateMap(m).issues.some((i) => i.code === "WORKSPACE_NO_EXIT")).toBe(true);
});
it("permits a missing explicit spawn with a warning and a safe implicit landing", () => {
  const m = fixture();
  m.spawnPoints = {};
  const result = validateMap(m);
  expect(result.valid).toBe(true);
  expect(result.issues.some((i) => i.code === "SPAWN_MISSING" && i.severity === "warning")).toBe(
    true,
  );
});
it("a four-column corridor fits the existing footprint even between original cell centres", () => {
  const m = fixture();
  m.blocked.fill(1);
  m.zones.fill(null);
  for (let r = 20; r <= 60; r++)
    for (let c = 60; c <= 63; c++) {
      m.blocked[r * 128 + c] = 0;
      if (r < 40) m.zones[r * 128 + c] = "custom-a" as never;
    }
  m.spawnPoints = { "custom-a": { x: 62 / 128, y: 30 / 80 } };
  expect(validateMap(m).valid).toBe(true);
});
