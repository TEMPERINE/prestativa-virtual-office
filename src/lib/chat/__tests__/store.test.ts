import { describe, expect, it, vi } from "vitest";
import { createChatStore } from "../store";
import type { ChatApi, ChatConversation, ChatMessage, ChatRealtime, ChatStatus } from "../types";

const ws = "ws",
  me = "me",
  peer = "peer";
const conv = (id = "c1", seq = 0, unread = 0): ChatConversation => ({
  id,
  workspace_id: ws,
  participant_a: me,
  participant_b: peer,
  created_at: "2026-10-14T10:00:00Z",
  last_message_at: seq ? `2026-10-14T10:00:${String(seq).padStart(2, "0")}Z` : null,
  last_message_seq: seq,
  read_seq: 0,
  unread_count: unread,
  peer_id: peer,
  peer_name: "Colega",
  peer_sprite_id: null,
  peer_color: "",
  last_body: seq ? "oi" : null,
  last_type: seq ? "text" : null,
  last_sender_id: seq ? peer : null,
});
const message = (seq = 1, cid = "c1"): ChatMessage => ({
  id: `m${seq}`,
  conversation_id: cid,
  sender_id: peer,
  body: `msg ${seq}`,
  message_type: "text",
  seq,
  created_at: "2026-10-14T10:00:00Z",
});
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (x: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup() {
  let inboxChanged = () => {},
    inboxStatus = (_s: ChatStatus) => {};
  let receive = (_m: ChatMessage) => {},
    ready = () => {};
  let rows = [conv(), conv("c2")];
  const off = vi.fn();
  const incoming = vi.fn();
  const api: ChatApi = {
    list: vi.fn(async () => rows),
    start: vi.fn(async () => "c1"),
    history: vi.fn(async () => ({ messages: [], hasMore: false })),
    send: vi.fn(async (cid, body, type, id) => ({
      ...message(1, cid),
      id,
      body,
      message_type: type,
      sender_id: me,
    })),
    read: vi.fn(async () => {}),
  };
  const realtime: ChatRealtime = {
    inbox: vi.fn((_ws, _uid, changed, status) => {
      inboxChanged = changed;
      inboxStatus = status;
      return off;
    }),
    messages: vi.fn((_cid, received, subscribed) => {
      receive = received;
      ready = subscribed;
      return off;
    }),
  };
  let foreground = true,
    requestNumber = 0;
  const store = createChatStore({
    workspaceId: ws,
    userId: me,
    api,
    realtime,
    createId: () => (++requestNumber === 1 ? "request-id" : `request-id-${requestNumber}`),
    isForeground: () => foreground,
    onIncoming: incoming,
  });
  return {
    store,
    api,
    realtime,
    off,
    incoming,
    setRows: (x: ChatConversation[]) => {
      rows = x;
    },
    changed: () => inboxChanged(),
    status: (x: ChatStatus) => inboxStatus(x),
    receive: (m: ChatMessage) => receive(m),
    ready: () => ready(),
    background: () => {
      foreground = false;
    },
  };
}

describe("Office Chat store", () => {
  it("starts one session and opens A/B conversation through validated API", async () => {
    const s = setup();
    s.store.connect();
    s.store.connect();
    await flush();
    await s.store.start(peer);
    expect(s.api.start).toHaveBeenCalledWith(ws, peer);
    expect(s.realtime.inbox).toHaveBeenCalledTimes(1);
    expect(s.store.getSnapshot().selectedId).toBe("c1");
  });
  it("receives B's event once even when RPC/history/realtime repeat it", async () => {
    const s = setup();
    s.store.connect();
    await flush();
    await s.store.select("c1");
    s.receive(message());
    s.receive(message());
    expect(s.store.getSnapshot().messages.map((m) => m.id)).toEqual(["m1"]);
    expect(s.api.read).not.toHaveBeenCalled();
  });
  it("increments unread, dedupes alerts, and visible reading clears only loaded seq", async () => {
    const s = setup();
    s.store.connect();
    await flush();
    s.setRows([conv("c1", 1, 1)]);
    s.changed();
    await flush();
    expect(s.store.getSnapshot().conversations[0].unread_count).toBe(1);
    expect(s.incoming).toHaveBeenCalledTimes(1);
    s.changed();
    await flush();
    expect(s.incoming).toHaveBeenCalledTimes(1);
    await s.store.select("c1");
    s.receive(message());
    s.store.setReading(true);
    await flush();
    expect(s.api.read).toHaveBeenCalledWith("c1", 1);
    s.setRows([conv("c1", 1, 0)]);
    s.changed();
    await flush();
    expect(s.store.getSnapshot().conversations[0].unread_count).toBe(0);
  });
  it("background or scrolled-up conversation is not marked read", async () => {
    const s = setup();
    s.store.connect();
    await flush();
    await s.store.select("c1");
    s.background();
    s.store.setReading(true);
    s.receive(message());
    await flush();
    expect(s.api.read).not.toHaveBeenCalled();
  });
  it("keyset history prepends older page without duplicates and stable order", async () => {
    const s = setup();
    vi.mocked(s.api.history)
      .mockResolvedValueOnce({ messages: [message(3), message(4)], hasMore: true })
      .mockResolvedValueOnce({ messages: [message(1), message(2), message(3)], hasMore: false });
    s.store.connect();
    await flush();
    await s.store.select("c1");
    await s.store.loadOlder();
    expect(s.api.history).toHaveBeenLastCalledWith("c1", 3);
    expect(s.store.getSnapshot().messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(s.store.getSnapshot().hasMore).toBe(false);
  });
  it("does not lose a message arriving while latest page is in flight", async () => {
    const s = setup(),
      pending = deferred<{ messages: ChatMessage[]; hasMore: boolean }>();
    vi.mocked(s.api.history).mockReturnValueOnce(pending.promise);
    s.store.connect();
    await flush();
    const selected = s.store.select("c1");
    s.receive(message(2));
    pending.resolve({ messages: [message(1)], hasMore: false });
    await selected;
    expect(s.store.getSnapshot().messages.map((m) => m.seq)).toEqual([1, 2]);
  });
  it("late history response cannot overwrite another conversation", async () => {
    const s = setup(),
      pending = deferred<{ messages: ChatMessage[]; hasMore: boolean }>();
    vi.mocked(s.api.history)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ messages: [message(1, "c2")], hasMore: false });
    s.store.connect();
    await flush();
    const old = s.store.select("c1");
    await s.store.select("c2");
    pending.resolve({ messages: [message(1)], hasMore: false });
    await old;
    expect(s.store.getSnapshot().messages.every((m) => m.conversation_id === "c2")).toBe(true);
    expect(s.off).toHaveBeenCalledTimes(1);
  });
  it("retries unknown-result send with same UUID, not a second message", async () => {
    const s = setup();
    s.store.connect();
    await flush();
    await s.store.select("c1");
    vi.mocked(s.api.send).mockRejectedValueOnce(new Error("network"));
    expect(await s.store.send("olá", "text")).toBe(false);
    expect(await s.store.send("olá", "text")).toBe(true);
    expect(vi.mocked(s.api.send).mock.calls.map((c) => c[3])).toEqual(["request-id", "request-id"]);
    expect(s.store.getSnapshot().messages).toHaveLength(1);
  });
  it("retains an uncertain text identity across a successful sticker send", async () => {
    const s = setup();
    s.store.connect();
    await flush();
    await s.store.select("c1");
    vi.mocked(s.api.send).mockRejectedValueOnce(new Error("response lost after commit"));
    expect(await s.store.send("olá", "text")).toBe(false);
    expect(await s.store.send("coffee", "sticker")).toBe(true);
    expect(await s.store.send("olá", "text")).toBe(true);
    const attempts = vi.mocked(s.api.send).mock.calls;
    expect(attempts[0][3]).not.toBe(attempts[1][3]);
    expect(attempts[2][3]).toBe(attempts[0][3]);
  });
  it("reconnect preserves historical pages and their oldest pagination boundary", async () => {
    const s = setup();
    vi.mocked(s.api.history)
      .mockResolvedValueOnce({ messages: [message(3), message(4)], hasMore: true })
      .mockResolvedValueOnce({ messages: [message(1), message(2)], hasMore: false });
    s.store.connect();
    await flush();
    await s.store.select("c1");
    await s.store.loadOlder();
    const pending = deferred<{ messages: ChatMessage[]; hasMore: boolean }>();
    vi.mocked(s.api.history).mockReturnValueOnce(pending.promise);
    s.ready();
    expect(s.store.getSnapshot().messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    s.receive(message(6));
    pending.resolve({ messages: [message(4), message(5)], hasMore: true });
    await flush();
    expect(s.store.getSnapshot().messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.store.getSnapshot().hasMore).toBe(false);
    expect(s.api.read).not.toHaveBeenCalled();
  });
  it("reconnect fills missed sequence gaps larger than one history page", async () => {
    const s = setup();
    const range = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => message(from + i));
    vi.mocked(s.api.history)
      .mockResolvedValueOnce({ messages: range(1, 10), hasMore: false })
      .mockResolvedValueOnce({ messages: range(91, 130), hasMore: true })
      .mockResolvedValueOnce({ messages: range(51, 90), hasMore: true })
      .mockResolvedValueOnce({ messages: range(11, 50), hasMore: true });
    s.store.connect();
    await flush();
    await s.store.select("c1");
    // A live event can precede the reconnect snapshot, beyond the missed gap.
    s.receive(message(131));
    s.ready();
    await flush();
    expect(s.api.history).toHaveBeenNthCalledWith(3, "c1", 91);
    expect(s.api.history).toHaveBeenNthCalledWith(4, "c1", 51);
    expect(s.store.getSnapshot().messages.map((m) => m.seq)).toEqual(
      range(1, 131).map((m) => m.seq),
    );
    expect(s.store.getSnapshot().hasMore).toBe(false);
  });
  it("an interrupted gap recovery keeps history and cannot automatically consume unseen messages", async () => {
    const s = setup();
    vi.mocked(s.api.history)
      .mockResolvedValueOnce({ messages: [message(1)], hasMore: false })
      .mockResolvedValueOnce({ messages: [message(50)], hasMore: true })
      .mockRejectedValueOnce(new Error("offline again"));
    s.store.connect();
    await flush();
    await s.store.select("c1");
    s.ready();
    await flush();
    s.store.setReading(true);
    s.receive(message(51));
    await flush();
    expect(s.store.getSnapshot().error).toBeTruthy();
    expect(s.store.getSnapshot().messages.map((m) => m.seq)).toEqual([1, 51]);
    expect(s.api.read).not.toHaveBeenCalled();
  });
  it("reconnect refreshes inbox and selected page; disposal ignores late callbacks", async () => {
    const s = setup();
    s.store.connect();
    await flush();
    await s.store.select("c1");
    s.status("online");
    await flush();
    s.status("offline");
    s.status("online");
    await flush();
    expect(s.api.history).toHaveBeenCalledTimes(2);
    const before = s.store.getSnapshot();
    s.store.dispose();
    s.receive(message(7));
    s.changed();
    await flush();
    expect(s.store.getSnapshot()).toBe(before);
    expect(s.off).toHaveBeenCalledTimes(2);
  });
  it("does not leak a stale list after disposing the workspace store", async () => {
    const s = setup(),
      pending = deferred<ChatConversation[]>();
    vi.mocked(s.api.list).mockReturnValueOnce(pending.promise);
    s.store.connect();
    const before = s.store.getSnapshot();
    s.store.dispose();
    pending.resolve([conv()]);
    await flush();
    expect(s.store.getSnapshot()).toBe(before);
  });
  it("an old read RPC does not block reading a newly selected conversation", async () => {
    const s = setup(),
      pending = deferred<void>();
    vi.mocked(s.api.read).mockReturnValueOnce(pending.promise);
    s.store.connect();
    await flush();
    await s.store.select("c1");
    s.receive(message());
    s.store.setReading(true);
    await s.store.select("c2");
    s.receive(message(2, "c2"));
    s.store.setReading(true);
    await flush();
    expect(s.api.read).toHaveBeenCalledWith("c2", 2);
    pending.resolve();
    await flush();
  });
  it("a slower start cannot replace the person clicked most recently", async () => {
    const s = setup(),
      pending = deferred<string>();
    vi.mocked(s.api.start).mockReturnValueOnce(pending.promise).mockResolvedValueOnce("c2");
    s.store.connect();
    await flush();
    const old = s.store.start("first");
    await s.store.start("second");
    pending.resolve("c1");
    await old;
    expect(s.store.getSnapshot().selectedId).toBe("c2");
  });

  it("retry actually reloads a failed selected history", async () => {
    const s = setup();
    vi.mocked(s.api.history)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ messages: [message()], hasMore: false });
    s.store.connect();
    await flush();
    await s.store.select("c1");
    expect(s.store.getSnapshot().error).toBeTruthy();
    await s.store.retry();
    expect(s.store.getSnapshot().messages.map((m) => m.id)).toEqual(["m1"]);
    expect(s.store.getSnapshot().error).toBeNull();
  });
});
