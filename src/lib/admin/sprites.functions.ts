// Admin-only server fns para gerenciar o catálogo de personagens (skins).
// Skins criadas aqui são "extras" — as 9 default permanecem em sprite-catalog.ts.

import { createServerFn } from "@tanstack/react-start";
import { requireSuperadmin } from "@/lib/admin/permissions.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Facing = "up" | "down" | "left" | "right";
type Sheets = Record<Facing, string>;
type Dims = Record<Facing, { w: number; h: number }>;


export const adminListSkins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: skins, error }, { data: ws }] = await Promise.all([
      supabaseAdmin.from("sprite_skins").select("*").order("created_at", { ascending: false }),
      supabaseAdmin.from("workspaces").select("id, name"),
    ]);
    if (error) throw new Error(error.message);
    const wsById = new Map((ws ?? []).map((w: any) => [w.id, w.name]));
    return {
      skins: (skins ?? []).map((s: any) => ({
        ...s,
        workspace_name: s.workspace_id ? wsById.get(s.workspace_id) ?? "—" : null,
      })),
    };
  });

export const adminCreateSignedUploadUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { skinId: string; facings: Facing[] }) => {
    if (!/^[a-z0-9-]{2,32}$/.test(input.skinId)) throw new Error("ID inválido (use a-z, 0-9, -)");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result: Record<string, { signedUrl: string; path: string; token: string }> = {};
    for (const f of data.facings) {
      const path = `${data.skinId}/${f}-${Date.now()}.png`;
      const { data: signed, error } = await supabaseAdmin.storage
        .from("sprite-sheets")
        .createSignedUploadUrl(path);
      if (error || !signed) throw new Error(error?.message ?? "Falha ao gerar upload");
      result[f] = { signedUrl: signed.signedUrl, path, token: signed.token };
    }
    return { uploads: result };
  });

export const adminSaveSkin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id: string;
      label: string;
      gender: "m" | "f" | "n";
      workspaceId?: string | null;
      sheets: Sheets;
      dims: Dims;
      mirrorRightFromLeft?: boolean;
      mirrorLeftFromRight?: boolean;
    }) => {
      if (!/^[a-z0-9-]{2,32}$/.test(input.id)) throw new Error("ID inválido");
      if (!input.label || input.label.trim().length < 1) throw new Error("Rótulo obrigatório");
      return input;
    },
  )
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("sprite_skins")
      .upsert({
        id: data.id,
        label: data.label.trim(),
        gender: data.gender,
        workspace_id: data.workspaceId ?? null,
        sheets: data.sheets,
        dims: data.dims,
        mirror_right_from_left: !!data.mirrorRightFromLeft,
        mirror_left_from_right: !!data.mirrorLeftFromRight,
        created_by: (context as any).userId,
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminUpdateSkin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; label?: string; workspaceId?: string | null; gender?: "m" | "f" | "n" }) => input)
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = {};
    if (data.label !== undefined) patch.label = data.label.trim();
    if (data.workspaceId !== undefined) patch.workspace_id = data.workspaceId;
    if (data.gender !== undefined) patch.gender = data.gender;
    const { error } = await supabaseAdmin.from("sprite_skins").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteSkin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("sprite_skins").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
