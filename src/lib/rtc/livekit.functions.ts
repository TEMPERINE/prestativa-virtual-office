import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { authorizeV1Room } from "./rtc-access";

const Input = z.object({
  roomName: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9_:.\-]+$/),
  userId: z.string().uuid(),
  clientId: z
    .string()
    .min(8)
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
});

export const getLiveKitAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    if (data.userId !== context.userId) {
      throw new Error(
        "Sessão da chamada não corresponde ao personagem atual. Recarregue o espaço.",
      );
    }

    // Sala arbitrária não: workspace extraído do nome e membership real exigido.
    await authorizeV1Room(data.roomName, async (ws) => {
      const { data: ok, error } = await context.supabase.rpc("is_workspace_member", {
        _workspace_id: ws,
        _user_id: context.userId,
      });
      if (error) throw new Error("RTC_V1_CHECK_FAILED");
      return ok === true;
    });

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) {
      throw new Error("LiveKit não configurado (LIVEKIT_URL/KEY/SECRET ausentes)");
    }

    const { data: prof } = await context.supabase
      .from("profiles")
      .select("display_name")
      .eq("id", context.userId)
      .maybeSingle();

    const participantIdentity = data.clientId
      ? `${context.userId}:${data.clientId}`
      : context.userId;

    const { AccessToken } = await import("livekit-server-sdk");
    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: prof?.display_name ?? "Convidado",
      metadata: JSON.stringify({ userId: context.userId, clientId: data.clientId ?? "primary" }),
      attributes: { userId: context.userId, clientId: data.clientId ?? "primary" },
      ttl: "6h",
    });
    at.addGrant({
      room: data.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();
    return { url, token, identity: participantIdentity };
  });
