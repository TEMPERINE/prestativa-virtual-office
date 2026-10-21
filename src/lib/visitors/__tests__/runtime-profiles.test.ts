import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadActiveVisitorProfiles, loadOfficeMemberProfiles } from "../profiles";

const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: io }));
beforeEach(() => { vi.clearAllMocks(); });
describe("Office identity loading", () => {
  it("visitor receives four display fields only through the workspace RPC", async () => {
    io.rpc.mockResolvedValue({ data: [{ id: "member-a", display_name: "Member A", sprite_id: "marcio", avatar_color: "color", birth_date: "private", city: "private" }], error: null });
    expect(await loadOfficeMemberProfiles("workspace-a", true)).toEqual([{ id: "member-a", display_name: "Member A", sprite_id: "marcio", avatar_color: "color" }]);
    expect(io.rpc).toHaveBeenCalledWith("workspace_runtime_profiles", { workspace_id: "workspace-a" });
    expect(io.from).not.toHaveBeenCalled();
  });
  it("lazy IDs are local filters, never arbitrary identity arguments to RPC", async () => {
    io.rpc.mockResolvedValue({ data: [{ id: "member-a" }], error: null });
    expect(await loadOfficeMemberProfiles("workspace-a", true, ["member-b"])).toEqual([]);
    expect(io.rpc).toHaveBeenCalledWith("workspace_runtime_profiles", { workspace_id: "workspace-a" });
  });
  it("denied runtime never falls back to direct profiles", async () => {
    io.rpc.mockResolvedValue({ data: null, error: new Error("denied") });
    await expect(loadOfficeMemberProfiles("workspace-a", true)).rejects.toThrow("denied");
    expect(io.from).not.toHaveBeenCalled();
  });
  it("visitor without workspace makes no identity query", async () => {
    expect(await loadOfficeMemberProfiles(null, true)).toEqual([]);
    expect(io.rpc).not.toHaveBeenCalled();
    expect(io.from).not.toHaveBeenCalled();
  });
  it("member retains normal profiles source", async () => {
    const rows = [{ id: "member-a", display_name: "Member A", tagline: "Existing" }];
    const q = { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), then: (fn: (v: unknown) => unknown) => Promise.resolve({ data: rows }).then(fn) };
    io.from.mockReturnValue(q);
    expect(await loadOfficeMemberProfiles("workspace-a", false)).toEqual(rows);
    expect(io.from).toHaveBeenCalledWith("profiles");
    expect(io.rpc).not.toHaveBeenCalled();
  });
  it("members still resolve separate temporary visitors with the visitor badge marker", async () => {
    const q = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(), then: (fn: (v: unknown) => unknown) => Promise.resolve({ data: [{ user_id: "visitor", display_name: "Temporary", sprite_id: "marcio" }] }).then(fn) };
    io.from.mockReturnValue(q);
    expect(await loadActiveVisitorProfiles("workspace-a")).toEqual([expect.objectContaining({ id: "visitor", display_name: "Temporary", sprite_id: "marcio", is_visitor: true })]);
    expect(io.from).toHaveBeenCalledWith("workspace_visitors");
  });
});