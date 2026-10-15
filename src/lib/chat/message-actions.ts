import { ChatActionError } from "./api";
import type { ChatApi, ChatMessage, ChatReaction } from "./types";
import type { ChatState } from "./store";
type Scope = { cid: string; token: number };
type Deps = {
  api: ChatApi;
  userId: string;
  workspaceId: string;
  createId: () => string;
  getState: () => ChatState;
  scope: () => Scope | null;
  current: (scope: Scope) => boolean;
  disposed: () => boolean;
  patch: (state: Partial<ChatState>) => void;
  failure: (e: unknown) => void;
  refresh: () => Promise<void>;
  message: (message: ChatMessage) => void;
  reaction: (reaction: ChatReaction) => void;
};
/** Mutations share the existing store, actor and selected-conversation lifecycle. */
export function createMessageActions(d: Deps) {
  const pending = new Set<string>();
  const forwards = new Map<string, { id: string; confirmed: boolean }>();
  function start(id: string): Scope | null {
    const scope = d.scope();
    if (!scope || !d.getState().interactions || pending.has(id)) return null;
    const row = d.getState().messages.find((m) => m.id === id);
    if (!row || row.cancelled_at) return null;
    pending.add(id);
    d.patch({ actionsPending: [...pending], error: null });
    return scope;
  }
  function finish(id: string, scope: Scope) {
    pending.delete(id);
    if (d.current(scope)) d.patch({ actionsPending: [...pending] });
  }
  async function react(id: string, emoji: string) {
    if (!d.api.react) return false;
    const scope = start(id);
    if (!scope) return false;
    try {
      const active = d
        .getState()
        .reactions?.find((r) => r.message_id === id && r.user_id === d.userId)?.emoji;
      const row = await d.api.react(scope.cid, id, active === emoji ? null : emoji);
      if (d.current(scope)) d.reaction(row);
      return true;
    } catch (error) {
      if (d.current(scope)) d.failure(error);
      return false;
    } finally {
      finish(id, scope);
    }
  }
  async function cancel(id: string) {
    if (!d.api.cancel) return false;
    const scope = start(id);
    if (!scope) return false;
    try {
      if (d.getState().messages.find((m) => m.id === id)?.sender_id !== d.userId)
        throw new ChatActionError("Você não pode cancelar esta mensagem.");
      const row = await d.api.cancel(scope.cid, id);
      if (d.current(scope)) d.message(row);
      if (!d.disposed()) void d.refresh();
      return true;
    } catch (error) {
      if (d.current(scope)) d.failure(error);
      return false;
    } finally {
      finish(id, scope);
    }
  }
  async function loadContacts() {
    const scope = d.scope();
    if (!scope || !d.getState().interactions || !d.api.contacts || d.getState().contactsLoading)
      return;
    d.patch({ contactsLoading: true });
    try {
      const rows = await d.api.contacts(d.workspaceId);
      if (d.current(scope)) d.patch({ contacts: rows });
    } catch (error) {
      if (d.current(scope)) d.failure(error);
    } finally {
      if (d.current(scope)) d.patch({ contactsLoading: false });
    }
  }
  async function forward(
    id: string,
    peers: string[],
    operation: string,
  ): Promise<{ sent: number; failed: string[] }> {
    const targets = [...new Set(peers)];
    if (!d.api.forward) return { sent: 0, failed: targets };
    const scope = start(id);
    if (!scope) return { sent: 0, failed: targets };
    let sent = 0;
    const failed: string[] = [];
    try {
      for (const peer of targets) {
        if (!d.current(scope)) {
          failed.push(peer);
          continue;
        }
        const key = JSON.stringify([operation, scope.cid, id, peer]);
        let request = forwards.get(key);
        if (!request) {
          request = { id: d.createId(), confirmed: false };
          forwards.set(key, request);
        }
        if (request.confirmed) {
          sent++;
          continue;
        }
        try {
          const row = await d.api.forward(scope.cid, id, peer, request.id);
          request.confirmed = true;
          sent++;
          if (d.current(scope) && row.conversation_id === scope.cid) d.message(row);
        } catch (error) {
          failed.push(peer);
          if (d.current(scope)) d.failure(error);
        }
      }
      if (!d.disposed()) void d.refresh();
      return { sent, failed };
    } finally {
      finish(id, scope);
    }
  }
  return {
    react,
    cancel,
    forward,
    loadContacts,
    discardForward(operation: string) {
      for (const key of forwards.keys())
        if ((JSON.parse(key) as string[])[0] === operation) forwards.delete(key);
    },
    disposeActions() {
      pending.clear();
      forwards.clear();
    },
  };
}
