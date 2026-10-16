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
import type { ChatExtrasApi, ChatPin } from "@/lib/chat/extras";
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
function Shell({ s, extras }: { s: ReturnType<typeof services>; extras?: ChatExtrasApi }) {
  const [panel, setPanel] = useState<OfficePanel | null>(null);
  return (
    <OfficeChat
      workspaceId="ws"
      userId="me"
      panel={panel}
      onPanelChange={setPanel}
      api={s.api}
      realtime={s.realtime}
      extras={extras}
    >
      <Launch />
    </OfficeChat>
  );
}
async function open(s = services(), extras?: ChatExtrasApi) {
  render(<Shell s={s} extras={extras} />);
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

function fakeExtras() {
  let pin: ChatPin | null = null;
  const favs = new Set<string>();
  let push = (_p: ChatPin | null) => {};
  const api: ChatExtrasApi = {
    pin: vi.fn(async () => pin),
    setPin: vi.fn(async (_cid, id) => {
      pin = id ? { message_id: id, pinned_by: "me", pinned_at: "2026-10-16T10:00:00Z" } : null;
      return pin;
    }),
    favorites: vi.fn(async () => [...favs]),
    setFavorite: vi.fn(async (_cid, id, on) => {
      if (on) favs.add(id);
      else favs.delete(id);
    }),
    messages: vi.fn(async () => []),
    watchPin: (_cid, cb) => {
      push = cb;
      return () => {};
    },
  };
  return { api, favs, remote: (p: ChatPin | null) => act(() => push(p)) };
}
it("favorites and unfavorites a message only for the current user", async () => {
  const x = fakeExtras();
  await open(undefined, x.api);
  fireEvent.click(within(await menu(2)).getByRole("menuitem", { name: "Favoritar" }));
  await screen.findByLabelText("Favoritada por você");
  expect(x.api.setFavorite).toHaveBeenLastCalledWith("c", "m2", true);
  fireEvent.click(within(await menu(2)).getByRole("menuitem", { name: "Remover dos favoritos" }));
  await waitFor(() => expect(screen.queryByLabelText("Favoritada por você")).toBeNull());
  expect(x.api.setFavorite).toHaveBeenLastCalledWith("c", "m2", false);
});
it("pins, replaces and unpins; pin bar locates the original message", async () => {
  const x = fakeExtras();
  const scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled;
  await open(undefined, x.api);
  fireEvent.click(within(await menu(2)).getByRole("menuitem", { name: "Fixar" }));
  const bar = await screen.findByLabelText("Ir para a mensagem fixada");
  expect(bar.textContent).toContain("Texto da colega");
  fireEvent.click(within(await menu(1)).getByRole("menuitem", { name: "Fixar" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Ir para a mensagem fixada").textContent).toContain("Olá original"),
  );
  expect(screen.getAllByLabelText("Mensagem fixada")).toHaveLength(1);
  fireEvent.click(screen.getByLabelText("Ir para a mensagem fixada"));
  await waitFor(() => expect(scrolled).toHaveBeenCalled());
  fireEvent.click(within(await menu(1)).getByRole("menuitem", { name: "Desafixar" }));
  await waitFor(() => expect(screen.queryByLabelText("Ir para a mensagem fixada")).toBeNull());
  expect(x.api.setPin).toHaveBeenLastCalledWith("c", null);
});
it("reflects a pin made by the other participant and its automatic removal", async () => {
  const x = fakeExtras();
  await open(undefined, x.api);
  x.remote({ message_id: "m1", pinned_by: "peer", pinned_at: "2026-10-16T10:00:00Z" });
  await screen.findByLabelText("Ir para a mensagem fixada");
  expect(within(await menu(1)).getByRole("menuitem", { name: "Desafixar" })).toBeTruthy();
  x.remote(null); // server trigger clears the pin when the message is deleted/cancelled
  await waitFor(() => expect(screen.queryByLabelText("Ir para a mensagem fixada")).toBeNull());
});
it("lists favorites in the conversation view", async () => {
  const x = fakeExtras();
  x.favs.add("m2");
  (x.api.messages as ReturnType<typeof vi.fn>).mockResolvedValue([msg(2, false)]);
  await open(undefined, x.api);
  fireEvent.click(screen.getByLabelText("Mensagens favoritas"));
  const view = await screen.findByRole("region", { name: "Mensagens favoritas" });
  await within(view).findByText("Texto da colega");
});
it("old chat without pins/favorites support hides those items", async () => {
  await open();
  const actions = await menu(2);
  expect(within(actions).queryByRole("menuitem", { name: "Fixar" })).toBeNull();
  expect(within(actions).getByRole("menuitem", { name: "Responder" })).toBeTruthy();
});
