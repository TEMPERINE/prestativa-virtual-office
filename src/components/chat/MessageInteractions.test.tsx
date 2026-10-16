// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OfficeChat, useOfficeChat } from "./OfficeChat";
import { ChatActionError } from "@/lib/chat/api";
import type {
  ChatApi,
  ChatConversation,
  ChatMessage,
  ChatReaction,
  ChatRealtime,
} from "@/lib/chat/types";
import type { OfficePanel } from "@/lib/office/overlay";
const msg = (seq: number, own = true): ChatMessage => ({
  id: `m${seq}`,
  conversation_id: "c",
  sender_id: own ? "me" : "peer",
  body: own ? "Olá original" : "Texto da colega",
  message_type: "text",
  seq,
  created_at: "2026-10-15T10:00:00Z",
});
const base: ChatConversation = {
  id: "c",
  workspace_id: "ws",
  participant_a: "me",
  participant_b: "peer",
  created_at: "2026-10-15T10:00:00Z",
  last_message_at: "2026-10-15T10:00:00Z",
  last_message_seq: 3,
  read_seq: 0,
  unread_count: 1,
  peer_id: "peer",
  peer_name: "Colega",
  peer_sprite_id: null,
  peer_color: "",
  last_body: "coffee",
  last_type: "sticker",
  last_sender_id: "me",
  own_delivered_seq: 3,
  peer_delivered_seq: 0,
  peer_read_seq: 0,
};
function services() {
  let inbox = () => {},
    receive = (_m: ChatMessage) => {},
    rev = 0;
  let receiveReaction = (_r: ChatReaction) => {};
  let rows = [
      msg(1),
      msg(2, false),
      { ...msg(3), body: "coffee", message_type: "sticker" as const },
    ],
    conversation = { ...base };
  const api: ChatApi = {
    list: vi.fn(async () => [conversation]),
    start: async () => "c",
    history: vi.fn(async () => ({ messages: rows, hasMore: false })),
    read: vi.fn(async () => {}),
    supportsInteractions: () => true,
    send: vi.fn(async (cid, body, type, id, reply) => {
      const row = {
        ...msg(4),
        id,
        conversation_id: cid,
        body,
        message_type: type,
        reply_to_message_id: reply ?? null,
      };
      rows = [...rows, row];
      return row;
    }),
    lookup: vi.fn(async (_cid, ids) => rows.filter((m) => ids.includes(m.id))),
    reactions: vi.fn(async () => []),
    react: vi.fn(async (cid, id, emoji) => ({
      message_id: id,
      conversation_id: cid,
      user_id: "me",
      emoji,
      revision: ++rev,
      created_at: "2026-10-15T10:00:00Z",
    })),
    cancel: vi.fn(async (_cid, id) => {
      const row = {
        ...rows.find((m) => m.id === id)!,
        body: null,
        cancelled_at: "2026-10-15T11:00:00Z",
      };
      rows = rows.map((m) => (m.id === id ? row : m));
      return row;
    }),
    delete: vi.fn(async (_cid, id) => {
      const row = {
        ...rows.find((m) => m.id === id)!,
        body: null,
        deleted_at: "2026-10-15T11:00:00Z",
      };
      rows = rows.map((m) => (m.id === id ? row : m));
      return row;
    }),
    contacts: vi.fn(async () => [
      { id: "p1", name: "Colega Um", sprite_id: null },
      { id: "p2", name: "Colega Dois", sprite_id: null },
    ]),
    forward: vi.fn(async (_cid, id, peer, requestId) => ({
      ...rows.find((m) => m.id === id)!,
      id: requestId,
      conversation_id: `target-${peer}`,
      is_forwarded: true,
      reply_to_message_id: null,
    })),
  };
  const realtime: ChatRealtime = {
    inbox: (_ws, _uid, change) => {
      inbox = change;
      return () => {};
    },
    messages: (_cid, cb, _ready, reaction) => {
      receiveReaction = reaction ?? (() => {});
      receive = cb;
      return () => {};
    },
  };
  return {
    api,
    realtime,
    reaction: (r: ChatReaction) => {
      rev = Math.max(rev, r.revision);
      receiveReaction(r);
    },
    incoming: (m: ChatMessage) => receive(m),
    receipt: (delivered: number, read: number) => {
      conversation = { ...conversation, peer_delivered_seq: delivered, peer_read_seq: read };
      inbox();
    },
  };
}
function Launch() {
  const chat = useOfficeChat();
  return <button onClick={() => chat?.openPeer("peer")}>Abrir chat de teste</button>;
}
function Shell({ s }: { s: ReturnType<typeof services> }) {
  const [panel, setPanel] = useState<OfficePanel | null>(null);
  return (
    <OfficeChat
      workspaceId="ws"
      userId="me"
      panel={panel}
      onPanelChange={setPanel}
      api={s.api}
      realtime={s.realtime}
    >
      <Launch />
    </OfficeChat>
  );
}
async function open(s = services()) {
  render(<Shell s={s} />);
  fireEvent.click(screen.getByText("Abrir chat de teste"));
  await screen.findByText("Olá original");
  return s;
}
async function menu(seq: number) {
  fireEvent.pointerDown(screen.getByLabelText(`Opções da mensagem ${seq}`), {
    button: 0,
    ctrlKey: false,
  });
  return await screen.findByRole("menu");
}
beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId = 1;
      isPrimary = true;
    },
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  });
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
});
it("offers received/own actions correctly and copies text through Clipboard only", async () => {
  const s = await open();
  let actions = await menu(2);
  expect(within(actions).getByRole("menuitem", { name: "Responder" })).toBeTruthy();
  expect(within(actions).queryByRole("menuitem", { name: "Cancelar envio" })).toBeNull();
  fireEvent.click(within(actions).getByRole("menuitem", { name: "Copiar" }));
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Texto da colega"),
  );
  expect(s.api.send).not.toHaveBeenCalled();
  actions = await menu(3);
  expect(within(actions).queryByRole("menuitem", { name: "Copiar" })).toBeNull();
});
it("quick reaction adds then clicking its badge removes the same reaction", async () => {
  const s = await open();
  const actions = await menu(1);
  fireEvent.click(within(actions).getByRole("menuitem", { name: "Reagir" }));
  const picker = await screen.findByRole("dialog", { name: "Reagir à mensagem" });
  fireEvent.click(within(picker).getByRole("button", { name: "Reagir com ❤️" }));
  const badge = await screen.findByRole("button", { name: "Reação ❤️ (1)" });
  fireEvent.click(badge);
  await waitFor(() => expect(s.api.react).toHaveBeenLastCalledWith("c", "m1", null));
});
it("reply composer is cancellable and sends the reference without copying private metadata", async () => {
  const s = await open();
  fireEvent.click(within(await menu(2)).getByRole("menuitem", { name: "Responder" }));
  const preview = await screen.findByLabelText("Respondendo à mensagem");
  expect(preview.textContent).toContain("Colega");
  fireEvent.click(screen.getByLabelText("Cancelar resposta"));
  expect(screen.queryByLabelText("Respondendo à mensagem")).toBeNull();
  fireEvent.click(within(await menu(2)).getByRole("menuitem", { name: "Responder" }));
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Minha resposta" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
  await waitFor(() =>
    expect(s.api.send).toHaveBeenCalledWith(
      "c",
      "Minha resposta",
      "text",
      expect.any(String),
      "m2",
    ),
  );
  expect(await screen.findByRole("button", { name: /Ver mensagem respondida/ })).toBeTruthy();
});
it("forward dialog selects multiple workspace contacts and sends independent copies", async () => {
  const s = await open();
  fireEvent.click(within(await menu(2)).getByRole("menuitem", { name: "Encaminhar" }));
  const dialog = await screen.findByRole("dialog", { name: "Encaminhar mensagem" });
  fireEvent.click(await within(dialog).findByLabelText("Encaminhar para Colega Um"));
  fireEvent.click(within(dialog).getByLabelText("Encaminhar para Colega Dois"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Encaminhar (2)" }));
  await waitFor(() => expect(s.api.forward).toHaveBeenCalledTimes(2));
  for (const call of vi.mocked(s.api.forward!).mock.calls) {
    expect(call[0]).toBe("c");
    expect(call[1]).toBe("m2");
    expect(call).toHaveLength(4);
  }
});
it("sent/delivered/read and info derive from server receipts, and read removes cancel action", async () => {
  const s = await open();
  expect(screen.getAllByLabelText("Enviada").length).toBe(2);
  act(() => s.receipt(3, 0));
  await screen.findAllByLabelText("Entregue");
  fireEvent.click(within(await menu(1)).getByRole("menuitem", { name: "Informações" }));
  const dialog = await screen.findByRole("dialog", { name: "Informações da mensagem" });
  expect(within(dialog).getByText("Confirmado")).toBeTruthy();
  expect(within(dialog).getByText("Ainda não confirmado")).toBeTruthy();
  fireEvent.click(within(dialog).getByLabelText("Fechar janela"));
  act(() => s.receipt(3, 3));
  await screen.findAllByLabelText("Lida");
  expect(within(await menu(1)).queryByRole("menuitem", { name: "Cancelar envio" })).toBeNull();
});
it("cancels only after confirmation, redacts text and removes prohibited actions", async () => {
  const s = await open();
  fireEvent.click(within(await menu(1)).getByRole("menuitem", { name: "Cancelar envio" }));
  const dialog = await screen.findByRole("dialog", { name: "Cancelar esta mensagem?" });
  expect(s.api.cancel).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar envio" }));
  await screen.findByText("Você cancelou esta mensagem");
  expect(screen.queryByText("Olá original")).toBeNull();
  const actions = await menu(1);
  for (const name of ["Reagir", "Responder", "Encaminhar", "Copiar", "Cancelar envio"])
    expect(within(actions).queryByRole("menuitem", { name })).toBeNull();
});
it("already-read cancellation failure stays visible without losing the original content", async () => {
  const s = services();
  vi.mocked(s.api.cancel!).mockRejectedValue(
    new ChatActionError("Não é mais possível cancelar esta mensagem porque ela já foi lida."),
  );
  await open(s);
  fireEvent.click(within(await menu(1)).getByRole("menuitem", { name: "Cancelar envio" }));
  const dialog = await screen.findByRole("dialog", { name: "Cancelar esta mensagem?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar envio" }));
  expect(await within(dialog).findByText(/Não é mais possível cancelar/)).toBeTruthy();
  expect(screen.getByText("Olá original")).toBeTruthy();
});
it("received cancellation renders its tombstone and never exposes actions or content", async () => {
  const s = await open();
  act(() => s.incoming({ ...msg(2, false), body: null, cancelled_at: "2026-10-15T11:00:00Z" }));
  await screen.findByText("Esta mensagem foi cancelada");
  expect(screen.queryByText("Texto da colega")).toBeNull();
  expect(screen.queryByLabelText("Opções da mensagem 2")).toBeNull();
});
it("dialogs and menus remain inside the fullscreen host and Escape preserves Chat", async () => {
  const fullscreen = document.createElement("div");
  fullscreen.tabIndex = 0;
  document.body.append(fullscreen);
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: fullscreen });
  try {
    await open();
    const actions = await menu(1);
    expect(fullscreen.contains(actions)).toBe(true);
    fireEvent.click(within(actions).getByRole("menuitem", { name: "Informações" }));
    const dialog = await screen.findByRole("dialog", { name: "Informações da mensagem" });
    expect(fullscreen.contains(dialog)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Informações da mensagem" })).toBeNull(),
    );
    expect(screen.getByRole("dialog", { name: "Mensagens privadas" })).toBeTruthy();
  } finally {
    Reflect.deleteProperty(document, "fullscreenElement");
    fullscreen.remove();
  }
});
it("a received cancellation closes its open picker and restores normal reading", async () => {
  const s = await open();
  fireEvent.click(within(await menu(2)).getByRole("menuitem", { name: "Reagir" }));
  await screen.findByRole("dialog", { name: "Reagir à mensagem" });
  act(() => s.incoming({ ...msg(2, false), body: null, cancelled_at: "2026-10-15T11:00:00Z" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Reagir à mensagem" })).toBeNull(),
  );
  act(() => s.incoming({ ...msg(4, false), body: "Nova recebida" }));
  await waitFor(() => expect(s.api.read).toHaveBeenCalledWith("c", 4));
});
it("blocks reading messages covered by an open dialog until it closes", async () => {
  const s = await open();
  fireEvent.click(within(await menu(1)).getByRole("menuitem", { name: "Informações" }));
  const dialog = await screen.findByRole("dialog", { name: "Informações da mensagem" });
  vi.mocked(s.api.read).mockClear();
  act(() => s.incoming({ ...msg(4, false), body: "Coberta pelo diálogo" }));
  await screen.findByText("Coberta pelo diálogo");
  expect(s.api.read).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByLabelText("Fechar janela"));
  await waitFor(() => expect(s.api.read).toHaveBeenCalledWith("c", 4));
});
it("reuses the installed full emoji picker without new dependencies", async () => {
  await open();
  fireEvent.click(within(await menu(1)).getByRole("menuitem", { name: "Reagir" }));
  const dialog = await screen.findByRole("dialog", { name: "Reagir à mensagem" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Mais emojis" }));
  expect(await within(dialog).findByPlaceholderText("Buscar emoji...")).toBeTruthy();
});

it("opens a compact anchored quick toolbar directly from the bubble and expands only with plus", async () => {
  await open();
  fireEvent.click(screen.getByLabelText("Reagir à mensagem 1"));
  const bar = await screen.findByRole("toolbar", { name: "Reações rápidas" });
  expect(within(bar).getAllByRole("button")).toHaveLength(7);
  expect(screen.queryByPlaceholderText("Buscar emoji...")).toBeNull();
  expect(bar.closest("[data-chat-reaction-bar]")).toBeTruthy();
  fireEvent.click(within(bar).getByRole("button", { name: "Mais emojis" }));
  expect(await screen.findByPlaceholderText("Buscar emoji...")).toBeTruthy();
});
it("shows one gray check, two gray checks, then two contrasting blue checks", async () => {
  const s = await open();
  const check = () => screen.getAllByLabelText(/^(Enviada|Entregue|Lida)$/)[0];
  expect(check().getAttribute("title")).toBe("Enviada");
  expect(check().querySelector("svg")?.classList.contains("lucide-check")).toBe(true);
  expect(check().className).toContain("text-gray-600");
  act(() => s.receipt(3, 0));
  await screen.findAllByLabelText("Entregue");
  expect(check().querySelector("svg")?.classList.contains("lucide-check-check")).toBe(true);
  expect(check().className).toContain("text-gray-600");
  act(() => s.receipt(3, 3));
  await screen.findAllByLabelText("Lida");
  expect(check().querySelector("svg")?.classList.contains("lucide-check-check")).toBe(true);
  expect(check().className).toContain("text-blue-700");
  expect(check().className).toContain("dark:text-blue-400");
});
it("read messages replace cancel with confirmed soft delete and remove incompatible actions", async () => {
  const s = await open();
  act(() => s.receipt(3, 3));
  await screen.findAllByLabelText("Lida");
  const actions = await menu(1);
  expect(within(actions).queryByText("Cancelar envio")).toBeNull();
  fireEvent.click(within(actions).getByRole("menuitem", { name: "Apagar mensagem" }));
  const dialog = await screen.findByRole("dialog", { name: "Apagar esta mensagem?" });
  expect(s.api.delete).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Apagar mensagem" }));
  await screen.findByText("Você apagou esta mensagem");
  expect(screen.queryByText("Olá original")).toBeNull();
  const remaining = await menu(1);
  expect(within(remaining).getByRole("menuitem", { name: "Informações" })).toBeTruthy();
  for (const name of [
    "Reagir",
    "Responder",
    "Encaminhar",
    "Copiar",
    "Cancelar envio",
    "Apagar mensagem",
  ])
    expect(within(remaining).queryByRole("menuitem", { name })).toBeNull();
});
it("Realtime groups different reactions in one overlaid badge and switching replaces own reaction", async () => {
  const s = await open();
  const reaction = (uid: string, emoji: string, revision = 1): ChatReaction => ({
    message_id: "m1",
    conversation_id: "c",
    user_id: uid,
    emoji,
    revision,
    created_at: "2026-10-15T10:00:00Z",
  });
  act(() => {
    s.reaction(reaction("peer", "😂"));
    s.reaction(reaction("me", "❤️"));
  });
  const badge = await screen.findByLabelText("Reações da mensagem 1");
  expect(badge.className).toContain("absolute");
  expect(within(badge).getByLabelText("Total de reações").textContent).toBe("2");
  fireEvent.click(within(badge).getByRole("button", { name: "Reação 😂 (1)" }));
  await waitFor(() => expect(s.api.react).toHaveBeenLastCalledWith("c", "m1", "😂"));
  expect(within(badge).queryByRole("button", { name: "Reação ❤️ (1)" })).toBeNull();
});
it("received deletion redacts both its bubble and existing reply preview", async () => {
  const s = await open();
  fireEvent.click(within(await menu(2)).getByRole("menuitem", { name: "Responder" }));
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Resposta" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
  await screen.findByRole("button", { name: /Ver mensagem respondida/ });
  act(() => s.incoming({ ...msg(2, false), body: null, deleted_at: "2026-10-15T11:00:00Z" }));
  expect(await screen.findAllByText("Mensagem apagada")).toHaveLength(2);
  expect(screen.queryByText("Texto da colega")).toBeNull();
  expect(screen.queryByLabelText("Opções da mensagem 2")).toBeNull();
});
