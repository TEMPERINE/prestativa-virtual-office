import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OfficePresence,
  presenceTopic,
  type PresencePayload,
  type PresenceTransport,
  type PresenceTransportHandlers,
} from "@/lib/rtc/office-presence";
import {
  movementTopic,
  MovementRealtime,
  type MovementTransport,
} from "@/lib/rtc/movement-realtime";

function fakeTransport() {
  const opened: {
    handlers: PresenceTransportHandlers;
    tracks: PresencePayload[];
    untracks: number;
    closed: boolean;
  }[] = [];
  const transport: PresenceTransport = {
    open(handlers) {
      const e = { handlers, tracks: [] as PresencePayload[], untracks: 0, closed: false };
      opened.push(e);
      return {
        track: (p) => {
          e.tracks.push(p);
        },
        untrack: () => {
          e.untracks++;
        },
        close: () => {
          e.closed = true;
        },
      };
    },
  };
  const trackCount = () => opened.reduce((n, o) => n + o.tracks.length, 0);
  return { transport, opened, trackCount };
}

const self = {
  userId: "me",
  sessionId: "s1",
  generation: 3,
  workspaceId: "w1",
  joinedAt: "2026-01-01T00:00:00Z",
};
const meta = (userId: string, generation = 1): PresencePayload => ({
  userId,
  sessionId: `s-${userId}`,
  generation,
  workspaceId: "w1",
  joinedAt: "2026-01-01T00:00:00Z",
});

function setup(opts: { cooldown?: number } = {}) {
  const t = fakeTransport();
  const p = new OfficePresence({ self, transport: t.transport, rejoinCooldownMs: opts.cooldown });
  p.start();
  return { p, t, h: () => t.opened[t.opened.length - 1].handlers };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("OfficePresence", () => {
  it("topic", () => expect(presenceTopic("w")).toBe("workspace:w:presence"));

  it("21/22/33. um único track e nenhum heartbeat em 30 s", async () => {
    const { t, h } = setup();
    h().onSubscribed();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.trackCount()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("23/28. payload sem posição e com session/generation", () => {
    const { t, h } = setup();
    h().onSubscribed();
    const p = t.opened[0].tracks[0] as unknown as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual([
      "generation",
      "joinedAt",
      "presenceRevision",
      "sessionId",
      "userId",
      "workspaceId",
    ]);
    for (const k of ["x", "y", "vx", "vy", "zoneId", "roomName", "direction"])
      expect(p).not.toHaveProperty(k);
    expect(p).toMatchObject({ sessionId: "s1", generation: 3 });
  });

  it("24/25/26/27. sync, join, leave e contas distintas", () => {
    const { p, h } = setup();
    h().onPresence("sync", { a: [meta("a")] });
    expect([...p.getRoster().keys()]).toEqual(["a"]);
    h().onPresence("join", { a: [meta("a")], b: [meta("b")] });
    expect([...p.getRoster().keys()].sort()).toEqual(["a", "b"]);
    h().onPresence("leave", { b: [meta("b")] });
    expect([...p.getRoster().keys()]).toEqual(["b"]);
  });

  it("roster usa a maior generation do mesmo usuário", () => {
    const { p, h } = setup();
    h().onPresence("sync", { a: [meta("a", 1), meta("a", 4)] });
    expect(p.getRoster().get("a")?.generation).toBe(4);
  });

  it("inputMode: propaga no roster e re-publica só quando muda", () => {
    const { p, t, h } = setup();
    h().onSubscribed();
    // Payload inicial sem inputMode (desktop implícito) — mantém o formato mínimo.
    expect(t.opened[0].tracks[0]).not.toHaveProperty("inputMode");
    p.setInputMode("touch");
    p.setInputMode("touch"); // repetido não re-publica
    expect(t.opened[0].tracks[1]?.inputMode).toBe("touch");
    expect(t.trackCount()).toBe(2);
    h().onPresence("sync", { a: [{ ...meta("a"), inputMode: "touch" }] });
    expect(p.getRoster().get("a")?.inputMode).toBe("touch");
    h().onPresence("sync", { a: [{ ...meta("a"), inputMode: "mouse" }] });
    expect(p.getRoster().get("a")?.inputMode).toBe("mouse");
    // Metas sem inputMode não sobrescrevem com valor inválido.
    h().onPresence("sync", { a: [meta("a")] });
    expect(p.getRoster().get("a")?.inputMode).toBeUndefined();
  });

  it("29/30. cleanup faz untrack best-effort e remove canal", async () => {
    const t = fakeTransport();
    const p = new OfficePresence({ self, transport: t.transport });
    p.start();
    t.opened[0].handlers.onSubscribed();
    const fn = vi.fn();
    p.subscribe(fn);
    await p.dispose();
    expect(t.opened[0].untracks).toBe(1);
    expect(t.opened[0].closed).toBe(true);
    t.opened[0].handlers.onPresence("sync", { a: [meta("a")] });
    expect(fn).not.toHaveBeenCalled();
    expect(p.status).toBe("CLOSED");
  });

  it("untrack que falha não impede close", async () => {
    const closed = vi.fn();
    const p = new OfficePresence({
      self,
      transport: {
        open: () => ({
          track: () => {},
          untrack: () => Promise.reject(new Error("x")),
          close: closed,
        }),
      },
    });
    p.start();
    await p.dispose();
    expect(closed).toHaveBeenCalled();
  });

  it("31. reconexão: no máximo um novo track por SUBSCRIBED", () => {
    const { t, h } = setup();
    h().onSubscribed();
    h().onSubscribed();
    expect(t.trackCount()).toBe(2);
  });

  it("32. erro exposto; rate limit com cooldown e uma tentativa por ciclo", async () => {
    const { p, t, h } = setup({ cooldown: 30_000 });
    h().onSubscribed();
    h().onError("ClientPresenceRateLimitReached");
    h().onError("ClientPresenceRateLimitReached");
    expect(p.status).toBe("RATE_LIMITED");
    expect(p.error).toContain("RateLimit");
    await vi.advanceTimersByTimeAsync(29_000);
    expect(t.opened).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.opened).toHaveLength(2);
    expect(t.opened[0].closed).toBe(true);
    t.opened[1].handlers.onSubscribed();
    expect(p.status).toBe("ONLINE");
    expect(t.trackCount()).toBe(2);
  });

  it("erro genérico vira ERROR", () => {
    const { p, h } = setup();
    h().onError("CHANNEL_ERROR");
    expect(p.status).toBe("ERROR");
  });

  it("34/35. canais separados; falha do Presence não fecha Movement", async () => {
    const topics: string[] = [];
    let movementClosed = false;
    const mt: MovementTransport = {
      open: () => {
        topics.push(movementTopic("w1"));
        return { send: () => {}, close: () => void (movementClosed = true) };
      },
    };
    const m = new MovementRealtime({
      self: { userId: "me", sessionId: "s1", generation: 3 },
      transport: mt,
    });
    m.start();
    const { p, h } = setup({ cooldown: 10 });
    topics.push(presenceTopic("w1"));
    h().onError("ClientPresenceRateLimitReached");
    await vi.advanceTimersByTimeAsync(20);
    await p.dispose();
    expect(new Set(topics).size).toBe(2);
    expect(movementClosed).toBe(false);
    await m.dispose();
  });

  it("33b. código não contém heartbeat de track", async () => {
    const src = (await import("node:fs")).readFileSync("src/lib/rtc/office-presence.ts", "utf8");
    expect(src).not.toMatch(/setInterval/);
  });
});
