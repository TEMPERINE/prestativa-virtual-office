// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MapEditor } from "./MapEditor";
import {
  newOverrides,
  __resetMapSyncForTests,
  loadOverrides,
  type MapOverrides,
} from "@/lib/map-overrides";
import { setCurrentWorkspaceId } from "@/lib/workspace/current";
const io = vi.hoisted(() => {
  let map: unknown = null,
    version = 1;
  const writes: unknown[] = [],
    blobs: Blob[] = [];
  const from = vi.fn((table: string) => {
    const q: Record<string, any> = {
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    for (const op of ["select", "eq", "neq", "order", "limit", "in", "delete", "update", "insert"])
      q[op] = () => q;
    q.upsert = (row: { data: unknown }) => {
      if (table === "map_overrides") {
        writes.push(row);
        map = row.data;
        version++;
      }
      return q;
    };
    q.maybeSingle = async () => ({
      data:
        table === "map_overrides"
          ? { data: map, version }
          : table === "workspaces"
            ? { tier: 3 }
            : null,
      error: null,
    });
    q.single = q.maybeSingle;
    return q;
  });
  return {
    writes,
    blobs,
    from,
    setMap: (m: unknown) => {
      map = m;
      version = 1;
    },
    supabase: {
      from,
      rpc: async () => ({ data: false, error: null }),
      auth: { getUser: async () => ({ data: { user: { id: "fixture-user" } } }) },
    },
  };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: io.supabase }));
vi.mock("@/components/ui/app-dialogs", () => ({
  appPrompt: async () => "Nova área",
  appConfirm: async () => true,
}));
function fixture(): MapOverrides {
  const m = newOverrides();
  m.customZones = [
    { id: "custom-a", label: "Área existente", color: "#00ffff", kind: "workspace" },
  ];
  for (let r = 30; r <= 40; r++)
    for (let c = 50; c <= 65; c++) m.zones[r * 128 + c] = "custom-a" as never;
  m.spawnPoints = { "custom-a": { x: 58 / 128, y: 35 / 80 } };
  return m;
}
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  localStorage.clear();
  setCurrentWorkspaceId("fixture-workspace");
  __resetMapSyncForTests();
  io.writes.length = 0;
  io.blobs.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
  } as never);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((b: Blob) => {
      io.blobs.push(b);
      return "blob:fixture";
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  for (const c of clients) c.clear();
  clients.length = 0;
  setCurrentWorkspaceId(null);
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});
async function open(map = fixture()) {
  io.setMap(map);
  const route = createRootRoute({ component: MapEditor });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Áreas" });
  await waitFor(() => expect(loadOverrides()?.customZones?.[0]?.id).toBe("custom-a"));
}
it("invalid areas are diagnosed and Save cannot publish them", async () => {
  const m = fixture();
  m.zones.fill(null);
  await open(m);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^(Salvar|Salvo)$/ }).hasAttribute("disabled")).toBe(
      true,
    ),
  );
  expect(await screen.findByText(/Área existente: nenhuma célula pintada/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^(Salvar|Salvo)$/ }));
  expect(io.writes).toEqual([]);
});
it("a valid map with a non-destructive warning can be saved", async () => {
  const m = fixture();
  m.spawnPoints = {};
  await open(m);
  await screen.findByText(/Área existente: sem ponto explícito/);
  const save = screen.getByRole("button", { name: /^(Salvar|Salvo)$/ });
  expect(save.hasAttribute("disabled")).toBe(false);
  fireEvent.click(save);
  await waitFor(() => expect(io.writes).toHaveLength(1));
});
it("new zones export an explicit workspace kind and remain switchable to common", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Áreas" }));
  fireEvent.click(screen.getByTitle("Adicionar nova zona"));
  await screen.findByText("Nova área");
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  const read = async (blob: Blob) =>
    JSON.parse(
      await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsText(blob);
      }),
    );
  const exported = await read(io.blobs.at(-1)!);
  expect(exported.customZones.find((z: { label: string }) => z.label === "Nova área").kind).toBe(
    "workspace",
  );
  const row = screen.getByText("Nova área").closest(".group")!;
  fireEvent.click(row.querySelector('[title="Local de trabalho (reivindicável)"]')!);
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  const common = await read(io.blobs.at(-1)!);
  expect(
    common.zoneKinds[
      exported.customZones.find((z: { label: string }) => z.label === "Nova área").id
    ],
  ).toBe("common");
  expect(io.writes).toEqual([]);
});
