import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  GRID_COLS,
  GRID_ROWS,
  cellIndex,
  loadOverrides,
  newOverrides,
  saveOverrides,
  clearOverrides,
  pullOverridesFromCloud,
  pushOverridesToCloud,
  clearOverridesInCloud,
  type MapOverrides,
  type CustomZone,
  type ZoneKind,
  type PropInstance,
  type PropAction,
} from "@/lib/map-overrides";
import { ZONES, COLLIDERS, FLOOR_POLY, type ZoneId } from "@/lib/office-map";
import { PROP_CATALOG, getPropDef, subscribePropCatalog } from "@/lib/prop-catalog";
import { loadCustomPropsFromCloud, deleteCustomProp, uploadCustomProp } from "@/lib/custom-props";
import { OFFICE_THEMES, getCurrentThemeId, setCurrentThemeId } from "@/lib/office-themes";
import { useOfficeTheme } from "@/hooks/useOfficeTheme";
import { getCurrentWorkspaceId, subscribeCurrentWorkspaceId } from "@/lib/workspace/current";
import { useWorkspaceTier } from "@/lib/workspace/useWorkspaceTier";
import { toast } from "sonner";
import { MapSavePoints } from "./MapSavePoints";
import { defaultBlocked } from "@/lib/default-map-blocked";
import { appPrompt, appConfirm } from "@/components/ui/app-dialogs";

import { ArrowLeft, Eraser, Square, Download, Trash2, Eye, EyeOff, Undo, Plus, X, Briefcase, Users, MapPin, Hand, Zap, ZapOff, Lock, Map as MapIcon, Boxes, LayoutGrid, Upload, Loader2, Palette, Check, Pencil } from "lucide-react";

type Tool =
  | { kind: "blocked" }
  | { kind: "erase" }
  | { kind: "erase-zone" }
  | { kind: "zone"; zone: ZoneId }
  | { kind: "spawn"; zone: string }
  | { kind: "place-prop"; defId: string }
  | { kind: "select" };

// Seed overrides from the hardcoded COLLIDERS + ZONES so the user starts
// with the current layout already painted and can tweak from there.
function seedFromDefaults(): MapOverrides {
  // Padrão = paredes e móveis bloqueados do layout original (sem zonas).
  const o = newOverrides();
  o.blocked = defaultBlocked(o.cols * o.rows);
  return o;
}

const ZONE_COLORS: Record<string, string> = {
  descompressao: "#22c55e",
  diretoria: "#a855f7",
  reuniao: "#f59e0b",
  supervisao: "#06b6d4",
  feedback: "#ef4444",
  "atendente-1": "#ec4899",
  "atendente-2": "#f43f5e",
  "atendente-3": "#f97316",
  "atendente-4": "#eab308",
  "atendente-5": "#84cc16",
  "atendente-6": "#10b981",
  "atendente-7": "#14b8a6",
  "atendente-8": "#0ea5e9",
  "atendente-9": "#6366f1",
  "atendente-10": "#8b5cf6",
};

function mergeImport(
  prev: MapOverrides,
  src: MapOverrides,
  mode: "walls" | "walls-zones" | "all"
): MapOverrides {
  if (!src?.cols || !src?.rows || !Array.isArray(src.blocked)) return prev;
  // Resample src grid onto prev grid if needed.
  const cols = prev.cols, rows = prev.rows;
  const blocked = prev.blocked.slice();
  const zones = prev.zones.slice();
  for (let r = 0; r < rows; r++) {
    const sr = Math.min(src.rows - 1, Math.floor((r / rows) * src.rows));
    for (let c = 0; c < cols; c++) {
      const sc = Math.min(src.cols - 1, Math.floor((c / cols) * src.cols));
      const sIdx = sr * src.cols + sc;
      const dIdx = r * cols + c;
      blocked[dIdx] = src.blocked[sIdx] ?? 0;
      if (mode === "walls-zones" || mode === "all") {
        zones[dIdx] = (src.zones?.[sIdx] ?? null) as any;
      }
    }
  }
  const next: MapOverrides = { ...prev, blocked, zones };
  if (mode === "all") {
    next.customZones = src.customZones ?? [];
    next.zoneKinds = src.zoneKinds ?? {};
    next.spawnPoints = src.spawnPoints ?? {};
    next.props = src.props ?? [];
  }
  return next;
}

export function MapEditor() {
  const navigate = useNavigate();
  const goBack = () => {
    const last = typeof window !== "undefined" ? window.localStorage.getItem("lastWorkspaceId") : null;
    if (last) navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: last } });
    else navigate({ to: "/workspaces" });
  };
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [overrides, setOverrides] = useState<MapOverrides>(() => {
    return loadOverrides() ?? seedFromDefaults();
  });
  const [tool, setTool] = useState<Tool>({ kind: "blocked" });
  const [editorTab, setEditorTab] = useState<"map" | "zones" | "elements" | "theme">("map");
  const officeTheme = useOfficeTheme();
  const [brush, setBrush] = useState(1);
  const [mouseCell, setMouseCell] = useState<{ c: number; r: number } | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showImage, setShowImage] = useState(true);
  const [showEffective, setShowEffective] = useState(false);
  const [dirty, setDirty] = useState(!loadOverrides());
  const painting = useRef(false);
  const [altDown, setAltDown] = useState(false);
  const historyRef = useRef<MapOverrides[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  // bump para re-renderizar quando o catálogo de props muda (uploads, deletes).
  const [, setCatalogVersion] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [currentWorkspaceId, setCurrentWorkspaceIdState] = useState<string | null>(() => getCurrentWorkspaceId());
  const { tier: workspaceTier } = useWorkspaceTier(currentWorkspaceId);
  const levelThemes = useMemo(
    () => OFFICE_THEMES.filter((theme) => (theme.minTier ?? 1) === workspaceTier),
    [workspaceTier]
  );

  useEffect(() => {
    const unsubscribe = subscribeCurrentWorkspaceId(setCurrentWorkspaceIdState);
    return () => {
      unsubscribe();
    };
  }, []);

  // Carrega elementos personalizados da nuvem e re-renderiza quando mudam.
  useEffect(() => {
    void loadCustomPropsFromCloud();
    return subscribePropCatalog(() => setCatalogVersion((v) => v + 1));
  }, []);

  const onUploadAsset = useCallback(async (file: File) => {
    const label = await appPrompt({ title: "Nome do elemento", defaultValue: file.name.replace(/\.[^.]+$/, ""), placeholder: "Ex: mesa, planta…" });
    if (!label) return;
    const framesStr = await appPrompt({
      title: "Frames horizontais",
      description: "Quantos frames a imagem contém? 1 = imagem única; 2+ = sprite sheet dividido horizontalmente.",
      defaultValue: "1",
      placeholder: "1",
    });
    if (!framesStr) return;
    const frameCount = Math.max(1, Math.floor(Number(framesStr)) || 1);
    setUploading(true);
    try {
      await uploadCustomProp({ label, file, frameCount });
      toast.success(`"${label}" adicionado à galeria.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha no upload: ${msg}`);
    } finally {
      setUploading(false);
    }
  }, []);

  const onDeleteCustomProp = useCallback(async (id: string, label: string) => {
    if (!(await appConfirm({ title: `Remover "${label}"?`, description: "Não apaga instâncias já colocadas no mapa.", confirmLabel: "Remover", destructive: true }))) return;
    try {
      await deleteCustomProp(id);
      toast.success("Elemento removido da galeria.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha ao remover: ${msg}`);
    }
  }, []);

  // Mouse-wheel zoom (anchored to cursor) for precise painting.
  // Hold Shift + scroll to change brush size instead of zoom.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const BRUSH_SIZES = [1, 2, 5];
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        setBrush((b) => {
          const idx = BRUSH_SIZES.indexOf(b);
          if (e.deltaY < 0) {
            return BRUSH_SIZES[Math.min(BRUSH_SIZES.length - 1, idx + 1)] ?? BRUSH_SIZES[BRUSH_SIZES.length - 1];
          } else {
            return BRUSH_SIZES[Math.max(0, idx - 1)] ?? BRUSH_SIZES[0];
          }
        });
        return;
      }
      e.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      // Position of cursor within the (already scaled) stage, in stage-local px.
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom((z) => {
        const next = Math.max(1, Math.min(8, z * factor));
        const ratio = next / z;
        // Adjust scroll so the point under the cursor stays put.
        requestAnimationFrame(() => {
          main.scrollLeft += sx * (ratio - 1);
          main.scrollTop += sy * (ratio - 1);
        });
        return next;
      });
    };
    main.addEventListener("wheel", onWheel, { passive: false });
    return () => main.removeEventListener("wheel", onWheel);
  }, []);


  const customZones = overrides.customZones ?? [];

  // Unified zone list: customZones + any legacy built-in zone still painted
  // on the grid that hasn't been migrated to customZones yet. Everything in
  // this list is treated the same (editable, removable).
  const displayZones = useMemo(() => {
    const ids = new Set(customZones.map((c) => c.id));
    const legacy: CustomZone[] = ZONES
      .filter((z) => z.id !== "lobby" && !ids.has(z.id))
      .filter((z) => overrides.zones.includes(z.id as ZoneId))
      .map((z) => ({
        id: z.id,
        label: overrides.zoneLabels?.[z.id] || z.label,
        color: ZONE_COLORS[z.id] ?? "#888",
        kind: (z.id === "reuniao" || z.id === "feedback" || z.id === "descompressao"
          ? "common"
          : "workspace") as ZoneKind,
      }));
    return [...customZones, ...legacy];
  }, [customZones, overrides.zones, overrides.zoneLabels]);

  const zoneColorOf = useCallback(
    (id: string) => {
      const custom = customZones.find((c) => c.id === id);
      if (custom) return custom.color;
      return ZONE_COLORS[id] ?? "#888";
    },
    [customZones]
  );

  // Default zone kinds shown in the editor (mirror map-overrides defaults).
  const defaultKindOf = useCallback((id: string): ZoneKind => {
    if (id === "lobby" || id === "reuniao" || id === "feedback" || id === "descompressao") return "common";
    return "workspace";
  }, []);

  const kindOf = useCallback(
    (id: string): ZoneKind => {
      const ov = overrides.zoneKinds?.[id];
      if (ov) return ov;
      const custom = customZones.find((c) => c.id === id);
      if (custom?.kind) return custom.kind;
      return defaultKindOf(id);
    },
    [overrides.zoneKinds, customZones, defaultKindOf]
  );

  const toggleKind = useCallback((id: string) => {
    setOverrides((prev) => {
      const cur = prev.zoneKinds?.[id]
        ?? prev.customZones?.find((c) => c.id === id)?.kind
        ?? defaultKindOf(id);
      const next: ZoneKind = cur === "workspace" ? "common" : "workspace";
      return { ...prev, zoneKinds: { ...(prev.zoneKinds ?? {}), [id]: next } };
    });
    setDirty(true);
  }, [defaultKindOf]);

  const addCustomZone = useCallback(async () => {
    const label = await appPrompt({ title: "Nova zona", placeholder: "Nome da zona", confirmLabel: "Criar" });
    if (!label || !label.trim()) return;
    const palette = ["#22d3ee", "#fb7185", "#a3e635", "#fbbf24", "#c084fc", "#34d399", "#f472b6", "#60a5fa"];
    setOverrides((prev) => {
      const existing = prev.customZones ?? [];
      const id = `custom-${Date.now().toString(36)}`;
      const color = palette[existing.length % palette.length];
      const zone: CustomZone = { id, label: label.trim(), color };
      return { ...prev, customZones: [...existing, zone] };
    });
    setDirty(true);
  }, []);

  const renameZone = useCallback(async (id: string, current: string) => {
    const label = await appPrompt({ title: "Renomear área", defaultValue: current, placeholder: "Nome da área", confirmLabel: "Salvar" });
    const name = label?.trim();
    if (!name || name === current) return;
    setOverrides((prev) => {
      if ((prev.customZones ?? []).some((c) => c.id === id)) {
        return { ...prev, customZones: (prev.customZones ?? []).map((c) => (c.id === id ? { ...c, label: name } : c)) };
      }
      return { ...prev, zoneLabels: { ...(prev.zoneLabels ?? {}), [id]: name } };
    });
    setDirty(true);
  }, []);

  const removeCustomZone = useCallback(
    async (id: string) => {
      if (!(await appConfirm({ title: "Remover esta zona?", description: "As células pintadas dela serão apagadas.", confirmLabel: "Remover", destructive: true }))) return;
      setOverrides((prev) => {
        const next: MapOverrides = {
          ...prev,
          zones: prev.zones.map((z) => (z === (id as ZoneId) ? null : z)),
          customZones: (prev.customZones ?? []).filter((c) => c.id !== id),
        };
        const sp = { ...(prev.spawnPoints ?? {}) };
        delete sp[id];
        next.spawnPoints = sp;
        return next;
      });
      setTool((t) => (t.kind === "zone" && t.zone === (id as ZoneId) ? { kind: "blocked" } : t));
      setDirty(true);
    },
    []
  );

  // Effective tool: ALT held swaps paint tools to their eraser counterpart.
  const effectiveTool: Tool = useMemo(() => {
    if (!altDown) return tool;
    if (tool.kind === "blocked") return { kind: "erase" };
    if (tool.kind === "zone") return { kind: "erase-zone" };
    return tool;
  }, [tool, altDown]);

  const paintCell = useCallback(
    (col: number, row: number) => {
      setOverrides((prev) => {
        const next: MapOverrides = {
          ...prev,
          blocked: prev.blocked.slice(),
          zones: prev.zones.slice(),
        };
        const half = Math.floor(brush / 2);
        for (let dr = -half; dr <= brush - 1 - half; dr++) {
          for (let dc = -half; dc <= brush - 1 - half; dc++) {
            const r = row + dr;
            const c = col + dc;
            if (r < 0 || r >= next.rows || c < 0 || c >= next.cols) continue;
            const idx = cellIndex(c, r, next.cols);
            if (effectiveTool.kind === "blocked") {
              next.blocked[idx] = 1;
            } else if (effectiveTool.kind === "erase") {
              next.blocked[idx] = 0;
            } else if (effectiveTool.kind === "erase-zone") {
              next.zones[idx] = null;
            } else if (effectiveTool.kind === "zone") {
              next.zones[idx] = effectiveTool.zone;
            }
          }
        }
        return next;
      });
      setDirty(true);
    },
    [brush, effectiveTool]
  );

  const handlePointer = useCallback(
    (e: React.PointerEvent) => {
      if (!stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      if (tool.kind === "spawn") {
        const zoneId = tool.zone;
        setOverrides((prev) => ({
          ...prev,
          spawnPoints: { ...(prev.spawnPoints ?? {}), [zoneId]: { x, y } },
        }));
        setDirty(true);
        return;
      }
      if (tool.kind === "place-prop") {
        const def = getPropDef(tool.defId);
        if (!def) return;
        const id = `prop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const inst: PropInstance = {
          id,
          defId: def.id,
          x,
          y,
          w: def.defaultW,
          interactive: def.interactive,
        };
        setOverrides((prev) => ({ ...prev, props: [...(prev.props ?? []), inst] }));
        setSelectedPropId(id);
        setTool({ kind: "select" });
        setDirty(true);
        return;
      }
      if (tool.kind === "select") return;
      const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(x * GRID_COLS)));
      const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(y * GRID_ROWS)));
      paintCell(col, row);
    },
    [paintCell, tool]
  );

  const spawnPoints: Record<string, { x: number; y: number }> = overrides.spawnPoints ?? {};
  const draggingPin = useRef<string | null>(null);
  const propsList = overrides.props ?? [];
  const [selectedPropId, setSelectedPropId] = useState<string | null>(null);
  const draggingPropRef = useRef<
    | {
        id: string;
        mode: "move";
        offX: number; // pi.x - mouseNx no início
        offY: number;
        aspect: number;
      }
    | {
        id: string;
        mode: "resize";
        anchorLeft: number; // canto oposto (fixo durante o resize)
        anchorTop: number;
        aspect: number;
      }
    | null
  >(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  const updateProp = useCallback((id: string, patch: Partial<PropInstance>) => {
    setOverrides((prev) => ({
      ...prev,
      props: (prev.props ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
    setDirty(true);
  }, []);

  const removeProp = useCallback((id: string) => {
    setOverrides((prev) => ({
      ...prev,
      props: (prev.props ?? []).filter((p) => p.id !== id),
    }));
    setSelectedPropId((cur) => (cur === id ? null : cur));
    setDirty(true);
  }, []);

  const togglePropInteractive = useCallback((id: string) => {
    setOverrides((prev) => ({
      ...prev,
      props: (prev.props ?? []).map((p) =>
        p.id === id ? { ...p, interactive: !p.interactive } : p
      ),
    }));
    setDirty(true);
  }, []);

  const addPropAction = useCallback((id: string, action: PropAction) => {
    setOverrides((prev) => ({
      ...prev,
      props: (prev.props ?? []).map((p) => {
        if (p.id !== id) return p;
        const cur = p.actions ?? [];
        // evita duplicar gate-zone para a mesma zona
        if (action.type === "gate-zone" &&
            cur.some((a) => a.type === "gate-zone" && a.zoneId === action.zoneId)) {
          return p;
        }
        return { ...p, actions: [...cur, action] };
      }),
    }));
    setDirty(true);
  }, []);

  const removePropAction = useCallback((id: string, idx: number) => {
    setOverrides((prev) => ({
      ...prev,
      props: (prev.props ?? []).map((p) =>
        p.id === id ? { ...p, actions: (p.actions ?? []).filter((_, i) => i !== idx) } : p
      ),
    }));
    setDirty(true);
  }, []);


  const removeSpawn = useCallback((zoneId: string) => {
    setOverrides((prev) => {
      const cur = { ...(prev.spawnPoints ?? {}) };
      delete cur[zoneId];
      return { ...prev, spawnPoints: cur };
    });
    setDirty(true);
  }, []);

  const moveSpawnToPointer = useCallback((e: React.PointerEvent, zoneId: string) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setOverrides((prev) => ({
      ...prev,
      spawnPoints: { ...(prev.spawnPoints ?? {}), [zoneId]: { x, y } },
    }));
    setDirty(true);
  }, []);

  // On mount: pull the latest map from Lovable Cloud so a fresh browser /
  // device sees the same layout instead of falling back to the defaults.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cloud = await pullOverridesFromCloud();
      if (cancelled) return;
      if (cloud) {
        setOverrides(cloud);
        setDirty(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async () => {
    saveOverrides(overrides);
    setDirty(false);
    const res = await pushOverridesToCloud(overrides);
    if (res.ok) {
      toast.success("Mapa salvo na nuvem. Visível para todos os usuários.");
    } else {
      toast.error(
        `Salvo localmente, mas falhou ao enviar pra nuvem: ${res.error ?? "erro desconhecido"}`
      );
    }
  }, [overrides]);

  const reset = useCallback(async () => {
    if (!(await appConfirm({ title: "Limpar todas as células pintadas?", confirmLabel: "Limpar", destructive: true }))) return;
    setOverrides(newOverrides());
    setDirty(true);
  }, []);

  const reseed = useCallback(async () => {
    if (!(await appConfirm({ title: "Recarregar layout padrão?", description: "As alterações não salvas serão descartadas.", confirmLabel: "Recarregar", destructive: true }))) return;
    setOverrides(seedFromDefaults());
    setDirty(true);
  }, []);

  const clearSaved = useCallback(async () => {
    if (!(await appConfirm({ title: "Remover overrides salvos?", description: "Remove local e nuvem. O mapa voltará ao padrão.", confirmLabel: "Remover", destructive: true }))) return;
    clearOverrides();
    const res = await clearOverridesInCloud();
    setOverrides(seedFromDefaults());
    setDirty(true);
    if (res.ok) toast.success("Overrides removidos.");
    else toast.error(`Falha ao resetar na nuvem: ${res.error ?? "erro desconhecido"}`);
  }, []);


  // --- Importar paredes/zonas de outro espaço ----------------------------
  const [importOpen, setImportOpen] = useState(false);
  const [importList, setImportList] = useState<Array<{ id: string; name: string }>>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importMode, setImportMode] = useState<"walls" | "walls-zones" | "all">("walls");

  const openImport = useCallback(async () => {
    setImportOpen(true);
    setImportLoading(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { getCurrentWorkspaceId } = await import("@/lib/workspace/current");
      const currentWs = getCurrentWorkspaceId();
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { setImportList([]); return; }
      const { data: mems } = await supabase
        .from("workspace_members")
        .select("workspace_id, workspaces(id, name)")
        .eq("user_id", u.user.id);
      const list = (mems ?? [])
        .map((m: any) => ({ id: m.workspaces?.id, name: m.workspaces?.name }))
        .filter((w: any) => w.id && w.id !== currentWs);
      setImportList(list);
    } catch (e) {
      toast.error("Falha ao listar espaços.");
    } finally {
      setImportLoading(false);
    }
  }, []);

  const importFromWorkspace = useCallback(async (sourceId: string) => {
    try {
      if (sourceId === "__defaults__") {
        const seed = seedFromDefaults();
        setOverrides((prev) => mergeImport(prev, seed, importMode));
        setDirty(true);
        setImportOpen(false);
        toast.success("Layout padrão importado. Lembre de Salvar.");
        return;
      }
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase
        .from("map_overrides")
        .select("data")
        .eq("workspace_id", sourceId)
        .maybeSingle();
      if (error || !data) {
        // Fallback: seed from defaults (Prestativa hardcoded layout).
        const seed = seedFromDefaults();
        setOverrides((prev) => mergeImport(prev, seed, importMode));
        setDirty(true);
        setImportOpen(false);
        toast.success("Mapa importado a partir do layout padrão.");
        return;
      }
      const src = data.data as unknown as MapOverrides;
      setOverrides((prev) => mergeImport(prev, src, importMode));
      setDirty(true);
      setImportOpen(false);
      toast.success("Mapa importado. Lembre de Salvar.");
    } catch {
      toast.error("Falha ao importar.");
    }
  }, [importMode]);


  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(overrides)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "office-map-overrides.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [overrides]);

  const pushHistory = useCallback((snapshot: MapOverrides) => {
    historyRef.current.push(snapshot);
    if (historyRef.current.length > 50) historyRef.current.shift();
    setCanUndo(true);
  }, []);

  const undo = useCallback(() => {
    const hist = historyRef.current;
    if (hist.length === 0) return;
    const prev = hist.pop()!;
    setOverrides(prev);
    setCanUndo(hist.length > 0);
    setDirty(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        undo();
      } else if (e.key === "Escape") {
        if (tool.kind === "place-prop" || tool.kind === "spawn") {
          setTool({ kind: "blocked" });
        }
        setSelectedPropId(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedPropId) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
        e.preventDefault();
        removeProp(selectedPropId);
      }
      if (e.altKey) setAltDown(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey) setAltDown(false);
    };
    const onBlur = () => setAltDown(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [undo, tool, selectedPropId, removeProp]);

  // Pre-render tiles as plain divs would be huge (2560+). Use a canvas overlay.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const effectiveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cols = overrides.cols;
    const rows = overrides.rows;
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, cols, rows);
    const showZones = editorTab === "zones";
    const showBlocked = editorTab === "map";
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = cellIndex(c, r, cols);
        const zid = overrides.zones[i];
        if (showZones && zid) {
          ctx.fillStyle = zoneColorOf(zid) + "66"; // ~40% alpha
          ctx.fillRect(c, r, 1, 1);
        }
        if (showBlocked && overrides.blocked[i]) {
          ctx.fillStyle = "rgba(239, 68, 68, 0.55)"; // red
          ctx.fillRect(c, r, 1, 1);
        }
      }
    }
  }, [overrides, zoneColorOf, editorTab]);

  // Effective-collision overlay: shows EXACTLY what the game blocks for
  // the avatar (FLOOR_POLY + painted blocked OR default COLLIDERS).
  // This is the source of truth for calibration so painted area === in-game blocked area.
  useEffect(() => {
    const canvas = effectiveCanvasRef.current;
    if (!canvas) return;
    const cols = overrides.cols;
    const rows = overrides.rows;
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, cols, rows);
    if (!showEffective) return;

    const hasPainted = overrides.blocked.some((b) => b === 1);

    const pointInPoly = (px: number, py: number) => {
      let inside = false;
      for (let i = 0, j = FLOOR_POLY.length - 1; i < FLOOR_POLY.length; j = i++) {
        const xi = FLOOR_POLY[i].x, yi = FLOOR_POLY[i].y;
        const xj = FLOOR_POLY[j].x, yj = FLOOR_POLY[j].y;
        const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = (c + 0.5) / cols;
        const py = (r + 0.5) / rows;
        let blocked = !pointInPoly(px, py);
        if (!blocked) {
          if (hasPainted) {
            blocked = overrides.blocked[cellIndex(c, r, cols)] === 1;
          } else {
            for (const co of COLLIDERS) {
              if (px > co.x1 && px < co.x2 && py > co.y1 && py < co.y2) {
                blocked = true;
                break;
              }
            }
          }
        }
        if (blocked) {
          // Yellow outline-style — distinct from the red paint layer.
          ctx.fillStyle = "rgba(250, 204, 21, 0.55)";
          ctx.fillRect(c, r, 1, 1);
        }
      }
    }
  }, [overrides, showEffective, editorTab]);

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground">
      {/* Toolbar */}
      <header className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card flex-wrap">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-muted"
        >
          <ArrowLeft size={16} /> Voltar
        </button>
        <span className="text-sm font-semibold">Editor de Espaço</span>
        <span className="text-xs text-muted-foreground">
          {GRID_COLS}×{GRID_ROWS} células
        </span>

        {/* Brush size indicator */}
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Pincel:</span>
          <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary min-w-[2.5rem] text-center">
            {brush}×{brush}
          </span>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">(Shift+scroll)</span>
        </div>

        <div className="ml-auto flex items-center gap-2">

          <button
            onClick={() => setShowImage((v) => !v)}
            className="text-xs px-2 py-1 rounded bg-muted inline-flex items-center gap-1"
          >
            {showImage ? <Eye size={12} /> : <EyeOff size={12} />} Imagem
          </button>
          <button
            onClick={() => setShowGrid((v) => !v)}
            className="text-xs px-2 py-1 rounded bg-muted inline-flex items-center gap-1"
          >
            {showGrid ? <Eye size={12} /> : <EyeOff size={12} />} Grid
          </button>
          <button
            onClick={() => setShowEffective((v) => !v)}
            className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
              showEffective ? "bg-yellow-500/30 text-yellow-100" : "bg-muted"
            }`}
            title="Mostra o bloqueio EXATO que o jogo aplica (polígono do piso + colisões)"
          >
            {showEffective ? <Eye size={12} /> : <EyeOff size={12} />} Bloqueio do jogo
          </button>
          <MapSavePoints overrides={overrides} onLoad={(o) => setOverrides(o)} />
          <button onClick={exportJson} className="text-xs px-2 py-1 rounded bg-muted inline-flex items-center gap-1">
            <Download size={12} /> Export
          </button>
          <button onClick={reseed} className="text-xs px-2 py-1 rounded bg-muted">
            Recarregar padrão
          </button>
          <button
            onClick={openImport}
            className="text-xs px-2 py-1 rounded bg-muted inline-flex items-center gap-1"
            title="Copiar paredes/zonas de outro espaço"
          >
            <Upload size={12} /> Importar de outro
          </button>
          <button onClick={reset} className="text-xs px-2 py-1 rounded bg-muted inline-flex items-center gap-1">
            <Trash2 size={12} /> Limpar
          </button>
          <button onClick={clearSaved} className="text-xs px-2 py-1 rounded bg-muted">
            Remover overrides
          </button>
          <button
            onClick={save}
            className={`text-sm px-3 py-1.5 rounded font-semibold ${
              dirty ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {dirty ? "Salvar" : "Salvo"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar com abas */}
        <aside className="w-72 border-r border-border bg-card overflow-y-auto flex flex-col">
          {/* Tabs */}
          <div className="flex gap-0.5 p-2 border-b border-border sticky top-0 bg-gradient-to-r from-card via-card to-card z-10">
            {[
              {
                id: "map" as const,
                label: "Mapa",
                icon: <MapIcon size={14} />,
                activeBg: "bg-gradient-to-br from-pink-500 to-rose-500",
                hoverBg: "hover:bg-pink-500/10 hover:text-pink-500",
              },
              {
                id: "zones" as const,
                label: "Áreas",
                icon: <LayoutGrid size={14} />,
                activeBg: "bg-gradient-to-br from-sky-500 to-blue-600",
                hoverBg: "hover:bg-sky-500/10 hover:text-sky-500",
              },
              {
                id: "elements" as const,
                label: "Elementos",
                icon: <Boxes size={14} />,
                activeBg: "bg-gradient-to-br from-amber-500 to-orange-500",
                hoverBg: "hover:bg-amber-500/10 hover:text-amber-500",
              },
              {
                id: "theme" as const,
                label: "Tema",
                icon: <Palette size={14} />,
                activeBg: "bg-gradient-to-br from-violet-500 to-fuchsia-500",
                hoverBg: "hover:bg-violet-500/10 hover:text-violet-500",
              },
            ].map((t) => {
              const active = editorTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setEditorTab(t.id);
                    if (t.id === "map" && tool.kind !== "blocked" && tool.kind !== "erase") {
                      setTool({ kind: "blocked" });
                    } else if (t.id === "elements" && tool.kind !== "select" && tool.kind !== "place-prop") {
                      setTool({ kind: "select" });
                    } else if (t.id === "zones" && (tool.kind === "blocked" || tool.kind === "erase" || tool.kind === "place-prop" || tool.kind === "select")) {
                      // mantém ferramenta atual; usuário escolhe uma zona ou borracha
                    }
                  }}
                  className={`flex-1 inline-flex items-center justify-center gap-1 text-xs px-1.5 py-2 rounded-md transition-all ${
                    active
                      ? `${t.activeBg} text-white font-semibold shadow-md shadow-black/20 scale-[1.02]`
                      : `text-muted-foreground ${t.hoverBg}`
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="p-3 flex-1">
            {/* ===== Aba: Mapa ===== */}
            {editorTab === "map" && (
              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">Paredes / Bloqueios</h3>
                <div className="flex flex-col gap-1.5">
                  <ToolBtn
                    active={tool.kind === "blocked"}
                    onClick={() => setTool({ kind: "blocked" })}
                    icon={<Square size={14} />}
                    label="Colocar bloqueio"
                    color="#ef4444"
                  />
                  <ToolBtn
                    active={tool.kind === "erase" || (altDown && tool.kind === "blocked")}
                    onClick={() => setTool({ kind: "erase" })}
                    icon={<Eraser size={14} />}
                    label="Retirar bloqueio"
                  />
                  <button
                    onClick={undo}
                    disabled={!canUndo}
                    className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded ${
                      canUndo ? "bg-muted/60 hover:bg-muted" : "opacity-50 cursor-not-allowed"
                    }`}
                    title="Desfazer (Ctrl+Z)"
                  >
                    <Undo size={14} /> Desfazer
                  </button>
                </div>

                <div>
                  <span className="text-[10px] uppercase text-muted-foreground">Tamanho do pincel</span>
                  <div className="flex items-center gap-1 mt-1">
                    {[1, 2, 3, 5].map((b) => (
                      <button
                        key={b}
                        onClick={() => setBrush(b)}
                        className={`text-xs px-2 py-1 rounded flex-1 ${
                          brush === b ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}
                      >
                        {b}×{b}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border/50">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded" style={{ background: "rgba(239,68,68,0.55)" }} />
                    Tile bloqueado (avatar não passa)
                  </div>
                  <p className="text-[11px] mt-1">Clique e arraste para pintar/apagar. Segure <kbd className="px-1 rounded bg-muted text-foreground">Alt</kbd> para usar a borracha rapidamente.</p>
                </div>
              </div>
            )}

            {/* ===== Aba: Áreas ===== */}
            {editorTab === "zones" && (
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">Áreas / Salas</h3>
                  <button
                    onClick={addCustomZone}
                    title="Adicionar nova zona"
                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary hover:bg-primary/30"
                  >
                    <Plus size={12} /> Nova
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  {displayZones.map((z) => {
                    const active = tool.kind === "zone" && tool.zone === (z.id as ZoneId);
                    const k = kindOf(z.id);
                    return (
                      <div
                        key={z.id}
                        className={`group flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm ${
                          active ? "ring-2 ring-primary bg-muted" : "hover:bg-muted"
                        }`}
                      >
                        <button
                          onClick={() => setTool({ kind: "zone", zone: z.id as ZoneId })}
                          className="flex items-center gap-2 flex-1 min-w-0"
                        >
                          <span className="w-4 h-4 rounded shrink-0" style={{ backgroundColor: z.color, opacity: 0.7 }} />
                          <span className="truncate">{z.label}</span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setTool({ kind: "spawn", zone: z.id }); }}
                          title={spawnPoints[z.id] ? "Ponto de teleporte definido. Clique para reposicionar." : "Definir ponto de teleporte"}
                          className={`shrink-0 p-1 rounded ${
                            tool.kind === "spawn" && tool.zone === z.id
                              ? "ring-2 ring-primary text-primary"
                              : spawnPoints[z.id] ? "text-primary" : "text-muted-foreground"
                          } hover:bg-muted`}
                        >
                          <MapPin size={12} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleKind(z.id); }}
                          title={k === "workspace" ? "Local de trabalho (reivindicável)" : "Espaço comum"}
                          className={`shrink-0 p-1 rounded ${k === "workspace" ? "text-primary" : "text-muted-foreground"} hover:bg-muted`}
                        >
                          {k === "workspace" ? <Briefcase size={12} /> : <Users size={12} />}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); void renameZone(z.id, z.label); }}
                          title="Renomear área"
                          className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => removeCustomZone(z.id)}
                          title="Remover zona"
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    onClick={addCustomZone}
                    className="mt-2 inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded border border-dashed border-border hover:bg-muted text-muted-foreground"
                  >
                    <Plus size={12} /> Adicionar zona
                  </button>
                </div>

                <div className="mt-4 pt-3 border-t border-border/60 flex flex-col gap-2">
                  <ToolBtn
                    active={tool.kind === "erase-zone" || (altDown && tool.kind === "zone")}
                    onClick={() => setTool({ kind: "erase-zone" })}
                    icon={<Eraser size={14} />}
                    label="Apagar área"
                  />
                  <div>
                    <span className="text-[10px] uppercase text-muted-foreground">Tamanho do pincel</span>
                    <div className="flex items-center gap-1 mt-1">
                      {[1, 2, 3, 5].map((b) => (
                        <button
                          key={b}
                          onClick={() => setBrush(b)}
                          className={`text-xs px-2 py-1 rounded flex-1 ${
                            brush === b ? "bg-primary text-primary-foreground" : "bg-muted"
                          }`}
                        >
                          {b}×{b}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <p className="mt-3 text-[11px] text-muted-foreground">
                  Clique no nome pra pintar a área. <MapPin size={10} className="inline" /> define onde o avatar aparece ao teleportar. <Briefcase size={10} className="inline" /> / <Users size={10} className="inline" /> alterna entre área privada e comum.
                  <br />Segure <kbd className="px-1 rounded bg-muted text-foreground">Alt</kbd> para usar a borracha sem trocar de ferramenta.
                </p>
              </div>
            )}

            {/* ===== Aba: Elementos ===== */}
            {editorTab === "elements" && (
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">Galeria</h3>
                  <button
                    onClick={() => setTool({ kind: "select" })}
                    title="Selecionar / mover elementos"
                    className={`p-1 rounded ${tool.kind === "select" ? "ring-2 ring-primary text-primary" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    <Hand size={12} />
                  </button>
                </div>
                <label className={`mb-2 flex items-center justify-center gap-2 px-2 py-2 rounded border border-dashed text-[11px] cursor-pointer ${uploading ? "opacity-50 pointer-events-none" : "border-primary/40 text-primary hover:bg-primary/5"}`}>
                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  {uploading ? "Enviando..." : "Enviar imagem ou sprite"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.currentTarget.value = "";
                      if (f) void onUploadAsset(f);
                    }}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {PROP_CATALOG.map((def) => {
                    const active = tool.kind === "place-prop" && tool.defId === def.id;
                    return (
                      <div key={def.id} className="relative group">
                        <button
                          onClick={() => setTool({ kind: "place-prop", defId: def.id })}
                          className={`w-full flex flex-col items-center gap-1 p-2 rounded border ${active ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                          title={`Adicionar ${def.label}${def.frames.length > 1 ? ` (${def.frames.length} frames)` : ""}`}
                        >
                          <img src={def.frames[0]} alt="" className="h-12 object-contain" draggable={false} />
                          <span className="text-[10px] truncate max-w-full">{def.label}</span>
                          {def.frames.length > 1 && (
                            <span className="absolute top-1 left-1 text-[9px] bg-primary/80 text-primary-foreground px-1 rounded">
                              {def.frames.length}f
                            </span>
                          )}
                        </button>
                        {def.custom && (
                          <button
                            onClick={(e) => { e.stopPropagation(); void onDeleteCustomProp(def.id, def.label); }}
                            className="absolute top-1 right-1 p-0.5 rounded bg-background/80 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                            title="Remover da galeria"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {tool.kind === "place-prop" && (
                  <p className="text-[10px] text-muted-foreground mt-2">Clique no mapa para colocar. Esc para cancelar.</p>
                )}


                {propsList.length > 0 && (
                  <div className="mt-3 flex flex-col gap-1">
                    <span className="text-[10px] uppercase text-muted-foreground">No mapa ({propsList.length})</span>
                    {propsList.map((pi) => {
                      const def = getPropDef(pi.defId);
                      if (!def) return null;
                      const sel = selectedPropId === pi.id;
                      return (
                        <div
                          key={pi.id}
                          className={`group flex items-center gap-2 px-2 py-1 rounded text-xs ${sel ? "bg-muted ring-1 ring-primary" : "hover:bg-muted"}`}
                        >
                          <button
                            onClick={() => { setTool({ kind: "select" }); setSelectedPropId(pi.id); }}
                            className="flex-1 text-left truncate"
                          >
                            {def.label}
                            {pi.actions && pi.actions.length > 0 && (
                              <Lock size={10} className="inline ml-1 text-primary" />
                            )}
                          </button>
                          {def.interactive && (
                            <button
                              onClick={() => togglePropInteractive(pi.id)}
                              title={pi.interactive ? "Interativo (clique para desativar)" : "Não interativo (clique para ativar)"}
                              className={`p-0.5 ${pi.interactive ? "text-primary" : "text-muted-foreground"}`}
                            >
                              {pi.interactive ? <Zap size={12} /> : <ZapOff size={12} />}
                            </button>
                          )}
                          <button
                            onClick={() => removeProp(pi.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                            title="Remover"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ===== Ações do elemento selecionado ===== */}
                {(() => {
                  const sel = propsList.find((p) => p.id === selectedPropId);
                  if (!sel) return null;
                  const def = getPropDef(sel.defId);
                  if (!def) return null;
                  if (!def.interactive || def.frames.length < 2) return null;
                  const allZones = displayZones.map((z) => ({ id: z.id, label: z.label }));
                  const gateActions = (sel.actions ?? []).filter(
                    (a): a is Extract<PropAction, { type: "gate-zone" }> => a.type === "gate-zone"
                  );
                  const usedZones = new Set(gateActions.map((a) => a.zoneId));
                  const available = allZones.filter((z) => !usedZones.has(z.id));
                  return (
                    <div className="mt-4 pt-3 border-t border-border/60">
                      <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
                        <Lock size={12} /> Ações de "{def.label}"
                      </h3>
                      {gateActions.length === 0 && (
                        <p className="text-[11px] text-muted-foreground mb-2">
                          Nenhuma ação. Adicione abaixo para que o elemento afete o mundo.
                        </p>
                      )}
                      <div className="flex flex-col gap-1 mb-2">
                        {gateActions.map((a, i) => {
                          const z = allZones.find((zz) => zz.id === a.zoneId);
                          const frameLabel = a.blockedFrame === 0 ? "Frame 1 (fechada)" : `Frame ${a.blockedFrame + 1}`;
                          return (
                            <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-muted/50 text-[11px]">
                              <Lock size={10} className="text-primary shrink-0" />
                              <span className="flex-1 truncate">
                                Tranca <b>{z?.label ?? a.zoneId}</b>
                                <span className="text-muted-foreground"> · {frameLabel}</span>
                              </span>
                              <button
                                onClick={() => {
                                  const idx = (sel.actions ?? []).findIndex(
                                    (aa) => aa.type === "gate-zone" && aa.zoneId === a.zoneId
                                  );
                                  if (idx >= 0) removePropAction(sel.id, idx);
                                }}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {available.length > 0 ? (
                        <select
                          className="w-full text-[11px] px-2 py-1 rounded bg-muted border border-border"
                          value=""
                          onChange={(e) => {
                            const zoneId = e.target.value;
                            if (!zoneId) return;
                            addPropAction(sel.id, { type: "gate-zone", zoneId, blockedFrame: 0 });
                          }}
                        >
                          <option value="">+ Trancar uma sala…</option>
                          {available.map((z) => (
                            <option key={z.id} value={z.id}>{z.label}</option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">Todas as salas já estão trancadas por este elemento.</p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-2">
                        Enquanto o frame 1 (fechada) estiver ativo, ninguém entra nem sai da sala. Aperte X no jogo para abrir.
                      </p>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ===== Aba: Tema ===== */}
            {editorTab === "theme" && (
              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">Tema do espaço</h3>
                <p className="text-[11px] text-muted-foreground">
                  Troca apenas a imagem de fundo do mapa. Áreas, paredes e elementos continuam exatamente no mesmo lugar.
                </p>
                <div className="flex flex-col gap-2">
                  {levelThemes.map((t) => {
                    const active = (overrides.theme ?? "default") === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={async () => {
                          setOverrides((prev) => ({ ...prev, theme: t.id }));
                          const res = await setCurrentThemeId(t.id);
                          if (res.ok) toast.success(`Tema "${t.label}" aplicado`);
                          else toast.error(`Falha ao salvar tema: ${res.error ?? "erro"}`);
                        }}
                        className={`relative w-full text-left rounded-lg overflow-hidden border transition-all ${
                          active ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/50"
                        }`}
                      >
                        <div className="aspect-[16/10] bg-muted overflow-hidden">
                          <img
                            src={t.url}
                            alt={t.label}
                            className="w-full h-full object-cover"
                            draggable={false}
                          />
                        </div>
                        <div className="px-2.5 py-2 flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold truncate">{t.label}</div>
                            {t.description && (
                              <div className="text-[10px] text-muted-foreground truncate">{t.description}</div>
                            )}
                          </div>
                          {active && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
                              <Check size={12} /> Ativo
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </aside>


        {/* Stage */}
        <main
          ref={mainRef}
          className="flex-1 overflow-auto bg-neutral-900 p-4 relative"
          style={{ overscrollBehavior: "contain" }}
        >
          <div
            ref={stageRef}
            className={`relative mx-auto select-none ${["blocked","erase","zone","erase-zone"].includes(tool.kind) || (altDown && ["blocked","zone"].includes(tool.kind)) ? "cursor-none" : "cursor-crosshair"}`}
            style={{
              aspectRatio: "1536 / 1024",
              width: `calc(${zoom} * min(100%, calc((100vh - 110px) * 1.5)))`,
            }}

            onPointerDown={(e) => {
              if (draggingPin.current) return;
              if (draggingPropRef.current) return;
              // No modo seleção, clique no fundo só desseleciona
              if (tool.kind === "select") {
                setSelectedPropId(null);
                return;
              }
              (e.target as Element).setPointerCapture?.(e.pointerId);
              if (tool.kind === "blocked" || tool.kind === "erase" || tool.kind === "erase-zone" || tool.kind === "zone") {
                painting.current = true;
                pushHistory({
                  ...overrides,
                  blocked: overrides.blocked.slice(),
                  zones: overrides.zones.slice(),
                });
              }
              handlePointer(e);
            }}
            onPointerMove={(e) => {
              if (draggingPin.current) {
                moveSpawnToPointer(e, draggingPin.current);
                return;
              }
              if (!stageRef.current) return;
              const rect = stageRef.current.getBoundingClientRect();
              const nx = (e.clientX - rect.left) / rect.width;
              const ny = (e.clientY - rect.top) / rect.height;
              const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(nx * GRID_COLS)));
              const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(ny * GRID_ROWS)));
              setMouseCell({ c: col, r: row });
              if (tool.kind === "place-prop") {
                setGhostPos({ x: nx, y: ny });
              }
              if (draggingPropRef.current) {
                const drag = draggingPropRef.current;
                if (drag.mode === "move") {
                  updateProp(drag.id, {
                    x: Math.max(0, Math.min(1, nx + drag.offX)),
                    y: Math.max(0, Math.min(1, ny + drag.offY)),
                  });
                } else {
                  const newW = Math.max(0.01, Math.min(0.8, nx - drag.anchorLeft));
                  const newH = newW / drag.aspect;
                  updateProp(drag.id, {
                    w: newW,
                    x: drag.anchorLeft + newW / 2,
                    y: drag.anchorTop + newH,
                  });
                }
                return;
              }
              if (painting.current) handlePointer(e);
            }}
            onPointerLeave={() => {
              setMouseCell(null);
              if (tool.kind === "place-prop") setGhostPos(null);
            }}
            onPointerUp={() => { painting.current = false; draggingPin.current = null; draggingPropRef.current = null; }}
            onPointerCancel={() => { painting.current = false; draggingPin.current = null; draggingPropRef.current = null; }}
          >
            {showImage && (
              <img
                src={officeTheme.url}
                alt=""
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                draggable={false}
              />
            )}
            {/* Painted tiles via canvas, scaled pixelated */}
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ imageRendering: "pixelated" }}
            />
            {/* Effective game-collision overlay (FLOOR_POLY + colliders/painted) */}
            {editorTab === "map" && (
              <canvas
                ref={effectiveCanvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ imageRendering: "pixelated", mixBlendMode: "screen" }}
              />
            )}
            {/* Grid overlay */}
            {showGrid && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, rgba(255,255,255,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.18) 1px, transparent 1px)",
                  backgroundSize: `${100 / GRID_COLS}% ${100 / GRID_ROWS}%`,
                }}
              />
            )}
            {/* Spawn point pins */}
            {editorTab === "zones" && Object.entries(spawnPoints).map(([zid, p]) => {
              const color = zoneColorOf(zid);
              const label = customZones.find((c) => c.id === zid)?.label
                || overrides.zoneLabels?.[zid]
                || ZONES.find((z) => z.id === zid)?.label
                || zid;
              const active = tool.kind === "spawn" && tool.zone === zid;
              return (
                <div
                  key={zid}
                  className="absolute pointer-events-auto"
                  style={{
                    left: `${p.x * 100}%`,
                    top: `${p.y * 100}%`,
                    transform: "translate(-50%, -100%)",
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if ((e.target as HTMLElement).closest("button")) return;
                    draggingPin.current = zid;
                    (stageRef.current as Element | null)?.setPointerCapture?.(e.pointerId);
                  }}
                >
                  <div className="flex flex-col items-center -mb-1">
                    <div
                      className="px-1.5 py-0.5 rounded text-[9px] font-medium whitespace-nowrap shadow-soft"
                      style={{ background: color, color: "#0a0a0a" }}
                    >
                      {label}
                    </div>
                    <div className="relative" style={{ cursor: "grab" }}>
                      <MapPin
                        size={active ? 24 : 20}
                        className="drop-shadow"
                        style={{ color, fill: color, stroke: "#0a0a0a", strokeWidth: 1.5 }}
                      />
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); removeSpawn(zid); }}
                        title="Remover ponto"
                        className="absolute -top-1 -right-2 bg-card border border-border rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {tool.kind === "spawn" && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full shadow-soft">
                Clique no mapa para fixar o ponto · arraste o pino para ajustes finos
              </div>
            )}

            {/* Props (elementos) — render + handles de edição.
                Em outras abas, viram "fantasmas" pra manter referência sem poluir. */}
            {propsList.map((pi) => {
              const def = getPropDef(pi.defId);
              if (!def) return null;
              const sel = selectedPropId === pi.id;
              const wPct = pi.w * 100;
              const hPct = (pi.w / def.aspectRatio) * 100;
              const curFrame = pi.frame ?? 0;
              const isGhost = editorTab !== "elements";
              return (
                <div
                  key={pi.id}
                  className="absolute"
                  style={{
                    left: `${pi.x * 100}%`,
                    top: `${pi.y * 100}%`,
                    width: `${wPct}%`,
                    height: `${hPct}%`,
                    transform: "translate(-50%, -100%)",
                    zIndex: 30000 + Math.round(pi.y * 5000),
                    cursor: !isGhost && tool.kind === "select" ? "move" : "default",
                    pointerEvents: !isGhost && tool.kind === "select" ? "auto" : "none",
                    opacity: isGhost ? 0.28 : 1,
                    filter: isGhost ? "grayscale(0.6)" : undefined,
                    transition: "opacity 120ms ease, filter 120ms ease",
                  }}
                  onPointerDown={(e) => {
                    if (tool.kind !== "select") return;
                    if (e.button !== 0) return; // só botão esquerdo arrasta
                    e.stopPropagation();
                    setSelectedPropId(pi.id);
                    if (!stageRef.current) return;
                    const rect = stageRef.current.getBoundingClientRect();
                    const nx = (e.clientX - rect.left) / rect.width;
                    const ny = (e.clientY - rect.top) / rect.height;
                    draggingPropRef.current = {
                      id: pi.id,
                      mode: "move",
                      offX: pi.x - nx, // preserva o ponto exato onde o usuário clicou
                      offY: pi.y - ny,
                      aspect: def.aspectRatio,
                    };
                    (stageRef.current as Element | null)?.setPointerCapture?.(e.pointerId);
                  }}
                  onContextMenu={(e) => {
                    if (tool.kind !== "select") return;
                    if (def.frames.length <= 1) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedPropId(pi.id);
                    const next = (curFrame + 1) % def.frames.length;
                    updateProp(pi.id, { frame: next });
                  }}
                >
                  <img
                    src={def.frames[curFrame] ?? def.frames[0]}
                    alt=""
                    className="w-full h-full object-contain pointer-events-none select-none"
                    draggable={false}
                    style={{ imageRendering: "pixelated" }}
                  />
                  {sel && tool.kind === "select" && (
                    <>
                      <div className="absolute inset-0 ring-2 ring-primary rounded pointer-events-none" />
                      {/* Resize handle (canto inferior direito) — âncora = canto superior esquerdo */}
                      <div
                        className="absolute -right-1 -bottom-1 w-3 h-3 bg-primary border border-card rounded-sm cursor-nwse-resize"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (!stageRef.current) return;
                          const hNorm = pi.w / def.aspectRatio;
                          draggingPropRef.current = {
                            id: pi.id,
                            mode: "resize",
                            anchorLeft: pi.x - pi.w / 2,
                            anchorTop: pi.y - hNorm,
                            aspect: def.aspectRatio,
                          };
                          (stageRef.current as Element | null)?.setPointerCapture?.(e.pointerId);
                        }}
                      />
                      {/* Toolbar flutuante */}
                      <div
                        className="absolute left-1/2 -translate-x-1/2 -top-7 flex items-center gap-1 bg-card border border-border rounded px-1 py-0.5 shadow-soft text-xs whitespace-nowrap"
                        onPointerDown={(e) => e.stopPropagation()}
                        onContextMenu={(e) => e.stopPropagation()}
                      >
                        {def.frames.length > 1 && (
                          <button
                            onClick={() => updateProp(pi.id, { frame: (curFrame + 1) % def.frames.length })}
                            title="Alternar frame padrão (ou clique direito)"
                            className="p-1 rounded text-muted-foreground hover:bg-muted"
                          >
                            <span className="text-[10px] font-mono px-0.5">{curFrame + 1}/{def.frames.length}</span>
                          </button>
                        )}
                        {def.interactive && (
                          <button
                            onClick={() => togglePropInteractive(pi.id)}
                            title={pi.interactive ? "Interativo (clique para desativar)" : "Não interativo (clique para ativar)"}
                            className={`p-1 rounded ${pi.interactive ? "text-primary" : "text-muted-foreground"} hover:bg-muted`}
                          >
                            {pi.interactive ? <Zap size={12} /> : <ZapOff size={12} />}
                          </button>
                        )}
                        <button
                          onClick={() => removeProp(pi.id)}
                          title="Remover"
                          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {/* Preview esmaecida do prop colado ao cursor */}
            {tool.kind === "place-prop" && ghostPos && (() => {
              const def = getPropDef(tool.defId);
              if (!def) return null;
              const wPct = def.defaultW * 100;
              const hPct = (def.defaultW / def.aspectRatio) * 100;
              return (
                <img
                  src={def.frames[0]}
                  alt=""
                  draggable={false}
                  className="absolute pointer-events-none select-none"
                  style={{
                    left: `${ghostPos.x * 100}%`,
                    top: `${ghostPos.y * 100}%`,
                    width: `${wPct}%`,
                    height: `${hPct}%`,
                    transform: "translate(-50%, -100%)",
                    objectFit: "contain",
                    objectPosition: "bottom center",
                    opacity: 0.45,
                    imageRendering: "pixelated",
                    zIndex: 80000,
                    filter: "drop-shadow(0 0 4px rgba(0,0,0,0.5))",
                  }}
                />

              );
            })()}

            {tool.kind === "place-prop" && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full shadow-soft">
                Clique no mapa para colocar · Esc para cancelar
              </div>
            )}
            {/* Brush cursor overlay */}
            {mouseCell && (effectiveTool.kind === "blocked" || effectiveTool.kind === "erase" || effectiveTool.kind === "zone" || effectiveTool.kind === "erase-zone") && (() => {
              const half = Math.floor(brush / 2);
              const c0 = Math.max(0, mouseCell.c - half);
              const r0 = Math.max(0, mouseCell.r - half);
              const wCells = Math.min(brush, GRID_COLS - c0);
              const hCells = Math.min(brush, GRID_ROWS - r0);
              let bg = "rgba(255,255,255,0.12)";
              let border = "rgba(255,255,255,0.7)";
              if (effectiveTool.kind === "blocked") {
                bg = "rgba(239,68,68,0.22)";
                border = "rgba(239,68,68,0.85)";
              } else if (effectiveTool.kind === "zone") {
                const zc = zoneColorOf(effectiveTool.zone);
                bg = zc + "33";
                border = zc + "cc";
              }
              return (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: `${c0 * 100 / GRID_COLS}%`,
                    top: `${r0 * 100 / GRID_ROWS}%`,
                    width: `${wCells * 100 / GRID_COLS}%`,
                    height: `${hCells * 100 / GRID_ROWS}%`,
                    background: bg,
                    border: `2px solid ${border}`,
                    zIndex: 90000,
                    boxSizing: "border-box",
                  }}
                />
              );
            })()}
          </div>
          {/* Zoom HUD */}
          <div className="sticky bottom-2 ml-auto mr-2 w-fit flex items-center gap-1 bg-card/90 border border-border rounded-full px-2 py-1 text-xs shadow-soft backdrop-blur" style={{ float: "right" }}>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(1, z / 1.25))}
              className="px-1.5 rounded hover:bg-muted"
              title="Diminuir zoom"
            >−</button>
            <span className="tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
              className="px-1.5 rounded hover:bg-muted"
              title="Aumentar zoom"
            >+</button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="ml-1 px-1.5 rounded hover:bg-muted text-muted-foreground"
              title="Resetar zoom"
              disabled={zoom === 1}
            >1×</button>
          </div>
        </main>
      </div>

      {importOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setImportOpen(false)}
        >
          <div
            className="bg-card text-card-foreground rounded-lg shadow-lg w-full max-w-md p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Importar mapa de outro espaço</h3>
              <button onClick={() => setImportOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Copia o que você escolher do espaço de origem para o atual. As alterações só são gravadas quando você clicar em <strong>Salvar</strong>.
            </p>
            <div className="flex flex-col gap-1 text-xs">
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={importMode === "walls"} onChange={() => setImportMode("walls")} />
                Só paredes (bloqueios)
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={importMode === "walls-zones"} onChange={() => setImportMode("walls-zones")} />
                Paredes + áreas pintadas
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={importMode === "all"} onChange={() => setImportMode("all")} />
                Tudo (paredes, áreas, spawns, elementos)
              </label>
            </div>
            <div className="border-t border-border pt-2">
              <div className="text-xs font-medium mb-1">Escolha o espaço de origem:</div>
              {importLoading ? (
                <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Carregando…
                </div>
              ) : importList.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  Você não tem outros espaços. Você ainda pode importar o layout padrão da Prestativa abaixo.
                </div>
              ) : (
                <div className="max-h-48 overflow-auto flex flex-col gap-1">
                  {importList.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => importFromWorkspace(w.id)}
                      className="text-left text-xs px-2 py-1.5 rounded hover:bg-muted border border-border"
                    >
                      {w.name}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => importFromWorkspace("__defaults__")}
                className="mt-2 w-full text-xs px-2 py-1.5 rounded bg-muted hover:bg-muted/80"
              >
                Usar layout padrão da Prestativa (hardcoded)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolBtn({
  active,
  onClick,
  icon,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded ${
        active ? "ring-2 ring-primary bg-muted" : "bg-muted/60 hover:bg-muted"
      }`}
    >
      {color && <span className="w-3 h-3 rounded-sm" style={{ background: color }} />}
      {icon}
      {label}
    </button>
  );
}
