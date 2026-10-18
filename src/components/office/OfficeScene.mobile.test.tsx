// @vitest-environment jsdom
/** Mobile (touch/coarse) vs desktop (mouse/fine) on the real OfficeScene; only I/O is fake. */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OfficeScene } from "@/components/office/OfficeScene";
import { setCurrentWorkspaceId } from "@/lib/workspace/current";
import { getMapSync, __resetMapSyncForTests, newOverrides } from "@/lib/map-overrides";
import * as idleGuardModule from "@/lib/meetings/useMeetingIdleGuard";
import { MeetingReturnPosition } from "@/lib/meetings/meeting-inactivity-controller";
import { isMapWalkable } from "@/lib/office-map";

const io = vi.hoisted(() => {
  const uid = "00000000-0000-4000-8000-000000000001",
    peer = "00000000-0000-4000-8000-000000000002";
  let mapRead: Promise<unknown> = Promise.resolve(null);
  let includeSavedDbPosition = true;
  let ownClaim: string | null = null;
  const persisted: Record<string, any>[] = [];
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
          ? profiles
              .filter((p) => includeSavedDbPosition || p.id !== uid)
              .map((p, i) => ({
                user_id: p.id,
                x: 0.5 + i * 0.04,
                y: 0.5,
                facing: "down",
                zone: "lobby",
                is_online: true,
                updated_at: "2026-10-14T10:00:00Z",
              }))
          : table === "workspace_claims" && ownClaim
            ? [{ zone_id: ownClaim, user_id: uid }]
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
    query.upsert = (value: Record<string, unknown>) => {
      if (table === "positions") persisted.push(value);
      return query;
    };
    query.maybeSingle = async () => {
      return {
        data:
          table === "map_overrides"
            ? await mapRead
            : table === "workspaces"
              ? { tier: 3 }
              : table === "profiles"
                ? profiles[0]
                : null,
        error: null,
      };
    };
    query.single = query.maybeSingle;
    return query;
  });
  const supabase = {
    from,
    rpc: vi.fn(async () => ({ data: null, error: null })),
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
  return {
    supabase,
    channels,
    rtc,
    uid,
    peer,
    persisted,
    setMapRead: (p: Promise<unknown>) => {
      mapRead = p;
    },
    setOwnClaim: (id: string | null) => {
      ownClaim = id;
    },
    setSavedDbPosition: (value: boolean) => {
      includeSavedDbPosition = value;
    },
  };
});
vi.mock("@/lib/custom-props", async () => {
  const { setCustomProps } = await import("@/lib/prop-catalog");
  return {
    loadCustomPropsFromCloud: async () =>
      setCustomProps([{ id: "lamp-custom", label: "Luminária", frames: ["a.png", "b.png"], defaultW: 0.03, aspectRatio: 1, interactive: true, interactKey: "x" }]),
  };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: io.supabase }));
vi.mock("@supabase/supabase-js", async (original) => ({
  ...(await original<typeof import("@supabase/supabase-js")>()),
  createClient: () => io.supabase,
}));
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
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  io.persisted.length = 0;
  io.channels.length = 0;
  io.setSavedDbPosition(true);
  io.setOwnClaim(null);
  __resetMapSyncForTests();
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

async function mountScene() {
  const route = createRootRoute({ component: () => <OfficeScene /> });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(io.persisted.length).toBeGreaterThan(0));
  return () => client.clear();
}
const openMap = () => ({ ...newOverrides(), theme: "default" });
const saved = () => JSON.parse(localStorage.getItem(`office:last-position:v1:${io.uid}`)!);

// ---- input environment -------------------------------------------------
let coarse = false;
let viewportWidth = 1500, viewportHeight = 1000;
class FakePointerEvent extends MouseEvent {
  pointerId: number; pointerType: string; isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
    this.isPrimary = init.isPrimary ?? true;
  }
}
beforeEach(() => {
  viewportWidth = 1500; viewportHeight = 1000;
  vi.stubGlobal("PointerEvent", FakePointerEvent);
  window.matchMedia = ((q: string) => ({
    matches: q.includes("coarse") ? coarse : false,
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return this.dataset?.testid === "office-stage" ? viewportHeight * 1.5 : this.tabIndex === 0 ? viewportWidth : 0; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return this.dataset?.testid === "office-stage" || this.tabIndex === 0 ? viewportHeight : 0; } });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const left = this.dataset?.testid === "office-stage" ? Math.max(0, (viewportWidth - viewportHeight * 1.5) / 2) : 0;
    return { x: left, y: 0, left, top: 0, width: this.clientWidth, height: this.clientHeight, right: left + this.clientWidth, bottom: this.clientHeight, toJSON() {} };
  });
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
});
afterEach(() => {
  coarse = false;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
});

const DOOR = { id: "p-door", defId: "door", x: 0.3, y: 0.3, w: 0.04, interactive: true, frame: 0 };
const BELL = { id: "p-bell", defId: "bell-meta", x: 0.8, y: 0.8, w: 0.04, interactive: true };
const LAMP = { id: "p-lamp", defId: "lamp-custom", x: 0.2, y: 0.8, w: 0.03, interactive: true };
const mapWithProps = () => ({ ...openMap(), props: [DOOR, BELL, LAMP] });
async function ready() {
  io.setMapRead(Promise.resolve({ data: mapWithProps(), version: 1 }));
  const done = await mountScene();
  await waitFor(() => expect(getMapSync().snapshot().state).toBe("READY"));
  return done;
}
const stage = () => screen.getByTestId("office-stage");
const ptr = (el: Element, type: string, x: number, y: number, pointerType: string, pointerId = 1) =>
  fireEvent(el, new FakePointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType, pointerId, button: 0 }));
const panLayer = () => stage().children[0] as HTMLElement;
const zoomLayer = () => panLayer().children[0] as HTMLElement;
const sentTicks = () =>
  io.supabase.channel.mock.results.flatMap((r: any) => r.value.send.mock.calls.map((c: any[]) => c[0]))
    .filter((m: any) => m?.event === "prop_tick").map((m: any) => m.payload.propId);

// ---- MOBILE --------------------------------------------------------------
it("mobile: double tap no chão inicia rota (anel no destino); single tap não", async () => {
  coarse = true;
  const done = await ready();
  ptr(stage(), "pointerdown", 700, 500, "touch"); ptr(stage(), "pointerup", 700, 500, "touch");
  expect(screen.queryByTestId("touch-route-marker")).toBeNull();
  ptr(stage(), "pointerdown", 702, 500, "touch"); ptr(stage(), "pointerup", 702, 500, "touch");
  await waitFor(() => expect(screen.getByTestId("touch-route-marker").dataset.ok).toBe("true"));
  done();
});
it("mobile: tap em porta, sino e prop customizado aciona de longe pelo handler da tecla X", async () => {
  coarse = true;
  const done = await ready();
  await waitFor(() => expect(document.querySelector('[data-touch-prop="p-lamp"]')).not.toBeNull());
  fireEvent.click(document.querySelector('[data-touch-prop="p-door"]')!);
  await waitFor(() => expect(sentTicks()).toContain("p-door"));
  fireEvent.click(document.querySelector('[data-touch-prop="p-lamp"]')!);
  await waitFor(() => expect(sentTicks()).toContain("p-lamp"));
  // Sino abre o mesmo popover que a tecla X abre.
  fireEvent.click(document.querySelector('[data-touch-prop="p-bell"]')!);
  await waitFor(() => expect(screen.getAllByRole("button").some((b) => /tocar/i.test(b.textContent ?? ""))).toBe(true));
  // Tocar no prop nunca inicia caminhada.
  expect(screen.queryByTestId("touch-route-marker")).toBeNull();
  done();
});
it("mobile: tap no próprio avatar centraliza e reativa follow, sem menu nem rota", { timeout: 15000 }, async () => {
  coarse = true;
  const done = await ready();
  ptr(stage(), "pointerdown", 700, 500, "touch"); ptr(stage(), "pointermove", 500, 400, "touch"); ptr(stage(), "pointerup", 500, 400, "touch");
  await waitFor(() => expect(screen.getByTestId("center-on-me").getAttribute("aria-label")).toBe("Centralizar em mim"));
  fireEvent.click(await screen.findByTestId("touch-self-avatar"));
  await waitFor(() => expect(screen.getByTestId("center-on-me").getAttribute("aria-label")).toBe("Câmera seguindo você"), { timeout: 5000 });
  expect(screen.queryByTestId("touch-route-marker")).toBeNull();
  done();
});
it("mobile: arrastar move câmera e pinça altera o zoom", async () => {
  coarse = true;
  const done = await ready();
  ptr(stage(), "pointerdown", 100, 100, "touch", 1); ptr(stage(), "pointerdown", 200, 100, "touch", 2);
  ptr(stage(), "pointermove", 300, 100, "touch", 2);
  await waitFor(() => expect(zoomLayer().style.transform).toBe("scale(2)"));
  ptr(stage(), "pointerup", 100, 100, "touch", 1); ptr(stage(), "pointerup", 300, 100, "touch", 2);
  const before = panLayer().style.transform;
  ptr(stage(), "pointerdown", 700, 500, "touch", 3); ptr(stage(), "pointermove", 640, 470, "touch", 3); ptr(stage(), "pointerup", 640, 470, "touch", 3);
  await waitFor(() => expect(panLayer().style.transform).not.toBe(before));
  done();
});
it("mobile: painel de mesa e controles não disparam gestos do mapa", async () => {
  coarse = true;
  const done = await ready();
  const ctrl = screen.getByTestId("map-controls");
  ptr(ctrl, "pointerdown", 10, 10, "touch"); ptr(ctrl, "pointerup", 10, 10, "touch");
  ptr(ctrl, "pointerdown", 10, 10, "touch"); ptr(ctrl, "pointerup", 10, 10, "touch");
  expect(screen.queryByTestId("touch-route-marker")).toBeNull();
  done();
});
it("mobile: rotação para horizontal mostra mapa inteiro sem remontar Office nem canais", async () => {
  coarse = true;
  viewportWidth = 390; viewportHeight = 844;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  const done = await ready();
  ptr(stage(), "pointerdown", 100, 100, "touch", 1); ptr(stage(), "pointerdown", 200, 100, "touch", 2);
  ptr(stage(), "pointermove", 250, 100, "touch", 2);
  ptr(stage(), "pointerup", 100, 100, "touch", 1); ptr(stage(), "pointerup", 250, 100, "touch", 2);
  const node = stage(); const count = io.channels.length;
  viewportWidth = 844; viewportHeight = 390;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 844 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 390 });
  await act(async () => { window.dispatchEvent(new Event("orientationchange")); window.dispatchEvent(new Event("resize")); await new Promise((r) => setTimeout(r, 30)); });
  expect(stage()).toBe(node);
  expect(zoomLayer().style.transform).toBe("scale(1)");
  expect(panLayer().style.transform).toBe("translate3d(0px, 0px, 0)");
  expect(io.channels).toHaveLength(count);
  expect(io.channels.some((c) => c.removed)).toBe(false);
  done();
});

it("mobile: portrait starts and walks centered in the visible screen, not the oversized stage", async () => {
  coarse = true;
  viewportWidth = 390; viewportHeight = 844;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  const done = await ready();
  const centered = () => {
    const position = saved();
    const transform = panLayer().style.transform;
    const x = Number(transform.match(/translate3d\(([-\d.]+)px/)?.[1]);
    expect(x + position.x * 1266).toBeCloseTo(195, 0);
  };
  await waitFor(centered);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
  fireEvent.keyUp(window, { key: "ArrowRight" });
  await waitFor(centered);
  done();
});

// ---- DESKTOP -------------------------------------------------------------
it("desktop: nenhum controle mobile aparece para mouse", async () => {
  const done = await ready();
  expect(screen.queryByTestId("touch-self-avatar")).toBeNull();
  expect(document.querySelector("[data-touch-prop]")).toBeNull();
  expect(screen.queryByTestId("mobile-zone-sheet")).toBeNull();
  done();
});
it("desktop: drag com mouse continua pan, wheel continua zoom, duplo clique não cria rota", async () => {
  const done = await ready();
  fireEvent.wheel(stage(), { deltaY: -100, clientX: 700, clientY: 500 });
  await waitFor(() => expect(zoomLayer().style.transform).not.toBe("scale(1)"));
  const before = panLayer().style.transform;
  ptr(stage(), "pointerdown", 700, 500, "mouse"); ptr(stage(), "pointermove", 600, 450, "mouse"); ptr(stage(), "pointerup", 600, 450, "mouse");
  await waitFor(() => expect(panLayer().style.transform).not.toBe(before));
  ptr(stage(), "pointerdown", 700, 500, "mouse"); ptr(stage(), "pointerup", 700, 500, "mouse");
  ptr(stage(), "pointerdown", 700, 500, "mouse"); ptr(stage(), "pointerup", 700, 500, "mouse");
  expect(screen.queryByTestId("touch-route-marker")).toBeNull();
  done();
});
it("desktop: setas movem e a tecla X só aciona a porta por proximidade", async () => {
  const done = await ready();
  const start = { ...saved() };
  fireEvent.keyDown(window, { key: "ArrowRight" });
  await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
  fireEvent.keyUp(window, { key: "ArrowRight" });
  await waitFor(() => expect(saved().x).toBeGreaterThan(start.x));
  // avatar está longe da porta (0.3,0.3): X não aciona remotamente.
  fireEvent.keyDown(window, { key: "x" });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(sentTicks()).not.toContain("p-door");
  done();
});
