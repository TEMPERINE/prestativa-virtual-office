/**
 * Etapa 12B — paridade de zona: legado v1 (callZoneAt) × regra canônica V2
 * (canonical-zones) × servidor Token V2, para o MESMO mapa + versão.
 */
import { describe, expect, it, vi } from "vitest";
import type { MapOverrides } from "@/lib/map-overrides";

let current: MapOverrides | null = null;

vi.mock("@/lib/map-overrides", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/map-overrides")>();
  return {
    ...actual,
    loadOverrides: () => current,
    zoneFromOverrides: (p: { x: number; y: number }) => {
      if (!current) return null;
      const { col, row } = actual.pointToCell(p, current.cols, current.rows);
      return current.zones[actual.cellIndex(col, row, current.cols)] ?? null;
    },
    customZonesFromOverrides: () => current?.customZones ?? [],
    // cópia fiel do legado (bounding box das células pintadas)
    zoneRectFromOverrides: (id: string) => {
      const o = current;
      if (!o) return null;
      let a = Infinity,
        b = Infinity,
        c = -Infinity,
        d = -Infinity;
      for (let r = 0; r < o.rows; r++)
        for (let k = 0; k < o.cols; k++)
          if (o.zones[r * o.cols + k] === id) {
            a = Math.min(a, k);
            c = Math.max(c, k);
            b = Math.min(b, r);
            d = Math.max(d, r);
          }
      if (!isFinite(a)) return null;
      return { x1: a / o.cols, y1: b / o.rows, x2: (c + 1) / o.cols, y2: (d + 1) / o.rows };
    },
  };
});

const { legacyCallZoneAt } = await import("@/lib/legacy-call-zone");
const { zoneIdAtPoint, classifyPoint, classifyZone, meetingZoneAtPoint, resolveMeetingZone } =
  await import("../canonical-zones");
const { normalizeMapOverrides } = await import("@/lib/map-sync");
const { issueLiveKitTokenV2, TokenV2Error } = await import("../livekit-token-v2");
const { ZONES } = await import("@/lib/office-map");
const { MAP_GRID_COLS, MAP_GRID_ROWS } = await import("@/lib/map-sync").then(
  (m) =>
    m as never as {
      MAP_GRID_COLS: number;
      MAP_GRID_ROWS: number;
    },
);

const COLS = MAP_GRID_COLS ?? 128;
const ROWS = MAP_GRID_ROWS ?? 80;

function paint(
  rects: Record<string, { x1: number; y1: number; x2: number; y2: number }>,
  holes: Array<{ x: number; y: number }> = [],
) {
  const zones: Array<string | null> = new Array(COLS * ROWS).fill(null);
  for (const [id, r] of Object.entries(rects))
    for (let row = 0; row < ROWS; row++)
      for (let col = 0; col < COLS; col++) {
        const cx = (col + 0.5) / COLS,
          cy = (row + 0.5) / ROWS;
        if (cx >= r.x1 && cx <= r.x2 && cy >= r.y1 && cy <= r.y2) zones[row * COLS + col] = id;
      }
  for (const h of holes) zones[Math.floor(h.y * ROWS) * COLS + Math.floor(h.x * COLS)] = null;
  return {
    cols: COLS,
    rows: ROWS,
    blocked: new Array(COLS * ROWS).fill(0),
    zones,
    customZones: [
      { id: "sala-x", label: "X", color: "#000", kind: "common" },
      { id: "mesa-y", label: "Y", color: "#000", kind: "workspace" },
    ],
    zoneKinds: {},
    spawnPoints: {},
  };
}

const builtin = ZONES.filter((z) => z.id !== "lobby");
const POINTS: Array<{ x: number; y: number }> = [
  { x: 0.5, y: 0.42 }, // lobby
  { x: 0.5, y: 0.5 }, // corredor
  { x: 0.02, y: 0.98 },
  { x: 0.1, y: 0.95 }, // sala-x
  { x: 0.3, y: 0.95 }, // mesa-y
  { x: 0.8, y: 0.25 }, // buraco dentro de reunião
];
for (const z of builtin) {
  const r = z.rect;
  const cx = (r.x1 + r.x2) / 2,
    cy = (r.y1 + r.y2) / 2;
  POINTS.push(
    { x: cx, y: cy },
    { x: r.x1, y: r.y1 },
    { x: r.x2, y: r.y2 },
    { x: r.x1 - 0.002, y: cy },
    { x: r.x2 + 0.002, y: cy },
  );
}

const RAW_MAPS: Record<string, unknown> = {
  "sem overrides (sem linha)": null,
  "reset (linha vazia)": {
    cols: COLS,
    rows: ROWS,
    blocked: [],
    zones: [],
    customZones: [],
    zoneKinds: {},
    spawnPoints: {},
  },
  "com overrides": paint(
    {
      reuniao: { x1: 0.7, y1: 0.06, x2: 0.9, y2: 0.42 },
      feedback: { x1: 0.8, y1: 0.6, x2: 0.93, y2: 0.84 },
      diretoria: { x1: 0.32, y1: 0.1, x2: 0.64, y2: 0.3 },
      "sala-x": { x1: 0.05, y1: 0.9, x2: 0.15, y2: 0.99 },
      "mesa-y": { x1: 0.25, y1: 0.9, x2: 0.35, y2: 0.99 },
    },
    [{ x: 0.8, y: 0.25 }],
  ),
  "com overrides + zoneKinds (reunião vira workspace)": {
    ...paint({ reuniao: { x1: 0.7, y1: 0.06, x2: 0.9, y2: 0.42 } }),
    zoneKinds: { reuniao: "workspace" },
  },
};

describe("paridade de zona v1 × V2 × servidor", () => {
  for (const [name, raw] of Object.entries(RAW_MAPS)) {
    it(`${name}: mesmo zoneId em legado e canônico`, () => {
      const map = raw ? normalizeMapOverrides(raw) : null;
      current = map;
      for (const p of POINTS) expect([p, zoneIdAtPoint(map, p)]).toEqual([p, legacyCallZoneAt(p)]);
    });

    it(`${name}: cliente V2 e Token V2 concordam em zoneId/kind/privado`, async () => {
      const map = raw ? normalizeMapOverrides(raw) : null;
      const version = 9;
      const U = "11111111-1111-4111-8111-111111111111";
      const WS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const S = "33333333-3333-4333-8333-333333333333";
      const deps = {
        canAccessRuntime: async () => true,
        isWorkspaceMember: async () => true,
        getOfficeSession: async () => ({
          user_id: U,
          session_id: S,
          generation: 1,
          workspace_id: WS,
          active: true,
        }),
        getCanonicalMap: async () => (raw ? { data: raw, version } : null),
        getDisplayName: async () => "X",
        config: { url: "wss://x", apiKey: "APIk", apiSecret: "s".repeat(40) },
      };
      const mapVersion = raw ? version : 0;
      for (const p of POINTS) {
        const c = classifyPoint(map, p);
        const client = meetingZoneAtPoint(map, p);
        expect(client).toBe(c.isPrivateRoom ? c.zoneId : null);
        if (c.zoneId === "lobby") continue;
        let server: string;
        try {
          const r = await issueLiveKitTokenV2(
            U,
            {
              context: "PRIVATE_ROOM",
              workspaceId: WS,
              sessionId: S,
              generation: 1,
              mapVersion,
              zoneId: c.zoneId,
            },
            deps,
          );
          server = r.roomName.endsWith(`:${c.zoneId}`) ? "OK" : "WRONG_ROOM";
        } catch (e) {
          server = e instanceof TokenV2Error ? e.code : String(e);
        }
        expect([p, c.zoneId, server]).toEqual([p, c.zoneId, client ? "OK" : "ZONE_NOT_PRIVATE"]);
        expect(resolveMeetingZone(map, c.zoneId).ok).toBe(!!client);
      }
    });
  }

  it("mapa vazio normaliza para null nos dois lados (zonas embutidas valem)", () => {
    expect(normalizeMapOverrides(RAW_MAPS["reset (linha vazia)"])).toBeNull();
    expect(zoneIdAtPoint(null, { x: 0.8, y: 0.2 })).toBe("reuniao");
  });
});

describe("rtcMode canônico: zoneKind separado de rtcMode", () => {
  const map = normalizeMapOverrides({
    ...paint({
      reuniao: { x1: 0.7, y1: 0.06, x2: 0.9, y2: 0.42 },
      diretoria: { x1: 0.32, y1: 0.1, x2: 0.64, y2: 0.3 },
      "custom-portaria": { x1: 0.05, y1: 0.9, x2: 0.15, y2: 0.99 },
    }),
    customZones: [{ id: "custom-portaria", label: "Portaria", color: "#000" }],
    zoneKinds: { "custom-portaria": "workspace" },
  });

  it("common -> ZONE_ROOM", () => {
    const c = classifyPoint(map, { x: 0.8, y: 0.2 });
    expect([c.zoneId, c.kind, c.rtcMode]).toEqual(["reuniao", "common", "ZONE_ROOM"]);
  });
  it("workspace -> ZONE_ROOM (sem vídeo)", () => {
    const c = classifyPoint(map, { x: 0.5, y: 0.2 });
    expect([c.zoneId, c.kind, c.supportsVideo, c.rtcMode]).toEqual([
      "diretoria",
      "workspace",
      false,
      "ZONE_ROOM",
    ]);
    expect(resolveMeetingZone(map, "diretoria").ok).toBe(true);
  });
  it("Portaria como workspace -> ZONE_ROOM", () => {
    const c = classifyPoint(map, { x: 0.1, y: 0.95 });
    expect([c.zoneId, c.kind, c.rtcMode]).toEqual(["custom-portaria", "workspace", "ZONE_ROOM"]);
  });
  it("ponto sem zona -> PROXIMITY_LOBBY", () => {
    const c = classifyPoint(map, { x: 0.5, y: 0.6 });
    expect([c.zoneId, c.rtcMode, c.isPrivateRoom]).toEqual(["lobby", "PROXIMITY_LOBBY", false]);
    expect(meetingZoneAtPoint(map, { x: 0.5, y: 0.6 })).toBeNull();
  });
  it("atendentes embutidos (sem overrides) -> ZONE_ROOM", () => {
    for (let i = 1; i <= 10; i++)
      expect(classifyZone(null, `atendente-${i}`).rtcMode).toBe("ZONE_ROOM");
  });
});
