import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { isMessageRemoved } from "@/lib/chat/message-state";
import { MessageReactionBar } from "./MessageReactionBar";
import type { ChatConversation, ChatMessage } from "@/lib/chat/types";
import type { ChatState, ChatStore } from "@/lib/chat/store";
import {
  MessageRemovalDialog,
  ForwardMessagesDialog,
  MessageInfoDialog,
} from "./ChatMessageDialogs";
type DialogName = "forward" | "cancel" | "delete" | "info" | null;
export function MessageActions({
  message,
  conversation,
  userId,
  state,
  store,
  host,
  onReply,
  onOverlayChange,
}: {
  message: ChatMessage;
  conversation: ChatConversation;
  userId: string;
  state: ChatState;
  store: ChatStore;
  host: Element;
  onReply: (id: string) => void;
  onOverlayChange: (id: string, open: boolean) => void;
}) {
  const [menu, setMenu] = useState(false),
    [dialog, setDialog] = useState<DialogName>(null),
    [reactionOpen, setReactionOpen] = useState(false),
    [copyError, setCopyError] = useState("");
  const own = message.sender_id === userId,
    busy = state.actionsPending?.includes(message.id) ?? false,
    active = menu || !!dialog || reactionOpen;
  const removed = isMessageRemoved(message);
  useEffect(() => {
    if (removed) {
      setReactionOpen(false);
      setMenu(false);
      if (dialog !== "info") setDialog(null);
    }
  }, [removed, dialog]);
  useEffect(() => {
    onOverlayChange(message.id, active);
    return () => onOverlayChange(message.id, false);
  }, [message.id, active, onOverlayChange]);
  function open(name: DialogName) {
    onOverlayChange(message.id, true);
    store.clearError();
    setDialog(name);
    setMenu(false);
    setReactionOpen(false);
  }
  if (removed && !own) return null;
  const itemClass =
    "cursor-pointer rounded px-3 py-2 text-sm outline-none focus:bg-muted data-[disabled]:opacity-50";
  return (
    <>
      <Menu.Root
        modal={false}
        open={menu}
        onOpenChange={(value) => {
          if (value) onOverlayChange(message.id, true);
          setMenu(value);
        }}
      >
        <Menu.Trigger asChild>
          <button
            type="button"
            aria-label={`Opções da mensagem ${message.seq}`}
            disabled={busy}
            className="absolute right-1 top-1 rounded bg-background/85 p-0.5 text-foreground opacity-100 shadow-sm transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </Menu.Trigger>
        <Menu.Portal container={host}>
          <Menu.Content
            onCloseAutoFocus={(event) => {
              if (reactionOpen) event.preventDefault();
            }}
            sideOffset={4}
            align="end"
            className="z-[380] min-w-40 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                setMenu(false);
              }
            }}
          >
            {!removed && (
              <>
                {state.interactions && (
                  <>
                    <Menu.Item
                      className={itemClass}
                      onSelect={() => {
                        store.clearError();
                        onOverlayChange(message.id, true);
                        setMenu(false);
                        setReactionOpen(true);
                      }}
                    >
                      Reagir
                    </Menu.Item>
                    <Menu.Item
                      className={itemClass}
                      onSelect={() => {
                        setMenu(false);
                        onReply(message.id);
                      }}
                    >
                      Responder
                    </Menu.Item>
                    <Menu.Item className={itemClass} onSelect={() => open("forward")}>
                      Encaminhar
                    </Menu.Item>
                  </>
                )}
                {message.message_type === "text" && (
                  <Menu.Item
                    className={itemClass}
                    onSelect={() => {
                      setCopyError("");
                      void (async () => {
                        try {
                          if (!navigator.clipboard?.writeText) throw new Error();
                          await navigator.clipboard.writeText(message.body ?? "");
                        } catch {
                          setCopyError(
                            "Não foi possível copiar. Selecione o texto e tente novamente.",
                          );
                        }
                      })();
                    }}
                  >
                    Copiar
                  </Menu.Item>
                )}
              </>
            )}
            {own && (
              <Menu.Item className={itemClass} onSelect={() => open("info")}>
                Informações
              </Menu.Item>
            )}
            {own &&
              state.interactions &&
              !removed &&
              (conversation.peer_read_seq ?? 0) < message.seq && (
                <Menu.Item
                  className={`${itemClass} text-destructive`}
                  onSelect={() => open("cancel")}
                >
                  Cancelar envio
                </Menu.Item>
              )}
            {own &&
              state.interactions &&
              !removed &&
              (conversation.peer_read_seq ?? 0) >= message.seq && (
                <Menu.Item
                  className={`${itemClass} text-destructive`}
                  onSelect={() => open("delete")}
                >
                  Apagar mensagem
                </Menu.Item>
              )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {copyError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {copyError}
        </p>
      )}
      {state.interactions && !removed && (
        <MessageReactionBar
          open={reactionOpen}
          onOpenChange={(value) => {
            if (value) {
              store.clearError();
              onOverlayChange(message.id, true);
            }
            setReactionOpen(value);
          }}
          seq={message.seq}
          own={own}
          host={host}
          busy={busy}
          onReact={(emoji) => {
            void store.react(message.id, emoji);
          }}
        />
      )}
      {dialog === "info" && (
        <MessageInfoDialog
          message={message}
          conversation={conversation}
          host={host}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog === "cancel" || dialog === "delete") && (
        <MessageRemovalDialog
          operation={dialog}
          message={message}
          state={state}
          store={store}
          host={host}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "forward" && (
        <ForwardMessagesDialog
          message={message}
          state={state}
          store={store}
          host={host}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
