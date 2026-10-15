import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Loader2, Send, Smile, Sticker } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SpriteAvatar } from "@/components/profile/SpriteAvatar";
import { CHAT_MAX_LENGTH, type ChatConversation } from "@/lib/chat/types";
import type { ChatState, ChatStore } from "@/lib/chat/store";
import { CHAT_STICKERS, findChatSticker } from "@/lib/chat/stickers";

const EMOJIS = ["😊", "💖", "👍", "🎉", "☕", "🙏", "😂", "✅", "👋", "🙌", "💡", "🚀"];
function StaticSticker({ id }: { id: string }) {
  const sticker = findChatSticker(id);
  if (!sticker) return <span>Sticker indisponível</span>;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={sticker.label}>
      <rect x="4" y="4" width="88" height="88" rx="28" fill={sticker.color} />
      <text x="48" y="59" textAnchor="middle" fontSize="44">
        {sticker.glyph}
      </text>
      <text x="48" y="80" textAnchor="middle" fontSize="11" fontWeight="600" fill="#51304b">
        {sticker.label}
      </text>
    </svg>
  );
}
function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ChatThread({
  conversation,
  state,
  store,
  userId,
}: {
  conversation: ChatConversation;
  state: ChatState;
  store: ChatStore;
  userId: string;
}) {
  const [text, setText] = useState("");
  const [picker, setPicker] = useState<"emoji" | "sticker" | null>(null);
  const [atLatest, setAtLatest] = useState(true);
  const [visible, setVisible] = useState(
    () => document.visibilityState === "visible" && document.hasFocus(),
  );
  const scroll = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const firstId = state.messages[0]?.id,
    lastId = state.messages.at(-1)?.id;

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible" && document.hasFocus());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);
  useEffect(() => {
    store.setReading(visible && atLatest && !state.loading);
    return () => store.setReading(false);
  }, [store, visible, atLatest, state.loading]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    if (anchor.current && !state.loadingOlder) {
      el.scrollTop = anchor.current.top + el.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (atLatest) el.scrollTop = el.scrollHeight;
  }, [firstId, lastId, state.loadingOlder, atLatest]);
  async function send(body = text, type: "text" | "sticker" = "text") {
    if (await store.send(body, type)) {
      if (type === "text") setText("");
      setPicker(null);
      setAtLatest(true);
      input.current?.focus();
    }
  }
  function older() {
    if (scroll.current)
      anchor.current = { height: scroll.current.scrollHeight, top: scroll.current.scrollTop };
    setAtLatest(false);
    store.setReading(false);
    void store.loadOlder();
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 sm:hidden"
          aria-label="Voltar às conversas"
          onClick={() => store.clearSelection()}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <SpriteAvatar spriteId={conversation.peer_sprite_id} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{conversation.peer_name}</p>
          <p className="text-[11px] text-muted-foreground">Conversa privada neste espaço</p>
        </div>
        {conversation.unread_count > 0 && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Marcar como lida"
            disabled={state.loading || !state.messages.length}
            onClick={() => void store.markRead(state.messages.at(-1)?.seq ?? 0)}
          >
            <Check className="h-4 w-4" />
          </Button>
        )}
      </header>
      <div
        ref={scroll}
        role="log"
        aria-label="Histórico da conversa"
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
        onScroll={(event) => {
          if (state.loading || state.loadingOlder) return;
          const el = event.currentTarget;
          const latest = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          setAtLatest(latest);
          store.setReading(latest && visible && !state.loading);
        }}
      >
        {state.hasMore && (
          <div className="mb-4 text-center">
            <Button variant="ghost" size="sm" disabled={state.loadingOlder} onClick={older}>
              {state.loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}
            </Button>
          </div>
        )}
        {state.loading && state.messages.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">Carregando conversa…</p>
        )}
        {!state.loading && state.messages.length === 0 && (
          <p className="py-10 text-center text-xs text-muted-foreground">
            Tudo pronto para começar a conversa.
          </p>
        )}
        <ol className="space-y-3">
          {state.messages.map((message) => {
            const own = message.sender_id === userId;
            return (
              <li key={message.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 ${own ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground"}`}
                >
                  {message.message_type === "sticker" ? (
                    <StaticSticker id={message.body} />
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                      {message.body}
                    </p>
                  )}
                  <time
                    dateTime={message.created_at}
                    className="mt-1 block text-right text-[10px] opacity-65"
                  >
                    {time(message.created_at)}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      {!atLatest && (
        <button
          type="button"
          className="border-t py-2 text-xs text-primary"
          onClick={() => {
            setAtLatest(true);
            if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
          }}
        >
          Ir para as mensagens recentes ↓
        </button>
      )}
      <div className="relative border-t bg-background p-3">
        {picker && (
          <div
            data-chat-picker
            className="mb-2 flex flex-wrap gap-1 rounded-xl border bg-muted/50 p-2"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setPicker(null);
              }
            }}
          >
            {picker === "emoji"
              ? EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Emoji ${emoji}`}
                    className="rounded-lg p-2 text-xl hover:bg-accent"
                    onClick={() => {
                      setText((value) =>
                        value.length + emoji.length <= CHAT_MAX_LENGTH ? value + emoji : value,
                      );
                      setPicker(null);
                      input.current?.focus();
                    }}
                  >
                    {emoji}
                  </button>
                ))
              : CHAT_STICKERS.map((sticker) => (
                  <button
                    key={sticker.id}
                    type="button"
                    aria-label={`Sticker ${sticker.label}`}
                    className="rounded-lg hover:bg-accent disabled:opacity-50"
                    disabled={state.sending}
                    onClick={() => void send(sticker.id, "sticker")}
                  >
                    <StaticSticker id={sticker.id} />
                  </button>
                ))}
          </div>
        )}
        <label className="sr-only" htmlFor="office-chat-message">
          Mensagem
        </label>
        <Textarea
          id="office-chat-message"
          ref={input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          disabled={state.sending}
          autoFocus
          rows={2}
          className="min-h-[64px] resize-none rounded-xl text-sm"
          placeholder="Escreva uma mensagem…"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="mt-2 flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Adicionar emoji"
            disabled={state.sending}
            onClick={() => setPicker((value) => (value === "emoji" ? null : "emoji"))}
          >
            <Smile className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Enviar sticker"
            disabled={state.sending}
            onClick={() => setPicker((value) => (value === "sticker" ? null : "sticker"))}
          >
            <Sticker className="h-4 w-4" />
          </Button>
          <span className="ml-auto mr-2 text-[10px] text-muted-foreground">
            {text.length}/{CHAT_MAX_LENGTH}
          </span>
          <Button
            size="sm"
            aria-label="Enviar mensagem"
            disabled={state.sending || !text.trim()}
            onClick={() => void send()}
          >
            {state.sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
