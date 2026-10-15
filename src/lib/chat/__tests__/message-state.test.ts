import { expect, it } from "vitest";
import { mergeChatMessages, mergeChatReactions, messageReceipt } from "../message-state";
import type { ChatMessage, ChatReaction, ChatConversation } from "../types";
const msg: ChatMessage = {
  id: "m",
  conversation_id: "c",
  sender_id: "me",
  body: "private",
  message_type: "text",
  seq: 3,
  created_at: "2026-10-15T10:00:00Z",
};
const reaction = (revision: number, emoji: string | null): ChatReaction => ({
  message_id: "m",
  conversation_id: "c",
  user_id: "me",
  emoji,
  revision,
  created_at: "2026-10-15T10:00:00Z",
});
it("derives sent/delivered/read only from peer server cursors", () => {
  const row = { peer_delivered_seq: 2, peer_read_seq: 1 } as ChatConversation;
  expect(messageReceipt(msg, row)).toBe("sent");
  expect(messageReceipt(msg, { ...row, peer_delivered_seq: 3 })).toBe("delivered");
  expect(messageReceipt(msg, { ...row, peer_read_seq: 3 })).toBe("read");
});
it("a cancelled row cannot be resurrected by a stale history/RPC response", () => {
  const cancelled = { ...msg, body: null, cancelled_at: "2026-10-15T11:00:00Z" };
  expect(mergeChatMessages([cancelled], [msg])).toEqual([cancelled]);
  expect(mergeChatMessages([msg], [cancelled])).toEqual([cancelled]);
});
it("reaction revision makes tombstones and replacements survive older snapshots", () => {
  expect(mergeChatReactions([reaction(3, null)], [reaction(2, "👍")])).toEqual([reaction(3, null)]);
  expect(mergeChatReactions([reaction(1, "❤️")], [reaction(2, "👍")])).toEqual([reaction(2, "👍")]);
});
it("a deleted tombstone wins over plaintext snapshots in either merge order", () => {
  const deleted = { ...msg, body: null, deleted_at: "2026-10-15T11:00:00Z" };
  expect(mergeChatMessages([deleted], [msg])).toEqual([deleted]);
  expect(mergeChatMessages([msg], [deleted])).toEqual([deleted]);
});
