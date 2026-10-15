import { ChatUnavailableError } from "./api";
import {
  CHAT_MAX_LENGTH,
  type ChatApi,
  type ChatConversation,
  type ChatMessage,
  type ChatMessageType,
  type ChatRealtime,
  type ChatStatus,
  type IncomingChat,
} from "./types";
import { findChatSticker } from "./stickers";

export type ChatState = {
  conversations: ChatConversation[];
  selectedId: string | null;
  messages: ChatMessage[];
  hasMore: boolean;
  loading: boolean;
  loadingOlder: boolean;
  sending: boolean;
  loadingList: boolean;
  available: boolean;
  error: string | null;
  connection: ChatStatus;
};
export type ChatStore = ReturnType<typeof createChatStore>;
type Deps = {
  workspaceId: string;
  userId: string;
  api: ChatApi;
  realtime: ChatRealtime;
  createId?: () => string;
  isForeground?: () => boolean;
  onIncoming?: (event: IncomingChat) => void;
};
const merge = (left: ChatMessage[], right: ChatMessage[]) =>
  [...new Map([...left, ...right].map((m) => [m.id, m])).values()].sort((a, b) => a.seq - b.seq);
const initial = (): ChatState => ({
  conversations: [],
  selectedId: null,
  messages: [],
  hasMore: false,
  loading: false,
  loadingOlder: false,
  sending: false,
  loadingList: true,
  available: true,
  error: null,
  connection: "connecting",
});

/** One instance per authenticated workspace. No React, RTC, Presence or media. */
export function createChatStore(deps: Deps) {
  let state = initial(),
    disposed = false,
    connected = false,
    initialized = false,
    reading = false,
    historyLoaded = false,
    historyReady = false;
  let generation = 0,
    historyRequest = 0,
    startRequest = 0,
    readWorker: number | null = null,
    requestedRead = 0,
    readThrough = 0;
  let listInFlight: Promise<void> | null = null,
    listAgain = false;
  let offInbox: (() => void) | undefined, offMessages: (() => void) | undefined;
  // Keep each uncertain attempt until that same payload is acknowledged. A sticker
  // must not erase the identity of a text whose server response was lost.
  const pending = new Map<string, { id: string }>();
  const listeners = new Set<() => void>();
  const alerted = new Map<string, number>();
  const isForeground =
    deps.isForeground ??
    (() =>
      typeof document === "undefined" ||
      (document.visibilityState === "visible" && document.hasFocus()));
  const patch = (next: Partial<ChatState>) => {
    if (!disposed) {
      state = { ...state, ...next };
      listeners.forEach((fn) => fn());
    }
  };
  const failure = (error: unknown) =>
    patch({
      error:
        error instanceof ChatUnavailableError
          ? error.message
          : "Não foi possível atualizar o chat. Tente novamente.",
      ...(error instanceof ChatUnavailableError ? { available: false } : {}),
    });
  const current = (cid: string, token: number) =>
    !disposed && state.selectedId === cid && generation === token;

  async function refresh(): Promise<void> {
    if (disposed) return;
    if (listInFlight) {
      listAgain = true;
      return listInFlight;
    }
    listInFlight = (async () => {
      do {
        listAgain = false;
        try {
          const rows = (await deps.api.list(deps.workspaceId)).filter(
            (c) =>
              c.workspace_id === deps.workspaceId &&
              (c.participant_a === deps.userId || c.participant_b === deps.userId),
          );
          if (disposed) return;
          rows.sort(
            (a, b) =>
              (b.last_message_at ?? b.created_at).localeCompare(
                a.last_message_at ?? a.created_at,
              ) || a.id.localeCompare(b.id),
          );
          const previous = new Map(state.conversations.map((c) => [c.id, c.unread_count]));
          for (const row of rows) {
            if (
              initialized &&
              row.unread_count > (previous.get(row.id) ?? 0) &&
              row.last_message_seq > (alerted.get(row.id) ?? 0) &&
              !(reading && isForeground() && row.id === state.selectedId)
            ) {
              alerted.set(row.id, row.last_message_seq);
              deps.onIncoming?.({
                conversationId: row.id,
                peerName: row.peer_name,
                lastSeq: row.last_message_seq,
              });
            }
          }
          initialized = true;
          patch({ conversations: rows, loadingList: false, available: true });
          if (state.selectedId && !rows.some((c) => c.id === state.selectedId)) {
            offMessages?.();
            offMessages = undefined;
            generation++;
            patch({ selectedId: null, messages: [], hasMore: false, loading: false });
          }
        } catch (error) {
          failure(error);
          patch({ loadingList: false });
        }
      } while (listAgain && !disposed);
    })();
    try {
      await listInFlight;
    } finally {
      listInFlight = null;
    }
  }

  async function latest(cid: string, token: number) {
    const request = ++historyRequest;
    const saved = state.messages,
      savedHasMore = state.hasMore,
      hadHistory = historyLoaded;
    // Keep the existing DOM/history and the user's scroll intent during reconnect.
    historyReady = false;
    patch({ loading: true, loadingOlder: false });
    try {
      let page = await deps.api.history(cid);
      if (!current(cid, token) || request !== historyRequest) return;
      let recovered = page.messages;
      // Live events may already be beyond a missed gap. Reconcile back to the
      // contiguous prefix, rather than trusting the highest received sequence.
      let through = saved[0]?.seq;
      for (const message of saved.slice(1)) {
        if (through === undefined || message.seq !== through + 1) break;
        through = message.seq;
      }
      while (through !== undefined && recovered.length && recovered[0].seq > through + 1) {
        const before = recovered[0].seq;
        if (!page.hasMore) throw new Error("Incomplete chat history");
        page = await deps.api.history(cid, before);
        if (!current(cid, token) || request !== historyRequest) return;
        if (!page.messages.length || page.messages[0].seq >= before)
          throw new Error("Chat history cursor did not advance");
        recovered = merge(page.messages, recovered);
      }
      const keepsOldest =
        hadHistory && saved.length > 0 && saved[0].seq <= (recovered[0]?.seq ?? Infinity);
      historyLoaded = true;
      historyReady = true;
      patch({
        messages: merge(recovered, state.messages),
        hasMore: keepsOldest ? savedHasMore : page.hasMore,
        loading: false,
        error: null,
      });
      maybeRead();
    } catch (error) {
      if (current(cid, token) && request === historyRequest) {
        failure(error);
        patch({ loading: false });
      }
    }
  }
  async function select(cid: string) {
    startRequest++;
    if (disposed || cid === state.selectedId) return;
    if (!state.conversations.some((c) => c.id === cid)) {
      patch({ error: "Esta conversa não está disponível." });
      return;
    }
    offMessages?.();
    generation++;
    const token = generation;
    reading = false;
    historyLoaded = false;
    requestedRead = 0;
    readThrough = state.conversations.find((c) => c.id === cid)?.read_seq ?? 0;
    patch({
      selectedId: cid,
      messages: [],
      hasMore: false,
      loadingOlder: false,
      sending: false,
      error: null,
    });
    offMessages = deps.realtime.messages(
      cid,
      (message) => {
        if (!current(cid, token)) return;
        patch({ messages: merge(state.messages, [message]) });
        maybeRead();
        void refresh();
      },
      () => {
        if (current(cid, token)) void latest(cid, token);
      },
    );
    await latest(cid, token);
  }
  function clearSelection() {
    offMessages?.();
    offMessages = undefined;
    generation++;
    reading = false;
    historyLoaded = false;
    patch({
      selectedId: null,
      messages: [],
      hasMore: false,
      loading: false,
      loadingOlder: false,
      sending: false,
    });
  }
  async function start(peerId: string) {
    if (disposed) return;
    const request = ++startRequest;
    clearSelection();
    patch({ loading: true, error: null });
    try {
      const cid = await deps.api.start(deps.workspaceId, peerId);
      if (disposed || request !== startRequest) return;
      await refresh();
      if (disposed || request !== startRequest) return;
      await select(cid);
    } catch (error) {
      if (!disposed && request === startRequest) {
        failure(error);
        patch({ loading: false });
      }
    }
  }
  async function loadOlder() {
    const cid = state.selectedId,
      token = generation;
    if (
      !cid ||
      !state.hasMore ||
      state.loading ||
      state.loadingOlder ||
      !state.messages.length ||
      disposed
    )
      return;
    const before = state.messages[0].seq,
      request = historyRequest;
    patch({ loadingOlder: true });
    try {
      const page = await deps.api.history(cid, before);
      if (current(cid, token) && request === historyRequest)
        patch({
          messages: merge(page.messages, state.messages),
          hasMore: page.hasMore,
          loadingOlder: false,
        });
    } catch (error) {
      if (current(cid, token)) {
        failure(error);
        patch({ loadingOlder: false });
      }
    }
  }
  async function markRead(through: number) {
    const cid = state.selectedId,
      token = generation;
    if (!cid || disposed || through <= readThrough) return;
    requestedRead = Math.max(requestedRead, through);
    if (readWorker === token) return;
    readWorker = token;
    try {
      while (current(cid, token) && requestedRead > readThrough) {
        const target = requestedRead;
        await deps.api.read(cid, target);
        if (!current(cid, token)) return;
        readThrough = Math.max(readThrough, target);
      }
      if (current(cid, token)) void refresh();
    } catch (error) {
      if (current(cid, token)) failure(error);
    } finally {
      if (readWorker === token) readWorker = null;
    }
  }
  function maybeRead() {
    if (reading && historyReady && isForeground() && !state.loading && state.messages.length)
      void markRead(state.messages[state.messages.length - 1].seq);
  }
  async function send(body: string, type: ChatMessageType) {
    const cid = state.selectedId,
      token = generation;
    if (!cid || disposed || state.sending) return false;
    body = type === "text" ? body.trim() : body;
    if (!body || body.length > CHAT_MAX_LENGTH || (type === "sticker" && !findChatSticker(body)))
      return false;
    const key = JSON.stringify([cid, type, body]);
    let request = pending.get(key);
    if (!request) {
      request = { id: (deps.createId ?? (() => crypto.randomUUID()))() };
      pending.set(key, request);
    }
    patch({ sending: true, error: null });
    try {
      const message = await deps.api.send(cid, body, type, request.id);
      pending.delete(key);
      if (!current(cid, token)) return true;
      patch({ messages: merge(state.messages, [message]), sending: false });
      maybeRead();
      void refresh();
      return true;
    } catch (error) {
      if (!current(cid, token)) return false;
      const confirmed = state.messages.some(
        (m) => m.id === request.id && m.sender_id === deps.userId,
      );
      patch({ sending: false });
      if (confirmed) {
        pending.delete(key);
        return true;
      }
      failure(error);
      return false;
    }
  }
  function connect() {
    if (connected || disposed) return;
    connected = true;
    let wasOnline = false;
    offInbox = deps.realtime.inbox(
      deps.workspaceId,
      deps.userId,
      () => {
        void refresh();
      },
      (status) => {
        if (disposed) return;
        patch({ connection: status });
        if (status === "online") {
          void refresh();
          if (wasOnline && state.selectedId) void latest(state.selectedId, generation);
          wasOnline = true;
        }
      },
    );
    void refresh();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    offInbox?.();
    offMessages?.();
    listeners.clear();
    alerted.clear();
    pending.clear();
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect,
    dispose,
    refresh,
    start,
    select,
    send,
    loadOlder,
    markRead,
    async retry() {
      patch({ error: null });
      connect();
      await refresh();
      if (state.selectedId && !disposed) await latest(state.selectedId, generation);
    },
    clearSelection() {
      startRequest++;
      clearSelection();
    },
    setReading(on: boolean) {
      reading = on;
      if (on) maybeRead();
    },
    clearError() {
      patch({ error: null });
    },
  };
}
