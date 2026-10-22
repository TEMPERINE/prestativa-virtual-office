import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRuntimeProfileMap, loadActiveVisitorProfiles, loadOfficeMemberProfiles, type VisitorProfile } from "../profiles";

const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: io }));
beforeEach(() => { vi.clearAllMocks(); });

// Simula o banco: memberships por workspace; a RPC devolve só membros do workspace pedido.
const memberships: Record<string, string[]> = { A: ["alice", "ana"], B: ["bob", "bruno"] };
const allProfiles = ["alice", "ana", "bob", "bruno", "thamires"].map((id) => ({ id, display_name: id, sprite_id: "marcio", avatar_color: "c", city: "private" }));
function mockRpc() {
  io.rpc.mockImplementation(async (_fn: string, { workspace_id }: { workspace_id: string }) => ({
    data: allProfiles.filter((p) => (memberships[workspace_id] ?? []).includes(p.id)), error: null,
  }));
}
const visitor = (id: string): VisitorProfile => ({ id, display_name: id, avatar_color: "v", sprite_id: null, status: "available", is_visitor: true });
async function team(ws: string, visitors: VisitorProfile[] = []) {
  return Object.keys(buildRuntimeProfileMap(await loadOfficeMemberProfiles(ws), visitors)).sort();
}

describe("Office identity loading", () => {
  it("returns only the four display fields through the workspace RPC", async () => {
    mockRpc();
    expect(await loadOfficeMemberProfiles("A")).toEqual([
      { id: "alice", display_name: "alice", sprite_id: "marcio", avatar_color: "c" },
      { id: "ana", display_name: "ana", sprite_id: "marcio", avatar_color: "c" },
    ]);
    expect(io.rpc).toHaveBeenCalledWith("workspace_runtime_profiles", { workspace_id: "A" });
    expect(io.from).not.toHaveBeenCalled();
  });
  it("never reads public.profiles directly for the team (members included)", async () => {
    mockRpc();
    await loadOfficeMemberProfiles("A", ["alice"]);
    expect(io.from).not.toHaveBeenCalled();
  });
  it("lazy IDs are local filters only", async () => {
    mockRpc();
    expect(await loadOfficeMemberProfiles("A", ["bob"])).toEqual([]);
    expect(io.rpc).toHaveBeenCalledWith("workspace_runtime_profiles", { workspace_id: "A" });
  });
  it("denied runtime throws without fallback", async () => {
    io.rpc.mockResolvedValue({ data: null, error: new Error("denied") });
    await expect(loadOfficeMemberProfiles("A")).rejects.toThrow("denied");
    expect(io.from).not.toHaveBeenCalled();
  });
  it("no workspace means no query", async () => {
    expect(await loadOfficeMemberProfiles(null)).toEqual([]);
    expect(io.rpc).not.toHaveBeenCalled();
  });
  it("members still resolve temporary visitors with the visitor marker", async () => {
    const q = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(), then: (fn: (v: unknown) => unknown) => Promise.resolve({ data: [{ user_id: "visitor", display_name: "Temporary", sprite_id: "marcio" }] }).then(fn) };
    io.from.mockReturnValue(q);
    expect(await loadActiveVisitorProfiles("A")).toEqual([expect.objectContaining({ id: "visitor", is_visitor: true })]);
    expect(io.from).toHaveBeenCalledWith("workspace_visitors");
  });
});

describe("Multi-workspace team isolation", () => {
  beforeEach(() => { memberships.A = ["alice", "ana"]; memberships.B = ["bob", "bruno"]; mockRpc(); });
  it("workspace A shows exactly Alice and Ana", async () => {
    expect(await team("A")).toEqual(["alice", "ana"]);
  });
  it("workspace B shows exactly Bob and Bruno", async () => {
    expect(await team("B")).toEqual(["bob", "bruno"]);
  });
  it("profiles without membership (e.g. other company) never enter the team", async () => {
    expect(await team("A")).not.toContain("thamires");
  });
  it("multi-membership is legitimate: Alice in A and B appears in both", async () => {
    memberships.B = ["bob", "bruno", "alice"];
    expect(await team("A")).toContain("alice");
    expect(await team("B")).toEqual(["alice", "bob", "bruno"]);
  });
  it("visitors stay in their own workspace", async () => {
    expect(await team("A", [visitor("VA")])).toEqual(["VA", "alice", "ana"]);
    expect(await team("B", [visitor("VB")])).toEqual(["VB", "bob", "bruno"]);
  });
  it("removed membership disappears on the next rebuild", async () => {
    expect(await team("A")).toContain("ana");
    memberships.A = ["alice"];
    expect(await team("A")).toEqual(["alice"]);
  });
  it("offline count only covers the current workspace", async () => {
    const map = buildRuntimeProfileMap(await loadOfficeMemberProfiles("B"), []);
    const online = new Set(["bob"]);
    const offline = Object.values(map).filter((p) => !online.has(p.id)).map((p) => p.id);
    expect(offline).toEqual(["bruno"]);
  });
  it("self keeps full fields only when a member of the workspace", async () => {
    const rows = await loadOfficeMemberProfiles("A");
    const map = buildRuntimeProfileMap(rows, [], { id: "alice", tagline: "oi" } as { id: string; tagline: string });
    expect((map.alice as unknown as { tagline: string }).tagline).toBe("oi");
    expect(buildRuntimeProfileMap(rows, [], { id: "bob" }).bob).toBeUndefined();
  });
});
