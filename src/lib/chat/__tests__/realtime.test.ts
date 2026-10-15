import { describe, expect, it, vi } from "vitest";
import { createChatRealtime } from "../realtime";

function setup() {
  const channels: {
    handlers: { config: Record<string, string>; callback: (event: { new: unknown }) => void }[];
    status?: (s: string) => void;
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  }[] = [];
  const client = {
    channel: vi.fn((_topic: string) => {
      const handlers: (typeof channels)[number]["handlers"] = [];
      const channel: (typeof channels)[number] = {
        handlers,
        on: vi.fn((_event, config, callback) => {
          handlers.push({ config, callback });
          return channel;
        }),
        subscribe: vi.fn((callback) => {
          channel.status = callback;
          return channel;
        }),
      };
      channels.push(channel);
      return channel;
    }),
    removeChannel: vi.fn(async () => "ok"),
  };
  return { client, channels, realtime: createChatRealtime(client as never) };
}
const message = {
  id: "m",
  conversation_id: "conversation",
  sender_id: "peer",
  body: "oi",
  message_type: "text",
  seq: 1,
  created_at: "2026-10-14T10:00:00Z",
};

describe("chat Realtime", () => {
  it("inbox filters both participant columns, never workspace-wide messages", () => {
    const { realtime, channels } = setup();
    const changed = vi.fn();
    realtime.inbox("workspace", "me", changed, vi.fn());
    expect(channels).toHaveLength(1);
    expect(
      channels[0].handlers.map((h) => [h.config.table, h.config.event, h.config.filter]),
    ).toEqual([
      ["chat_conversations", "INSERT", "participant_a=eq.me"],
      ["chat_conversations", "UPDATE", "participant_a=eq.me"],
      ["chat_conversations", "INSERT", "participant_b=eq.me"],
      ["chat_conversations", "UPDATE", "participant_b=eq.me"],
    ]);
    channels[0].handlers[0].callback({ new: { workspace_id: "other" } });
    expect(changed).not.toHaveBeenCalled();
    channels[0].handlers[0].callback({ new: { workspace_id: "workspace" } });
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("B receives the subscribed conversation; disposed callbacks cannot fire", () => {
    const { realtime, channels, client } = setup();
    const received = vi.fn();
    const ready = vi.fn();
    const off = realtime.messages("conversation", received, ready);
    expect(channels[0].handlers[0].config.filter).toBe("conversation_id=eq.conversation");
    channels[0].status?.("SUBSCRIBED");
    expect(ready).toHaveBeenCalledTimes(1);
    channels[0].handlers[0].callback({ new: message });
    expect(received).toHaveBeenCalledWith(message);
    off();
    off();
    channels[0].handlers[0].callback({ new: { ...message, id: "late" } });
    expect(received).toHaveBeenCalledTimes(1);
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
  });
  it("drops malformed and wrong-conversation payloads", () => {
    const { realtime, channels } = setup();
    const received = vi.fn();
    realtime.messages("conversation", received, vi.fn());
    for (const row of [{}, { ...message, seq: -1 }, { ...message, conversation_id: "other" }])
      channels[0].handlers[0].callback({ new: row });
    expect(received).not.toHaveBeenCalled();
  });
  it("rapidly revisiting a conversation never reuses a channel still leaving", () => {
    const s = setup();
    const stop = s.realtime.messages("conversation", vi.fn(), vi.fn());
    stop();
    s.realtime.messages("conversation", vi.fn(), vi.fn());
    expect(s.client.channel.mock.calls[0][0]).not.toBe(s.client.channel.mock.calls[1][0]);
  });
});

it("selected channel receives scoped cancellation updates and versioned reaction tombstones", () => {
  const { realtime, channels, client } = setup();
  const received = vi.fn(),
    reaction = vi.fn();
  const off = realtime.messages("conversation", received, vi.fn(), reaction);
  expect(channels).toHaveLength(1);
  const update = channels[0].handlers.find(
    (h) => h.config.table === "chat_messages" && h.config.event === "UPDATE",
  );
  expect(update?.config.filter).toBe("conversation_id=eq.conversation");
  update?.callback({ new: { ...message, body: null, cancelled_at: "2026-10-15T10:00:00Z" } });
  expect(received).toHaveBeenCalledWith({
    ...message,
    body: null,
    cancelled_at: "2026-10-15T10:00:00Z",
  });
  update?.callback({ new: { ...message, body: "stale", deleted_at: "2026-10-15T11:00:00Z" } });
  expect(received).toHaveBeenLastCalledWith({
    ...message,
    body: null,
    deleted_at: "2026-10-15T11:00:00Z",
  });
  const reactionUpdate = channels[0].handlers.find(
    (h) => h.config.table === "chat_message_reactions" && h.config.event === "UPDATE",
  );
  expect(reactionUpdate?.config.filter).toBe("conversation_id=eq.conversation");
  const row = {
    message_id: "m",
    conversation_id: "conversation",
    user_id: "peer",
    emoji: null,
    revision: 2,
    created_at: "2026-10-15T10:00:00Z",
  };
  reactionUpdate?.callback({ new: row });
  expect(reaction).toHaveBeenCalledWith(row);
  reactionUpdate?.callback({ new: { ...row, conversation_id: "other" } });
  expect(reaction).toHaveBeenCalledTimes(1);
  off();
  reactionUpdate?.callback({ new: { ...row, revision: 3 } });
  expect(reaction).toHaveBeenCalledTimes(1);
  expect(client.removeChannel).toHaveBeenCalledTimes(1);
});
