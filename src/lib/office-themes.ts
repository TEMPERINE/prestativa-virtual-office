// Temas visuais do espaço. Inicialmente alteram somente a imagem de
// fundo (BG) do mapa — sem mexer em proporções, colliders, zonas etc.
// A seleção é persistida dentro de map_overrides (escopado por workspace
// e sincronizado em nuvem), de forma que todos os usuários do mesmo
// espaço vejam o mesmo tema.

import officeMapDefaultAsset from "@/assets/office-map-default-v2.png.asset.json";
const officeMapDefault = officeMapDefaultAsset.url;
import officeMapJunino from "@/assets/office-map-junino.jpg.asset.json";
import officeMapHalloween from "@/assets/office-map-halloween-v2.jpg.asset.json";
import officeMapNatal from "@/assets/office-map-natal.png.asset.json";
import officeMapNivel1 from "@/assets/office-map-nivel1.jpg.asset.json";
import officeMapNivel2 from "@/assets/office-map-nivel2.png.asset.json";
import {
  loadOverrides,
  newOverrides,
  saveOverrides,
  pushOverridesToCloud,
  pullOverridesFromCloud,
} from "@/lib/map-overrides";
import { getCurrentWorkspaceId } from "@/lib/workspace/current";
import { getCachedTier } from "@/lib/workspace/useWorkspaceTier";
import { getTierCaps } from "@/lib/workspace/tiers";

export type OfficeTheme = {
  id: string;
  label: string;
  description?: string;
  url: string;
  /** Nível mínimo para usar este tema (1, 2 ou 3). Default = qualquer nível. */
  minTier?: 1 | 2 | 3;
};

export const OFFICE_THEMES: OfficeTheme[] = [
  {
    id: "default",
    label: "Padrão",
    description: "Layout original da Prestativa Office (Nível 3).",
    url: officeMapDefault,
    minTier: 3,
  },
  {
    id: "nivel-1",
    label: "Nível 1 — Essencial",
    description: "Layout compacto para 1 a 2 pessoas.",
    url: officeMapNivel1.url,
  },
  {
    id: "nivel-2",
    label: "Nível 2 — Time",
    description: "Layout intermediário com até 5 estações de trabalho.",
    url: officeMapNivel2.url,
    minTier: 2,
  },
  {
    id: "festa-junina",
    label: "Festa Junina",
    description: "Bandeirinhas, girassóis e xadrez vermelho — arraiá no espaço.",
    url: officeMapJunino.url,
    minTier: 3,
  },
  {
    id: "halloween",
    label: "Halloween",
    description: "Abóboras, luzes e decoração de Halloween no escritório.",
    url: officeMapHalloween.url,
    minTier: 3,
  },
  {
    id: "natal",
    label: "Natal",
    description: "Árvores, guirlandas e luzes de Natal no escritório.",
    url: officeMapNatal.url,
    minTier: 3,
  },
];

export const DEFAULT_THEME_ID = "default";
export const CUSTOM_THEME_ID = "custom";
const EVENT = "office-theme-changed";

function getDefaultThemeIdForCurrentWorkspace(): string {
  const ws = getCurrentWorkspaceId();
  const tier = getCachedTier(ws);
  const tierDefault = tier != null ? getTierCaps(tier).defaultThemeId : null;
  return tierDefault ?? DEFAULT_THEME_ID;
}

export function getCurrentThemeId(): string {
  return loadOverrides()?.theme ?? getDefaultThemeIdForCurrentWorkspace();
}

export function getTheme(id: string): OfficeTheme {
  return OFFICE_THEMES.find((t) => t.id === id) ?? OFFICE_THEMES[0];
}

export function getCurrentTheme(): OfficeTheme {
  const o = loadOverrides();
  const id = o?.theme ?? getDefaultThemeIdForCurrentWorkspace();
  if (id === CUSTOM_THEME_ID && o?.customTheme?.url) {
    return {
      id: CUSTOM_THEME_ID,
      label: o.customTheme.label || "Tema personalizado",
      description: "Tema enviado pelo administrador.",
      url: o.customTheme.url,
    };
  }
  return getTheme(id);
}

export async function setCurrentThemeId(id: string): Promise<{ ok: boolean; error?: string }> {
  // Nunca partir de um mapa vazio: se o cache local não tem o mapa do espaço,
  // buscar o canônico na nuvem antes de gravar, para que trocar de tema jamais
  // apague paredes, zonas, spawns ou elementos já desenhados.
  let base = loadOverrides();
  if (!base) {
    try {
      base = await pullOverridesFromCloud();
    } catch {
      base = null;
    }
  }
  const next = { ...(base ?? newOverrides()), theme: id };
  saveOverrides(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT));
  }
  return pushOverridesToCloud(next);
}

export function subscribeTheme(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  // map-overrides-changed cobre cargas iniciais da nuvem e edições remotas
  window.addEventListener("map-overrides-changed", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("map-overrides-changed", handler);
  };
}
