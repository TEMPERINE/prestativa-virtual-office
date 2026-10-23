// @vitest-environment jsdom
/** Real OfficeScene and map lifecycle; only Auth/DB/network/media I/O is fake. */
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
  let visitorMode = false;
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
        ? visitorMode ? [] : profiles
        : table === "workspace_visitors" && visitorMode
          ? [{ user_id: uid, display_name: "Temporary", sprite_id: "marcio" }]
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
    rpc: vi.fn(async (name: string) => ({ data: name === "workspace_runtime_profiles" ? profiles.filter((p) => p.id === peer) : null, error: null })),
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
    profiles,
    setMapRead: (p: Promise<unknown>) => {
      mapRead = p;
    },
    setOwnClaim: (id: string | null) => {
      ownClaim = id;
    },
    setSavedDbPosition: (value: boolean) => {
      includeSavedDbPosition = value;
    },
    setVisitorMode: (value: boolean) => { visitorMode = value; },
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
  io.setVisitorMode(false);
  io.supabase.from.mockClear();
  io.supabase.rpc.mockClear();
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

async function mountScene(audience: "member" | "visitor" = "member") {
  const route = createRootRoute({ component: () => <OfficeScene audience={audience} /> });
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
it("visitor scene loads colleague identities from authorized RPC without reading member profiles", async () => {
  io.setVisitorMode(true);
  io.setMapRead(Promise.resolve({ data: openMap(), version: 1 }));
  const done = await mountScene("visitor");
  await waitFor(() => expect(io.supabase.rpc).toHaveBeenCalledWith("workspace_runtime_profiles", {
    workspace_id: "10000000-0000-4000-8000-000000000001",
  }));
  expect(io.supabase.from.mock.calls.some(([table]) => table === "profiles")).toBe(false);
  expect(io.supabase.from).toHaveBeenCalledWith("workspace_visitors");
  done();
});
it("visitor without onboarded_at enters Office directly: no member onboarding nor notifications prompt", async () => {
  io.setVisitorMode(true);
  localStorage.removeItem(`officeNotifSetupDone:${io.uid}`);
  io.setMapRead(Promise.resolve({ data: openMap(), version: 1 }));
  const done = await mountScene("visitor");
  await waitFor(() => expect(document.querySelector("[data-office-topbar]")).not.toBeNull());
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByText("Bem-vindo ao Prestativa Office")).toBeNull();
  expect(screen.queryByText("Não perca nenhum chamado")).toBeNull();
  expect(screen.queryByText("Refazer onboarding")).toBeNull();
  expect(io.supabase.from.mock.calls.some(([t]) => t === "profiles")).toBe(false);
  done();
});
it("member without onboarded_at still gets the member onboarding", async () => {
  const prev = io.profiles[0].onboarded_at;
  (io.profiles[0] as any).onboarded_at = null;
  try {
    io.setMapRead(Promise.resolve({ data: openMap(), version: 1 }));
    const done = await mountScene();
    expect(await screen.findByText("Bem-vindo ao Prestativa Office")).toBeTruthy();
    done();
  } finally { io.profiles[0].onboarded_at = prev; }
});
it("onboarded member does not get the onboarding", async () => {
  io.setMapRead(Promise.resolve({ data: openMap(), version: 1 }));
  const done = await mountScene();
  await waitFor(() => expect(document.querySelector("[data-office-topbar]")).not.toBeNull());
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByText("Bem-vindo ao Prestativa Office")).toBeNull();
  done();
});
const saved = () => JSON.parse(localStorage.getItem(`office:last-position:v1:${io.uid}`)!);
it("does not correct a saved point before canonical load, then recovers nearby and persists normally", async () => {
  let resolve!: (row: unknown) => void;
  io.setMapRead(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const done = await mountScene();
  expect(saved()).toMatchObject({ x: 0.5, y: 0.5 });
  expect(io.persisted.every((p) => p.x === 0.5 && p.y === 0.5)).toBe(true);
  const map = openMap();
  map.blocked[40 * 128 + 64] = 1;
  act(() => resolve({ data: map, version: 1 }));
  await waitFor(() => expect(saved().x === 0.5 && saved().y === 0.5).toBe(false));
  expect(isMapWalkable(map, saved())).toBe(true);
  expect(Math.hypot(saved().x - 0.5, saved().y - 0.5)).toBeLessThan(0.04);
  expect(io.persisted.some((p) => p.x === saved().x && p.y === saved().y)).toBe(true);
  done();
});
it("does not relocate from an unconfirmed cache when the canonical same-version map is clear", async () => {
  const cache = openMap();
  cache.blocked[40 * 128 + 64] = 1;
  getMapSync().restoreCache(cache, 1);
  let resolve!: (row: unknown) => void;
  io.setMapRead(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const done = await mountScene();
  expect(saved()).toMatchObject({ x: 0.5, y: 0.5 });
  act(() => resolve({ data: openMap(), version: 1 }));
  await waitFor(() =>
    expect({ state: getMapSync().snapshot().state, error: getMapSync().snapshot().error }).toEqual({
      state: "READY",
      error: null,
    }),
  );
  expect(saved()).toMatchObject({ x: 0.5, y: 0.5 });
  expect(io.persisted.every((p) => p.x === 0.5 && p.y === 0.5)).toBe(true);
  done();
});
it("a map update recovers a blocked live position once without remounting Office or restarting channels", async () => {
  io.setMapRead(Promise.resolve({ data: openMap(), version: 1 }));
  const done = await mountScene();
  await waitFor(() =>
    expect({ state: getMapSync().snapshot().state, error: getMapSync().snapshot().error }).toEqual({
      state: "READY",
      error: null,
    }),
  );
  const scene = document.querySelector("[data-office-topbar]")?.closest('[tabindex="0"]');
  const count = io.channels.length;
  const map = openMap();
  map.blocked[40 * 128 + 64] = 1;
  act(() => getMapSync().applyConfirmed(map, 2));
  await waitFor(() => expect(saved().x === 0.5 && saved().y === 0.5).toBe(false));
  const corrected = io.persisted.filter((p) => p.x === saved().x && p.y === saved().y).length;
  act(() => window.dispatchEvent(new CustomEvent("map-overrides-changed")));
  await waitFor(() => expect(isMapWalkable(map, saved())).toBe(true));
  expect(io.persisted.filter((p) => p.x === saved().x && p.y === saved().y)).toHaveLength(
    corrected,
  );
  expect(document.querySelector("[data-office-topbar]")?.closest('[tabindex="0"]')).toBe(scene);
  expect(io.channels).toHaveLength(count);
  expect(io.channels.some((c) => c.removed)).toBe(false);
  done();
});

it("keeps a local persisted point unchanged while the canonical map is still loading, even without a DB snapshot", async () => {
  io.setSavedDbPosition(false);
  const point = { x: 0.4, y: 0.2, ts: Date.now(), facing: "down", zone: "diretoria" };
  localStorage.setItem(`office:last-position:v1:${io.uid}`, JSON.stringify(point));
  let resolve!: (row: unknown) => void;
  io.setMapRead(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const done = await mountScene();
  expect(saved()).toMatchObject({ x: point.x, y: point.y });
  act(() => resolve({ data: openMap(), version: 1 }));
  await waitFor(() => expect(getMapSync().snapshot().state).toBe("READY"));
  expect(saved()).toMatchObject({ x: point.x, y: point.y });
  done();
});
it("rebuilds painted workspace hit areas after a map update and never gives the parent bounds pointer events", async () => {
  io.setMapRead(Promise.resolve({ data: openMap(), version: 1 }));
  const done = await mountScene();
  await waitFor(() => expect(getMapSync().snapshot().state).toBe("READY"));
  const map = openMap();
  map.customZones = [{ id: "custom-l", label: "Área L", color: "#00ffff", kind: "workspace" }];
  for (let c = 40; c < 50; c++) map.zones[30 * 128 + c] = "custom-l" as never;
  for (let r = 31; r < 40; r++) map.zones[r * 128 + 40] = "custom-l" as never;
  act(() => getMapSync().applyConfirmed(map, 2));
  const path = await waitFor(() => {
    const p = document.querySelector('[data-workspace-hit="custom-l"]');
    expect(p).toBeTruthy();
    return p!;
  });
  const bounds = path.parentElement!.parentElement!;
  expect(bounds.style.pointerEvents).toBe("none");
  expect(path.getAttribute("pointer-events")).toBe("all");
  vi.spyOn(bounds, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
    width: 100,
    height: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  fireEvent.pointerEnter(path);
  expect(await screen.findByRole("button", { name: /Reivindicar/ })).toBeTruthy();
  fireEvent(document, new MouseEvent("pointermove", { clientX: 5, clientY: 50 }));
  expect(screen.getByRole("button", { name: /Reivindicar/ })).toBeTruthy();
  fireEvent(document, new MouseEvent("pointermove", { clientX: 50, clientY: 50 }));
  await waitFor(() => expect(screen.queryByRole("button", { name: /Reivindicar/ })).toBeNull());
  fireEvent.pointerEnter(path);
  const common = { ...map, zoneKinds: { "custom-l": "common" as const } };
  act(() => getMapSync().applyConfirmed(common, 3));
  await waitFor(() => expect(document.querySelector('[data-workspace-hit="custom-l"]')).toBeNull());
  done();
});

it("real keyboard movement stays clear while sliding along a one-cell wall", async () => {
  const map = openMap();
  for (let r = 0; r < 80; r++) map.blocked[r * 128 + 64] = 1;
  localStorage.setItem(
    `office:last-position:v1:${io.uid}`,
    JSON.stringify({ x: 0.4859, y: 0.4, ts: Date.now(), facing: "down" }),
  );
  io.setMapRead(Promise.resolve({ data: map, version: 1 }));
  const done = await mountScene();
  await waitFor(() => expect(getMapSync().snapshot().state).toBe("READY"));
  fireEvent.keyDown(window, { key: "ArrowRight" });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 90));
  });
  fireEvent.keyUp(window, { key: "ArrowRight" });
  expect(saved().x).toBe(0.4859);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  await waitFor(() => expect(saved().y).toBeGreaterThan(0.41));
  fireEvent.keyUp(window, { key: "ArrowDown" });
  expect(saved().x).toBe(0.4859);
  expect(isMapWalkable(map, saved())).toBe(true);
  done();
});

it("an inactivity return validates the captured old point against the updated map", async () => {
  const observe = vi.spyOn(MeetingReturnPosition.prototype, "observe");
  const guard = vi.spyOn(idleGuardModule, "useMeetingIdleGuard");
  io.setMapRead(Promise.resolve({ data: openMap(), version: 1 }));
  const done = await mountScene();
  await waitFor(() => expect(getMapSync().snapshot().state).toBe("READY"));
  const returns = observe.mock.contexts.at(-1);
  if (!(returns instanceof MeetingReturnPosition)) throw new Error("Missing real return-position instance");
  const previous = { x: 0.4, y: 0.4 };
  returns.observe(previous, false);
  returns.observe({ x: 0.5, y: 0.5 }, true);
  const map = openMap();
  map.blocked[32 * 128 + 51] = 1;
  act(() => getMapSync().applyConfirmed(map, 2));
  expect(saved()).toMatchObject({ x: 0.5, y: 0.5 });
  act(() => guard.mock.calls.at(-1)![0].onEject("custom-meeting"));
  await waitFor(() => expect(saved().x === 0.5 && saved().y === 0.5).toBe(false));
  expect(isMapWalkable(map, saved())).toBe(true);
  expect(Math.hypot(saved().x - previous.x, saved().y - previous.y)).toBeLessThan(0.04);
  done();
});
it("a zone teleport is cancelled if its painting disappears during the animation", async () => {
  const map = openMap();
  map.customZones = [
    { id: "custom-target", label: "Área alvo", color: "#00ffff", kind: "workspace" },
  ];
  for (let r = 30; r <= 45; r++)
    for (let c = 80; c <= 95; c++) map.zones[r * 128 + c] = "custom-target" as never;
  map.spawnPoints = { "custom-target": { x: 0.68, y: 0.45 } };
  io.setOwnClaim("custom-target");
  io.setMapRead(Promise.resolve({ data: map, version: 1 }));
  const done = await mountScene();
  await waitFor(() => expect(getMapSync().snapshot().state).toBe("READY"));
  fireEvent.keyDown(window, { key: "d", ctrlKey: true });
  await screen.findByText(/Teleportando para Área alvo/);
  act(() => getMapSync().applyConfirmed(openMap(), 2));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 550));
  });
  expect(saved()).toMatchObject({ x: 0.5, y: 0.5 });
  done();
});
