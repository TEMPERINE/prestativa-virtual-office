import { expect, it, vi } from "vitest";
import { createDeliveryQueue } from "../delivery-queue";
import type { ChatMessage } from "../types";
const msg = (seq: number, cid = "c"): ChatMessage => ({
  id: `m${seq}`,
  conversation_id: cid,
  sender_id: "peer",
  body: "x",
  message_type: "text",
  seq,
  created_at: "2026-10-15T10:00:00Z",
});
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
it("fetches multiple real pages before acknowledging each delivered cursor", async () => {
  let resolve!: (rows: ChatMessage[]) => void;
  const page = vi
    .fn()
    .mockReturnValueOnce(
      new Promise<ChatMessage[]>((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce([msg(3), msg(4)]);
  const acknowledge = vi.fn(async () => {}),
    received = vi.fn(),
    error = vi.fn();
  const q = createDeliveryQueue({ page, acknowledge, received, error });
  q.enqueue("c", 0, 4);
  expect(acknowledge).not.toHaveBeenCalled();
  resolve([msg(1), msg(2)]);
  await flush();
  expect(acknowledge.mock.calls).toEqual([
    ["c", 2],
    ["c", 4],
  ]);
  expect(received).toHaveBeenCalledTimes(2);
  expect(error).not.toHaveBeenCalled();
  q.enqueue("c", 0, 4);
  await flush();
  expect(page).toHaveBeenCalledTimes(2);
});
it("never acknowledges a skipped sequence or a page from another conversation", async () => {
  for (const rows of [[msg(2)], [msg(1, "other")]]) {
    const acknowledge = vi.fn(),
      error = vi.fn();
    const q = createDeliveryQueue({
      page: async () => rows,
      acknowledge,
      received: vi.fn(),
      error,
    });
    q.enqueue("c", 0, 2);
    await flush();
    expect(acknowledge).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  }
});
it("disposal prevents late network results from issuing receipts or updating UI", async () => {
  let resolve!: (rows: ChatMessage[]) => void;
  const acknowledge = vi.fn(),
    received = vi.fn();
  const q = createDeliveryQueue({
    page: () =>
      new Promise((r) => {
        resolve = r;
      }),
    acknowledge,
    received,
    error: vi.fn(),
  });
  q.enqueue("c", 0, 1);
  q.dispose();
  resolve([msg(1)]);
  await flush();
  expect(acknowledge).not.toHaveBeenCalled();
  expect(received).not.toHaveBeenCalled();
});
