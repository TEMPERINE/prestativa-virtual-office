import { useEffect, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  ChevronDown,
  Copy,
  Forward,
  Info,
  Pin,
  Reply,
  SmilePlus,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
import { isMessageRemoved } from "@/lib/chat/message-state";
import { MessageReactionBar } from "./MessageReactionBar";
import { useThreadExtras } from "./chat-extras";
import { PinOff, StarOff } from "lucide-react";
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
  const menuContentRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const reactionContentRef = useRef<HTMLDivElement>(null);
  const own = message.sender_id === userId,
    busy = state.actionsPending?.includes(message.id) ?? false,
    active = menu || !!dialog || reactionOpen;
  const removed = isMessageRemoved(message);
  const extras = useThreadExtras();
  const pinned = extras?.pin?.message_id === message.id;
  const favorite = extras?.favorites.has(message.id) ?? false;
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
    "flex h-9 cursor-pointer select-none items-center gap-3 px-4 text-[14px] leading-none outline-none focus:bg-muted data-[highlighted]:bg-muted data-[disabled]:cursor-default data-[disabled]:opacity-45";
  const icon = "h-[18px] w-[18px] shrink-0 opacity-70";
  const unread = (conversation.peer_read_seq ?? 0) < message.seq;
  return (
    <>
      <Menu.Root
        modal={false}
        open={menu}
        onOpenChange={(value) => {
          if (value) {
            onOverlayChange(message.id, true);
            store.clearError();
          }
          setMenu(value);
          // WhatsApp pattern: quick reactions open glued above the same bubble.
          if (state.interactions && !removed) setReactionOpen(value);
        }}
      >
        <Menu.Trigger asChild>
          <button
            ref={menuTriggerRef}
            type="button"
            aria-label={`Opções da mensagem ${message.seq}`}
            disabled={busy}
            className="absolute right-1 top-1 rounded bg-background/85 p-0.5 text-foreground opacity-100 shadow-sm transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 data-[state=open]:opacity-100"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </Menu.Trigger>
        <Menu.Portal container={host}>
          <Menu.Content
            ref={menuContentRef}
            onPointerDownOutside={(event) => {
              // The reaction portal belongs to this menu's interactive group.
              const original = event.detail.originalEvent;
              const content = reactionContentRef.current;
              if (content && (original.composedPath().includes(content) ||
                (original.target instanceof Node && content.contains(original.target)))) {
                event.preventDefault();
              }
            }}
            onCloseAutoFocus={(event) => {
              if (reactionOpen) event.preventDefault();
            }}
            sideOffset={2}
            align={own ? "end" : "start"}
            collisionPadding={8}
            className="z-[380] min-w-[188px] overflow-hidden rounded-lg border border-border/50 bg-popover py-1.5 text-popover-foreground shadow-[0_2px_10px_hsl(0_0%_0%/0.18)]"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                setMenu(false);
              }
            }}
          >
            {!removed && state.interactions && (
              <Menu.Item
                className={itemClass}
                onSelect={() => {
                  setMenu(false);
                  setReactionOpen(false);
                  onReply(message.id);
                }}
              >
                <Reply className={icon} />
                Responder
              </Menu.Item>
            )}
            {!removed && message.message_type === "text" && (
              <Menu.Item
                className={itemClass}
                onSelect={() => {
                  setReactionOpen(false);
                  setCopyError("");
                  void (async () => {
                    try {
                      if (!navigator.clipboard?.writeText) throw new Error();
                      await navigator.clipboard.writeText(message.body ?? "");
                    } catch {
                      setCopyError("Não foi possível copiar. Selecione o texto e tente novamente.");
                    }
                  })();
                }}
              >
                <Copy className={icon} />
                Copiar
              </Menu.Item>
            )}
            {!removed && state.interactions && (
              <>
                <Menu.Item
                  className={itemClass}
                  onSelect={(event) => {
                    // Close the menu ourselves without Radix closing the retained bar.
                    event.preventDefault();
                    store.clearError();
                    onOverlayChange(message.id, true);
                    setMenu(false);
                    setReactionOpen(true);
                  }}
                >
                  <SmilePlus className={icon} />
                  Reagir
                </Menu.Item>
                <Menu.Item className={itemClass} onSelect={() => open("forward")}>
                  <Forward className={icon} />
                  Encaminhar
                </Menu.Item>
                {extras && (
                  <>
                    <Menu.Item
                      className={itemClass}
                      onSelect={() => {
                        setReactionOpen(false);
                        void extras.togglePin(message);
                      }}
                    >
                      {pinned ? <PinOff className={icon} /> : <Pin className={icon} />}
                      {pinned ? "Desafixar" : "Fixar"}
                    </Menu.Item>
                    <Menu.Item
                      className={itemClass}
                      onSelect={() => {
                        setReactionOpen(false);
                        void extras.toggleFavorite(message);
                      }}
                    >
                      {favorite ? <StarOff className={icon} /> : <Star className={icon} />}
                      {favorite ? "Remover dos favoritos" : "Favoritar"}
                    </Menu.Item>
                  </>
                )}
              </>
            )}
            {own && state.interactions && !removed && unread && (
              <Menu.Item className={itemClass} onSelect={() => open("cancel")}>
                <Undo2 className={icon} />
                Cancelar envio
              </Menu.Item>
            )}
            {own && state.interactions && !removed && !unread && (
              <Menu.Item className={itemClass} onSelect={() => open("delete")}>
                <Trash2 className={icon} />
                Apagar mensagem
              </Menu.Item>
            )}
            {own && (
              <Menu.Item className={itemClass} onSelect={() => open("info")}>
                <Info className={icon} />
                Informações
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
          menuContentRef={menuContentRef}
          menuTriggerRef={menuTriggerRef}
          sharedContentRef={reactionContentRef}
          open={reactionOpen}
          onOpenChange={(value) => {
            if (value) {
              store.clearError();
              onOverlayChange(message.id, true);
            }
            setReactionOpen(value);
            if (!value) setMenu(false);
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
