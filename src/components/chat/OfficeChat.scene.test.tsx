// @vitest-environment jsdom
/** Real OfficeScene + real Chat components. Only Auth/DB/network/media I/O is fake. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OfficeScene } from "@/components/office/OfficeScene";
import { OfficeChat } from "./OfficeChat";
import { setCurrentWorkspaceId } from "@/lib/workspace/current";
import type { OfficePanel } from "@/lib/office/overlay";
import type { ChatApi, ChatRealtime } from "@/lib/chat/types";

const io = vi.hoisted(() => {
  const uid = "00000000-0000-4000-8000-000000000001",
    peer = "00000000-0000-4000-8000-000000000002";
  const profiles = [
    {
      id: uid,
      display_name: "Fixture",
      avatar_color: "#fa488e",
      sprite_id: "marcio",
      status: "available",
      onboarded_at: "2026-10-14T00:00:00Z",
    },
    {
      id: peer,
      display_name: "Colega",
      avatar_color: "#fa488e",
      sprite_id: "marcio",
      status: "available",
      onboarded_at: "2026-10-14T00:00:00Z",
    },
  ];
  const channels: { name: string; removed: boolean }[] = [];
  const from = vi.fn((table: string) => {
    const data =
      table === "profiles"
        ? profiles
        : table === "positions"
          ? profiles.map((p, i) => ({
              user_id: p.id,
              x: 0.45 + i * 0.04,
              y: 0.5,
              facing: "down",
              zone: "lobby",
              is_online: true,
              updated_at: "2026-10-14T10:00:00Z",
            }))
          : [];
    const query: Record<string, any> = {
      then: (fn: (x: unknown) => unknown) => Promise.resolve({ data, error: null }).then(fn),
    };
    for (const op of [
      "select",
      "eq",
      "neq",
      "in",
      "or",
      "order",
      "limit",
      "update",
      "upsert",
      "insert",
      "delete",
      "is",
      "not",
      "gt",
      "gte",
    ])
      query[op] = () => query;
    query.maybeSingle = async () => ({
      data: table === "workspaces" ? { tier: 3 } : table === "profiles" ? profiles[0] : null,
      error: null,
    });
    query.single = query.maybeSingle;
    return query;
  });
  const supabase = {
    from,
    rpc: vi.fn(async (fn: string) => ({ data: fn === "workspace_runtime_profiles" ? profiles : null, error: null })),
    realtime: { setAuth: vi.fn(async () => {}) },
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: uid } } })),
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    channel: vi.fn((name: string) => {
      const item = { name, removed: false };
      channels.push(item);
      const channel = {
        item,
        on: vi.fn(() => channel),
        subscribe: vi.fn(() => channel),
        unsubscribe: vi.fn(async () => "ok"),
        send: vi.fn(async () => "ok"),
        track: vi.fn(async () => {}),
        untrack: vi.fn(async () => {}),
        presenceState: () => ({}),
      };
      return channel;
    }),
    removeChannel: vi.fn(async (channel: { item: (typeof channels)[number] }) => {
      channel.item.removed = true;
      return "ok";
    }),
  };
  const rtc = {
    connectionStatus: "disconnected",
    micOn: false,
    camOn: false,
    screenOn: false,
    localScreenStream: null,
    localVideoStream: null,
    remoteStreams: {},
    remoteScreenStreams: {},
    connectedPeers: [],
    speakingPeers: new Set(),
    selfSpeaking: false,
    audioInputDevices: [],
    audioOutputDevices: [],
    videoDevices: [],
    selectedAudioInputDeviceId: null,
    selectedAudioOutputDeviceId: null,
    selectedVideoDeviceId: null,
    lastError: null,
    v2: null,
    toggleMic: vi.fn(async () => {}),
    toggleCam: vi.fn(async () => {}),
    toggleScreen: vi.fn(async () => {}),
    getLocalAudioTrack: () => null,
    setAudioInputDevice: vi.fn(),
    setAudioOutputDevice: vi.fn(),
    setVideoDevice: vi.fn(),
  };
  return { supabase, channels, rtc, uid, peer };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: io.supabase }));
vi.mock("@/lib/rtc/useLiveKit", () => ({ ACTIVE_RTC_ENGINE: "v2", useLiveKit: () => io.rtc }));
// Server RPC transport is an I/O boundary; component and overlay ownership are real.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  localStorage.clear();
  localStorage.setItem(`officeNotifSetupDone:${io.uid}`, "1");
  setCurrentWorkspaceId("10000000-0000-4000-8000-000000000001");
});
afterEach(() => {
  cleanup();
  setCurrentWorkspaceId(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("avatar's real interaction menu opens Chat without replacing the scene or its channels", async () => {
  const ws = "10000000-0000-4000-8000-000000000001";
  const api: ChatApi = {
    list: async () => [
      {
        id: "c",
        workspace_id: ws,
        participant_a: io.uid,
        participant_b: io.peer,
        created_at: "2026-10-14T10:00:00Z",
        last_message_at: null,
        last_message_seq: 0,
        read_seq: 0,
        unread_count: 0,
        peer_id: io.peer,
        peer_name: "Colega",
        peer_sprite_id: "marcio",
        peer_color: "",
        last_body: null,
        last_type: null,
        last_sender_id: null,
      },
    ],
    start: vi.fn(async () => "c"),
    history: async () => ({
      messages: [
        {
          id: "scene-message",
          conversation_id: "c",
          sender_id: io.uid,
          body: "Mensagem fixture",
          message_type: "text",
          seq: 1,
          created_at: "2026-10-15T10:00:00Z",
        },
      ],
      hasMore: false,
    }),
    supportsInteractions: () => true,
    send: vi.fn(),
    read: async () => {},
  };
  const realtime: ChatRealtime = { inbox: () => () => {}, messages: () => () => {} };
  function Experience() {
    const [panel, setPanel] = useState<OfficePanel | null>(null);
    return (
      <OfficeChat
        workspaceId={ws}
        userId={io.uid}
        panel={panel}
        onPanelChange={setPanel}
        api={api}
        realtime={realtime}
      >
        <OfficeScene panel={panel} onPanelChange={setPanel} />
      </OfficeChat>
    );
  }
  const route = createRootRoute({ component: Experience });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const peer = await screen.findByRole("button", { name: "Interagir com Colega" });
  const scene = document.querySelector("[data-office-topbar]")?.closest('[tabindex="0"]');
  expect(scene).toBeTruthy();
  await waitFor(() => expect(io.channels.length).toBeGreaterThan(0));
  const channelsBefore = io.channels.length;
  fireEvent.click(peer);
  fireEvent.click(await screen.findByRole("button", { name: "Enviar mensagem" }));
  await screen.findByRole("textbox", { name: "Mensagem" });
  const panelElement = screen.getByRole("dialog", { name: "Mensagens privadas" });
  const header = screen.getByText("Mensagens").closest("header")!;
  header.setPointerCapture = vi.fn();
  header.releasePointerCapture = vi.fn();
  const beforeLeft = parseFloat(panelElement.style.left);
  const dragPointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
    fireEvent(header, event);
  };
  dragPointer("pointerdown", 900, 80);
  dragPointer("pointermove", 820, 120);
  dragPointer("pointerup", 820, 120);
  expect(parseFloat(panelElement.style.left)).toBe(beforeLeft - 80);
  fireEvent.click(screen.getByLabelText("Reagir à mensagem 1"));
  const reactions = await screen.findByRole("toolbar", { name: "Reações rápidas" });
  expect(document.querySelector("[data-office-topbar]")?.closest('[tabindex="0"]')).toBe(scene);
  fireEvent.keyDown(reactions, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("toolbar", { name: "Reações rápidas" })).toBeNull(),
  );
  expect(screen.getByRole("dialog", { name: "Mensagens privadas" })).toBeTruthy();
  const optionEvent = new MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ctrlKey: false,
  });
  fireEvent(screen.getByLabelText("Opções da mensagem 1"), optionEvent);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Informações" }));
  const info = await screen.findByRole("dialog", { name: "Informações da mensagem" });
  expect(document.querySelector("[data-office-topbar]")?.closest('[tabindex="0"]')).toBe(scene);
  fireEvent.keyDown(info, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Informações da mensagem" })).toBeNull(),
  );
  expect(api.start).toHaveBeenCalledWith(ws, io.peer);
  expect(document.querySelector("[data-office-topbar]")?.closest('[tabindex="0"]')).toBe(scene);
  fireEvent.click(screen.getByLabelText("Fechar mensagens"));
  expect(document.querySelector("[data-office-topbar]")?.closest('[tabindex="0"]')).toBe(scene);
  expect(io.channels.length).toBe(channelsBefore);
  expect(io.channels.some((c) => c.removed)).toBe(false);
  expect(io.rtc.toggleMic).not.toHaveBeenCalled();
  expect(io.rtc.toggleCam).not.toHaveBeenCalled();
  expect(io.rtc.toggleScreen).not.toHaveBeenCalled();
  queryClient.clear();
});
