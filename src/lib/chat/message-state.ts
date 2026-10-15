import type { ChatConversation, ChatMessage, ChatReaction } from "./types";

export const isMessageRemoved = (message: ChatMessage) =>
  !!(message.cancelled_at || message.deleted_at);

export function messageReceipt(
  message: ChatMessage,
  conversation: ChatConversation,
): "sent" | "delivered" | "read" {
  if (message.seq <= (conversation.peer_read_seq ?? 0)) return "read";
  if (message.seq <= (conversation.peer_delivered_seq ?? 0)) return "delivered";
  return "sent";
}
export function mergeChatMessages(left: ChatMessage[], right: ChatMessage[]): ChatMessage[] {
  const rows = new Map<string, ChatMessage>();
  for (const row of [...left, ...right]) {
    const previous = rows.get(row.id);
    if (!previous || !isMessageRemoved(previous) || isMessageRemoved(row))
      rows.set(row.id, isMessageRemoved(row) ? { ...row, body: null } : row);
  }
  return [...rows.values()].sort((a, b) => a.seq - b.seq);
}
export function mergeChatReactions(left: ChatReaction[], right: ChatReaction[]): ChatReaction[] {
  const rows = new Map<string, ChatReaction>();
  for (const row of [...left, ...right]) {
    const key = `${row.message_id}:${row.user_id}`;
    if ((rows.get(key)?.revision ?? 0) < row.revision) rows.set(key, row);
  }
  return [...rows.values()];
}
