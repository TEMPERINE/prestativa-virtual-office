// RTC v2 Etapa 6 — LiveKitRoomManager.
//
// Única camada do RTC v2 autorizada a criar/conectar/desconectar Rooms.
// Recebe apenas o MediaContext (OFFLINE | LOBBY | PRIVATE_ROOM(zoneId)) —
// nunca posição, zonas, desiredPeers ou roster.
//
// Invariantes:
//  - no máximo 1 Room existente (conectando/conectada/desconectando) por vez;
//  - troca de contexto = desconectar a atual (await) → conectar a nova;
//  - um único loop de reconciliação; sempre mira o destino MAIS RECENTE;
//  - reconexão é do próprio LiveKit (Reconnecting/Reconnected na mesma Room);
//  - falha/disconnect inesperado → ERROR, sem retry automático; retry() explícito.
//  - não é dono de câmera/microfone (LocalMedia virá em etapa posterior).
//
// Não ligado ao produto. RTC v1 (useLiveKit.ts) permanece intocado.

import type { MediaContext } from "./media-context";
import {
  emitTelemetry,
  isMapVersionStaleError,
  type RtcTelemetryEventType,
  type RtcTelemetrySink,
  type TelemetryFields,
} from "./rtc-telemetry-types";

export type RoomManagerStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "DISCONNECTING"
  | "ERROR";

export interface RoomManagerSnapshot {
  status: RoomManagerStatus;
  /** Contexto da Room atualmente conectada (ou em reconexão). */
  connected: MediaContext | null;
  /** Destino mais recente solicitado. */
  desired: MediaContext;
  error: string | null;
  roomName: string | null;
}

export interface ConnectionInfo {
  url: string;
  token: string;
  roomName?: string;
}

export type TokenProvider = (
  ctx: Exclude<MediaContext, { kind: "OFFLINE" }>,
) => Promise<ConnectionInfo>;

export type RoomEventName = "reconnecting" | "reconnected" | "disconnected";

/** Superfície mínima de uma Room usada pelo manager. */
export interface RoomLike {
  connect(url: string, token: string, opts: { autoSubscribe: boolean }): Promise<void>;
  disconnect(): Promise<void>;
  on(event: RoomEventName, fn: (...args: unknown[]) => void): void;
  off(event: RoomEventName, fn: (...args: unknown[]) => void): void;
}

export type RoomFactory = () => RoomLike;

export interface RoomManagerDeps {
  tokenProvider: TokenProvider;
  roomFactory?: RoomFactory;
  telemetry?: RtcTelemetrySink;
}

const OFFLINE: MediaContext = { kind: "OFFLINE" };

export function sameCtx(a: MediaContext | null, b: MediaContext | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind !== "PRIVATE_ROOM" || a.zoneId === (b as { zoneId: string }).zoneId;
}

export { roomNameFor } from "./room-names";

/** Factory de produção — único `new Room()` do RTC v2. Carregada sob demanda. */
export async function createLiveKitRoomFactory(): Promise<RoomFactory> {
  const { Room, RoomEvent } = await import("livekit-client");
  const map: Record<RoomEventName, string> = {
    reconnecting: RoomEvent.Reconnecting,
    reconnected: RoomEvent.Reconnected,
    disconnected: RoomEvent.Disconnected,
  };
  return () => {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    return {
      connect: (url, token, opts) =>
        room.connect(url, token, { autoSubscribe: opts.autoSubscribe }),
      disconnect: () => room.disconnect(false),
      on: (e, fn) => void room.on(map[e] as never, fn as never),
      off: (e, fn) => void room.off(map[e] as never, fn as never),
    };
  };
}

interface Active {
  room: RoomLike;
  ctx: MediaContext;
  listeners: Array<[RoomEventName, (...a: unknown[]) => void]>;
  /** true enquanto o manager está desconectando esta Room de propósito. */
  closing: boolean;
}

export class LiveKitRoomManager {
  private snap: RoomManagerSnapshot = {
    status: "DISCONNECTED",
    connected: null,
    desired: OFFLINE,
    error: null,
    roomName: null,
  };
  private active: Active | null = null;
  private running = false;
  private disposed = false;
  /** Contexto que falhou; bloqueia auto-reconciliação até retry() ou novo destino. */
  private failedCtx: MediaContext | null = null;
  private listeners = new Set<(s: RoomManagerSnapshot) => void>();
  private factory: RoomFactory | null;
  private idle: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RoomManagerDeps) {
    this.factory = deps.roomFactory ?? null;
  }

  getSnapshot(): RoomManagerSnapshot {
    return this.snap;
  }

  subscribe(fn: (s: RoomManagerSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Room atual somente quando CONNECTED/RECONNECTING (para anexar mídia). */
  getActiveRoom(): RoomLike | null {
    const s = this.snap.status;
    if (!this.active || this.active.closing) return null;
    return s === "CONNECTED" || s === "RECONNECTING" ? this.active.room : null;
  }

  /** Promise que resolve quando o loop atual termina (útil em testes). */
  whenIdle(): Promise<void> {
    return this.idle;
  }

  setDesiredContext(ctx: MediaContext): void {
    if (this.disposed) return;
    if (!sameCtx(ctx, this.snap.desired)) {
      this.patch({ desired: ctx });
      if (!sameCtx(ctx, this.failedCtx)) this.failedCtx = null;
    }
    this.kick();
  }

  /** Uma nova tentativa para o destino atual. */
  retry(): void {
    if (this.disposed || this.snap.status !== "ERROR") return;
    this.failedCtx = null;
    this.patch({ error: null });
    this.kick();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const a = this.active;
    this.active = null;
    if (a) await this.closeRoom(a);
    if (a)
      this.tel("ROOM_DISCONNECTED", a.ctx, {
        disconnectReason: "dispose",
        connectionState: "DISCONNECTED",
      });
    this.patch({ status: "DISCONNECTED", connected: null, roomName: null, error: null });
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------

  private kick(): void {
    if (this.running) return;
    this.running = true;
    this.idle = this.reconcile().finally(() => {
      this.running = false;
      // Destino alterado enquanto o loop terminava (kick ignorado por
      // running=true): reconcilia de novo em vez de perder o wakeup.
      if (!this.disposed && !this.settled()) this.kick();
    });
  }

  private settled(): boolean {
    const d = this.snap.desired;
    if (this.failedCtx && sameCtx(d, this.failedCtx)) return true;
    if (d.kind === "OFFLINE") return !this.active;
    return !!this.active && sameCtx(this.active.ctx, d);
  }

  private async reconcile(): Promise<void> {
    while (!this.disposed && !this.settled()) {
      const target = this.snap.desired;

      // 1) Desconecta a Room atual se não for o destino.
      if (this.active && !sameCtx(this.active.ctx, target)) {
        const a = this.active;
        this.patch({ status: "DISCONNECTING" });
        await this.closeRoom(a);
        if (this.active === a) this.active = null;
        this.tel("ROOM_DISCONNECTED", a.ctx, {
          disconnectReason: "context_change",
          connectionState: "DISCONNECTED",
        });
        this.patch({ status: "DISCONNECTED", connected: null, roomName: null });
        continue;
      }
      if (target.kind === "OFFLINE") {
        this.patch({ status: "DISCONNECTED", connected: null, roomName: null, error: null });
        continue;
      }

      // 2) Token (resultado obsoleto é descartado).
      this.patch({ status: "CONNECTING", error: null });
      this.tel("ROOM_CONNECT_REQUESTED", target, { roomName: null });
      let info: ConnectionInfo;
      try {
        info = await this.deps.tokenProvider(target);
      } catch (e) {
        if (this.disposed) return;
        if (!sameCtx(this.snap.desired, target)) continue;
        this.fail(target, e);
        return;
      }
      if (this.disposed) return;
      if (!sameCtx(this.snap.desired, target)) continue;

      // 3) Cria e conecta — só existe Room se this.active === null aqui.
      if (!this.factory) this.factory = await createLiveKitRoomFactory();
      if (this.disposed) return;
      if (!sameCtx(this.snap.desired, target)) continue;
      const room = this.factory();
      const a: Active = { room, ctx: target, listeners: [], closing: false };
      this.attach(a);
      this.active = a;
      try {
        await room.connect(info.url, info.token, { autoSubscribe: target.kind === "PRIVATE_ROOM" });
      } catch (e) {
        await this.closeRoom(a);
        if (this.active === a) this.active = null;
        if (this.disposed) return;
        this.patch({ connected: null, roomName: null });
        if (!sameCtx(this.snap.desired, target)) continue;
        this.fail(target, e);
        return;
      }
      if (this.disposed || this.active !== a) {
        await this.closeRoom(a);
        return;
      }
      this.patch({
        status: "CONNECTED",
        connected: target,
        roomName: info.roomName ?? null,
        error: null,
      });
      this.tel("ROOM_SIGNAL_CONNECTED", target);
      // se o destino mudou durante o connect, o loop desconecta na próxima volta
    }
  }

  private attach(a: Active): void {
    const isCurrent = () => !this.disposed && this.active === a && !a.closing;
    const onReconnecting = () => {
      if (isCurrent() && this.snap.status === "CONNECTED") {
        this.patch({ status: "RECONNECTING" });
        this.tel("ROOM_RECONNECTING", a.ctx);
      }
    };
    const onReconnected = () => {
      if (isCurrent() && this.snap.status === "RECONNECTING") {
        this.patch({ status: "CONNECTED" });
        this.tel("ROOM_RECONNECTED", a.ctx);
      }
    };
    const onDisconnected = (reason?: unknown) => {
      if (!isCurrent()) return;
      // Só é "inesperado" depois de CONNECTED/RECONNECTING; durante connect o catch trata.
      if (this.snap.status !== "CONNECTED" && this.snap.status !== "RECONNECTING") return;
      this.detach(a);
      this.active = null;
      this.tel("ROOM_DISCONNECTED", a.ctx, {
        disconnectReason:
          typeof reason === "string" || typeof reason === "number" ? String(reason) : "unexpected",
      });
      this.fail(a.ctx, new Error("disconnected"), false);
    };
    a.listeners = [
      ["reconnecting", onReconnecting],
      ["reconnected", onReconnected],
      ["disconnected", onDisconnected],
    ];
    for (const [e, fn] of a.listeners) a.room.on(e, fn);
  }

  private detach(a: Active): void {
    for (const [e, fn] of a.listeners) a.room.off(e, fn);
    a.listeners = [];
  }

  private async closeRoom(a: Active): Promise<void> {
    if (a.closing) return;
    a.closing = true;
    this.detach(a);
    try {
      await a.room.disconnect();
    } catch {
      /* best-effort */
    }
  }

  private fail(ctx: MediaContext, e: unknown, connectFailure = true): void {
    this.failedCtx = ctx;
    // Visitante em sala de vídeo/reunião: estado neutro (sem mídia), sem erro nem retry.
    if (String(e instanceof Error ? e.message : e).includes("VISITOR_ZONE_FORBIDDEN")) {
      this.patch({ status: "DISCONNECTED", connected: null, roomName: null, error: null });
      return;
    }
    if (connectFailure) {
      if (isMapVersionStaleError(e)) this.tel("MAP_STALE", ctx, { error: e });
      this.tel("ROOM_CONNECT_FAILED", ctx, { error: e, connectionState: "ERROR" });
    }
    this.patch({
      status: "ERROR",
      connected: null,
      roomName: null,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  private tel(
    type: RtcTelemetryEventType,
    ctx: MediaContext | null,
    extra: TelemetryFields = {},
  ): void {
    emitTelemetry(this.deps.telemetry, type, {
      context: ctx?.kind ?? null,
      zoneId: ctx && ctx.kind === "PRIVATE_ROOM" ? ctx.zoneId : null,
      roomName: this.snap.roomName,
      connectionState: this.snap.status,
      ...extra,
    });
  }

  private patch(p: Partial<RoomManagerSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    for (const l of this.listeners) l(this.snap);
  }
}
