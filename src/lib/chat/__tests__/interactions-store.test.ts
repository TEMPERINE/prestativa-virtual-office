import { expect, it, vi } from "vitest";
import { createChatStore } from "../store";
import { ChatActionError } from "../api";
import type { ChatApi, ChatConversation, ChatMessage, ChatReaction, ChatRealtime } from "../types";
const msg = (seq: number, cid = "c"): ChatMessage => ({
  id: `m${seq}`,
  conversation_id: cid,
  sender_id: "me",
  body: `text ${seq}`,
  message_type: "text",
  seq,
  created_at: "2026-10-15T10:00:00Z",
});
const conv = (id = "c"): ChatConversation => ({
  id,
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
  peer_color: "",
  peer_sprite_id: null,
  last_body: null,
  last_type: null,
  last_sender_id: null,
  own_delivered_seq: 0,
  peer_delivered_seq: 0,
  peer_read_seq: 0,
});
const flush = async () => {
  for (let i = 0; i < 70; i++) await Promise.resolve();
};
function setup() {
  let rows = [conv(), conv("other")],
    receive = (_m: ChatMessage) => {},
    react = (_r: ChatReaction) => {},
    ready = () => {};
  let counter = 0,
    rev = 0;
  const api: ChatApi = {
    list: vi.fn(async () => rows),
    start: vi.fn(async () => "c"),
    history: vi.fn(async () => ({ messages: [msg(1)], hasMore: false })),
    read: vi.fn(async () => {}),
    send: vi.fn(async (cid, body, type, id, replyTo) => ({
      ...msg(2, cid),
      id,
      body,
      message_type: type,
      reply_to_message_id: replyTo ?? null,
    })),
    supportsInteractions: () => true,
    undelivered: vi.fn(async () => []),
    delivered: vi.fn(async () => {}),
    reactions: vi.fn(async () => []),
    lookup: vi.fn(async () => []),
    react: vi.fn(async (cid, id, emoji) => ({
      message_id: id,
      conversation_id: cid,
      user_id: "me",
      emoji,
      revision: ++rev,
      created_at: "2026-10-15T10:00:00Z",
    })),
    cancel: vi.fn(async (cid, id) => ({
      ...msg(1, cid),
      id,
      body: null,
      cancelled_at: "2026-10-15T11:00:00Z",
    })),
    forward: vi.fn(async (_cid, _id, peer, id) => ({
      ...msg(1, `target-${peer}`),
      id,
      is_forwarded: true,
    })),
    contacts: vi.fn(async () => [
      { id: "p1", name: "Um", sprite_id: null },
      { id: "p2", name: "Dois", sprite_id: null },
    ]),
  };
  const realtime: ChatRealtime = {
    inbox: () => () => {},
    messages: (_cid, received, subscribed, reaction) => {
      receive = received;
      ready = subscribed;
      react = reaction ?? (() => {});
      return () => {};
    },
  };
  const store = createChatStore({
    workspaceId: "ws",
    userId: "me",
    api,
    realtime,
    createId: () => `request-${++counter}`,
    isForeground: () => false,
  });
  return {
    store,
    api,
    receive: (m: ChatMessage) => receive(m),
    reaction: (r: ChatReaction) => react(r),
    ready: () => ready(),
    rows: (r: ChatConversation[]) => {
      rows = r;
    },
  };
}
async function selected(s: ReturnType<typeof setup>) {
  s.store.connect();
  await flush();
  await s.store.select("c");
  await flush();
}
it("receives background inbox data before acknowledging delivery, without marking read", async () => {
  const s = setup();
  let resolve!: (rows: ChatMessage[]) => void;
  s.rows([{ ...conv(), last_message_seq: 2, unread_count: 2 }]);
  vi.mocked(s.api.undelivered!).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  s.store.connect();
  await flush();
  expect(s.api.delivered).not.toHaveBeenCalled();
  resolve([msg(1), msg(2)]);
  await flush();
  expect(s.api.delivered).toHaveBeenCalledWith("c", 2);
  expect(s.api.read).not.toHaveBeenCalled();
  expect(s.store.getSnapshot().selectedId).toBeNull();
});
it("toggles own reaction through authoritative RPC responses and keeps newer tombstones", async () => {
  const s = setup();
  await selected(s);
  await s.store.react("m1", "❤️");
  expect(s.store.getSnapshot().reactions?.[0].emoji).toBe("❤️");
  await s.store.react("m1", "❤️");
  expect(s.api.react).toHaveBeenLastCalledWith("c", "m1", null);
  s.reaction({
    message_id: "m1",
    conversation_id: "c",
    user_id: "me",
    emoji: "old",
    revision: 1,
    created_at: "2026-10-15T10:00:00Z",
  });
  expect(s.store.getSnapshot().reactions?.[0].emoji).toBeNull();
});
it("cancellation redacts history and reply context and ignores stale original events", async () => {
  const s = setup();
  vi.mocked(s.api.history).mockResolvedValue({
    messages: [msg(1), { ...msg(2), reply_to_message_id: "m1" }],
    hasMore: false,
  });
  await selected(s);
  await s.store.react("m1", "👍");
  expect(await s.store.cancel("m1")).toBe(true);
  s.receive(msg(1));
  expect(s.store.getSnapshot().messages.find((m) => m.id === "m1")?.body).toBeNull();
  expect(s.store.getSnapshot().reactions?.filter((r) => r.emoji)).toEqual([]);
  s.ready();
  await flush();
  expect(s.store.getSnapshot().messages.find((m) => m.id === "m1")?.body).toBeNull();
});
it("atomic already-read failure preserves content and exposes a safe specific error", async () => {
  const s = setup();
  await selected(s);
  vi.mocked(s.api.cancel!).mockRejectedValueOnce(
    new ChatActionError("Não é mais possível cancelar esta mensagem porque ela já foi lida."),
  );
  expect(await s.store.cancel("m1")).toBe(false);
  expect(s.store.getSnapshot().messages[0].body).toBe("text 1");
  expect(s.store.getSnapshot().error).toContain("já foi lida");
});
it("reply send includes the chosen same-conversation reference", async () => {
  const s = setup();
  await selected(s);
  expect(await s.store.send("resposta", "text", "m1")).toBe(true);
  expect(s.api.send).toHaveBeenCalledWith("c", "resposta", "text", "request-1", "m1");
});
it("forward retry keeps per-destination IDs and does not resend confirmed targets", async () => {
  const s = setup();
  await selected(s);
  await s.store.loadContacts();
  vi.mocked(s.api.forward!).mockImplementation(async (_cid, _id, peer, id) => {
    if (peer === "p2") throw new Error("response lost");
    return { ...msg(1, `target-${peer}`), id, is_forwarded: true };
  });
  expect(await s.store.forward("m1", ["p1", "p2"], "operation")).toEqual({
    sent: 1,
    failed: ["p2"],
  });
  const failedId = vi.mocked(s.api.forward!).mock.calls[1][3];
  vi.mocked(s.api.forward!).mockResolvedValue({
    ...msg(1, "target-p2"),
    id: failedId,
    is_forwarded: true,
  });
  expect(await s.store.forward("m1", ["p1", "p2"], "operation")).toEqual({ sent: 2, failed: [] });
  expect(s.store.getSnapshot().error).toBeNull();
  expect(s.api.forward).toHaveBeenCalledTimes(3);
  expect(vi.mocked(s.api.forward!).mock.calls[2][3]).toBe(failedId);
  expect(s.store.getSnapshot().messages).toHaveLength(1);
});
it("reconnect reconciles old loaded pages and reactions, including cancellations outside latest page", async () => {
  const s = setup();
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => msg(a + i));
  vi.mocked(s.api.history)
    .mockResolvedValueOnce({ messages: range(41, 80), hasMore: true })
    .mockResolvedValueOnce({ messages: range(1, 40), hasMore: false });
  await selected(s);
  await s.store.loadOlder();
  vi.mocked(s.api.history)
    .mockResolvedValueOnce({ messages: range(42, 81), hasMore: true })
    .mockResolvedValueOnce({
      messages: [{ ...msg(1), body: null, cancelled_at: "2026-10-15T11:00:00Z" }, ...range(2, 41)],
      hasMore: false,
    });
  vi.mocked(s.api.reactions!).mockResolvedValue([
    {
      message_id: "m2",
      conversation_id: "c",
      user_id: "peer",
      emoji: "😂",
      revision: 2,
      created_at: "2026-10-15T11:00:00Z",
    },
  ]);
  s.ready();
  await flush();
  expect(s.store.getSnapshot().messages.find((m) => m.id === "m1")?.body).toBeNull();
  expect(s.store.getSnapshot().messages).toHaveLength(81);
  expect(s.store.getSnapshot().reactions?.some((r) => r.emoji === "😂")).toBe(true);
});
it("late reaction and reply lookups cannot leak into a newly selected conversation", async () => {
  const s = setup();
  let resolve!: (rows: ChatReaction[]) => void;
  vi.mocked(s.api.reactions!).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  s.store.connect();
  await flush();
  await s.store.select("c");
  vi.mocked(s.api.history).mockResolvedValue({ messages: [msg(1, "other")], hasMore: false });
  await s.store.select("other");
  resolve([
    {
      message_id: "m1",
      conversation_id: "c",
      user_id: "peer",
      emoji: "👍",
      revision: 1,
      created_at: "2026-10-15T10:00:00Z",
    },
  ]);
  await flush();
  expect(s.store.getSnapshot().reactions).toEqual([]);
  expect(s.store.getSnapshot().selectedId).toBe("other");
});
it("reply jump safely loads older pages and handles lookup failures", async () => {
  const s = setup();
  vi.mocked(s.api.history)
    .mockResolvedValueOnce({ messages: [msg(3)], hasMore: true })
    .mockResolvedValueOnce({ messages: [msg(1), msg(2)], hasMore: false });
  await selected(s);
  vi.mocked(s.api.lookup!).mockResolvedValue([msg(1)]);
  expect(await s.store.revealMessage("m1")).toBe(true);
  expect(s.store.getSnapshot().messages.map((m) => m.seq)).toEqual([1, 2, 3]);
  vi.mocked(s.api.lookup!).mockRejectedValueOnce(new Error("network"));
  expect(await s.store.revealMessage("unavailable")).toBe(false);
  expect(s.store.getSnapshot().error).toBeTruthy();
});
it("a cancelled reply target cannot reappear through an older history page", async () => {
  const s = setup();
  vi.mocked(s.api.history)
    .mockResolvedValueOnce({ messages: [{ ...msg(2), reply_to_message_id: "m1" }], hasMore: true })
    .mockResolvedValueOnce({ messages: [msg(1)], hasMore: false });
  vi.mocked(s.api.lookup!).mockResolvedValue([msg(1)]);
  await selected(s);
  s.receive({ ...msg(1), body: null, cancelled_at: "2026-10-15T11:00:00Z" });
  expect(s.store.getSnapshot().replyMessages?.find((m) => m.id === "m1")?.body).toBeNull();
  await s.store.loadOlder();
  expect(s.store.getSnapshot().messages.find((m) => m.id === "m1")?.body).toBeNull();
});

it("retains unloaded cancellation events before an in-flight older page returns", async () => {
  const s = setup();
  let resolve!: (page: { messages: ChatMessage[]; hasMore: boolean }) => void;
  vi.mocked(s.api.history)
    .mockResolvedValueOnce({ messages: [msg(41)], hasMore: true })
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
  await selected(s);
  const pendingPage = s.store.loadOlder();
  s.receive({ ...msg(10), body: null, cancelled_at: "2026-10-15T11:00:00Z" });
  expect(s.store.getSnapshot().messages.map((m) => m.seq)).toEqual([41]);
  const exposed: (string | null)[] = [];
  const stop = s.store.subscribe(() => {
    const row = s.store.getSnapshot().messages.find((m) => m.id === "m10");
    if (row) exposed.push(row.body);
  });
  resolve({ messages: [msg(10)], hasMore: false });
  await pendingPage;
  await flush();
  stop();
  expect(s.store.getSnapshot().messages.find((m) => m.id === "m10")?.body).toBeNull();
  expect(exposed.length).toBeGreaterThan(0);
  expect(exposed.every((body) => body === null)).toBe(true);
});

it("redacts a stale jump lookup even when its cancelled target was never loaded or referenced", async () => {
  const s = setup();
  vi.mocked(s.api.history).mockResolvedValue({ messages: [msg(41)], hasMore: false });
  await selected(s);
  let resolve!: (rows: ChatMessage[]) => void;
  vi.mocked(s.api.lookup!).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const pendingJump = s.store.revealMessage("m10");
  s.receive({ ...msg(10), body: null, cancelled_at: "2026-10-15T11:00:00Z" });
  resolve([msg(10)]);
  await pendingJump;
  expect(s.store.getSnapshot().replyMessages?.find((m) => m.id === "m10")?.body).toBeNull();
});

it("keeps cancellation metadata across selection changes for background delivery snapshots", async () => {
  const s = setup();
  let delivery!: (rows: ChatMessage[]) => void;
  let history!: (page: { messages: ChatMessage[]; hasMore: boolean }) => void;
  s.rows([{ ...conv(), last_message_seq: 41 }, conv("other")]);
  vi.mocked(s.api.undelivered!).mockReturnValueOnce(
    new Promise((r) => {
      delivery = r;
    }),
  );
  vi.mocked(s.api.history)
    .mockResolvedValueOnce({ messages: [msg(41)], hasMore: true })
    .mockResolvedValueOnce({ messages: [msg(10, "other")], hasMore: false })
    .mockReturnValueOnce(
      new Promise((r) => {
        history = r;
      }),
    );
  await selected(s);
  s.receive({ ...msg(10), body: null, cancelled_at: "2026-10-15T11:00:00Z" });
  await s.store.select("other");
  expect(s.store.getSnapshot().messages[0].body).toBe("text 10");
  const reselect = s.store.select("c");
  delivery(Array.from({ length: 41 }, (_, index) => msg(index + 1)));
  await flush();
  expect(s.store.getSnapshot().messages.find((m) => m.id === "m10")?.body).toBeNull();
  history({ messages: [msg(41)], hasMore: true });
  await reselect;
});
