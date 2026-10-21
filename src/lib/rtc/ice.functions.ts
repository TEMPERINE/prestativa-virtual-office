import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { authorizeIce } from "./rtc-access";

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export const getIceServers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string }) => d)
  .handler(async ({ data, context }): Promise<IceServer[]> => {
    await authorizeIce(data?.workspaceId, async (ws) => {
      const { data: ok, error } = await context.supabase.rpc("can_access_workspace_runtime", {
        _workspace_id: ws,
        _user_id: context.userId,
      });
      if (error) throw new Error("ICE_CHECK_FAILED");
      return ok === true;
    });
    const username = process.env.TURN_USERNAME;
    const credential = process.env.TURN_CREDENTIAL;
    const servers: IceServer[] = [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    ];
    if (username && credential) {
      servers.push(
        { urls: "stun:stun.relay.metered.ca:80" },
        { urls: "turn:standard.relay.metered.ca:80", username, credential },
        { urls: "turn:standard.relay.metered.ca:80?transport=tcp", username, credential },
        { urls: "turn:standard.relay.metered.ca:443", username, credential },
        { urls: "turns:standard.relay.metered.ca:443?transport=tcp", username, credential },
      );
    }
    return servers;
  });
