/**
 * RTC v2 — Etapa 10: Presence lento (online/offline) por workspace.
 *
 * Canal privado `workspace:{workspaceId}:presence`, separado do canal de
 * movimento (erros de Presence podem fechar o channel inteiro).
 * - Um único track() por SUBSCRIBED (inicial ou reconexão). Sem heartbeat.
 * - Payload sem posição, zona, room, mic/cam ou relógio.
 * - untrack() best-effort + remoção do canal no cleanup.
 * - Erros (incl. rate limit) são expostos; rejoin com cooldown, uma tentativa por ciclo.
 * O roster significa apenas "online neste workspace" — não é roster LiveKit
 * nem decide Private Room. Ainda não integrado ao Office.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitTelemetry, type RtcTelemetrySink } from "./rtc-telemetry-types";

export interface PresencePayload {
  userId: string;
  sessionId: string;
  generation: number;
  workspaceId: string;
  joinedAt: string;
  /** RTC On Demand: "LOBBY" | "PRIVATE:<zoneId>". Sem coordenadas. */
  mediaLocation?: string;
  /**
   * Modo de entrada do dispositivo ("touch" = celular, "mouse" = desktop).
   * Apenas informativo (ícone na Equipe); nunca participa de decisões de mídia.
   */
  inputMode?: "touch" | "mouse";
  /**
   * Contador monotônico da sessão: começa em 1 e só incrementa quando um
   * estado publicado relevante muda (hoje: mediaLocation). Sem heartbeat,
   * sem timer, nunca por movimento. Desempata metas com a mesma generation.
   */
  presenceRevision?: number;
}

/** Meta `a` deve substituir `cur` (mesmo userId)? Determinístico. */
export function presenceMetaWins(a: PresencePayload, cur: PresencePayload | undefined): boolean {
  if (!cur) return true;
  if (a.generation !== cur.generation) return a.generation > cur.generation;
  const ra = typeof a.presenceRevision === "number" ? a.presenceRevision : null;
  const rc = typeof cur.presenceRevision === "number" ? cur.presenceRevision : null;
  if (ra != null && rc != null && ra !== rc) return ra > rc;
  if (ra != null && rc == null) return true;
  if (ra == null && rc != null) return false;
  // Fallback defensivo (metas antigas sem revision): ordem de chegada.
  return true;
}

export type PresenceState = Record<string, PresencePayload[]>;

export type PresenceStatus = "IDLE" | "JOINING" | "ONLINE" | "ERROR" | "RATE_LIMITED" | "CLOSED";

export interface PresenceTransportHandlers {
  /** sync/join/leave: sempre entrega o estado completo atual. */
  onPresence(kind: "sync" | "join" | "leave", state: PresenceState): void;
  onSubscribed(): void;
  onError(message: string): void;
}

export interface PresenceTransportHandle {
  track(payload: PresencePayload): Promise<unknown> | unknown;
  untrack(): Promise<unknown> | unknown;
  close(): Promise<void> | void;
}

export interface PresenceTransport {
  open(handlers: PresenceTransportHandlers): PresenceTransportHandle;
}

export interface OfficePresenceOptions {
  self: Omit<PresencePayload, "joinedAt"> & { joinedAt?: string };
  transport: PresenceTransport;
  /** Cooldown antes de uma única tentativa de rejoin após erro. */
  rejoinCooldownMs?: number;
  telemetry?: RtcTelemetrySink;
}

export const PRESENCE_REJOIN_COOLDOWN_MS = 30_000;

export function presenceTopic(workspaceId: string): string {
  return `workspace:${workspaceId}:presence`;
}

export function isRateLimitError(message: string): boolean {
  return /rate.?limit/i.test(message);
}

export class OfficePresence {
  private readonly payload: PresencePayload;
  private readonly transport: PresenceTransport;
  private readonly cooldownMs: number;
  private readonly telemetry?: RtcTelemetrySink;

  private handle: PresenceTransportHandle | null = null;
  private epoch = 0;
  private disposed = false;
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null;

  private _status: PresenceStatus = "IDLE";
  private _error: string | null = null;
  private roster = new Map<string, PresencePayload>();
  private listeners = new Set<() => void>();

  constructor(opts: OfficePresenceOptions) {
    this.payload = {
      userId: opts.self.userId,
      sessionId: opts.self.sessionId,
      generation: opts.self.generation,
      workspaceId: opts.self.workspaceId,
      joinedAt: opts.self.joinedAt ?? new Date().toISOString(),
      presenceRevision: 1,
      ...(opts.self.inputMode ? { inputMode: opts.self.inputMode } : {}),
    };
    this.transport = opts.transport;
    this.cooldownMs = opts.rejoinCooldownMs ?? PRESENCE_REJOIN_COOLDOWN_MS;
    this.telemetry = opts.telemetry;
  }

  get status(): PresenceStatus {
    return this._status;
  }
  get error(): string | null {
    return this._error;
  }
  getRoster(): ReadonlyMap<string, PresencePayload> {
    return this.roster;
  }
  getTrackedPayload(): Readonly<PresencePayload> {
    return this.payload;
  }
  /** Atualiza só o contexto de mídia (troca de zona). Um track() por mudança. */
  setMediaLocation(loc: string | null): void {
    const next = loc ?? undefined;
    if (this.disposed || this.payload.mediaLocation === next) return;
    this.payload.mediaLocation = next;
    this.payload.presenceRevision = (this.payload.presenceRevision ?? 1) + 1;
    if (this._status === "ONLINE" && this.handle) {
      const myEpoch = this.epoch;
      void Promise.resolve(this.handle.track({ ...this.payload })).catch((e) =>
        this.fail(myEpoch, e instanceof Error ? e.message : String(e)),
      );
    }
  }
  /** Atualiza o modo de entrada (celular/desktop). Um track() por mudança real. */
  setInputMode(mode: "touch" | "mouse"): void {
    if (this.disposed || this.payload.inputMode === mode) return;
    this.payload.inputMode = mode;
    this.payload.presenceRevision = (this.payload.presenceRevision ?? 1) + 1;
    if (this._status === "ONLINE" && this.handle) {
      const myEpoch = this.epoch;
      void Promise.resolve(this.handle.track({ ...this.payload })).catch((e) =>
        this.fail(myEpoch, e instanceof Error ? e.message : String(e)),
      );
    }
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(): void {
    if (this.disposed || this.handle) return;
    const myEpoch = ++this.epoch;
    this.setStatus("JOINING");
    this.handle = this.transport.open({
      onSubscribed: () => {
        if (myEpoch !== this.epoch || this.disposed) return;
        this._error = null;
        this.setStatus("ONLINE");
        // Único track() por assinatura — nunca como keepalive.
        void Promise.resolve(this.handle?.track({ ...this.payload })).catch((e) =>
          this.fail(myEpoch, e instanceof Error ? e.message : String(e)),
        );
      },
      onPresence: (_kind, state) => {
        if (myEpoch !== this.epoch || this.disposed) return;
        this.applyState(state);
      },
      onError: (msg) => this.fail(myEpoch, msg),
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    if (this.rejoinTimer) clearTimeout(this.rejoinTimer);
    this.rejoinTimer = null;
    const h = this.handle;
    this.handle = null;
    if (h) {
      try {
        await h.untrack();
      } catch {
        /* best-effort */
      }
      await h.close();
    }
    this.roster.clear();
    this._status = "CLOSED";
    this.listeners.clear();
  }

  private fail(myEpoch: number, message: string): void {
    if (myEpoch !== this.epoch || this.disposed) return;
    this._error = message;
    console.warn("[office-presence]", message);
    const rateLimited = isRateLimitError(message);
    this.setStatus(rateLimited ? "RATE_LIMITED" : "ERROR");
    emitTelemetry(this.telemetry, "PRESENCE_ERROR", {
      error: { code: rateLimited ? "RATE_LIMITED" : "PRESENCE_ERROR", message },
      metadata: { channel: "presence" },
    });
    if (this.rejoinTimer) return; // uma tentativa por ciclo
    this.rejoinTimer = setTimeout(() => {
      this.rejoinTimer = null;
      if (this.disposed) return;
      const old = this.handle;
      this.handle = null;
      this.epoch++;
      void Promise.resolve(old?.close()).finally(() => {
        if (!this.disposed) this.start();
      });
    }, this.cooldownMs);
  }

  private applyState(state: PresenceState): void {
    const next = new Map<string, PresencePayload>();
    for (const metas of Object.values(state)) {
      for (const m of metas ?? []) {
        if (!m || typeof m.userId !== "string") continue;
        const cur = next.get(m.userId);
        // generation > presenceRevision > ordem de chegada (só p/ metas antigos).
        if (presenceMetaWins(m, cur)) {
          next.set(m.userId, {
            userId: m.userId,
            sessionId: m.sessionId,
            generation: m.generation,
            workspaceId: m.workspaceId,
            joinedAt: m.joinedAt,
            ...(typeof m.mediaLocation === "string" ? { mediaLocation: m.mediaLocation } : {}),
            ...(m.inputMode === "touch" || m.inputMode === "mouse" ? { inputMode: m.inputMode } : {}),
            ...(typeof m.presenceRevision === "number"
              ? { presenceRevision: m.presenceRevision }
              : {}),
          });
        }
      }
    }
    // Só notifica mudança relevante (entra/sai/mediaLocation/sessão/inputMode) —
    // evita loop Presence → demand → track próprio → Presence sem alteração real.
    const sig = (r: Map<string, PresencePayload>) =>
      [...r.values()]
        .map((p) => `${p.userId}|${p.sessionId}|${p.generation}|${p.mediaLocation ?? ""}|${p.inputMode ?? ""}`)
        .sort()
        .join(";");
    const changed = sig(next) !== sig(this.roster);
    this.roster = next;
    if (changed) {
      this._revision++;
      this.notify();
    }
  }

  private _revision = 0;
  /** Incrementa a cada mudança relevante do roster. */
  get revision(): number {
    return this._revision;
  }

  private setStatus(s: PresenceStatus): void {
    this._status = s;
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

/** Adaptador Supabase: canal privado exclusivo de Presence. */
export function createSupabasePresenceTransport(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
): PresenceTransport {
  return {
    open(handlers) {
      const channel = supabase.channel(presenceTopic(workspaceId), {
        config: { private: true, presence: { key: userId } },
      });
      const emit = (kind: "sync" | "join" | "leave") =>
        handlers.onPresence(kind, channel.presenceState() as unknown as PresenceState);
      channel.on("presence", { event: "sync" }, () => emit("sync"));
      channel.on("presence", { event: "join" }, () => emit("join"));
      channel.on("presence", { event: "leave" }, () => emit("leave"));
      channel.on(
        "system",
        {},
        (payload: { status?: string; message?: string; extension?: string }) => {
          if (payload?.status === "error")
            handlers.onError(payload.message ?? "presence system error");
        },
      );
      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") handlers.onSubscribed();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          handlers.onError(`${status}${err ? `: ${err.message}` : ""}`);
        }
      });
      return {
        track: (p) => channel.track(p as unknown as Record<string, unknown>),
        untrack: () => channel.untrack(),
        async close() {
          await supabase.removeChannel(channel);
        },
      };
    },
  };
}
