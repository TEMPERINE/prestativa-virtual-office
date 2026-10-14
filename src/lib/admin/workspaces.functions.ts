// Admin-only server fns para gerenciar espaços (workspaces) fora do hub regular.
// Permite criar, renomear, mudar tier, excluir e listar com metadados.

import { createServerFn } from "@tanstack/react-start";
import { requireSuperadmin } from "@/lib/admin/permissions.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .slice(0, 48) || "espaco"
  );
}

export const adminListWorkspacesFull = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ws, error } = await supabaseAdmin
      .from("workspaces")
      .select("id, name, slug, description, owner_id, tier, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (ws ?? []).map((w) => w.id);
    const ownerIds = (ws ?? []).map((w) => w.owner_id).filter(Boolean);

    const [{ data: members }, { data: profiles }] = await Promise.all([
      supabaseAdmin.from("workspace_members").select("workspace_id, user_id").in("workspace_id", ids),
      supabaseAdmin.from("profiles").select("id, display_name").in("id", ownerIds),
    ]);

    const profilesById = new Map((profiles ?? []).map((p: any) => [p.id, p.display_name]));
    const countByWs = new Map<string, number>();
    (members ?? []).forEach((m: any) => countByWs.set(m.workspace_id, (countByWs.get(m.workspace_id) ?? 0) + 1));

    return {
      workspaces: (ws ?? []).map((w: any) => ({
        ...w,
        owner_name: profilesById.get(w.owner_id) ?? "—",
        member_count: countByWs.get(w.id) ?? 0,
      })),
    };
  });

export const adminCreateWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; tier: 1 | 2 | 3; ownerId?: string | null }) => {
    if (!input.name || input.name.trim().length < 2) throw new Error("Nome muito curto");
    if (![1, 2, 3].includes(input.tier)) throw new Error("Tier inválido");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const ownerId = data.ownerId ?? context.userId;
    const slug = `${slugify(data.name)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: id, error } = await context.supabase.rpc("platform_create_workspace", {
      ws_slug: slug, ws_name: data.name.trim(), owner: ownerId, ws_tier: data.tier,
    });
    if (error || !id) throw new Error(error?.message ?? "Falha ao criar");
    return { id };
  });

export const adminUpdateWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; name?: string; tier?: 1 | 2 | 3; ownerId?: string }) => input)
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { error } = await context.supabase.rpc("platform_update_workspace", {
      ws: data.id, new_name: data.name, new_tier: data.tier, new_owner: data.ownerId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("workspaces").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Explicit ownership transfer; membership + owner_id change in one DB transaction. */
export const adminTransferWorkspaceOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; newOwnerId: string }) => input)
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { error } = await context.supabase.rpc("platform_transfer_workspace_owner", {
      ws: data.workspaceId, new_owner: data.newOwnerId, former_role: "member",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
