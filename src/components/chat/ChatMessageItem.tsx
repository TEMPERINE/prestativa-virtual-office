import { AppleEmoji } from "./AppleEmoji";
import { Check, CheckCheck } from "lucide-react";
import { findChatSticker } from "@/lib/chat/stickers";
import { messageReceipt, isMessageRemoved } from "@/lib/chat/message-state";
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
  const removed = isMessageRemoved(message);
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
        className={`relative max-w-[85%] rounded-2xl px-3 py-2 ${reactions.size && !removed ? "mb-3" : ""} ${own ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground"}`}
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
        {message.is_forwarded && !removed && (
          <p className="mb-1 pr-10 text-[10px] italic opacity-75">Encaminhada</p>
        )}
        {message.reply_to_message_id && !removed && (
          <button
            type="button"
            aria-label={`Ver mensagem respondida ${message.reply_to_message_id}`}
            className="mb-2 block w-full rounded border-l-2 border-current bg-background/15 pl-2 pr-10 py-1 text-left text-xs"
            onClick={() => onJump(message.reply_to_message_id!)}
          >
            <span className="block font-semibold">
              {original?.sender_id === userId ? "Você" : conversation.peer_name}
            </span>
            <span className="line-clamp-2">
              {original?.deleted_at
                ? "Mensagem apagada"
                : original?.cancelled_at
                  ? "Mensagem cancelada"
                  : original?.message_type === "sticker"
                    ? `Sticker · ${findChatSticker(original.body ?? "")?.label ?? ""}`
                    : (original?.body?.slice(0, 160) ?? "Carregando mensagem…")}
            </span>
          </button>
        )}
        {removed ? (
          <p className="pr-5 text-sm italic opacity-75">
            {message.deleted_at
              ? own
                ? "Você apagou esta mensagem"
                : "Mensagem apagada"
              : own
                ? "Você cancelou esta mensagem"
                : "Esta mensagem foi cancelada"}
          </p>
        ) : message.message_type === "sticker" ? (
          <StaticSticker id={message.body ?? ""} />
        ) : (
          <p className="whitespace-pre-wrap break-words pr-10 text-sm [overflow-wrap:anywhere]">
            {message.body}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px]">
          <time className="opacity-75" dateTime={message.created_at}>
            {Number.isNaN(date.getTime())
              ? ""
              : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </time>
          {own && !removed && (
            <span
              aria-label={label}
              title={label}
              className={`inline-flex rounded-sm bg-white px-0.5 dark:bg-slate-950 ${receipt === "read" ? "text-blue-700 dark:text-blue-400" : "text-gray-600 dark:text-slate-400"}`}
            >
              {receipt === "sent" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <CheckCheck className="h-3.5 w-3.5" />
              )}
            </span>
          )}
        </div>
        {!removed && reactions.size > 0 && (
          <div
            aria-label={`Reações da mensagem ${message.seq}`}
            className={`absolute -bottom-3 flex items-center gap-0.5 rounded-full border bg-background px-1 py-0.5 text-foreground shadow-sm ${own ? "right-2" : "left-2"}`}
          >
            {[...reactions].map(([emoji, data]) => (
              <button
                key={emoji}
                type="button"
                disabled={!state.interactions || state.actionsPending?.includes(message.id)}
                aria-label={`Reação ${emoji} (${data.count})`}
                aria-pressed={data.mine}
                className={`rounded-full px-0.5 text-xs ${data.mine ? "bg-primary/15 ring-1 ring-primary/30" : "hover:bg-muted"}`}
                onClick={() => void store.react(message.id, emoji)}
              >
                <AppleEmoji emoji={emoji} size={16} />
              </button>
            ))}
            <span aria-label="Total de reações" className="px-1 text-[10px]">
              {[...reactions.values()].reduce((total, data) => total + data.count, 0)}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}
