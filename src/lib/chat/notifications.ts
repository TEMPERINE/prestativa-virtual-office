import type { OfficeNotificationService } from "@/lib/notifications/notification-service";
import type { IncomingChat } from "./types";

type Deps = {
  service: () => OfficeNotificationService | null;
  isForeground: () => boolean;
  present: (peerName: string, open: () => void, conversationId: string) => void | (() => void);
  open: (conversationId: string) => void;
};
/** In-app presenter + optional OfficeNotificationService capability, no new adapter. */
export function createChatNotifier(deps: Deps) {
  let closed = false;
  const seen = new Map<string, number>(),
    pending = new Map<string, IncomingChat>();
  const dismiss = new Map<string, () => void>();
  const open = (id: string) => {
    if (!closed) deps.open(id);
  };
  function show(event: IncomingChat) {
    const cleanup = deps.present(
      event.peerName,
      () => open(event.conversationId),
      event.conversationId,
    );
    if (cleanup) dismiss.set(event.conversationId, cleanup);
  }
  return {
    receive(event: IncomingChat) {
      if (closed || event.lastSeq <= (seen.get(event.conversationId) ?? 0)) return;
      seen.set(event.conversationId, event.lastSeq);
      if (seen.size > 100) seen.delete(seen.keys().next().value!);
      if (deps.isForeground()) show(event);
      else {
        pending.set(event.conversationId, event);
        if (pending.size > 100) pending.delete(pending.keys().next().value!);
        // No fallback to notify(): the installed Electron join bridge does not
        // yet support chat routing. Existing Web/Desktop behavior stays intact.
        const service = deps.service();
        try {
          if (service?.notifyChat && service.isOptedIn() && service.getPermission() === "granted") {
            service.notifyChat({
              title: "Prestativa Office",
              body: `${event.peerName} enviou uma mensagem privada.`,
              tag: `chat-${event.conversationId}`,
              onClick: () => {
                if (!closed) {
                  service.focusApp();
                  open(event.conversationId);
                }
              },
            });
          }
        } catch {
          /* Future native delivery must not interrupt the persistent inbox. */
        }
      }
    },
    flush(unreadIds?: ReadonlySet<string>) {
      if (closed || !deps.isForeground()) return;
      for (const event of pending.values())
        if (!unreadIds || unreadIds.has(event.conversationId)) show(event);
      pending.clear();
    },
    dispose() {
      closed = true;
      pending.clear();
      seen.clear();
      dismiss.forEach((fn) => fn());
      dismiss.clear();
    },
  };
}
