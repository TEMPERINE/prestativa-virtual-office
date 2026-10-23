// Núcleo PURO do token LiveKit v2 (Etapa 7). Sem I/O próprio: tudo via deps,
// para ser testável sem rede. O wrapper servidor fica em livekit-token-v2.functions.ts.
import { z } from "zod";
import { normalizeMapOverrides } from "@/lib/map-sync";
import { roomNameFor } from "./room-names";
import { classifyZone, resolveMeetingZone } from "./canonical-zones";
import type { MediaContext } from "./media-context";

export const TOKEN_V2_TTL = "10m";

/** Contrato estrito: campos extras (userId, identity, roomName, apiKey…) são rejeitados. */
export const TokenV2Input = z.discriminatedUnion("context", [
  z
    .object({
      context: z.literal("LOBBY"),
      workspaceId: z.string().uuid(),
      sessionId: z.string().uuid(),
      generation: z.number().int().positive(),
      mapVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      context: z.literal("PRIVATE_ROOM"),
      workspaceId: z.string().uuid(),
      sessionId: z.string().uuid(),
      generation: z.number().int().positive(),
      mapVersion: z.number().int().min(0),
      zoneId: z
        .string()
        .min(1)
        .max(100)
        .regex(/^[a-zA-Z0-9_-]+$/),
    })
    .strict(),
]);
export type TokenV2Input = z.infer<typeof TokenV2Input>;

export type TokenV2ErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_INPUT"
  | "NOT_MEMBER"
  | "SESSION_INVALID"
  | "MAP_VERSION_STALE"
  | "ZONE_NOT_FOUND"
  | "ZONE_NOT_PRIVATE"
  | "VISITOR_ZONE_FORBIDDEN"
  | "LIVEKIT_NOT_CONFIGURED";

export class TokenV2Error extends Error {
  constructor(public code: TokenV2ErrorCode) {
    super(code);
    this.name = "TokenV2Error";
  }
}

export type OfficeSessionRow = {
  user_id: string;
  session_id: string;
  generation: number;
  workspace_id: string;
  active: boolean;
};

export interface TokenV2Deps {
  /** Acesso ao runtime do Office (membro real OU visitante ativo) — can_access_workspace_runtime. */
  canAccessRuntime(workspaceId: string, userId: string): Promise<boolean>;
  /** Membro real do workspace (is_workspace_member). false = visitante ativo. */
  isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean>;
  getOfficeSession(userId: string): Promise<OfficeSessionRow | null>;
  getCanonicalMap(workspaceId: string): Promise<{ data: unknown; version: number } | null>;
  getDisplayName(userId: string): Promise<string | null>;
  config: { url?: string; apiKey?: string; apiSecret?: string };
}

export type TokenV2Result = { url: string; token: string; roomName: string };

export function parseTokenV2Input(raw: unknown): TokenV2Input {
  const r = TokenV2Input.safeParse(raw);
  if (!r.success) throw new TokenV2Error("INVALID_INPUT");
  return r.data;
}

export async function issueLiveKitTokenV2(
  userId: string | null | undefined,
  raw: unknown,
  deps: TokenV2Deps,
): Promise<TokenV2Result> {
  if (!userId) throw new TokenV2Error("UNAUTHENTICATED");
  const input = parseTokenV2Input(raw);

  if (!(await deps.canAccessRuntime(input.workspaceId, userId))) throw new TokenV2Error("NOT_MEMBER");

  const s = await deps.getOfficeSession(userId);
  if (
    !s ||
    s.user_id !== userId ||
    s.session_id !== input.sessionId ||
    Number(s.generation) !== input.generation ||
    s.workspace_id !== input.workspaceId ||
    s.active !== true
  ) {
    throw new TokenV2Error("SESSION_INVALID");
  }

  let ctx: MediaContext;
  if (input.context === "PRIVATE_ROOM") {
    const row = await deps.getCanonicalMap(input.workspaceId);
    const canonicalVersion = row ? Number(row.version) : 0;
    if (input.mapVersion !== canonicalVersion) throw new TokenV2Error("MAP_VERSION_STALE");
    const map = row ? normalizeMapOverrides(row.data) : null;
    const zone = resolveMeetingZone(map, input.zoneId);
    if (!zone.ok) throw new TokenV2Error(zone.reason);
    // Visitante: zonas normais liberadas; salas de vídeo/reunião (supportsVideo canônico) não.
    if (classifyZone(map, zone.zoneId).supportsVideo && !(await deps.isWorkspaceMember(input.workspaceId, userId)))
      throw new TokenV2Error("VISITOR_ZONE_FORBIDDEN");
    ctx = { kind: "PRIVATE_ROOM", zoneId: zone.zoneId };
  } else {
    ctx = { kind: "LOBBY" };
  }

  const { url, apiKey, apiSecret } = deps.config;
  if (!url || !apiKey || !apiSecret) throw new TokenV2Error("LIVEKIT_NOT_CONFIGURED");

  const roomName = roomNameFor(input.workspaceId, ctx)!;
  const name = (await deps.getDisplayName(userId)) ?? "Convidado";

  const { AccessToken } = await import("livekit-server-sdk");
  const at = new AccessToken(apiKey, apiSecret, { identity: userId, name, ttl: TOKEN_V2_TTL });
  at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();
  return { url, token, roomName };
}
