import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { MapSyncController, normalizeMapOverrides } from "@/lib/map-sync";

// Banco simulado: uma linha por workspace + trigger map_overrides_bump_version.
type Row = { workspace_id: string; data: unknown; version: number };
const db = { row: null as Row | null, deletes: 0 };
function upsert(data: unknown) {
  db.row = db.row
    ? { ...db.row, data, version: db.row.version + 1 }
    : { workspace_id: "ws1", data, version: 1 };
  return db.row;
}

vi.mock("@/integrations/supabase/client", () => {
  const from = () => {
    let pending: Row | null = null;
    const q = {
      upsert: (v: { data: unknown }) => {
        pending = upsert(v.data);
        return q;
      },
      select: () => q,
      eq: () => q,
      single: async () => ({ data: pending, error: null }),
      maybeSingle: async () => ({ data: db.row, error: null }),
      delete: () => {
        db.deletes++;
        return q;
      },
    };
    return q;
  };
  return { supabase: { from, rpc: async () => ({ data: false, error: null }), auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } } };
});

const small = (z: string) => ({
  cols: 2,
  rows: 2,
  blocked: [1, 0, 0, 0],
  zones: [z, null, null, null],
});
const fetchRow = async () => (db.row ? { data: db.row.data, version: db.row.version } : null);

async function freshModule() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: () => true,
  });
  vi.stubGlobal(
    "CustomEvent",
    class {
      constructor(public type: string) {}
    },
  );
  const cur = await import("@/lib/workspace/current");
  cur.setCurrentWorkspaceId("ws1");
  const mo = await import("@/lib/map-overrides");
  mo.__resetMapSyncForTests();
  return { mo, store };
}

beforeEach(() => {
  db.row = { workspace_id: "ws1", data: small("a"), version: 17 };
  db.deletes = 0;
});

describe("Etapa 4B — reset sem DELETE", () => {
  it("1/2. version 17 + reset = 18; nova edição = 19", async () => {
    const { mo } = await freshModule();
    await mo.pullOverridesFromCloud();
    expect(mo.getMapSync().snapshot().version).toBe(17);
    expect((await mo.clearOverridesInCloud()).ok).toBe(true);
    expect(db.row!.version).toBe(18);
    expect(mo.getMapSync().snapshot()).toMatchObject({ version: 18, map: null, state: "READY" });
    await mo.pushOverridesToCloud(small("b") as never);
    expect(db.row!.version).toBe(19);
    expect(mo.getMapSync().snapshot().version).toBe(19);
    expect(db.deletes).toBe(0);
  });

  it("3/6. resets consecutivos sempre aumentam version, nunca diminuem", async () => {
    const { mo } = await freshModule();
    await mo.pullOverridesFromCloud();
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      await mo.clearOverridesInCloud();
      seen.push(mo.getMapSync().snapshot().version);
    }
    expect(seen).toEqual([18, 19, 20]);
    expect(db.row!.workspace_id).toBe("ws1");
  });

  it("4. cliente em 17 recebe aviso de reset e converge para 18 com mapa base", async () => {
    const other = new MapSyncController({ fetchCanonical: fetchRow });
    await other.load();
    expect(other.snapshot().version).toBe(17);
    upsert(normalizeMapOverrides(small("x")) && { cols: 128, rows: 80, blocked: [], zones: [] });
    await other.notify(18);
    expect(other.snapshot()).toMatchObject({ state: "READY", version: 18, map: null });
  });

  it("5. cliente que abre depois do reset recebe mapa base em version 18", async () => {
    const { mo } = await freshModule();
    await mo.clearOverridesInCloud(); // 17 -> 18
    const late = new MapSyncController({ fetchCanonical: fetchRow });
    await late.load();
    expect(late.snapshot()).toMatchObject({ state: "READY", version: 18, map: null });
  });

  it("7. cache antigo é substituído pelo estado resetado", async () => {
    const { mo, store } = await freshModule();
    await mo.pullOverridesFromCloud();
    expect(JSON.parse(store.get(mo.STORAGE_KEY)!).version).toBe(17);
    await mo.clearOverridesInCloud();
    const env = JSON.parse(store.get(mo.STORAGE_KEY)!);
    expect(env).toMatchObject({ version: 18, data: null, workspaceId: "ws1" });
    mo.__resetMapSyncForTests(); // reabre: restaura cache resetado, não o antigo
    expect(mo.loadOverrides()).toBeNull();
    expect(mo.getMapSync().snapshot().version).toBe(18);
  });

  it("documento vazio normaliza para null (mesma interpretação de 'sem overrides')", () => {
    expect(normalizeMapOverrides({ cols: 128, rows: 80, blocked: [0], zones: [null] })).toBeNull();
  });

  it("8. nenhum caminho de reset executa DELETE em map_overrides", () => {
    const src = readFileSync("src/lib/map-overrides.ts", "utf8");
    const editor = readFileSync("src/components/office/MapEditor.tsx", "utf8");
    expect(src).not.toMatch(/\.delete\(/);
    expect(editor).not.toMatch(/from\("map_overrides"\)[\s\S]{0,40}\.delete\(/);
  });
});
