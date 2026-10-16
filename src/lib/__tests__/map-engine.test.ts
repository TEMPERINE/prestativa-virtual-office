import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  normalizeMapOverrides,
  newOverrides,
  saveOverrides,
  getZoneKind,
  isBlockedByOverrides,
  __resetMapSyncForTests,
  type MapOverrides,
} from "../map-overrides";
import { collides, canMoveOnMap } from "../office-map";

function map(): MapOverrides {
  return {
    ...newOverrides(),
    customZones: [{ id: "custom-test", label: "Área teste", color: "#00ffff" }],
  };
}
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    },
    dispatchEvent: () => true,
  });
  vi.stubGlobal(
    "CustomEvent",
    class {
      constructor(public type: string) {}
    },
  );
  __resetMapSyncForTests();
});
afterEach(() => vi.unstubAllGlobals());
it("normalizes a legacy custom zone to the workspace kind shown by the editor, without mutating the input", () => {
  const raw = map();
  const normalized = normalizeMapOverrides(raw)!;
  expect(normalized.customZones?.[0].kind).toBe("workspace");
  expect(raw.customZones?.[0].kind).toBeUndefined();
});
it("runtime resolves a legacy custom zone as workspace", () => {
  saveOverrides(map());
  expect(getZoneKind("custom-test")).toBe("workspace");
});
it("explicit common and authoritative zoneKinds survive normalization", () => {
  const raw = map();
  raw.customZones![0].kind = "common";
  saveOverrides(raw);
  expect(getZoneKind("custom-test")).toBe("common");
  raw.zoneKinds = { "custom-test": "workspace" };
  saveOverrides(raw);
  expect(getZoneKind("custom-test")).toBe("workspace");
  expect(getZoneKind("reuniao")).toBe("common");
});
it("the complete footprint detects a blocked corner that all five legacy samples miss", () => {
  const raw = map();
  raw.blocked[40 * 128 + 64] = 1;
  saveOverrides(raw);
  expect(isBlockedByOverrides({ x: 0.491, y: 0.491 }, 0.014)).toBe(true);
  expect(collides({ x: 0.491, y: 0.491 })).toBe(true);
});
it.each(["vertical", "horizontal"])("blocks a one-cell %s wall and its contact line", (axis) => {
  const raw = map();
  for (let i = 0; i < (axis === "vertical" ? 80 : 128); i++)
    raw.blocked[axis === "vertical" ? i * 128 + 64 : 40 * 128 + i] = 1;
  saveOverrides(raw);
  const near = axis === "vertical" ? { x: 0.49, y: 0.6 } : { x: 0.6, y: 0.49 };
  const tangent = axis === "vertical" ? { x: 0.486, y: 0.6 } : { x: 0.6, y: 0.486 };
  expect(collides(near)).toBe(true);
  expect(collides(tangent)).toBe(true);
});
it("valid points parallel to a wall remain clear in both directions", () => {
  const raw = map();
  for (let r = 0; r < 80; r++) raw.blocked[r * 128 + 64] = 1;
  saveOverrides(raw);
  for (let i = 0; i < 20; i++) expect(collides({ x: 0.4859, y: 0.3 + i * 0.01 })).toBe(false);
});

it("a swept movement cannot cross a thin wall even when both endpoints are clear", () => {
  const raw = map();
  for (let r = 0; r < 80; r++) raw.blocked[r * 128 + 64] = 1;
  expect(canMoveOnMap(raw, { x: 0.45, y: 0.5 }, { x: 0.55, y: 0.5 })).toBe(false);
  expect(canMoveOnMap(raw, { x: 0.4859, y: 0.3 }, { x: 0.4859, y: 0.6 })).toBe(true);
});

it("a painted L-shaped zone does not own the unpainted hole inside its bounding box", async () => {
  const { zoneIdAtPoint } = await import("../rtc/canonical-zones");
  const raw = map();
  for (let c = 60; c <= 68; c++) raw.zones[30 * 128 + c] = "custom-test" as never;
  for (let r = 31; r <= 40; r++) raw.zones[r * 128 + 60] = "custom-test" as never;
  expect(zoneIdAtPoint(raw, { x: 65.5 / 128, y: 35.5 / 80 })).toBe("lobby");
  expect(zoneIdAtPoint(raw, { x: 60.5 / 128, y: 35.5 / 80 })).toBe("custom-test");
});
