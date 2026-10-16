import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getNotificationService } from "@/lib/notifications/notification-service";
import { createChatApi } from "@/lib/chat/api";
import { createChatRealtime } from "@/lib/chat/realtime";
import { createChatStore, type ChatState, type ChatStore } from "@/lib/chat/store";
import { createChatNotifier } from "@/lib/chat/notifications";
import type { ChatApi, ChatRealtime } from "@/lib/chat/types";
import type { OfficePanel } from "@/lib/office/overlay";
import { ChatPanel } from "./ChatPanel";
import { createChatExtrasApi, type ChatExtrasApi } from "@/lib/chat/extras";
import { ChatExtrasApiContext } from "./chat-extras";

type Actions = {
  openPeer: (userId: string) => void;
  openInbox: () => void;
  unread: number;
  available: boolean;
};
const Context = createContext<Actions | null>(null);
export const useOfficeChat = () => useContext(Context);
const apiDefault = createChatApi(supabase),
  realtimeDefault = createChatRealtime(supabase),
  extrasDefault = createChatExtrasApi(supabase);
const EMPTY: ChatState = {
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
};
const foreground = () =>
  typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();

/** Mounted beside the persistent Office: panel changes never recreate its session. */
export function OfficeChat({
  workspaceId,
  userId,
  panel,
  onPanelChange,
  children,
  api = apiDefault,
  realtime = realtimeDefault,
  extras,
}: {
  workspaceId: string;
  userId: string;
  panel: OfficePanel | null;
  onPanelChange: (panel: OfficePanel | null) => void;
  children: ReactNode;
  api?: ChatApi;
  realtime?: ChatRealtime;
  extras?: ChatExtrasApi | null;
}) {
  // Injected fake APIs (tests) get no implicit network-backed pins/favorites.
  const extrasApi = extras !== undefined ? extras : api === apiDefault ? extrasDefault : null;
  const panelChange = useRef(onPanelChange);
  panelChange.current = onPanelChange;
  const [session, setSession] = useState<{
    workspaceId: string;
    userId: string;
    store: ChatStore;
  } | null>(null);
  const store =
    session?.workspaceId === workspaceId && session.userId === userId ? session.store : null;
  useEffect(() => {
    let next: ChatStore;
    const notifier = createChatNotifier({
      service: getNotificationService,
      isForeground: foreground,
      open: (id) => {
        panelChange.current("chat");
        void next.select(id);
      },
      present: (peerName, open, id) => {
        const toastId = `chat-${workspaceId}-${id}`;
        toast(`${peerName} enviou uma mensagem`, {
          id: toastId,
          description: "Nova mensagem privada.",
          action: { label: "Abrir conversa", onClick: open },
        });
        return () => toast.dismiss(toastId);
      },
    });
    next = createChatStore({
      workspaceId,
      userId,
      api,
      realtime,
      isForeground: foreground,
      onIncoming: notifier.receive,
    });
    setSession({ workspaceId, userId, store: next });
    next.connect();
    const resume = () => {
      if (foreground())
        void next.refresh().then(() =>
          notifier.flush(
            new Set(
              next
                .getSnapshot()
                .conversations.filter((c) => c.unread_count > 0)
                .map((c) => c.id),
            ),
          ),
        );
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      notifier.dispose();
      next.dispose();
    };
  }, [workspaceId, userId, api, realtime]);
  const subscribe = useCallback((fn: () => void) => store?.subscribe(fn) ?? (() => {}), [store]);
  const snapshot = useCallback(() => store?.getSnapshot() ?? EMPTY, [store]);
  const state = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const actions = useMemo<Actions>(
    () => ({
      openInbox: () => panelChange.current("chat"),
      openPeer: (peerId) => {
        panelChange.current("chat");
        void store?.start(peerId);
      },
      unread: state.conversations.reduce((total, c) => total + c.unread_count, 0),
      available: state.available,
    }),
    [store, state.conversations, state.available],
  );
  useEffect(() => {
    if (panel !== "chat") store?.setReading(false);
  }, [panel, store]);
  return (
    <Context.Provider value={actions}>
      {children}
      {panel === "chat" && (
        <ChatExtrasApiContext.Provider value={extrasApi}>
        <ChatPanel
          state={state}
          store={store}
          userId={userId}
          onClose={() => {
            store?.setReading(false);
            panelChange.current(null);
          }}
        />
        </ChatExtrasApiContext.Provider>
      )}
    </Context.Provider>
  );
}

export function OfficeChatButton() {
  const chat = useOfficeChat();
  if (!chat) return null;
  return (
    <button
      type="button"
      aria-label={chat.unread ? `Abrir mensagens (${chat.unread} não lidas)` : "Abrir mensagens"}
      title="Mensagens privadas"
      onClick={chat.openInbox}
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <MessageCircle className="h-4 w-4" />
      {chat.unread > 0 && (
        <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[9px] leading-4 text-primary-foreground">
          {chat.unread > 99 ? "99+" : chat.unread}
        </span>
      )}
    </button>
  );
}
