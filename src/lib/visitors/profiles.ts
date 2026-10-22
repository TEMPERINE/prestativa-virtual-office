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

export type RuntimeMemberProfile = { id: string; display_name: string; sprite_id: string | null; avatar_color: string };

/**
 * Identidades visuais da equipe do workspace atual (membros reais apenas).
 * Fonte única para membros e visitantes: workspace_runtime_profiles (membership é a autoridade).
 * Nunca lê public.profiles diretamente — evita vazar perfis de outros workspaces.
 */
export async function loadOfficeMemberProfiles(workspaceId: string | null, ids?: string[]): Promise<RuntimeMemberProfile[]> {
  if (!workspaceId) return [];
  const { data, error } = await supabase.rpc("workspace_runtime_profiles", { workspace_id: workspaceId });
  if (error) throw error;
  return (data ?? []).filter((p) => !ids || ids.includes(p.id)).map((p) => ({
    id: p.id, display_name: p.display_name, sprite_id: p.sprite_id, avatar_color: p.avatar_color,
  }));
}

/** Monta o cache de perfis do runtime: só membros + visitantes ativos do workspace; o próprio usuário mantém campos completos. */
export function buildRuntimeProfileMap<T extends { id: string }>(
  members: RuntimeMemberProfile[],
  visitors: VisitorProfile[],
  self?: T | null,
): Record<string, T> {
  const map: Record<string, T> = {};
  for (const m of members) map[m.id] = m as unknown as T;
  for (const v of visitors) map[v.id] = v as unknown as T;
  if (self && map[self.id]) map[self.id] = { ...map[self.id], ...self };
  return map;
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
