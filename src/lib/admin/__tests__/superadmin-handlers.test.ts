import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ serviceCalls: 0, mapWritten: null as any }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (data: any) => data;
    const builder = {
      middleware: () => builder,
      inputValidator: (fn: any) => { validate = fn; return builder; },
      handler: (fn: any) => (args: any) => fn({ ...args, data: validate(args?.data) }),
    };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => {
  const query = () => {
    state.serviceCalls++;
    const chain: any = { then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve) };
    for (const name of ["select", "in", "eq", "order", "update", "delete", "insert"])
      chain[name] = () => chain;
    chain.upsert = (row: any) => { state.mapWritten = row; return chain; };
    chain.single = async () => ({ data: { data: state.mapWritten?.data, version: 18 }, error: null });
    chain.maybeSingle = async () => ({ data: null, error: null });
    return chain;
  };
  return { supabaseAdmin: {
    auth: { admin: { listUsers: async () => { state.serviceCalls++; return { data: { users: [] }, error: null }; } } },
    from: query,
  } };
});
import { adminListAccounts } from "../accounts.functions";
import { adminListWorkspacesFull } from "../workspaces.functions";
import { adminListSkins } from "../sprites.functions";
import { adminReadWorkspaceMap, adminWriteWorkspaceMap, adminManageSavePoints, adminManageCustomProps } from "../workspace-resources.functions";

function context(roles: string[], rpcError: unknown = null) {
  // Auth middleware is outside this unit: it supplies a verified session.
  // These adapters model the two DB contracts, not the authorization decision.
  const chain: any = { select: () => chain, eq: () => chain,
    maybeSingle: async () => ({ data: roles.includes("admin") ? { role: "admin" } : null, error: rpcError }) };
  return { userId: "fixture-actor", supabase: {
    from: () => chain,
    rpc: async () => ({ data: roles.includes("superadmin"), error: rpcError }),
  } };
}

describe("global server handlers", () => {
  beforeEach(() => { state.serviceCalls = 0; });
  for (const [name, handler] of Object.entries({ adminListAccounts, adminListWorkspacesFull, adminListSkins })) {
    it(`${name}: legacy admin/master does not reach the service-role client`, async () => {
      await expect((handler as any)({ context: context(["admin", "master"]) })).rejects.toThrow();
      expect(state.serviceCalls).toBe(0);
    });
    it(`${name}: explicit Superadmin without legacy labels keeps global access`, async () => {
      await expect((handler as any)({ context: context(["superadmin"]) })).resolves.toBeDefined();
      expect(state.serviceCalls).toBeGreaterThan(0);
    });
    it(`${name}: DB authorization error fails closed`, async () => {
      await expect((handler as any)({ context: context(["superadmin"], { message: "unavailable" }) })).rejects.toThrow();
      expect(state.serviceCalls).toBe(0);
    });
  }
  const workspaceId = "10000000-0000-4000-8000-000000000001";
  for (const handler of [adminReadWorkspaceMap, adminManageSavePoints, adminManageCustomProps]) {
    it("workspace resource endpoints reject legacy roles before touching service data", async () => {
      await expect((handler as any)({ context: context(["admin", "master"]), data: { workspaceId, action: "list" } })).rejects.toThrow("forbidden");
      expect(state.serviceCalls).toBe(0);
    });
  }
  it("Superadmin reset persists the empty canonical document and database version", async () => {
    const map = { cols: 128, rows: 80, blocked: [], zones: [] };
    const result = await (adminWriteWorkspaceMap as any)({ context: context(["superadmin"]), data: { workspaceId, map } });
    expect(state.mapWritten).toMatchObject({ workspace_id: workspaceId, data: map, updated_by: "fixture-actor" });
    expect(result.version).toBe(18);
  });
});
