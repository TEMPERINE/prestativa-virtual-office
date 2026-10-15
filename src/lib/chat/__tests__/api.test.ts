import { describe, expect, it, vi } from "vitest";
import { CHAT_PAGE_SIZE } from "../types";
import { createChatApi, ChatUnavailableError } from "../api";

function setup(rows: unknown[] = [], error: { code: string } | null = null) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    lt: vi.fn(() => query),
    then: (resolve: (x: unknown) => unknown) =>
      Promise.resolve({ data: rows, error }).then(resolve),
  };
  const rpc = vi.fn(async () => ({ data: null, error }));
  return { api: createChatApi({ from: () => query, rpc } as never), rpc, query };
}
describe("chat API", () => {
  it("uses seq-exclusive keyset and one extra row, in chronological UI order", async () => {
    const rows = Array.from({ length: 41 }, (_, i) => ({ seq: 100 - i }));
    const s = setup(rows);
    const result = await s.api.history("c", 101);
    expect(s.query.eq).toHaveBeenCalledWith("conversation_id", "c");
    expect(s.query.order).toHaveBeenCalledWith("seq", { ascending: false });
    expect(s.query.lt).toHaveBeenCalledWith("seq", 101);
    expect(s.query.limit).toHaveBeenCalledWith(CHAT_PAGE_SIZE + 1);
    expect(result.messages.map((m) => m.seq)).toEqual(Array.from({ length: 40 }, (_, i) => 61 + i));
    expect(result.hasMore).toBe(true);
  });
  it("mutation payload includes an idempotency key and no sender identity", async () => {
    const s = setup();
    await expect(s.api.send("c", "oi", "text", "request")).rejects.toThrow("confirmar");
    expect(s.rpc).toHaveBeenCalledWith("chat_send_message", {
      cid: "c",
      content: "oi",
      kind: "text",
      message_id: "request",
    });
  });
  it("missing migration is a safe unavailable state, not raw SQL output", async () => {
    const s = setup([], { code: "PGRST202" });
    await expect(s.api.list("ws")).rejects.toBeInstanceOf(ChatUnavailableError);
  });
});
