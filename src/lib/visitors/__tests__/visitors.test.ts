import { describe, expect, it } from "vitest";
import { officeCapabilitiesFor, visitPhase } from "../capabilities";
import { computeVisitWindow, extendedExpiry } from "../schedule";

describe("visitor capabilities", () => {
  it("visitante nunca teleporta, reivindica mesa, aciona props ou convida", () => {
    const c = officeCapabilitiesFor("visitor", { isWorkspaceAdmin: true });
    expect(c.canTeleport).toBe(false);
    expect(c.canClaimDesk).toBe(false);
    expect(c.canInteractProps).toBe(false);
    expect(c.canInviteVisitors).toBe(false);
    expect(c.canUseChat).toBe(false);
  });
  it("só owner/admin do espaço convida visitantes", () => {
    expect(officeCapabilitiesFor("member").canInviteVisitors).toBe(false);
    expect(officeCapabilitiesFor("member", { isWorkspaceAdmin: true }).canInviteVisitors).toBe(true);
  });
});

describe("visit window", () => {
  const start = new Date("2026-10-21T12:00:00Z");
  it("24 horas termina um dia depois", () => {
    expect(computeVisitWindow(start, { hours: 24 })?.expiresAt.toISOString()).toBe("2026-10-22T12:00:00.000Z");
  });
  it("sem término válido não gera convite", () => {
    expect(computeVisitWindow(start, {})).toBeNull();
    expect(computeVisitWindow(start, { customEnd: new Date("2026-10-21T11:00:00Z") })).toBeNull();
  });
  it("estender não reativa visita expirada", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(extendedExpiry("2026-10-21T11:00:00Z", 4, now)).toBeNull();
    expect(extendedExpiry("2026-10-21T13:00:00Z", 1, now)?.toISOString()).toBe("2026-10-21T14:00:00.000Z");
  });
  it("fases: agendado, aguardando, ativo, encerrado", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    const base = { starts_at: "2026-10-21T10:00:00Z", expires_at: "2026-10-21T14:00:00Z", activated_at: null, revoked_at: null };
    expect(visitPhase({ ...base, starts_at: "2026-10-21T13:00:00Z" }, now)).toBe("scheduled");
    expect(visitPhase(base, now)).toBe("waiting");
    expect(visitPhase({ ...base, activated_at: "x" }, now)).toBe("active");
    expect(visitPhase({ ...base, revoked_at: "x" }, now)).toBe("ended");
  });
});
