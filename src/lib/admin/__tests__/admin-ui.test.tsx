// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({ options }),
  useNavigate: () => () => {},
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}));
vi.mock("@/integrations/supabase/client", () => {
  let requestedRole = "";
  const chain: any = {
    select: () => chain,
    eq: (column: string, value: string) => { if (column === "role") requestedRole = value; return chain; },
    maybeSingle: async () => ({ data: state.roles.includes(requestedRole) ? { role: requestedRole } : null, error: null }),
  };
  return { supabase: { auth: { getUser: async () => ({ data: { user: { id: "fixture-actor" } } }) }, from: () => chain } };
});
import { Route } from "@/routes/_authenticated/admin.index";

describe("actual admin page composition", () => {
  const containers: HTMLElement[] = [];
  afterEach(() => { for (const c of containers) c.remove(); containers.length = 0; });
  for (const roles of [["superadmin"], ["admin", "master"], ["member"], ["owner"]]) {
    it(`renders the global panel only for explicit Superadmin (${roles.join(",")})`, async () => {
      state.roles = roles;
      const container = document.createElement("div"); document.body.append(container); containers.push(container);
      const root = createRoot(container);
      const Page = (Route as any).options.component;
      await act(async () => { root.render(<Page />); });
      const allowed = roles.includes("superadmin");
      expect(container.textContent?.includes("Painel administrativo")).toBe(allowed);
      expect(container.textContent?.includes("Acesso restrito")).toBe(!allowed);
      if (allowed) expect(container.querySelectorAll("a").length).toBe(3);
      await act(async () => { root.unmount(); });
    });
  }
});
