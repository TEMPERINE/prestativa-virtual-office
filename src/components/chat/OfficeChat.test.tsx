// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OfficeChat, OfficeChatButton, useOfficeChat } from "./OfficeChat";
import type { ChatApi, ChatConversation, ChatMessage, ChatRealtime } from "@/lib/chat/types";
import type { OfficePanel } from "@/lib/office/overlay";

beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const conversation: ChatConversation = {
  id: "c",
  workspace_id: "ws",
  participant_a: "me",
  participant_b: "peer",
  created_at: "2026-10-14T10:00:00Z",
  last_message_at: null,
  last_message_seq: 0,
  read_seq: 0,
  unread_count: 0,
  peer_id: "peer",
  peer_name: "Colega",
  peer_sprite_id: null,
  peer_color: "",
  last_body: null,
  last_type: null,
  last_sender_id: null,
};
function services() {
  let inbox = () => {};
  let receive = (_m: ChatMessage) => {};
  let ready = () => {};
  const api: ChatApi = {
    list: vi.fn(async () => [conversation]),
    start: vi.fn(async () => "c"),
    history: vi.fn(async () => ({ messages: [], hasMore: false })),
    send: vi.fn(async (_cid, body, type, id) => ({
      id,
      body,
      message_type: type,
      seq: 1,
      sender_id: "me",
      conversation_id: "c",
      created_at: "2026-10-14T10:00:00Z",
    })),
    read: vi.fn(async () => {}),
  };
  const realtime: ChatRealtime = {
    inbox: vi.fn((_ws, _uid, cb, status) => {
      inbox = cb;
      status("online");
      return vi.fn();
    }),
    messages: vi.fn((_cid, cb, subscribed) => {
      receive = cb;
      ready = subscribed;
      return vi.fn();
    }),
  };
  return {
    api,
    realtime,
    incoming: (m: ChatMessage) => receive(m),
    inbox: () => inbox(),
    ready: () => ready(),
  };
}
function Scene({ mounts }: { mounts: { mount: () => void; unmount: () => void } }) {
  const chat = useOfficeChat();
  useEffect(() => {
    mounts.mount();
    return mounts.unmount;
  }, [mounts]);
  return (
    <div data-testid="office-scene">
      <button onClick={() => chat?.openPeer("peer")}>Enviar mensagem ao participante</button>
      <OfficeChatButton />
    </div>
  );
}
function Shell({
  s,
  mounts,
}: {
  s: ReturnType<typeof services>;
  mounts: { mount: () => void; unmount: () => void };
}) {
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
      <Scene mounts={mounts} />
    </OfficeChat>
  );
}
const mounts = () => ({ mount: vi.fn(), unmount: vi.fn() });

it("real chat shell keeps its Office child mounted across open, close and reopen", async () => {
  const s = services(),
    m = mounts();
  render(<Shell s={s} mounts={m} />);
  fireEvent.click(screen.getByText("Enviar mensagem ao participante"));
  await screen.findByRole("textbox", { name: "Mensagem" });
  expect(m.mount).toHaveBeenCalledTimes(1);
  expect(m.unmount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Fechar mensagens"));
  expect(screen.queryByLabelText("Mensagem")).toBeNull();
  fireEvent.click(screen.getByLabelText("Abrir mensagens"));
  await screen.findByRole("textbox", { name: "Mensagem" });
  expect(m.mount).toHaveBeenCalledTimes(1);
  expect(m.unmount).not.toHaveBeenCalled();
  expect(s.realtime.messages).toHaveBeenCalledTimes(1);
});
it("sends text and emojis through the same conversation, then a static sticker", async () => {
  const s = services();
  render(<Shell s={s} mounts={mounts()} />);
  fireEvent.click(screen.getByText("Enviar mensagem ao participante"));
  const input = await screen.findByRole("textbox", { name: "Mensagem" });
  fireEvent.change(input, { target: { value: "Olá" } });
  fireEvent.click(screen.getByLabelText("Adicionar emoji"));
  const smile = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('[data-chat-picker] [data-unified="1f60a"]');
    if (!el) throw new Error("emoji not rendered");
    return el;
  });
  fireEvent.click(smile);
  fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
  await waitFor(() =>
    expect(s.api.send).toHaveBeenCalledWith("c", "Olá😊", "text", expect.any(String)),
  );
  await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
  fireEvent.click(screen.getByLabelText("Enviar sticker"));
  fireEvent.click(screen.getByRole("button", { name: "Sticker Café?" }));
  await waitFor(() =>
    expect(s.api.send).toHaveBeenCalledWith("c", "coffee", "sticker", expect.any(String)),
  );
});
it("renders user text safely, and only marks a visible latest message read", async () => {
  const s = services();
  render(<Shell s={s} mounts={mounts()} />);
  fireEvent.click(screen.getByText("Enviar mensagem ao participante"));
  await screen.findByRole("textbox", { name: "Mensagem" });
  act(() =>
    s.incoming({
      id: "received",
      conversation_id: "c",
      sender_id: "peer",
      body: '<img src=x onerror="alert(1)">',
      message_type: "text",
      seq: 1,
      created_at: "2026-10-14T10:00:00Z",
    }),
  );
  expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeTruthy();
  expect(screen.getByRole("log").querySelector("img")).toBeNull();
  await waitFor(() => expect(s.api.read).toHaveBeenCalledWith("c", 1));
});
it("supports StrictMode cleanup and Escape without losing the Office", async () => {
  const s = services(),
    m = mounts();
  render(
    <StrictMode>
      <Shell s={s} mounts={m} />
    </StrictMode>,
  );
  fireEvent.click(screen.getByText("Enviar mensagem ao participante"));
  const panel = await screen.findByRole("dialog", { name: "Mensagens privadas" });
  fireEvent.keyDown(panel, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Mensagens privadas" })).toBeNull();
  expect(screen.getByTestId("office-scene")).toBeTruthy();
});
it("missing migration shows friendly state while the Office remains available", async () => {
  const s = services();
  const { ChatUnavailableError } = await import("@/lib/chat/api");
  vi.mocked(s.api.list).mockRejectedValue(new ChatUnavailableError());
  render(<Shell s={s} mounts={mounts()} />);
  fireEvent.click(screen.getByLabelText("Abrir mensagens"));
  expect(await screen.findByText(/aguarda configuração/)).toBeTruthy();
  expect(screen.getByTestId("office-scene")).toBeTruthy();
});

it("scrolling history does not clear unread until returning to latest", async () => {
  const s = services();
  render(<Shell s={s} mounts={mounts()} />);
  fireEvent.click(screen.getByText("Enviar mensagem ao participante"));
  await screen.findByRole("textbox", { name: "Mensagem" });
  const log = screen.getByRole("log");
  Object.defineProperty(log, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(log, "clientHeight", { value: 300, configurable: true });
  log.scrollTop = 0;
  fireEvent.scroll(log);
  act(() =>
    s.incoming({
      id: "unread",
      conversation_id: "c",
      sender_id: "peer",
      body: "nova",
      message_type: "text",
      seq: 1,
      created_at: "2026-10-14T10:00:00Z",
    }),
  );
  await screen.findByText("nova");
  expect(s.api.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText(/Ir para as mensagens recentes/));
  await waitFor(() => expect(s.api.read).toHaveBeenCalledWith("c", 1));
});
it("IME composition Enter does not prematurely send", async () => {
  const s = services();
  render(<Shell s={s} mounts={mounts()} />);
  fireEvent.click(screen.getByText("Enviar mensagem ao participante"));
  const input = await screen.findByRole("textbox", { name: "Mensagem" });
  fireEvent.change(input, { target: { value: "texto" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(s.api.send).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(s.api.send).toHaveBeenCalledTimes(1));
});

it("reconnect keeps historical scroll intent and leaves unseen messages unread", async () => {
  const s = services();
  const msg = (seq: number): ChatMessage => ({
    id: `m${seq}`,
    conversation_id: "c",
    sender_id: "peer",
    body: `histórico ${seq}`,
    message_type: "text",
    seq,
    created_at: "2026-10-14T10:00:00Z",
  });
  vi.mocked(s.api.history)
    .mockResolvedValueOnce({ messages: [msg(3), msg(4)], hasMore: true })
    .mockResolvedValueOnce({ messages: [msg(1), msg(2)], hasMore: false });
  render(<Shell s={s} mounts={mounts()} />);
  fireEvent.click(screen.getByText("Enviar mensagem ao participante"));
  await screen.findByText("histórico 3");
  fireEvent.click(screen.getByText("Carregar mensagens anteriores"));
  await screen.findByText("histórico 1");
  const log = screen.getByRole("log");
  Object.defineProperty(log, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(log, "clientHeight", { value: 300, configurable: true });
  log.scrollTop = 200;
  fireEvent.scroll(log);
  vi.mocked(s.api.read).mockClear();
  let resolve!: (page: { messages: ChatMessage[]; hasMore: boolean }) => void;
  vi.mocked(s.api.history).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  act(() => s.ready());
  // Browser layout/resize may emit a synthetic bottom scroll while loading.
  Object.defineProperty(log, "scrollHeight", { value: 300, configurable: true });
  log.scrollTop = 0;
  fireEvent.scroll(log);
  Object.defineProperty(log, "scrollHeight", { value: 1000, configurable: true });
  log.scrollTop = 200;
  await act(async () => resolve({ messages: [msg(3), msg(4), msg(5)], hasMore: true }));
  expect(screen.getByText("histórico 1")).toBeTruthy();
  expect(log.scrollTop).toBe(200);
  expect(s.api.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText(/Ir para as mensagens recentes/));
  await waitFor(() => expect(s.api.read).toHaveBeenCalledWith("c", 5));
});
