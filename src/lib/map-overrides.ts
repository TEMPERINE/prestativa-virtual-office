import { usesSuperadminTransport } from "@/lib/admin/workspace-access";
// Tile-based overrides painted in the Map Editor.
// Persisted to localStorage so the OfficeScene picks them up automatically.

import type { ZoneId } from "./office-map";
import {
  MapSyncController,
  normalizeMapOverrides,
  isMapOverridesShape,
  type CanonicalMapRow,
  type MapSnapshot,
} from "./map-sync";

import { getCurrentWorkspaceId } from "./workspace/current";

export { normalizeMapOverrides };

export const GRID_COLS = 128;
export const GRID_ROWS = 80;
export const STORAGE_KEY = "office-map-overrides:v1";

export type ZoneKind = "workspace" | "common";
export type CustomZone = { id: string; label: string; color: string; kind?: ZoneKind };

export type SpawnPoint = { x: number; y: number };

export type PropAction = { type: "gate-zone"; zoneId: string; blockedFrame: number };

export type PropInstance = {
  id: string; // uuid local
  defId: string; // ref ao PROP_CATALOG
  x: number; // centro normalizado 0..1
  y: number;
  w: number; // largura normalizada (altura derivada do aspectRatio)
  interactive: boolean; // toggle pelo editor
  frame?: number; // frame inicial padrão (se não houver prop_state remoto)
  actions?: PropAction[]; // efeitos do prop sobre o mundo (ex.: trancar sala)
};

export type MapOverrides = {
  cols: number;
  rows: number;
  blocked: number[];
  zones: (ZoneId | null)[];
  customZones?: CustomZone[];
  zoneKinds?: Record<string, ZoneKind>;
  spawnPoints?: Record<string, SpawnPoint>;
  // Nomes personalizados para zonas embutidas (id -> nome).
  zoneLabels?: Record<string, string>;
  // Elementos visuais sobrepostos ao mapa (mobília, portas etc.)
  props?: PropInstance[];
  // Tema visual do escritório (id em office-themes.ts). Default = "default".
  theme?: string;
  // Quando theme === "custom", url da imagem de fundo enviada pelo admin.
  customTheme?: { url: string; label?: string };
};

function emptyOverrides(): MapOverrides {
  const size = GRID_COLS * GRID_ROWS;
  return {
    cols: GRID_COLS,
    rows: GRID_ROWS,
    blocked: new Array(size).fill(0),
    zones: new Array(size).fill(null),
    customZones: [],
    zoneKinds: {},
    spawnPoints: {},
  };
}

// Defaults for built-in zones — workstations are claimable, social rooms are common.
export const DEFAULT_ZONE_KINDS: Record<string, ZoneKind> = {
  "atendente-1": "workspace",
  "atendente-2": "workspace",
  "atendente-3": "workspace",
  "atendente-4": "workspace",
  "atendente-5": "workspace",
  "atendente-6": "workspace",
  "atendente-7": "workspace",
  "atendente-8": "workspace",
  "atendente-9": "workspace",
  "atendente-10": "workspace",
  supervisao: "workspace",
  diretoria: "workspace",
  reuniao: "common",
  feedback: "common",
  descompressao: "common",
  lobby: "common",
};

export function getZoneKind(id: string): ZoneKind {
  const o = loadOverrides();
  const override = o?.zoneKinds?.[id];
  if (override) return override;
  const custom = o?.customZones?.find((c) => c.id === id);
  if (custom?.kind) return custom.kind;
  return DEFAULT_ZONE_KINDS[id] ?? "common";
}

export function setZoneKind(id: string, kind: ZoneKind) {
  const o = loadOverrides() ?? emptyOverrides();
  const next: MapOverrides = { ...o, zoneKinds: { ...(o.zoneKinds ?? {}), [id]: kind } };
  saveOverrides(next);
}

// ---- Estado canônico (RTC v2 Etapa 4) -----------------------------------
// Única estrutura consumida por loadOverrides()/zoneFromOverrides()/callZoneAt.
// Só é escrita pelo MapSyncController, que normaliza toda entrada.

type CacheEnvelope = { version: number; data: unknown; workspaceId?: string | null };

function readCacheEnvelope(): CacheEnvelope | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "data" in parsed && "version" in parsed) {
      const env = parsed as CacheEnvelope;
      return { version: Number(env.version) || 0, data: env.data, workspaceId: env.workspaceId };
    }
    return { version: 0, data: parsed }; // formato legado sem versão
  } catch (e) {
    console.warn("[map-sync] cache local ilegível", e);
    return null;
  }
}

function persist(s: MapSnapshot) {
  if (typeof window === "undefined") return;
  try {
    // Sempre grava o envelope com version: um reset (map null) substitui o cache antigo.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: s.version, data: s.map, workspaceId: controllerWs }),
    );
  } catch (e) {
    console.warn("[map-sync] falha ao gravar cache local", e);
  }
  window.dispatchEvent(new CustomEvent("map-overrides-changed"));
}

async function fetchCanonicalRow(): Promise<CanonicalMapRow> {
  const ws = await getWs();
  if (!ws) return null;
  const { supabase } = await import("@/integrations/supabase/client");
  if (await usesSuperadminTransport()) {
    const { adminReadWorkspaceMap } = await import("@/lib/admin/workspace-resources.functions");
    const row = await adminReadWorkspaceMap({ data: { workspaceId: ws } });
    return row ? { data: row.data, version: Number(row.version) } : null;
  }
  const { data, error } = await supabase
    .from("map_overrides")
    .select("data, version")
    .eq("workspace_id", ws)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { data: data.data, version: Number(data.version) };
}

let controller: MapSyncController | null = null;
let controllerWs: string | null = null;
let restored = false;

// Um controller por workspace ativo: version de um espaço nunca vaza para outro.
export function getMapSync(): MapSyncController {
  const ws = getCurrentWorkspaceId();
  if (!controller || ws !== controllerWs) {
    controller = new MapSyncController({ fetchCanonical: fetchCanonicalRow, onChange: persist });
    controllerWs = ws;
    restored = false;
  }
  if (!restored && typeof window !== "undefined") {
    restored = true;
    const env = readCacheEnvelope();
    // Cache de outro workspace é descartado; legado (sem workspaceId) vira versão 0.
    if (env && (env.workspaceId == null || env.workspaceId === ws)) {
      controller.restoreCache(env.data, env.workspaceId ? env.version : 0);
    }
  }
  return controller;
}

/** Apenas para testes. */
export function __resetMapSyncForTests() {
  controller = null;
  controllerWs = null;
  restored = false;
}

export function loadOverrides(): MapOverrides | null {
  if (typeof window === "undefined") return null;
  return getMapSync().snapshot().map;
}

export function saveOverrides(o: MapOverrides) {
  getMapSync().applyLocalEdit(o);
}

export function clearOverrides() {
  getMapSync().applyCleared();
}

// ---- Cloud sync (Lovable Cloud) ----------------------------------------

async function getWs(): Promise<string | null> {
  const { getCurrentWorkspaceId } = await import("@/lib/workspace/current");
  return getCurrentWorkspaceId();
}

export async function pullOverridesFromCloud(): Promise<MapOverrides | null> {
  if (typeof window === "undefined") return null;
  await getMapSync().load();
  return getMapSync().snapshot().map;
}

// Canal privado de aviso de versão (workspace:{id}:map). Só transporta `version`.
type MapChannel = import("@supabase/supabase-js").RealtimeChannel;
let mapChannel: MapChannel | null = null;

export async function pushOverridesToCloud(
  o: MapOverrides,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ws = await getWs();
    if (!ws) return { ok: false, error: "Nenhum workspace ativo." };
    if (!isMapOverridesShape(o)) return { ok: false, error: "Mapa inválido." };
    // Mapa vazio persiste o documento vazio canônico (mesma linha, trigger incrementa version).
    const normalized = normalizeMapOverrides(o) ?? emptyOverrides();
    const { supabase } = await import("@/integrations/supabase/client");
    const { data: userData } = await supabase.auth.getUser();
    const privileged = await usesSuperadminTransport();
    const result = privileged
      ? { data: await (await import("@/lib/admin/workspace-resources.functions")).adminWriteWorkspaceMap({ data: { workspaceId: ws, map: normalized } }), error: null }
      : await supabase
      .from("map_overrides")
      .upsert(
        {
          workspace_id: ws,
          data: JSON.parse(JSON.stringify(normalized)),
          updated_by: userData.user?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id" },
      )
      .select("data, version")
      .single();
    const { data, error } = result;
    if (error || !data) return { ok: false, error: error?.message ?? "Mapa não confirmado." };
    const version = Number(data.version);
    getMapSync().applyConfirmed(data.data, version);
    if (mapChannel) {
      mapChannel
        .send({ type: "broadcast", event: "map_version", payload: { version } })
        .catch((e) => console.warn("[map-sync] falha ao anunciar versão", e));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Reset do mapa: NUNCA apaga a linha. Grava o documento vazio canônico via
 * upsert na mesma linha do workspace; o trigger incrementa version (17 → 18).
 */
export async function clearOverridesInCloud(): Promise<{ ok: boolean; error?: string }> {
  const res = await pushOverridesToCloud(emptyOverrides());
  if (!res.ok) console.warn("[map-sync] falha ao resetar mapa", res.error);
  return res;
}

export function subscribeOverridesFromCloud(onChange: (o: MapOverrides | null) => void) {
  let cancelled = false;
  let cleanup = () => {};
  (async () => {
    const ws = await getWs();
    if (!ws) return;
    const { supabase } = await import("@/integrations/supabase/client");
    if (cancelled) return;
    const sync = getMapSync();
    const deliver = () => {
      if (!cancelled) onChange(sync.snapshot().map);
    };
    const onVersion = (v: unknown) => {
      const p = sync.notify(Number(v));
      if (p) p.then(deliver);
    };
    const suffix = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    // postgres_changes: apenas extrai `version`; o mapa é rebuscado e normalizado.
    const pgChannel = supabase
      .channel(`map_overrides:${ws}:${suffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "map_overrides", filter: `workspace_id=eq.${ws}` },
        (payload) => {
          const next = payload.new as { version?: number } | null;
          if (next && next.version != null) onVersion(next.version);
          else if (payload.eventType === "DELETE") {
            // Legado: reset não apaga mais a linha. Revalida no banco sem regredir version.
            sync.load().then(deliver);
          }
        },
      );
    const bcChannel = supabase
      .channel(`workspace:${ws}:map`, { config: { private: true } })
      .on("broadcast", { event: "map_version" }, ({ payload }) => onVersion(payload?.version));
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (token) {
      try {
        await supabase.realtime.setAuth(token);
      } catch (e) {
        console.warn("[map-sync] setAuth falhou", e);
      }
    }
    if (cancelled) {
      supabase.removeChannel(pgChannel);
      supabase.removeChannel(bcChannel);
      return;
    }
    pgChannel.subscribe();
    bcChannel.subscribe();
    mapChannel = bcChannel;
    cleanup = () => {
      if (mapChannel === bcChannel) mapChannel = null;
      supabase.removeChannel(pgChannel);
      supabase.removeChannel(bcChannel);
    };
  })();
  return () => {
    cancelled = true;
    cleanup();
  };
}

export function newOverrides(): MapOverrides {
  return emptyOverrides();
}

export function cellIndex(col: number, row: number, cols = GRID_COLS) {
  return row * cols + col;
}

export function pointToCell(p: { x: number; y: number }, cols = GRID_COLS, rows = GRID_ROWS) {
  const col = Math.max(0, Math.min(cols - 1, Math.floor(p.x * cols)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor(p.y * rows)));
  return { col, row };
}

// True if the given normalized point falls on a blocked tile.
export function isBlockedByOverrides(p: { x: number; y: number }, radius = 0): boolean {
  const o = loadOverrides();
  if (!o) return false;
  // Sample center + 4 shoulders so the avatar's body can't clip into tiles.
  const samples = radius
    ? [
        p,
        { x: p.x - radius, y: p.y },
        { x: p.x + radius, y: p.y },
        { x: p.x, y: p.y - radius },
        { x: p.x, y: p.y + radius },
      ]
    : [p];
  for (const s of samples) {
    const { col, row } = pointToCell(s, o.cols, o.rows);
    if (o.blocked[cellIndex(col, row, o.cols)] === 1) return true;
  }
  return false;
}

export function zoneFromOverrides(p: { x: number; y: number }): ZoneId | null {
  const o = loadOverrides();
  if (!o) return null;
  const { col, row } = pointToCell(p, o.cols, o.rows);
  return o.zones[cellIndex(col, row, o.cols)] ?? null;
}

export function hasZoneOverrides(): boolean {
  const o = loadOverrides();
  if (!o) return false;
  return o.zones.some((z) => z !== null);
}

export function customZonesFromOverrides(): CustomZone[] {
  const o = loadOverrides();
  return o?.customZones ?? [];
}

// Bounding box (normalized 0..1) of all painted tiles for a given zone id.
// Returns null when nothing is painted for that zone.
export function zoneRectFromOverrides(
  id: ZoneId,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const o = loadOverrides();
  if (!o) return null;
  let minC = Infinity,
    minR = Infinity,
    maxC = -Infinity,
    maxR = -Infinity;
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      if (o.zones[cellIndex(c, r, o.cols)] === id) {
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
      }
    }
  }
  if (!isFinite(minC)) return null;
  return {
    x1: minC / o.cols,
    y1: minR / o.rows,
    x2: (maxC + 1) / o.cols,
    y2: (maxR + 1) / o.rows,
  };
}

// Spawn point overrides — exact teleport landing per zone.
export function spawnPointForZone(id: string): SpawnPoint | null {
  const o = loadOverrides();
  const p = o?.spawnPoints?.[id];
  if (p && typeof p.x === "number" && typeof p.y === "number") return p;
  return null;
}

export function setSpawnPoint(id: string, point: SpawnPoint) {
  const o = loadOverrides() ?? emptyOverrides();
  const next: MapOverrides = {
    ...o,
    spawnPoints: { ...(o.spawnPoints ?? {}), [id]: point },
  };
  saveOverrides(next);
}

export function clearSpawnPoint(id: string) {
  const o = loadOverrides();
  if (!o?.spawnPoints) return;
  const next = { ...o.spawnPoints };
  delete next[id];
  saveOverrides({ ...o, spawnPoints: next });
}

/** Nome exibido de uma zona embutida, respeitando renomeação no editor. */
export function zoneLabelOverride(id: string): string | undefined {
  const v = loadOverrides()?.zoneLabels?.[id];
  return v && v.trim() ? v : undefined;
}
