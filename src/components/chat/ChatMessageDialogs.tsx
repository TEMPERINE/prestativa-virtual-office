import { useEffect, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SpriteAvatar } from "@/components/profile/SpriteAvatar";
import { messageReceipt } from "@/lib/chat/message-state";
import type { ChatConversation, ChatMessage } from "@/lib/chat/types";
import type { ChatState, ChatStore } from "@/lib/chat/store";

export function ChatDialog({
  title,
  host,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  host: Element;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal container={host}>
        <Dialog.Overlay
          className="fixed inset-0 z-[360] bg-black/35"
          onPointerDown={(e) => e.stopPropagation()}
        />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[370] max-h-[85dvh] w-[min(420px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-background p-5 text-foreground shadow-xl"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              if (!busy) onClose();
            }
          }}
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <Dialog.Title className="mb-4 pr-8 text-base font-semibold">{title}</Dialog.Title>
          <button
            type="button"
            disabled={busy}
            aria-label="Fechar janela"
            onClick={onClose}
            className="absolute right-3 top-3 rounded p-1 hover:bg-muted disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function MessageInfoDialog({
  message,
  conversation,
  host,
  onClose,
}: {
  message: ChatMessage;
  conversation: ChatConversation;
  host: Element;
  onClose: () => void;
}) {
  const status = messageReceipt(message, conversation);
  const at = new Date(message.created_at);
  return (
    <ChatDialog title="Informações da mensagem" host={host} onClose={onClose}>
      {message.cancelled_at && (
        <p className="mb-3 text-xs text-muted-foreground">
          Mensagem cancelada. As confirmações referem-se ao registro da mensagem, que agora contém o
          aviso de cancelamento.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <dt>Enviada</dt>
        <dd>
          <time dateTime={message.created_at}>
            {Number.isNaN(at.getTime()) ? "Horário indisponível" : at.toLocaleString("pt-BR")}
          </time>
        </dd>
        <dt>Entregue</dt>
        <dd>{status !== "sent" ? "Confirmado" : "Ainda não confirmado"}</dd>
        <dt>Lida</dt>
        <dd>{status === "read" ? "Confirmado" : "Ainda não confirmado"}</dd>
      </dl>
    </ChatDialog>
  );
}
export function CancelMessageDialog({
  message,
  state,
  store,
  host,
  onClose,
}: {
  message: ChatMessage;
  state: ChatState;
  store: ChatStore;
  host: Element;
  onClose: () => void;
}) {
  const busy = state.actionsPending?.includes(message.id) ?? false;
  return (
    <ChatDialog title="Cancelar esta mensagem?" host={host} onClose={onClose} busy={busy}>
      <p className="text-sm text-muted-foreground">
        O conteúdo será removido para os participantes se ainda não tiver sido lido. Cópias já
        encaminhadas ou copiadas não podem ser apagadas.
      </p>
      {state.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Voltar
        </Button>
        <Button
          variant="destructive"
          disabled={busy || !!message.cancelled_at}
          onClick={async () => {
            if (await store.cancel(message.id)) onClose();
          }}
        >
          {busy ? "Cancelando…" : "Cancelar envio"}
        </Button>
      </div>
    </ChatDialog>
  );
}
export function ForwardMessagesDialog({
  message,
  state,
  store,
  host,
  onClose,
}: {
  message: ChatMessage;
  state: ChatState;
  store: ChatStore;
  host: Element;
  onClose: () => void;
}) {
  const [operation] = useState(() => crypto.randomUUID());
  const [selected, setSelected] = useState(new Set<string>());
  const [search, setSearch] = useState("");
  const [result, setResult] = useState("");
  const busy = state.actionsPending?.includes(message.id) ?? false;
  useEffect(() => {
    void store.loadContacts();
    return () => store.discardForward(operation);
  }, [store, operation]);
  const contacts = (state.contacts ?? []).filter((c) =>
    c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <ChatDialog title="Encaminhar mensagem" host={host} onClose={onClose} busy={busy}>
      <p className="mb-3 text-xs text-muted-foreground">
        Uma nova mensagem será criada para cada pessoa, sem identificar a conversa original.
      </p>
      <input
        aria-label="Buscar pessoas"
        placeholder="Buscar pessoas"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-3 w-full rounded-lg border bg-background px-3 py-2 text-sm"
      />
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {state.contactsLoading && <p className="p-2 text-xs">Carregando pessoas…</p>}
        {!state.contactsLoading && !contacts.length && (
          <p className="p-2 text-xs text-muted-foreground">
            Nenhum contato disponível neste espaço.
          </p>
        )}
        {contacts.map((c) => (
          <label
            key={c.id}
            className="flex cursor-pointer items-center gap-2 rounded-lg p-2 hover:bg-muted"
          >
            <input
              type="checkbox"
              aria-label={`Encaminhar para ${c.name}`}
              checked={selected.has(c.id)}
              disabled={busy}
              onChange={() =>
                setSelected((old) => {
                  const next = new Set(old);
                  if (next.has(c.id)) next.delete(c.id);
                  else next.add(c.id);
                  return next;
                })
              }
            />
            <SpriteAvatar spriteId={c.sprite_id} size={28} />
            <span className="text-sm">{c.name}</span>
          </label>
        ))}
      </div>
      {message.cancelled_at && (
        <p role="alert" className="mt-3 text-sm">
          Esta mensagem foi cancelada.
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {result && (
        <p role="status" className="mt-3 text-xs">
          {result}
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <Button
          disabled={busy || !selected.size || !!message.cancelled_at}
          onClick={async () => {
            const response = await store.forward(message.id, [...selected], operation);
            if (!response.failed.length) onClose();
            else {
              setSelected(new Set(response.failed));
              setResult(
                `${response.sent} encaminhamento(s) confirmado(s). Tente novamente para os demais.`,
              );
            }
          }}
        >
          {busy ? "Encaminhando…" : `Encaminhar (${selected.size})`}
        </Button>
      </div>
    </ChatDialog>
  );
}
