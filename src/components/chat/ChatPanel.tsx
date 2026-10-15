import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SpriteAvatar } from "@/components/profile/SpriteAvatar";
import type { ChatState, ChatStore } from "@/lib/chat/store";
import { ChatThread } from "./ChatThread";
import { findChatSticker } from "@/lib/chat/stickers";
import { useChatPanelPosition } from "./use-chat-panel-position";

export function ChatPanel({
  state,
  store,
  userId,
  onClose,
}: {
  state: ChatState;
  store: ChatStore | null;
  userId: string;
  onClose: () => void;
}) {
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => {
    const update = () => setHost(document.fullscreenElement ?? document.body);
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const position = useChatPanelPosition(host);
  const selected = state.conversations.find((c) => c.id === state.selectedId);
  if (!host) return null;
  return createPortal(
    <section
      ref={position.panelRef}
      style={position.style}
      role="dialog"
      aria-modal="false"
      aria-label="Mensagens privadas"
      data-office-chat-panel
      className="fixed right-3 top-14 bottom-4 z-[300] flex w-[min(760px,calc(100vw-24px))] max-h-[850px] flex-col overflow-hidden rounded-2xl border bg-background text-foreground shadow-2xl"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header
        ref={position.headerRef}
        style={position.headerStyle}
        {...position.headerEvents}
        className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-4 py-3"
      >
        <MessageCircle className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Mensagens</h2>
        {state.connection === "offline" && (
          <span className="text-[10px] text-muted-foreground">Reconectando mensagens…</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          aria-label="Fechar mensagens"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>
      {state.error && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs"
        >
          <span className="flex-1">{state.error}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void store?.retry();
            }}
          >
            Tentar novamente
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Conversas"
          className={`${selected ? "hidden sm:block" : "block"} w-full shrink-0 overflow-y-auto border-r sm:w-56`}
        >
          {state.loadingList && (
            <p className="p-4 text-xs text-muted-foreground">Carregando conversas…</p>
          )}
          {!state.loadingList && !state.conversations.length && (
            <p className="p-4 text-xs leading-relaxed text-muted-foreground">
              Clique em uma pessoa no escritório e escolha Enviar mensagem.
            </p>
          )}
          {state.conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => void store?.select(conversation.id)}
              aria-current={conversation.id === state.selectedId ? "true" : undefined}
              className={`flex w-full items-center gap-2 border-b px-3 py-3 text-left hover:bg-muted/60 ${conversation.id === state.selectedId ? "bg-primary/10" : ""}`}
            >
              <SpriteAvatar spriteId={conversation.peer_sprite_id} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">
                  {conversation.peer_name}
                </span>
                <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                  {conversation.last_type === "sticker"
                    ? `Sticker · ${findChatSticker(conversation.last_body ?? "")?.label ?? ""}`
                    : (conversation.last_body ?? "Comece uma conversa")}
                </span>
              </span>
              {conversation.unread_count > 0 && (
                <span
                  aria-label={`${conversation.unread_count} não lidas`}
                  className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground"
                >
                  {conversation.unread_count > 99 ? "99+" : conversation.unread_count}
                </span>
              )}
            </button>
          ))}
        </nav>
        {selected && store ? (
          <ChatThread
            key={selected.id}
            conversation={selected}
            state={state}
            store={store}
            userId={userId}
          />
        ) : (
          <div className="hidden flex-1 flex-col items-center justify-center gap-3 px-8 text-center sm:flex">
            <MessageCircle className="h-9 w-9 text-primary/45" />
            <p className="text-sm text-muted-foreground">
              {state.loading ? "Abrindo conversa…" : "Escolha uma conversa para começar."}
            </p>
          </div>
        )}
      </div>
    </section>,
    host,
  );
}
