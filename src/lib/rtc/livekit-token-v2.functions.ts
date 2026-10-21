// RTC v2 — endpoint de token LiveKit (Etapa 7). NÃO ligado ao Office ainda.
// Independente do endpoint v1 (livekit.functions.ts), que segue inalterado.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { issueLiveKitTokenV2, parseTokenV2Input, TokenV2Error } from "./livekit-token-v2";

export const getLiveKitTokenV2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => parseTokenV2Input(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    try {
      // Visitantes ativos: só LOBBY (proximidade); salas privadas/reuniões seguem só para membros.
      const { data: member, error: memErr } = await sb.rpc("is_workspace_member", {
        _workspace_id: data.workspaceId,
        _user_id: context.userId,
      });
      if (memErr) throw memErr;
      if (member !== true && data.context !== "LOBBY") throw new TokenV2Error("NOT_MEMBER");
      return await issueLiveKitTokenV2(context.userId, data, {
        async isMember(workspaceId, userId) {
          const { data: ok, error } = await sb.rpc("can_access_workspace_runtime", {
            _workspace_id: workspaceId,
            _user_id: userId,
          });
          if (error) throw error;
          return ok === true;
        },
        async getOfficeSession(userId) {
          const { data: row, error } = await sb
            .from("office_sessions")
            .select("user_id, session_id, generation, workspace_id, active")
            .eq("user_id", userId)
            .maybeSingle();
          if (error) throw error;
          return row ? { ...row, generation: Number(row.generation) } : null;
        },
        async getCanonicalMap(workspaceId) {
          const { data: row, error } = await sb
            .from("map_overrides")
            .select("data, version")
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          if (error) throw error;
          return row ? { data: row.data, version: Number(row.version) } : null;
        },
        async getDisplayName(userId) {
          const { data: p } = await sb
            .from("profiles")
            .select("display_name")
            .eq("id", userId)
            .maybeSingle();
          if (p?.display_name) return p.display_name;
          const { data: v } = await sb
            .from("workspace_visitors")
            .select("display_name")
            .eq("user_id", userId)
            .is("revoked_at", null)
            .gt("expires_at", new Date().toISOString())
            .maybeSingle();
          return v?.display_name ?? null;
        },
        config: {
          url: process.env.LIVEKIT_URL,
          apiKey: process.env.LIVEKIT_API_KEY,
          apiSecret: process.env.LIVEKIT_API_SECRET,
        },
      });
    } catch (e) {
      if (e instanceof TokenV2Error) throw new Error(e.code);
      console.error("[livekit-token-v2] falha interna", e instanceof Error ? e.message : e);
      throw new Error("TOKEN_V2_INTERNAL");
    }
  });
