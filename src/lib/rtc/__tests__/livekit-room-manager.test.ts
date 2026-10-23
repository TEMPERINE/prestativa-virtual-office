import { describe, it, expect } from "vitest";
import {
  LiveKitRoomManager,
  type RoomLike,
  type RoomEventName,
  type ConnectionInfo,
  type TokenProvider,
} from "../livekit-room-manager";
import type { MediaContext } from "../media-context";

// ---------------------------------------------------------------- fakes

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const label = (c: MediaContext) => (c.kind === "PRIVATE_ROOM" ? c.zoneId : c.kind);

class FakeRoom implements RoomLike {
  static seq = 0;
  id = ++FakeRoom.seq;
  state: "NEW" | "CONNECTING" | "CONNECTED" | "DISCONNECTED" = "NEW";
  opts: { autoSubscribe: boolean } | null = null;
  token = "";
  handlers = new Map<RoomEventName, Set<(...a: unknown[]) => void>>();
  pendingConnect: Deferred<void> | null = null;
  constructor(private h: Harness) {}
  connect(_url: string, token: string, opts: { autoSubscribe: boolean }) {
    this.token = token;
    this.opts = opts;
    this.state = "CONNECTING";
    this.h.log.push(`connect:${token}`);
    this.h.checkInvariant();
    if (this.h.manualConnect) {
      this.pendingConnect = deferred<void>();
      return this.pendingConnect.promise.then(() => {
        if (this.state === "CONNECTING") this.state = "CONNECTED";
      });
    }
    if (this.h.failNextConnect) {
      this.h.failNextConnect = false;
      return Promise.reject(new Error("connect failed"));
    }
    this.state = "CONNECTED";
    return Promise.resolve();
  }
  async disconnect() {
    this.h.log.push(`disconnect:${this.token}`);
    this.state = "DISCONNECTED";
  }
  on(e: RoomEventName, fn: (...a: unknown[]) => void) {
    if (!this.handlers.has(e)) this.handlers.set(e, new Set());
    this.handlers.get(e)!.add(fn);
  }
  off(e: RoomEventName, fn: (...a: unknown[]) => void) {
    this.handlers.get(e)?.delete(fn);
  }
  emit(e: RoomEventName) {
    for (const fn of [...(this.handlers.get(e) ?? [])]) fn();
  }
  listenerCount() {
    return [...this.handlers.values()].reduce((n, s) => n + s.size, 0);
  }
}

class Harness {
  rooms: FakeRoom[] = [];
  log: string[] = [];
  tokenCalls: string[] = [];
  manualToken = false;
  manualConnect = false;
  failNextConnect = false;
  maxLive = 0;
  pendingTokens: Array<{ ctx: string; d: Deferred<ConnectionInfo> }> = [];

  live() {
    return this.rooms.filter((r) => r.state === "CONNECTING" || r.state === "CONNECTED");
  }
  checkInvariant() {
    const n = this.live().length;
    this.maxLive = Math.max(this.maxLive, n);
    if (n > 1) throw new Error(`invariant: ${n} live rooms`);
  }
  tokenProvider: TokenProvider = (ctx) => {
    const l = label(ctx);
    this.tokenCalls.push(l);
    const info = { url: "wss://fake", token: l, roomName: `room:${l}` };
    if (!this.manualToken) return Promise.resolve(info);
    const d = deferred<ConnectionInfo>();
    this.pendingTokens.push({ ctx: l, d });
    return d.promise;
  };
  factory = () => {
    const r = new FakeRoom(this);
    this.rooms.push(r);
    return r;
  };
  manager() {
    return new LiveKitRoomManager({ tokenProvider: this.tokenProvider, roomFactory: this.factory });
  }
}

const LOBBY: MediaContext = { kind: "LOBBY" };
const OFF: MediaContext = { kind: "OFFLINE" };
const A: MediaContext = { kind: "PRIVATE_ROOM", zoneId: "A" };
const B: MediaContext = { kind: "PRIVATE_ROOM", zoneId: "B" };

async function settle(m: LiveKitRoomManager) {
  await flush();
  await m.whenIdle();
  await flush();
}

// ---------------------------------------------------------------- tests

describe("LiveKitRoomManager", () => {
  it("1. OFFLINE não cria Room", async () => {
    const h = new Harness();
    const m = h.manager();
    m.setDesiredContext(OFF);
    await settle(m);
    expect(h.rooms).toHaveLength(0);
    expect(h.tokenCalls).toHaveLength(0);
    expect(m.getSnapshot().status).toBe("DISCONNECTED");
  });

  it("2. LOBBY conecta com autoSubscribe:false", async () => {
    const h = new Harness();
    const m = h.manager();
    m.setDesiredContext(LOBBY);
    await settle(m);
    expect(h.rooms[0].opts).toEqual({ autoSubscribe: false });
    expect(m.getSnapshot()).toMatchObject({
      status: "CONNECTED",
      connected: LOBBY,
      roomName: "room:LOBBY",
    });
  });

  it("3. PRIVATE_ROOM conecta com autoSubscribe:true", async () => {
    const h = new Harness();
    const m = h.manager();
    m.setDesiredContext(A);
    await settle(m);
    expect(h.rooms[0].opts).toEqual({ autoSubscribe: true });
    expect(m.getSnapshot().connected).toEqual(A);
  });

  it("4. mesmo contexto novamente é idempotente", async () => {
    const h = new Harness();
    const m = h.manager();
    m.setDesiredContext(LOBBY);
    await settle(m);
    m.setDesiredContext({ kind: "LOBBY" });
    m.setDesiredContext(LOBBY);
    await settle(m);
    m.setDesiredContext(A);
    await settle(m);
    m.setDesiredContext({ kind: "PRIVATE_ROOM", zoneId: "A" });
    await settle(m);
    expect(h.tokenCalls).toEqual(["LOBBY", "A"]);
    expect(h.rooms).toHaveLength(2);
    expect(h.log.filter((l) => l === "disconnect:A")).toHaveLength(0);
  });

  it("5/6/7. ordem disconnect → connect em todas as trocas", async () => {
    const h = new Harness();
    const m = h.manager();
    for (const c of [LOBBY, A, B, LOBBY]) {
      m.setDesiredContext(c);
      await settle(m);
    }
    expect(h.log).toEqual([
      "connect:LOBBY",
      "disconnect:LOBBY",
      "connect:A",
      "disconnect:A",
      "connect:B",
      "disconnect:B",
      "connect:LOBBY",
    ]);
  });

  it("8. nunca existem duas Rooms vivas simultaneamente", async () => {
    const h = new Harness();
    h.manualConnect = true;
    const m = h.manager();
    const seq = [LOBBY, A, B, LOBBY, A, OFF, B];
    for (const c of seq) {
      m.setDesiredContext(c);
      await flush();
      h.rooms.at(-1)?.pendingConnect?.resolve();
      await flush();
    }
    await settle(m);
    h.rooms.at(-1)?.pendingConnect?.resolve();
    await settle(m);
    expect(h.maxLive).toBe(1);
    expect(h.live()).toHaveLength(1);
    expect(m.getSnapshot().connected).toEqual(B);
  });

  it("9. mudança de destino durante token fetch descarta resultado obsoleto", async () => {
    const h = new Harness();
    h.manualToken = true;
    const m = h.manager();
    m.setDesiredContext(A);
    await flush();
    m.setDesiredContext(B);
    h.pendingTokens[0].d.resolve({ url: "u", token: "A" });
    await flush();
    expect(h.rooms).toHaveLength(0); // não conectou A
    h.pendingTokens[1].d.resolve({ url: "u", token: "B" });
    await settle(m);
    expect(h.log).toEqual(["connect:B"]);
  });

  it("10. A → B → Lobby rapidamente termina somente em Lobby", async () => {
    const h = new Harness();
    h.manualToken = true;
    const m = h.manager();
    m.setDesiredContext(LOBBY);
    await flush();
    h.pendingTokens[0].d.resolve({ url: "u", token: "LOBBY" });
    await settle(m);
    m.setDesiredContext(A);
    await flush();
    m.setDesiredContext(B);
    m.setDesiredContext(LOBBY);
    await flush();
    // resolve tokens conforme forem pedidos (A obsoleto, depois LOBBY)
    for (let i = 0; i < 5; i++) {
      h.pendingTokens.splice(0).forEach((t) => t.d.resolve({ url: "u", token: t.ctx }));
      await flush();
    }
    await settle(m);
    // Nenhum fila histórica: B nunca é tentado; termina em LOBBY.
    expect(h.tokenCalls).not.toContain("B");
    expect(h.log.filter((l) => l.startsWith("connect:"))).not.toContain("connect:A");
    expect(h.log.filter((l) => l.startsWith("connect:"))).not.toContain("connect:B");
    expect(m.getSnapshot()).toMatchObject({ status: "CONNECTED", connected: LOBBY });
  });

  it("11/12. Reconnecting/Reconnected reutilizam a mesma Room sem token novo", async () => {
    const h = new Harness();
    const m = h.manager();
    m.setDesiredContext(A);
    await settle(m);
    h.rooms[0].emit("reconnecting");
    expect(m.getSnapshot().status).toBe("RECONNECTING");
    await settle(m);
    expect(h.rooms).toHaveLength(1);
    expect(h.tokenCalls).toHaveLength(1);
    h.rooms[0].emit("reconnected");
    expect(m.getSnapshot()).toMatchObject({ status: "CONNECTED", connected: A });
    expect(h.rooms).toHaveLength(1);
  });

  it("13. disconnect inesperado → ERROR sem reconectar sozinho", async () => {
    const h = new Harness();
    const m = h.manager();
    m.setDesiredContext(A);
    await settle(m);
    h.rooms[0].state = "DISCONNECTED";
    h.rooms[0].emit("disconnected");
    await settle(m);
    expect(m.getSnapshot()).toMatchObject({ status: "ERROR", connected: null, desired: A });
    expect(h.tokenCalls).toHaveLength(1);
    expect(h.rooms).toHaveLength(1);
  });

  it("14. connect failure → ERROR, sem retry infinito e sem Room fantasma", async () => {
    const h = new Harness();
    h.failNextConnect = true;
    const m = h.manager();
    m.setDesiredContext(A);
    await settle(m);
    expect(m.getSnapshot()).toMatchObject({ status: "ERROR", desired: A, error: "connect failed" });
    expect(h.rooms[0].state).toBe("DISCONNECTED");
    expect(h.rooms[0].listenerCount()).toBe(0);
    m.setDesiredContext(A); // mesmo destino não re-tenta sozinho
    await settle(m);
    expect(h.tokenCalls).toHaveLength(1);
  });

  it("15. retry() faz apenas uma nova tentativa", async () => {
    const h = new Harness();
    h.failNextConnect = true;
    const m = h.manager();
    m.setDesiredContext(A);
    await settle(m);
    h.failNextConnect = true;
    m.retry();
    m.retry();
    await settle(m);
    expect(h.tokenCalls).toEqual(["A", "A"]);
    expect(m.getSnapshot().status).toBe("ERROR");
    m.retry();
    await settle(m);
    expect(h.tokenCalls).toHaveLength(3);
    expect(m.getSnapshot()).toMatchObject({ status: "CONNECTED", connected: A });
  });

  it("16. OFFLINE durante CONNECTING converge para DISCONNECTED", async () => {
    const h = new Harness();
    h.manualConnect = true;
    const m = h.manager();
    m.setDesiredContext(A);
    await flush();
    expect(m.getSnapshot().status).toBe("CONNECTING");
    m.setDesiredContext(OFF);
    h.rooms[0].pendingConnect!.resolve();
    await settle(m);
    expect(m.getSnapshot()).toMatchObject({ status: "DISCONNECTED", connected: null });
    expect(h.live()).toHaveLength(0);
  });

  it("17. dispose() durante token fetch impede conexão posterior", async () => {
    const h = new Harness();
    h.manualToken = true;
    const m = h.manager();
    m.setDesiredContext(A);
    await flush();
    await m.dispose();
    h.pendingTokens[0].d.resolve({ url: "u", token: "A" });
    await settle(m);
    expect(h.rooms).toHaveLength(0);
    expect(m.getSnapshot().status).toBe("DISCONNECTED");
  });

  it("18. dispose() durante connect não deixa Room fantasma", async () => {
    const h = new Harness();
    h.manualConnect = true;
    const m = h.manager();
    m.setDesiredContext(A);
    await flush();
    await m.dispose();
    h.rooms[0].pendingConnect!.resolve();
    await settle(m);
    expect(h.live()).toHaveLength(0);
    expect(h.rooms[0].listenerCount()).toBe(0);
    expect(m.getSnapshot().status).toBe("DISCONNECTED");
  });

  it("19. listeners da Room antiga não alteram o estado da nova", async () => {
    const h = new Harness();
    const m = h.manager();
    m.setDesiredContext(A);
    await settle(m);
    const old = h.rooms[0];
    const oldFns = [...(old.handlers.get("disconnected") ?? [])];
    m.setDesiredContext(B);
    await settle(m);
    // mesmo chamando handlers capturados da Room antiga diretamente:
    oldFns.forEach((fn) => fn());
    old.emit("reconnecting");
    expect(m.getSnapshot()).toMatchObject({ status: "CONNECTED", connected: B });
  });

  it("20. API não aceita desiredPeers nem posição", () => {
    const h = new Harness();
    const m = h.manager();
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(m)).join(",");
    expect(api).not.toMatch(/peer|position|zone(?!Id)|roster|visible/i);
    expect(m.setDesiredContext.length).toBe(1);
  });
});

describe("LiveKitRoomManager — visitante em sala de reunião", () => {
  it("Lobby → Diretoria → Reunião (neutro, sem retry) → Diretoria → Lobby", async () => {
    const h = new Harness();
    const base = h.tokenProvider;
    const m = new LiveKitRoomManager({
      tokenProvider: (ctx) =>
        ctx.kind === "PRIVATE_ROOM" && ctx.zoneId === "reuniao"
          ? (h.tokenCalls.push("reuniao"), Promise.reject(new Error("VISITOR_ZONE_FORBIDDEN")))
          : base(ctx),
      roomFactory: h.factory,
    });
    const DIR: MediaContext = { kind: "PRIVATE_ROOM", zoneId: "diretoria" };
    const REU: MediaContext = { kind: "PRIVATE_ROOM", zoneId: "reuniao" };
    m.setDesiredContext(LOBBY);
    await settle(m);
    m.setDesiredContext(DIR);
    await settle(m);
    expect([m.getSnapshot().status, m.getSnapshot().roomName]).toEqual(["CONNECTED", "room:diretoria"]);
    m.setDesiredContext(REU);
    await settle(m);
    m.setDesiredContext(REU);
    await settle(m);
    expect([m.getSnapshot().status, m.getSnapshot().error]).toEqual(["DISCONNECTED", null]);
    expect(h.tokenCalls.filter((c) => c === "reuniao")).toHaveLength(1);
    expect(h.live()).toHaveLength(0);
    m.setDesiredContext(DIR);
    await settle(m);
    expect(m.getSnapshot().status).toBe("CONNECTED");
    m.setDesiredContext(LOBBY);
    await settle(m);
    expect([m.getSnapshot().status, m.getSnapshot().roomName]).toEqual(["CONNECTED", "room:LOBBY"]);
  });
});
