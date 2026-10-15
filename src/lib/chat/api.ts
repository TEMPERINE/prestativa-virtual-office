import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { CHAT_PAGE_SIZE, type ChatApi, type ChatMessage } from "./types";

export class ChatUnavailableError extends Error {
  constructor() {
    super("O chat ainda aguarda configuração neste ambiente.");
  }
}
function fail(error: { code?: string } | null): void {
  if (!error) return;
  if (["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code ?? ""))
    throw new ChatUnavailableError();
  if (error.code === "42501") throw new Error("Você não tem acesso a esta conversa.");
  throw new Error("Não foi possível atualizar o chat. Tente novamente.");
}
/** The network is a boundary: never put an unchecked Realtime/JSON value in UI. */
export function parseChatMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    ["id", "conversation_id", "sender_id", "body", "created_at"].some(
      (k) => typeof row[k] !== "string",
    )
  )
    return null;
  if (row.message_type !== "text" && row.message_type !== "sticker") return null;
  const seq = typeof row.seq === "number" ? row.seq : Number(row.seq);
  if (!Number.isSafeInteger(seq) || seq <= 0) return null;
  return {
    id: row.id as string,
    conversation_id: row.conversation_id as string,
    sender_id: row.sender_id as string,
    body: row.body as string,
    message_type: row.message_type,
    created_at: row.created_at as string,
    seq,
  };
}

export function createChatApi(client: SupabaseClient<Database>): ChatApi {
  return {
    async list(workspaceId) {
      const { data, error } = await client.rpc("chat_list_conversations", { ws: workspaceId });
      fail(error);
      return data ?? [];
    },
    async start(workspaceId, peerId) {
      const { data, error } = await client.rpc("chat_start_conversation", {
        ws: workspaceId,
        peer: peerId,
      });
      fail(error);
      if (!data) throw new Error("Não foi possível abrir a conversa.");
      return data;
    },
    async history(conversationId, before) {
      let query = client
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("seq", { ascending: false })
        .limit(CHAT_PAGE_SIZE + 1);
      if (before !== undefined) query = query.lt("seq", before);
      const { data, error } = await query;
      fail(error);
      const rows = data ?? [];
      return {
        messages: rows.slice(0, CHAT_PAGE_SIZE).reverse(),
        hasMore: rows.length > CHAT_PAGE_SIZE,
      };
    },
    async send(conversationId, body, type, id) {
      const { data, error } = await client.rpc("chat_send_message", {
        cid: conversationId,
        content: body,
        kind: type,
        message_id: id,
      });
      fail(error);
      const message = parseChatMessage(data);
      if (!message) throw new Error("Não foi possível confirmar o envio. Tente novamente.");
      return message;
    },
    async read(conversationId, through) {
      const { error } = await client.rpc("chat_mark_read", {
        cid: conversationId,
        through_seq: through,
      });
      fail(error);
    },
  };
}
