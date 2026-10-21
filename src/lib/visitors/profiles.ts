import { supabase } from "@/integrations/supabase/client";

export const VISITOR_AVATAR_COLOR = "#64748b";

export type VisitorProfile = {
  id: string;
  display_name: string;
  avatar_color: string;
  sprite_id: string | null;
  status: "available";
  is_visitor: true;
};

/** Members keep their existing profile read; visitors use only authorized display identities. */
export async function loadOfficeMemberProfiles(workspaceId: string | null, isVisitor: boolean, ids?: string[]) {
  if (isVisitor) {
    if (!workspaceId) return [];
    const { data, error } = await supabase.rpc("workspace_runtime_profiles", { workspace_id: workspaceId });
    if (error) throw error;
    return (data ?? []).filter((p) => !ids || ids.includes(p.id)).map((p) => ({
      id: p.id, display_name: p.display_name, sprite_id: p.sprite_id, avatar_color: p.avatar_color,
    }));
  }
  let q = supabase.from("profiles").select("id, display_name, avatar_color, sprite_id, tagline, status, onboarded_at, first_name, last_name, birth_date, city, state, country_code");
  if (ids) q = q.in("id", ids);
  const { data } = await q;
  return data ?? [];
}

/** Visitantes ativos do workspace como perfis de exibição (sem tocar em public.profiles). */
export async function loadActiveVisitorProfiles(workspaceId: string, ids?: string[]): Promise<VisitorProfile[]> {
  let q = supabase
    .from("workspace_visitors")
    .select("user_id, display_name, sprite_id, expires_at, revoked_at")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  if (ids && ids.length) q = q.in("user_id", ids);
  const { data } = await q;
  return (data ?? []).map((v) => ({
    id: v.user_id,
    display_name: v.display_name,
    avatar_color: VISITOR_AVATAR_COLOR,
    sprite_id: v.sprite_id,
    status: "available" as const,
    is_visitor: true as const,
  }));
}
