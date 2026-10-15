import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  CHAT_PAGE_SIZE,
  type ChatApi,
  type ChatMessage,
  type ChatConversation,
  type ChatReaction,
  type ChatContact,
} from "./types";

export class ChatUnavailableError extends Error {
  constructor() {
    super("O chat ainda aguarda configuração neste ambiente.");
  }
}
export class ChatActionError extends Error {}
const missing = (error: { code?: string } | null) =>
  ["PGRST202", "42883"].includes(error?.code ?? "");
function fail(error: { code?: string } | null): void {
  if (!error) return;
  if (["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code ?? ""))
    throw new ChatUnavailableError();
  if (error.code === "PCH01")
    throw new ChatActionError("Não é mais possível cancelar esta mensagem porque ela já foi lida.");
  if (error.code === "PCH02") throw new ChatActionError("Esta mensagem foi cancelada ou apagada.");
  if (error.code === "PCH03")
    throw new ChatActionError("Esta mensagem ainda não foi lida. Use Cancelar envio.");
  if (error.code === "42501") throw new ChatActionError("Você não tem acesso a esta conversa.");
  throw new Error("Não foi possível atualizar o chat. Tente novamente.");
}
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const cursor = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

/** Network boundary; a tombstone can never put old plaintext back in the UI. */
export function parseChatMessage(value: unknown): ChatMessage | null {
  const row = record(value);
  if (
    !row ||
    ["id", "conversation_id", "sender_id", "created_at"].some((k) => typeof row[k] !== "string")
  )
    return null;
  if (row.message_type !== "text" && row.message_type !== "sticker") return null;
  const seq = typeof row.seq === "number" ? row.seq : Number(row.seq);
  if (!Number.isSafeInteger(seq) || seq <= 0) return null;
  if (row.cancelled_at !== undefined && !nullableString(row.cancelled_at)) return null;
  if (row.deleted_at !== undefined && !nullableString(row.deleted_at)) return null;
  if (!row.cancelled_at && !row.deleted_at && typeof row.body !== "string") return null;
  if (row.reply_to_message_id !== undefined && !nullableString(row.reply_to_message_id))
    return null;
  if (row.is_forwarded !== undefined && typeof row.is_forwarded !== "boolean") return null;
  return {
    id: row.id as string,
    conversation_id: row.conversation_id as string,
    sender_id: row.sender_id as string,
    body: row.cancelled_at || row.deleted_at ? null : (row.body as string),
    message_type: row.message_type,
    seq,
    created_at: row.created_at as string,
    ...("deleted_at" in row ? { deleted_at: row.deleted_at as string | null } : {}),
    ...("cancelled_at" in row ? { cancelled_at: row.cancelled_at as string | null } : {}),
    ...("reply_to_message_id" in row
      ? { reply_to_message_id: row.reply_to_message_id as string | null }
      : {}),
    ...("is_forwarded" in row ? { is_forwarded: row.is_forwarded as boolean } : {}),
  };
}
export function parseChatReaction(value: unknown): ChatReaction | null {
  const row = record(value);
  if (
    !row ||
    ["message_id", "conversation_id", "user_id", "created_at"].some(
      (k) => typeof row[k] !== "string",
    ) ||
    !nullableString(row.emoji) ||
    !cursor(row.revision) ||
    row.revision < 1
  )
    return null;
  return {
    message_id: row.message_id as string,
    conversation_id: row.conversation_id as string,
    user_id: row.user_id as string,
    emoji: row.emoji,
    revision: row.revision,
    created_at: row.created_at as string,
  };
}
function parseConversation(value: unknown): ChatConversation | null {
  const r = record(value);
  if (
    !r ||
    [
      "id",
      "workspace_id",
      "participant_a",
      "participant_b",
      "created_at",
      "peer_id",
      "peer_name",
      "peer_color",
    ].some((k) => typeof r[k] !== "string") ||
    [
      "last_message_seq",
      "read_seq",
      "unread_count",
      "own_delivered_seq",
      "peer_delivered_seq",
      "peer_read_seq",
    ].some((k) => !cursor(r[k])) ||
    [
      "last_message_at",
      "last_body",
      "last_type",
      "last_sender_id",
      "peer_sprite_id",
      "last_cancelled_at",
    ].some((k) => !nullableString(r[k]))
  )
    return null;
  if (r.last_deleted_at !== undefined && !nullableString(r.last_deleted_at)) return null;
  return {
    ...(r.last_deleted_at !== undefined
      ? { last_deleted_at: r.last_deleted_at as string | null }
      : {}),
    id: r.id as string,
    workspace_id: r.workspace_id as string,
    participant_a: r.participant_a as string,
    participant_b: r.participant_b as string,
    created_at: r.created_at as string,
    last_message_at: r.last_message_at as string | null,
    last_message_seq: r.last_message_seq as number,
    read_seq: r.read_seq as number,
    unread_count: r.unread_count as number,
    peer_id: r.peer_id as string,
    peer_name: r.peer_name as string,
    peer_sprite_id: r.peer_sprite_id as string | null,
    peer_color: r.peer_color as string,
    last_body: r.last_body as string | null,
    last_type: r.last_type as string | null,
    last_sender_id: r.last_sender_id as string | null,
    own_delivered_seq: r.own_delivered_seq as number,
    peer_delivered_seq: r.peer_delivered_seq as number,
    peer_read_seq: r.peer_read_seq as number,
    last_cancelled_at: r.last_cancelled_at as string | null,
  };
}
function messages(rows: unknown[]): ChatMessage[] {
  return rows.map((row) => {
    const parsed = parseChatMessage(row);
    if (!parsed) throw new Error("Invalid message response");
    return parsed;
  });
}
function one(value: unknown): ChatMessage {
  const parsed = parseChatMessage(value);
  if (!parsed) throw new Error("Não foi possível confirmar o envio. Tente novamente.");
  return parsed;
}
export function createChatApi(client: SupabaseClient<Database>): ChatApi {
  let interactions: boolean | null = null;
  return {
    supportsInteractions: () => interactions === true,
    resetCapabilities: () => {
      interactions = null;
    },
    async list(workspaceId) {
      if (interactions !== false) {
        const { data, error } = await client.rpc("chat_list_conversations_v2", { ws: workspaceId });
        if (missing(error)) interactions = false;
        else {
          fail(error);
          if (!Array.isArray(data)) throw new Error("Invalid inbox response");
          const rows = data.map(parseConversation);
          if (rows.some((r) => !r)) throw new Error("Invalid inbox response");
          interactions = true;
          return rows as ChatConversation[];
        }
      }
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
    async history(cid, before) {
      let query = client
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", cid)
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
    async send(cid, body, type, id, replyTo) {
      const result = replyTo
        ? await client.rpc("chat_send_message_v2", {
            cid,
            content: body,
            kind: type,
            message_id: id,
            reply_to: replyTo,
          })
        : await client.rpc("chat_send_message", { cid, content: body, kind: type, message_id: id });
      fail(result.error);
      return one(result.data);
    },
    async read(cid, through) {
      const { error } = await client.rpc("chat_mark_read", { cid, through_seq: through });
      fail(error);
    },
    async undelivered(cid, after) {
      const { data, error } = await client
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", cid)
        .gt("seq", after)
        .order("seq", { ascending: true })
        .limit(100);
      fail(error);
      return messages(data ?? []);
    },
    async delivered(cid, through) {
      const { error } = await client.rpc("chat_mark_delivered", { cid, through_seq: through });
      fail(error);
    },
    async lookup(cid, ids) {
      const result: ChatMessage[] = [];
      for (let start = 0; start < ids.length; start += 100) {
        const { data, error } = await client
          .from("chat_messages")
          .select("*")
          .eq("conversation_id", cid)
          .in("id", ids.slice(start, start + 100));
        fail(error);
        result.push(...messages(data ?? []));
      }
      return result;
    },
    async reactions(cid, ids) {
      const result: ChatReaction[] = [];
      for (let start = 0; start < ids.length; start += 100) {
        const { data, error } = await client
          .from("chat_message_reactions")
          .select("*")
          .eq("conversation_id", cid)
          .in("message_id", ids.slice(start, start + 100));
        fail(error);
        for (const row of data ?? []) {
          const parsed = parseChatReaction(row);
          if (!parsed) throw new Error("Invalid reaction response");
          result.push(parsed);
        }
      }
      return result;
    },
    async react(cid, id, emoji) {
      const { data, error } = await client.rpc("chat_set_reaction", { cid, message_id: id, emoji });
      fail(error);
      const row = parseChatReaction(data);
      if (!row) throw new Error("Invalid reaction response");
      return row;
    },
    async delete(cid, id) {
      const { data, error } = await client.rpc("chat_delete_message", { cid, message_id: id });
      fail(error);
      return one(data);
    },
    async cancel(cid, id) {
      const { data, error } = await client.rpc("chat_cancel_message", { cid, message_id: id });
      fail(error);
      return one(data);
    },
    async forward(cid, id, peerId, requestId) {
      const { data, error } = await client.rpc("chat_forward_message", {
        cid,
        message_id: id,
        peer: peerId,
        forward_id: requestId,
      });
      fail(error);
      return one(data);
    },
    async contacts(workspaceId) {
      const { data, error } = await client.rpc("chat_list_contacts", { ws: workspaceId });
      fail(error);
      if (!Array.isArray(data)) throw new Error("Invalid contacts response");
      return data.map((value) => {
        const r = record(value);
        if (
          !r ||
          typeof r.id !== "string" ||
          typeof r.name !== "string" ||
          !nullableString(r.sprite_id)
        )
          throw new Error("Invalid contact");
        return { id: r.id, name: r.name, sprite_id: r.sprite_id } satisfies ChatContact;
      });
    },
  };
}
