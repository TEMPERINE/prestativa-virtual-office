import type { ChatMessage } from "./types";
type Deps = {
  page: (cid: string, after: number) => Promise<ChatMessage[]>;
  acknowledge: (cid: string, through: number) => Promise<void>;
  received: (cid: string, messages: ChatMessage[]) => void;
  error: (error: unknown) => void;
};
/** Serial receipt worker. A cursor is acknowledged only after receiving its contiguous data. */
export function createDeliveryQueue(deps: Deps) {
  let disposed = false,
    running = false;
  const jobs = new Map<string, { through: number; target: number }>();
  const confirmed = new Map<string, number>();
  async function run() {
    if (running || disposed) return;
    running = true;
    try {
      while (jobs.size && !disposed) {
        const [cid, job] = jobs.entries().next().value!;
        jobs.delete(cid);
        let after = Math.max(job.through, confirmed.get(cid) ?? 0);
        while (after < job.target && !disposed) {
          const rows = await deps.page(cid, after);
          if (disposed) return;
          if (!rows.length) break; // Membership may have been revoked; never ACK metadata.
          let through = after;
          for (const row of rows) {
            if (row.conversation_id !== cid || row.seq !== through + 1)
              throw new Error("Incomplete delivery page");
            through = row.seq;
          }
          deps.received(cid, rows);
          await deps.acknowledge(cid, through);
          if (disposed) return;
          confirmed.set(cid, through);
          after = through;
        }
      }
    } catch (error) {
      if (!disposed) deps.error(error);
      // Retry is event/reconnect driven, never a permanent polling loop.
      jobs.clear();
    } finally {
      running = false;
    }
  }
  return {
    enqueue(cid: string, through: number, target: number) {
      if (disposed || target <= Math.max(through, confirmed.get(cid) ?? 0)) return;
      const old = jobs.get(cid);
      jobs.set(cid, {
        through: Math.max(through, old?.through ?? 0),
        target: Math.max(target, old?.target ?? 0),
      });
      void run();
    },
    dispose() {
      disposed = true;
      jobs.clear();
      confirmed.clear();
    },
  };
}
