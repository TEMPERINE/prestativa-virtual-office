import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isSuperadminRole } from "@/lib/admin/permissions";
import { canRecordMeeting, normalizeMemberProfile } from "../record-permission";

const read = (f: string) => readFileSync(f, "utf8");

describe("canRecordMeeting", () => {
  it("Superadmin grava quando membro, sem ligar mídia fora do workspace", () => {
    expect(canRecordMeeting({ workspaceRole: "member", globalRoles: ["superadmin"] })).toBe(true);
    expect(canRecordMeeting({ workspaceRole: null, globalRoles: ["superadmin"] })).toBe(false);
  });
  it("novo Membro nasce Operacional", () => {
    expect(normalizeMemberProfile("member", undefined)).toBe("operational");
    expect(normalizeMemberProfile("member", null)).toBe("operational");
  });
  it("Membro Operacional não grava", () => {
    expect(canRecordMeeting({ workspaceRole: "member", memberProfile: "operational" })).toBe(false);
    expect(canRecordMeeting({ workspaceRole: "member" })).toBe(false);
  });
  it("Membro Estratégico grava", () => {
    expect(canRecordMeeting({ workspaceRole: "member", memberProfile: "strategic" })).toBe(true);
  });
  it("Admin e Dono gravam", () => {
    expect(canRecordMeeting({ workspaceRole: "admin" })).toBe(true);
    expect(canRecordMeeting({ workspaceRole: "owner" })).toBe(true);
    expect(canRecordMeeting({ workspaceRole: null, isWorkspaceOwner: true })).toBe(true);
  });
  it("Supervisão (papel supervisor existente) grava", () => {
    expect(canRecordMeeting({ workspaceRole: "member", globalRoles: ["supervisor"] })).toBe(true);
  });
  it("fora do espaço não grava", () => {
    expect(canRecordMeeting({ workspaceRole: null, globalRoles: ["supervisor"] })).toBe(false);
  });
  it("Estratégico → Operacional remove a permissão", () => {
    expect(canRecordMeeting({ workspaceRole: "member", memberProfile: "operational" })).toBe(false);
  });
  it("Admin/Dono não usam perfil de membro", () => {
    expect(normalizeMemberProfile("admin", "strategic")).toBe("operational");
  });
});

describe("integração da regra", () => {
  it("backend valida antes de criar meeting_egress ou chamar Egress", () => {
    const src = read("src/lib/meetings/egress.functions.ts");
    const check = src.indexOf('rpc("can_record_meeting"');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(src.indexOf('.from("meeting_egress")\n      .insert'));
    expect(check).toBeLessThan(src.indexOf("startRoomCompositeEgress"));
  });
  it("botão Gravar só aparece com permissão; indicador Gravando continua para todos", () => {
    const src = read("src/components/office/OfficeScene.tsx");
    expect(src).toContain("tierCaps.canRecordMeetings && canRecordMeeting && (");
    expect(src).toContain("!canRecordMeeting && recorder.isRecording");
  });
  it("troca de perfil não altera o papel no espaço", () => {
    const src = read("src/lib/admin/accounts.functions.ts");
    const fn = src.slice(src.indexOf("adminSetMemberProfile"));
    expect(fn).toContain('rpc("platform_set_member_profile"');
    expect(fn).not.toMatch(/update\(\{[^}]*role:/);
  });
  it("Perfil estratégico e labels legadas não são Superadmin", () => {
    expect(isSuperadminRole(["member", "strategic"])).toBe(false);
    expect(isSuperadminRole(["admin", "master"])).toBe(false);
    expect(isSuperadminRole(["superadmin"])).toBe(true);
  });
  it("credenciais continuam só no servidor", () => {
    for (const f of ["src/lib/meetings/useCanRecordMeeting.ts", "src/lib/meetings/record-permission.ts"]) {
      expect(read(f)).not.toMatch(/RECORDING_S3|LIVEKIT_API/);
    }
  });
});
