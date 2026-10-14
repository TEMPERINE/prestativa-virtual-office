import { usesSuperadminTransport } from "@/lib/admin/workspace-access";
// Cria um novo workspace (espaço) de forma isolada, sem afetar o
// workspace atualmente em uso. Toda a configuração inicial vai direto
// para a nuvem escopada por workspace_id — não toca em localStorage
// nem dispara eventos que o OfficeScene atual escuta.

import { supabase } from "@/integrations/supabase/client";
import { newOverrides, type MapOverrides } from "@/lib/map-overrides";

export type SeedSource = "blank" | "current";

export type CreateWorkspaceInput = {
  name: string;
  slug: string;
  description?: string | null;
  cover_url?: string | null;
  themeId: string;
  customThemeUrl?: string | null;
  customThemeLabel?: string | null;
  seedFrom: SeedSource;
  sourceWorkspaceId?: string | null; // usado quando seedFrom = "current"
  tier?: 1 | 2 | 3; // default 1
};

export type CreateWorkspaceResult =
  | { ok: true; workspaceId: string }
  | { ok: false; error: string };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 48) || "espaco";
}

export function suggestSlug(name: string): string {
  const base = slugify(name);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

async function fetchSourceOverrides(
  sourceWorkspaceId: string
): Promise<MapOverrides | null> {
  if (await usesSuperadminTransport()) {
    const { adminReadWorkspaceMap } = await import("@/lib/admin/workspace-resources.functions");
    const row = await adminReadWorkspaceMap({ data: { workspaceId: sourceWorkspaceId } });
    return row?.data as unknown as MapOverrides ?? null;
  }
  const { data, error } = await supabase
    .from("map_overrides")
    .select("data")
    .eq("workspace_id", sourceWorkspaceId)
    .maybeSingle();
  if (error || !data) return null;
  const parsed = (data.data as unknown) as MapOverrides;
  if (!parsed?.cols || !parsed?.rows || !Array.isArray(parsed.blocked)) return null;
  return parsed;
}

export async function createWorkspace(
  input: CreateWorkspaceInput
): Promise<CreateWorkspaceResult> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, error: "Não autenticado." };
  }
  const uid = userData.user.id;

  // 1) Cria o workspace (com nível).
  let workspaceId: string;
  if (await usesSuperadminTransport()) {
    const { data: id, error } = await supabase.rpc("platform_create_workspace", {
      ws_slug: input.slug.trim(), ws_name: input.name.trim(), owner: uid, ws_tier: input.tier ?? 1,
    });
    if (error || !id) return { ok: false, error: error?.message ?? "Falha ao criar espaço." };
    workspaceId = id;
    const { error: metadataError } = await supabase.from("workspaces").update({
      description: input.description?.trim() || null, cover_url: input.cover_url || null,
    }).eq("id", workspaceId);
    if (metadataError) {
      await supabase.from("workspaces").delete().eq("id", workspaceId);
      return { ok: false, error: metadataError.message };
    }
  } else {
    const { data: wsRow, error: wsErr } = await supabase
      .from("workspaces")
      .insert({
        name: input.name.trim(),
        slug: input.slug.trim(),
        description: input.description?.trim() || null,
        cover_url: input.cover_url || null,
        owner_id: uid,
        tier: input.tier ?? 1,
      } as any)
      .select("id")
      .single();

    if (wsErr || !wsRow) {
      return { ok: false, error: wsErr?.message ?? "Falha ao criar espaço." };
    }
    workspaceId = wsRow.id as string;

    // 2) Garante o owner como membro.
    const { error: memErr } = await supabase
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: uid, role: "owner" });
    if (memErr && !/duplicate|conflict/i.test(memErr.message)) {
      // Rollback best-effort.
      await supabase.from("workspaces").delete().eq("id", workspaceId);
      return { ok: false, error: memErr.message };
    }

  }

  // 3) Monta overrides iniciais (em branco ou copiado do atual) + tema.
  let baseOverrides: MapOverrides;
  if (input.seedFrom === "current" && input.sourceWorkspaceId) {
    const src = await fetchSourceOverrides(input.sourceWorkspaceId);
    baseOverrides = src ?? newOverrides();
  } else {
    baseOverrides = newOverrides();
  }
  const overrides: MapOverrides = {
    ...baseOverrides,
    theme: input.themeId,
    ...(input.themeId === "custom" && input.customThemeUrl
      ? { customTheme: { url: input.customThemeUrl, label: input.customThemeLabel || "Tema personalizado" } }
      : {}),
  };

  const { error: mapErr } = await supabase.from("map_overrides").upsert(
    {
      workspace_id: workspaceId,
      data: JSON.parse(JSON.stringify(overrides)),
      updated_by: uid,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" }
  );
  if (mapErr) {
    // Não faz rollback do workspace — o admin pode editar o mapa depois.
    return { ok: false, error: `Workspace criado, mas falhou ao salvar mapa: ${mapErr.message}` };
  }

  // 4) Se copiando do atual, clona custom_props do source.
  if (input.seedFrom === "current" && input.sourceWorkspaceId) {
    const { data: cps } = await supabase
      .from("custom_props")
      .select("id, label, frames, default_w, aspect_ratio")
      .eq("workspace_id", input.sourceWorkspaceId);
    if (cps && cps.length > 0) {
      const rows = cps.map((p: any) => ({
        id: `${p.id}-${Math.random().toString(36).slice(2, 6)}`,
        workspace_id: workspaceId,
        label: p.label,
        frames: p.frames,
        default_w: p.default_w,
        aspect_ratio: p.aspect_ratio,
        created_by: uid,
      }));
      await supabase.from("custom_props").insert(rows);
    }
  }

  return { ok: true, workspaceId };
}
