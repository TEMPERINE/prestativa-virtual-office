import { Check, CheckCheck } from "lucide-react";
import { findChatSticker } from "@/lib/chat/stickers";
import { messageReceipt } from "@/lib/chat/message-state";
import type { ChatMessage, ChatConversation } from "@/lib/chat/types";
import type { ChatState, ChatStore } from "@/lib/chat/store";
import { MessageActions } from "./MessageActions";
export function StaticSticker({ id }: { id: string }) {
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
export function ChatMessageItem({
  message,
  conversation,
  state,
  store,
  userId,
  host,
  onReply,
  onJump,
  onOverlayChange,
}: {
  message: ChatMessage;
  conversation: ChatConversation;
  state: ChatState;
  store: ChatStore;
  userId: string;
  host: Element;
  onReply: (id: string) => void;
  onJump: (id: string) => void;
  onOverlayChange: (id: string, open: boolean) => void;
}) {
  const own = message.sender_id === userId;
  const original = message.reply_to_message_id
    ? [...state.messages, ...(state.replyMessages ?? [])].find(
        (m) => m.id === message.reply_to_message_id,
      )
    : null;
  const receipt = messageReceipt(message, conversation);
  const label = receipt === "read" ? "Lida" : receipt === "delivered" ? "Entregue" : "Enviada";
  const reactions = new Map<string, { count: number; mine: boolean }>();
  for (const reaction of state.reactions ?? [])
    if (reaction.message_id === message.id && reaction.emoji) {
      const old = reactions.get(reaction.emoji);
      reactions.set(reaction.emoji, {
        count: (old?.count ?? 0) + 1,
        mine: !!old?.mine || reaction.user_id === userId,
      });
    }
  const date = new Date(message.created_at);
  return (
    <li
      id={`chat-message-${message.id}`}
      tabIndex={-1}
      className={`group flex ${own ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`relative max-w-[85%] rounded-2xl px-3 py-2 ${own ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground"}`}
      >
        <MessageActions
          message={message}
          conversation={conversation}
          userId={userId}
          state={state}
          store={store}
          host={host}
          onReply={onReply}
          onOverlayChange={onOverlayChange}
        />
        {message.is_forwarded && !message.cancelled_at && (
          <p className="mb-1 pr-5 text-[10px] italic opacity-75">Encaminhada</p>
        )}
        {message.reply_to_message_id && !message.cancelled_at && (
          <button
            type="button"
            aria-label={`Ver mensagem respondida ${message.reply_to_message_id}`}
            className="mb-2 block w-full rounded border-l-2 border-current bg-background/15 px-2 py-1 text-left text-xs"
            onClick={() => onJump(message.reply_to_message_id!)}
          >
            <span className="block font-semibold">
              {original?.sender_id === userId ? "Você" : conversation.peer_name}
            </span>
            <span className="line-clamp-2">
              {original?.cancelled_at
                ? "Mensagem cancelada"
                : original?.message_type === "sticker"
                  ? `Sticker · ${findChatSticker(original.body ?? "")?.label ?? ""}`
                  : (original?.body?.slice(0, 160) ?? "Carregando mensagem…")}
            </span>
          </button>
        )}
        {message.cancelled_at ? (
          <p className="pr-5 text-sm italic opacity-75">
            {own ? "Você cancelou esta mensagem" : "Esta mensagem foi cancelada"}
          </p>
        ) : message.message_type === "sticker" ? (
          <StaticSticker id={message.body ?? ""} />
        ) : (
          <p className="whitespace-pre-wrap break-words pr-4 text-sm [overflow-wrap:anywhere]">
            {message.body}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-80">
          <time dateTime={message.created_at}>
            {Number.isNaN(date.getTime())
              ? ""
              : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </time>
          {own && !message.cancelled_at && (
            <span
              aria-label={label}
              title={label}
              className={receipt === "read" ? "text-sky-200" : ""}
            >
              {receipt === "sent" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <CheckCheck className="h-3.5 w-3.5" />
              )}
            </span>
          )}
        </div>
        {!message.cancelled_at && reactions.size > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {[...reactions].map(([emoji, data]) => (
              <button
                key={emoji}
                type="button"
                disabled={!state.interactions || state.actionsPending?.includes(message.id)}
                aria-label={`Reação ${emoji} (${data.count})`}
                aria-pressed={data.mine}
                className={`rounded-full border px-1.5 py-0.5 text-xs ${data.mine ? "border-current bg-background/20" : "border-transparent bg-background/10"}`}
                onClick={() => void store.react(message.id, emoji)}
              >
                {emoji} {data.count}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
