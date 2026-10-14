import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireSuperadmin } from "./permissions.server";
import { isMapOverridesShape, normalizeMapOverrides } from "@/lib/map-sync";

const Workspace = z.object({ workspaceId: z.string().uuid() });

export const adminReadWorkspaceMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth]).inputValidator((d: unknown) => Workspace.parse(d))
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("map_overrides")
      .select("data, version").eq("workspace_id", data.workspaceId).maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminWriteWorkspaceMap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Workspace.extend({ map: z.unknown() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    if (!isMapOverridesShape(data.map)) throw new Error("Mapa inválido");
    const normalized = normalizeMapOverrides(data.map) ?? data.map;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("map_overrides").upsert({
      workspace_id: data.workspaceId, data: JSON.parse(JSON.stringify(normalized)),
      updated_by: context.userId, updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id" }).select("data, version").single();
    if (error) throw new Error(error.message);
    // Existing database trigger remains the only source of map version.
    return row;
  });

export const adminManageSavePoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Workspace.extend({
    action: z.enum(["list", "create", "delete"]), id: z.string().uuid().optional(),
    name: z.string().trim().min(1).optional(), map: z.unknown().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.action === "list") {
      const { data: rows, error } = await supabaseAdmin.from("map_save_points")
        .select("id,name,created_at,data").eq("workspace_id", data.workspaceId).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return { rows: rows ?? [] };
    }
    if (data.action === "delete") {
      if (!data.id) throw new Error("Save point inválido");
      const { error } = await supabaseAdmin.from("map_save_points").delete().eq("workspace_id", data.workspaceId).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      if (!data.name || !isMapOverridesShape(data.map)) throw new Error("Save point inválido");
      const { error } = await supabaseAdmin.from("map_save_points").insert({
        workspace_id: data.workspaceId, name: data.name, data: JSON.parse(JSON.stringify(data.map)), created_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    return { rows: [] };
  });

export const adminManageCustomProps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Workspace.extend({
    action: z.enum(["list", "create", "delete"]), id: z.string().min(1).optional(),
    prop: z.object({ id: z.string().min(1), label: z.string().trim().min(1),
      frames: z.array(z.string().startsWith("data:image/png;base64,")).min(1),
      default_w: z.number().positive(), aspect_ratio: z.number().positive() }).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.action === "list") {
      const { data: rows, error } = await supabaseAdmin.from("custom_props")
        .select("id,label,frames,default_w,aspect_ratio").eq("workspace_id", data.workspaceId).order("created_at");
      if (error) throw new Error(error.message);
      return { rows: rows ?? [] };
    }
    if (data.action === "delete") {
      if (!data.id) throw new Error("Elemento inválido");
      const { error } = await supabaseAdmin.from("custom_props").delete().eq("workspace_id", data.workspaceId).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      if (!data.prop) throw new Error("Elemento inválido");
      const { error } = await supabaseAdmin.from("custom_props").insert({
        ...data.prop, workspace_id: data.workspaceId, created_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    return { rows: [] };
  });
