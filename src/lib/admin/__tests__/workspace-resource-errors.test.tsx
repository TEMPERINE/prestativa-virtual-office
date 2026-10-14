// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  transport: vi.fn(), savePoints: vi.fn(), error: vi.fn(), setProps: vi.fn(),
}));
vi.mock("@/lib/admin/workspace-access", () => ({ usesSuperadminTransport: mocks.transport }));
vi.mock("@/lib/admin/workspace-resources.functions", () => ({ adminManageSavePoints: mocks.savePoints }));
vi.mock("@/lib/workspace/current", () => ({ getCurrentWorkspaceId: () => "fixture-workspace" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/prop-catalog", () => ({ setCustomProps: mocks.setProps }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
import { MapSavePoints } from "@/components/office/MapSavePoints";
import { loadCustomPropsFromCloud } from "@/lib/custom-props";

describe("failed administrative transport", () => {
  afterEach(() => { vi.clearAllMocks(); });
  it("preserves the custom prop catalog when authorization lookup rejects", async () => {
    mocks.transport.mockRejectedValueOnce(new Error("Fixture failure"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(loadCustomPropsFromCloud()).resolves.toBeUndefined();
    expect(mocks.setProps).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
  it("restores the save button and gives feedback when a save-point read fails", async () => {
    mocks.transport.mockResolvedValue(true);
    mocks.savePoints.mockRejectedValueOnce(new Error("Fixture failure"));
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(<MapSavePoints overrides={{} as any} onLoad={() => {}} />); });
      await act(async () => { container.querySelector("button")!.click(); });
      const saveButton = [...container.querySelectorAll("button")].find(b => b.textContent?.includes("Salvar estado atual"));
      expect(saveButton?.disabled).toBe(false);
      expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("Erro ao listar"));
    } finally {
      await act(async () => { root.unmount(); }); container.remove();
    }
  });
});
