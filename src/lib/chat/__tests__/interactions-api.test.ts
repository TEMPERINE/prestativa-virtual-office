import { expect, it, vi } from "vitest";
import { createChatApi, parseChatMessage, ChatActionError } from "../api";
const conversation = {
  id: "c",
  workspace_id: "ws",
  participant_a: "me",
  participant_b: "peer",
  created_at: "2026-10-15T10:00:00Z",
  last_message_at: null,
  last_message_seq: 0,
  read_seq: 0,
  unread_count: 0,
  peer_id: "peer",
  peer_name: "Colega",
  peer_sprite_id: null,
  peer_color: "",
  last_body: null,
  last_type: null,
  last_sender_id: null,
};
const message = {
  id: "m",
  conversation_id: "c",
  sender_id: "me",
  body: "oi",
  message_type: "text",
  seq: 1,
  created_at: "2026-10-15T10:00:00Z",
};
function setup(rpc = vi.fn(async () => ({ data: null, error: null })), data: unknown[] = []) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((_column: string, _value: unknown) => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    gt: vi.fn(() => query),
    lt: vi.fn(() => query),
    in: vi.fn(() => query),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  const client = { rpc, from: vi.fn(() => query) };
  return { api: createChatApi(client as never), rpc, query, client };
}
it("preserves legacy Chat when the staged RPCs are absent and probes once until retry", async () => {
  const rpc = vi.fn(async (name: string) =>
    name === "chat_list_conversations_v2"
      ? { data: null, error: { code: "PGRST202" } }
      : { data: [conversation], error: null },
  );
  const s = setup(rpc as never);
  expect(await s.api.list("ws")).toEqual([conversation]);
  expect(s.api.supportsInteractions!()).toBe(false);
  await s.api.list("ws");
  expect(rpc.mock.calls.filter((c) => c[0] === "chat_list_conversations_v2")).toHaveLength(1);
  s.api.resetCapabilities!();
  await s.api.list("ws");
  expect(rpc.mock.calls.filter((c) => c[0] === "chat_list_conversations_v2")).toHaveLength(2);
});
it("uses typed v2 receipts and nullable fields without widening actor input", async () => {
  const row = {
    ...conversation,
    own_delivered_seq: 0,
    peer_delivered_seq: 0,
    peer_read_seq: 0,
    last_cancelled_at: null,
  };
  const s = setup(vi.fn(async () => ({ data: [row], error: null })) as never);
  expect(await s.api.list("ws")).toEqual([row]);
  expect(s.api.supportsInteractions!()).toBe(true);
});
it("reply send carries only its scoped reference and idempotency key", async () => {
  const s = setup(
    vi.fn(async () => ({
      data: { ...message, reply_to_message_id: "original" },
      error: null,
    })) as never,
  );
  expect((await s.api.send("c", "oi", "text", "request", "original")).reply_to_message_id).toBe(
    "original",
  );
  expect(s.rpc).toHaveBeenCalledWith("chat_send_message_v2", {
    cid: "c",
    content: "oi",
    kind: "text",
    message_id: "request",
    reply_to: "original",
  });
});
it("maps an atomic already-read rejection to the exact safe user-facing error", async () => {
  const s = setup(
    vi.fn(async () => ({
      data: null,
      error: { code: "PCH01", message: "private raw SQL detail" },
    })) as never,
  );
  await expect(s.api.cancel!("c", "m")).rejects.toThrow(
    "Não é mais possível cancelar esta mensagem porque ela já foi lida.",
  );
  await expect(s.api.cancel!("c", "m")).rejects.toBeInstanceOf(ChatActionError);
});
it("delivery fetches ascending data after the persisted cursor, not just inbox metadata", async () => {
  const s = setup(undefined, [message]);
  expect(await s.api.undelivered!("c", 0)).toEqual([message]);
  expect(s.query.eq).toHaveBeenCalledWith("conversation_id", "c");
  expect(s.query.gt).toHaveBeenCalledWith("seq", 0);
  expect(s.query.order).toHaveBeenCalledWith("seq", { ascending: true });
  expect(s.query.limit).toHaveBeenCalledWith(100);
});
it("reaction and reply lookups always include the selected conversation filter", async () => {
  const s = setup();
  await s.api.reactions!("c", ["m"]);
  await s.api.lookup!("c", ["m"]);
  expect(s.query.eq.mock.calls.every((c) => c[0] === "conversation_id" && c[1] === "c")).toBe(true);
  expect(s.query.in).toHaveBeenCalledWith("message_id", ["m"]);
  expect(s.query.in).toHaveBeenCalledWith("id", ["m"]);
});
it("a cancellation parser strips stale plaintext and rejects null active bodies", () => {
  expect(parseChatMessage({ ...message, body: null })).toBeNull();
  const parsed = parseChatMessage({ ...message, cancelled_at: "2026-10-15T11:00:00Z" });
  expect(parsed?.body).toBeNull();
  expect(parsed?.cancelled_at).toBeTruthy();
});
