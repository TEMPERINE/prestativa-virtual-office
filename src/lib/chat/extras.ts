import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { parseChatMessage } from "./api";
import type { ChatMessage } from "./types";

/** Conversation-wide pin (one per conversation) and per-user favorites. */
export type ChatPin = { message_id: string; pinned_by: string | null; pinned_at: string | null };
export interface ChatExtrasApi {
  pin(cid: string): Promise<ChatPin | null>;
  setPin(cid: string, messageId: string | null): Promise<ChatPin | null>;
  favorites(cid: string): Promise<string[]>;
  setFavorite(cid: string, messageId: string, favorite: boolean): Promise<void>;
  messages(cid: string, ids: string[]): Promise<ChatMessage[]>;
  watchPin(cid: string, changed: (pin: ChatPin | null) => void): () => void;
}

export function parsePin(value: unknown): ChatPin | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.pinned_message_id !== "string") return null;
  return {
    message_id: r.pinned_message_id,
    pinned_by: typeof r.pinned_by === "string" ? r.pinned_by : null,
    pinned_at: typeof r.pinned_at === "string" ? r.pinned_at : null,
  };
}

let seq = 0;
export function createChatExtrasApi(typed: SupabaseClient<Database>): ChatExtrasApi {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = typed as unknown as SupabaseClient<any>;
  const check = (error: unknown) => {
    if (error) throw new Error("Não foi possível atualizar a mensagem. Tente novamente.");
  };
  return {
    async pin(cid) {
      const { data, error } = await client
        .from("chat_conversations")
        .select("pinned_message_id,pinned_by,pinned_at")
        .eq("id", cid)
        .maybeSingle();
      check(error);
      return parsePin(data);
    },
    async setPin(cid, messageId) {
      const { data, error } = await client.rpc("chat_set_pin", { cid, message_id: messageId });
      check(error);
      return parsePin(data);
    },
    async favorites(cid) {
      const { data, error } = await client
        .from("chat_message_favorites")
        .select("message_id")
        .eq("conversation_id", cid)
        .order("created_at", { ascending: false });
      check(error);
      return (data ?? []).map((r: { message_id: string }) => r.message_id);
    },
    async setFavorite(cid, messageId, favorite) {
      const { error } = await client.rpc("chat_set_favorite", {
        cid,
        message_id: messageId,
        favorite,
      });
      check(error);
    },
    async messages(cid, ids) {
      if (!ids.length) return [];
      const { data, error } = await client
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", cid)
        .in("id", ids.slice(0, 200));
      check(error);
      return (data ?? []).map(parseChatMessage).filter((m): m is ChatMessage => !!m);
    },
    watchPin(cid, changed) {
      let closed = false;
      const channel = client
        .channel(`office-chat:pin:${cid}:${++seq}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "chat_conversations", filter: `id=eq.${cid}` },
          (payload) => {
            if (!closed && (payload.new as { id?: string }).id === cid) changed(parsePin(payload.new));
          },
        )
        .subscribe();
      return () => {
        if (closed) return;
        closed = true;
        void client.removeChannel(channel).catch(() => {});
      };
    },
  };
}
