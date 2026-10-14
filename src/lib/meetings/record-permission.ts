// Regra única de quem pode INICIAR gravação de reunião.
// O servidor usa a função de banco can_record_meeting (mesma regra);
// este módulo espelha a regra para a interface e para os testes.

export type WorkspaceRole = "owner" | "admin" | "member";
export type MemberProfile = "operational" | "strategic";

/** Papéis globais que já existem no sistema e autorizam gravação. */
const RECORDING_GLOBAL_ROLES = new Set(["admin", "master", "supervisor", "superadmin"]);

export function normalizeMemberProfile(role: WorkspaceRole, profile?: string | null): MemberProfile {
  if (role !== "member") return "operational"; // Admin/Dono não usam perfil
  return profile === "strategic" ? "strategic" : "operational";
}

export function canRecordMeeting(input: {
  workspaceRole: WorkspaceRole | null | undefined;
  memberProfile?: string | null;
  isWorkspaceOwner?: boolean;
  globalRoles?: string[];
}): boolean {
  if (!input.workspaceRole && !input.isWorkspaceOwner) return false; // precisa ser membro do espaço
  if (input.isWorkspaceOwner) return true;
  if (input.workspaceRole === "owner" || input.workspaceRole === "admin") return true;
  if ((input.globalRoles ?? []).some((r) => RECORDING_GLOBAL_ROLES.has(r))) return true;
  return normalizeMemberProfile("member", input.memberProfile) === "strategic";
}
