import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ChatRealtime } from "./types";
import { parseChatMessage } from "./api";

// A leaving Supabase channel can remain registered until its async ack.
// Unique topics prevent subscribe() from reusing that old channel on A→B→A.
let subscriptionSequence = 0;

export function createChatRealtime(client: SupabaseClient<Database>): ChatRealtime {
  return {
    inbox(workspaceId, userId, changed, status) {
      let closed = false;
      const channel = client.channel(
        `office-chat:inbox:${workspaceId}:${userId}:${++subscriptionSequence}`,
      );
      for (const participant of ["participant_a", "participant_b"] as const) {
        for (const event of ["INSERT", "UPDATE"] as const) {
          channel.on(
            "postgres_changes",
            {
              event,
              schema: "public",
              table: "chat_conversations",
              filter: `${participant}=eq.${userId}`,
            },
            (payload) => {
              if (
                !closed &&
                (payload.new as { workspace_id?: string }).workspace_id === workspaceId
              )
                changed();
            },
          );
        }
      }
      channel.subscribe((value) => {
        if (closed) return;
        status(
          value === "SUBSCRIBED"
            ? "online"
            : value === "CLOSED" || value === "CHANNEL_ERROR" || value === "TIMED_OUT"
              ? "offline"
              : "connecting",
        );
      });
      return () => {
        if (closed) return;
        closed = true;
        void client.removeChannel(channel).catch(() => {});
      };
    },
    messages(conversationId, received, ready) {
      let closed = false;
      const channel = client
        .channel(`office-chat:messages:${conversationId}:${++subscriptionSequence}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chat_messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const message = parseChatMessage(payload.new);
            if (!closed && message?.conversation_id === conversationId) received(message);
          },
        )
        .subscribe((status) => {
          if (!closed && status === "SUBSCRIBED") ready();
        });
      return () => {
        if (closed) return;
        closed = true;
        void client.removeChannel(channel).catch(() => {});
      };
    },
  };
}
