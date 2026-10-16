import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Loader2, Send, Smile, Sticker } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SpriteAvatar } from "@/components/profile/SpriteAvatar";
import { isMessageRemoved } from "@/lib/chat/message-state";
import { CHAT_MAX_LENGTH, type ChatConversation } from "@/lib/chat/types";
import type { ChatState, ChatStore } from "@/lib/chat/store";
import { CHAT_STICKERS, findChatSticker } from "@/lib/chat/stickers";

import { ChatMessageItem, StaticSticker } from "./ChatMessageItem";

import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
export function ChatThread({
  conversation,
  state,
  store,
  userId,
  portalHost,
}: {
  conversation: ChatConversation;
  state: ChatState;
  store: ChatStore;
  userId: string;
  portalHost: Element;
}) {
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [overlays, setOverlays] = useState(new Set<string>());
  const onOverlayChange = useCallback(
    (id: string, open: boolean) => {
      if (open) store.setReading(false);
      setOverlays((old) => {
        if (old.has(id) === open) return old;
        const next = new Set(old);
        if (open) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [store],
  );
  const replying = replyTo
    ? [...state.messages, ...(state.replyMessages ?? [])].find((m) => m.id === replyTo)
    : null;
  const blocked = overlays.size > 0;
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
    store.setReading(visible && atLatest && !state.loading && !blocked);
    return () => store.setReading(false);
  }, [store, visible, atLatest, state.loading, blocked]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    if (anchor.current && !state.loadingOlder) {
      el.scrollTop = anchor.current.top + el.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (atLatest) el.scrollTop = el.scrollHeight;
  }, [firstId, lastId, state.loadingOlder, atLatest]);
  async function send(body = text, type: "text" | "sticker" = "text") {
    if (await (replyTo ? store.send(body, type, replyTo) : store.send(body, type))) {
      setReplyTo(null);
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
          store.setReading(latest && visible && !state.loading && !blocked);
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
          {state.messages.map((message) => (
            <ChatMessageItem
              key={message.id}
              message={message}
              conversation={conversation}
              state={state}
              store={store}
              userId={userId}
              host={portalHost}
              onReply={(id) => {
                setReplyTo(id);
                input.current?.focus();
              }}
              onOverlayChange={onOverlayChange}
              onJump={(id) => {
                setAtLatest(false);
                store.setReading(false);
                void store.revealMessage(id).then((found) => {
                  if (found) {
                    const el = document.getElementById(`chat-message-${id}`);
                    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
                    el?.focus({ preventScroll: true });
                  }
                });
              }}
            />
          ))}
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
        {replyTo && (
          <div
            aria-label="Respondendo à mensagem"
            className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-primary bg-muted px-3 py-2 text-xs"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {replying?.sender_id === userId ? "Você" : conversation.peer_name}
              </p>
              <p className="truncate">
                {replying?.deleted_at
                  ? "Mensagem apagada"
                  : replying?.cancelled_at
                    ? "Mensagem cancelada"
                    : replying?.message_type === "sticker"
                      ? `Sticker · ${findChatSticker(replying.body ?? "")?.label ?? ""}`
                      : (replying?.body?.slice(0, 160) ?? "Mensagem indisponível")}
              </p>
            </div>
            <button
              type="button"
              aria-label="Cancelar resposta"
              className="rounded p-1 hover:bg-accent"
              onClick={() => setReplyTo(null)}
            >
              ×
            </button>
          </div>
        )}
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
            {picker === "emoji" ? (
              <div className="w-full overflow-hidden">
                <EmojiPicker
                  emojiStyle={EmojiStyle.APPLE}
                  theme={Theme.AUTO}
                  width="100%"
                  height={340}
                  previewConfig={{ showPreview: false }}
                  searchPlaceholder="Buscar emoji..."
                  onEmojiClick={(value) => {
                    const emoji = value.emoji;
                    setText((old) =>
                      old.length + emoji.length <= CHAT_MAX_LENGTH ? old + emoji : old,
                    );
                    setPicker(null);
                    input.current?.focus();
                  }}
                />
              </div>
            ) : (
              CHAT_STICKERS.map((sticker) => (
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
              ))
            )}
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
            disabled={state.sending || !text.trim() || (!!replying && isMessageRemoved(replying))}
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
