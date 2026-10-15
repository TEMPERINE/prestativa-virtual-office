import { ChatUnavailableError, ChatActionError } from "./api";
import {
  CHAT_MAX_LENGTH,
  type ChatApi,
  type ChatConversation,
  type ChatMessage,
  type ChatMessageType,
  type ChatRealtime,
  type ChatStatus,
  type ChatReaction,
  type ChatContact,
  type IncomingChat,
} from "./types";
import { findChatSticker } from "./stickers";
import { mergeChatMessages, mergeChatReactions } from "./message-state";
import { createDeliveryQueue } from "./delivery-queue";
import { createMessageActions } from "./message-actions";

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
  interactions?: boolean;
  reactions?: ChatReaction[];
  replyMessages?: ChatMessage[];
  contacts?: ChatContact[];
  contactsLoading?: boolean;
  actionsPending?: string[];
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
const merge = mergeChatMessages;
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
  interactions: false,
  reactions: [],
  replyMessages: [],
  contacts: [],
  contactsLoading: false,
  actionsPending: [],
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
  // Keep conversation-keyed cancellation metadata for this workspace-store's
  // lifetime. Background delivery can outlive a selection change. No plaintext
  // or persistence: an old page/lookup must never resurrect a known cancellation.
  const cancelledMessages = new Map<string, string>();
  const cancellationKey = (row: ChatMessage) => JSON.stringify([row.conversation_id, row.id]);
  const listeners = new Set<() => void>();
  const alerted = new Map<string, number>();
  const isForeground =
    deps.isForeground ??
    (() =>
      typeof document === "undefined" ||
      (document.visibilityState === "visible" && document.hasFocus()));
  const patch = (next: Partial<ChatState>) => {
    if (!disposed) {
      const cid = next.selectedId !== undefined ? next.selectedId : state.selectedId;
      for (const row of [...(next.messages ?? []), ...(next.replyMessages ?? [])])
        if (row.conversation_id === cid && row.cancelled_at)
          cancelledMessages.set(cancellationKey(row), row.cancelled_at);
      const redact = (rows: ChatMessage[]) =>
        rows.map((row) => {
          const at =
            row.conversation_id === cid ? cancelledMessages.get(cancellationKey(row)) : undefined;
          return at ? { ...row, body: null, cancelled_at: at } : row;
        });
      // Normalize before notifying subscribers: no transient plaintext snapshot.
      if (next.messages) next = { ...next, messages: redact(next.messages) };
      if (next.replyMessages) next = { ...next, replyMessages: redact(next.replyMessages) };
      state = { ...state, ...next };
      listeners.forEach((fn) => fn());
    }
  };
  const failure = (error: unknown) =>
    patch({
      error:
        error instanceof ChatUnavailableError || error instanceof ChatActionError
          ? error.message
          : "Não foi possível atualizar o chat. Tente novamente.",
      ...(error instanceof ChatUnavailableError ? { available: false } : {}),
    });
  const current = (cid: string, token: number) =>
    !disposed && state.selectedId === cid && generation === token;

  let contextWorker: { token: number; again: boolean } | null = null;
  const createId = deps.createId ?? (() => crypto.randomUUID());
  function applyMessages(rows: ChatMessage[]) {
    const cid = state.selectedId;
    if (!cid) return;
    const scoped = rows.filter((m) => m.conversation_id === cid);
    for (const row of scoped)
      if (row.cancelled_at) cancelledMessages.set(cancellationKey(row), row.cancelled_at);
    const first = state.messages[0]?.seq ?? 0;
    const display = scoped.filter(
      (m) => !first || m.seq >= first || state.messages.some((old) => old.id === m.id),
    );
    const related = scoped.filter(
      (m) =>
        state.replyMessages?.some((old) => old.id === m.id) ||
        state.messages.some((reply) => reply.reply_to_message_id === m.id),
    );
    const merged = merge(state.messages, display);
    const context = merge(state.replyMessages ?? [], related);
    const tombstones = new Map(
      [...merged, ...context].filter((m) => m.cancelled_at).map((m) => [m.id, m]),
    );
    const messages = merged.map((m) => tombstones.get(m.id) ?? m);
    const replyMessages = context.map((m) => tombstones.get(m.id) ?? m);
    const cancelled = new Set(tombstones.keys());
    for (const [key, request] of pending) if (cancelled.has(request.id)) pending.delete(key);
    patch({
      messages,
      replyMessages,
      reactions: (state.reactions ?? []).filter((r) => !cancelled.has(r.message_id)),
    });
  }
  function applyReaction(row: ChatReaction) {
    if (
      row.conversation_id !== state.selectedId ||
      !state.messages.some((m) => m.id === row.message_id && !m.cancelled_at)
    )
      return;
    patch({ reactions: mergeChatReactions(state.reactions ?? [], [row]) });
  }
  function hydrateContext() {
    const cid = state.selectedId,
      token = generation;
    if (!cid || !state.interactions || !deps.api.lookup || !deps.api.reactions) return;
    if (contextWorker?.token === token) {
      contextWorker.again = true;
      return;
    }
    const job = { token, again: false };
    contextWorker = job;
    void (async () => {
      try {
        do {
          job.again = false;
          const loaded = state.messages;
          const ids = [
            ...new Set(
              loaded
                .map((m) => m.reply_to_message_id)
                .filter((id): id is string => !!id && !loaded.some((m) => m.id === id)),
            ),
          ];
          const [related, reactions] = await Promise.all([
            deps.api.lookup!(cid, ids),
            deps.api.reactions!(
              cid,
              loaded.map((m) => m.id),
            ),
          ]);
          if (!current(cid, token)) return;
          const safe = related.filter((m) => m.conversation_id === cid && ids.includes(m.id));
          patch({ replyMessages: merge(state.replyMessages ?? [], safe) });
          applyMessages([]);
          for (const row of reactions) applyReaction(row);
        } while (job.again && current(cid, token));
      } catch (error) {
        if (current(cid, token)) failure(error);
      } finally {
        if (contextWorker === job) contextWorker = null;
      }
    })();
  }
  const delivery = createDeliveryQueue({
    page: (cid, after) => deps.api.undelivered!(cid, after),
    acknowledge: async (cid, through) => {
      await deps.api.delivered!(cid, through);
      if (!disposed) void refresh();
    },
    received: (cid, rows) => {
      if (!disposed && state.selectedId === cid) {
        applyMessages(rows);
        hydrateContext();
        maybeRead();
      }
    },
    error: failure,
  });
  const actions = createMessageActions({
    api: deps.api,
    userId: deps.userId,
    workspaceId: deps.workspaceId,
    createId,
    getState: () => state,
    scope: () => (state.selectedId ? { cid: state.selectedId, token: generation } : null),
    current: (scope) => current(scope.cid, scope.token),
    disposed: () => disposed,
    patch,
    failure,
    refresh,
    message: (message) => applyMessages([message]),
    reaction: applyReaction,
  });

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
          patch({
            conversations: rows,
            loadingList: false,
            available: true,
            interactions: deps.api.supportsInteractions?.() ?? false,
          });
          if (state.interactions && deps.api.undelivered && deps.api.delivered)
            for (const row of rows)
              delivery.enqueue(row.id, row.own_delivered_seq ?? row.read_seq, row.last_message_seq);
          if (state.selectedId && !rows.some((c) => c.id === state.selectedId)) {
            offMessages?.();
            offMessages = undefined;
            generation++;
            patch({
              selectedId: null,
              messages: [],
              hasMore: false,
              loading: false,
              reactions: [],
              replyMessages: [],
              actionsPending: [],
              contactsLoading: false,
            });
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
      while (
        through !== undefined &&
        recovered.length &&
        recovered[0].seq > (state.interactions ? saved[0].seq : through + 1)
      ) {
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
      applyMessages([]);
      hydrateContext();
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
      reactions: [],
      replyMessages: [],
      actionsPending: [],
      contactsLoading: false,
    });
    offMessages = deps.realtime.messages(
      cid,
      (message) => {
        if (!current(cid, token)) return;
        applyMessages([message]);
        hydrateContext();
        maybeRead();
        void refresh();
      },
      () => {
        if (current(cid, token)) void latest(cid, token);
      },
      state.interactions
        ? (row) => {
            if (current(cid, token)) applyReaction(row);
          }
        : undefined,
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
      reactions: [],
      replyMessages: [],
      actionsPending: [],
      contactsLoading: false,
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
      if (current(cid, token) && request === historyRequest) {
        // Prepending is intentional here; applyMessages normally ignores unloaded old updates.
        patch({
          messages: merge(page.messages, state.messages),
          hasMore: page.hasMore,
          loadingOlder: false,
        });
        applyMessages([]);
        hydrateContext();
      }
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
  async function send(body: string, type: ChatMessageType, replyTo?: string | null) {
    const cid = state.selectedId,
      token = generation;
    if (!cid || disposed || state.sending) return false;
    body = type === "text" ? body.trim() : body;
    if (!body || body.length > CHAT_MAX_LENGTH || (type === "sticker" && !findChatSticker(body)))
      return false;
    if (
      replyTo &&
      (!state.interactions ||
        ![...state.messages, ...(state.replyMessages ?? [])].some(
          (m) => m.id === replyTo && !m.cancelled_at,
        ))
    )
      return false;
    const key = JSON.stringify([cid, type, body, replyTo ?? null]);
    let request = pending.get(key);
    if (!request) {
      request = { id: createId() };
      pending.set(key, request);
    }
    patch({ sending: true, error: null });
    try {
      const message = replyTo
        ? await deps.api.send(cid, body, type, request.id, replyTo)
        : await deps.api.send(cid, body, type, request.id);
      pending.delete(key);
      if (!current(cid, token)) return true;
      applyMessages([message]);
      patch({ sending: false });
      hydrateContext();
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
    cancelledMessages.clear();
    delivery.dispose();
    actions.disposeActions();
  }
  return {
    ...actions,
    async revealMessage(id: string) {
      const cid = state.selectedId,
        token = generation;
      if (!cid) return false;
      if (state.messages.some((m) => m.id === id)) return true;
      if (!deps.api.lookup) return false;
      try {
        const rows = await deps.api.lookup(cid, [id]);
        if (!current(cid, token)) return false;
        const target = rows.find((m) => m.id === id && m.conversation_id === cid);
        if (!target) return false;
        patch({ replyMessages: merge(state.replyMessages ?? [], [target]) });
        while (current(cid, token) && state.hasMore && !state.messages.some((m) => m.id === id)) {
          const first = state.messages[0]?.seq;
          await loadOlder();
          if (state.messages[0]?.seq === first) break;
        }
        return current(cid, token) && state.messages.some((m) => m.id === id);
      } catch (error) {
        if (current(cid, token)) failure(error);
        return false;
      }
    },
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
