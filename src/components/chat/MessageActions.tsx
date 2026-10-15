import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatConversation, ChatMessage } from "@/lib/chat/types";
import type { ChatState, ChatStore } from "@/lib/chat/store";
import {
  ChatDialog,
  CancelMessageDialog,
  ForwardMessagesDialog,
  MessageInfoDialog,
} from "./ChatMessageDialogs";
const QUICK = ["❤️", "👍", "😂", "😮", "😢", "🙏"];
type DialogName = "reaction" | "forward" | "cancel" | "info" | null;
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
    [allEmoji, setAllEmoji] = useState(false),
    [copyError, setCopyError] = useState("");
  const own = message.sender_id === userId,
    busy = state.actionsPending?.includes(message.id) ?? false,
    active = menu || !!dialog;
  useEffect(() => {
    if (message.cancelled_at) {
      setMenu(false);
      if (dialog !== "info") setDialog(null);
    }
  }, [message.cancelled_at, dialog]);
  useEffect(() => {
    onOverlayChange(message.id, active);
    return () => onOverlayChange(message.id, false);
  }, [message.id, active, onOverlayChange]);
  function open(name: DialogName) {
    onOverlayChange(message.id, true);
    store.clearError();
    setDialog(name);
    setMenu(false);
    setAllEmoji(false);
  }
  if (message.cancelled_at && !own) return null;
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
            {!message.cancelled_at && (
              <>
                {state.interactions && (
                  <>
                    <Menu.Item className={itemClass} onSelect={() => open("reaction")}>
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
              !message.cancelled_at &&
              (conversation.peer_read_seq ?? 0) < message.seq && (
                <Menu.Item
                  className={`${itemClass} text-destructive`}
                  onSelect={() => open("cancel")}
                >
                  Cancelar envio
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
      {dialog === "reaction" && !message.cancelled_at && (
        <ChatDialog
          title="Reagir à mensagem"
          host={host}
          onClose={() => setDialog(null)}
          busy={busy}
        >
          <div className="flex flex-wrap gap-1">
            {QUICK.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Reagir com ${emoji}`}
                disabled={busy}
                className="rounded-lg p-2 text-2xl hover:bg-muted disabled:opacity-50"
                onClick={async () => {
                  if (await store.react(message.id, emoji)) setDialog(null);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          {!allEmoji ? (
            <Button variant="ghost" className="mt-2" onClick={() => setAllEmoji(true)}>
              Mais emojis
            </Button>
          ) : (
            <div className="mt-2 overflow-hidden">
              <EmojiPicker
                emojiStyle={EmojiStyle.NATIVE}
                theme={Theme.LIGHT}
                width="100%"
                height={360}
                previewConfig={{ showPreview: false }}
                searchPlaceholder="Buscar emoji..."
                onEmojiClick={async (value) => {
                  if (await store.react(message.id, value.emoji)) setDialog(null);
                }}
              />
            </div>
          )}
          {state.error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {state.error}
            </p>
          )}
        </ChatDialog>
      )}
      {dialog === "info" && (
        <MessageInfoDialog
          message={message}
          conversation={conversation}
          host={host}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "cancel" && (
        <CancelMessageDialog
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
