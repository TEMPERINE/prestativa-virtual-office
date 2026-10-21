import { createContext, useContext } from "react";

/** Quem está no Office: membro real ou visitante temporário ativo. */
export type OfficeAudience = "member" | "visitor";

/**
 * Fonte única do que cada audiência pode fazer no Office (UI). O banco/RPCs
 * revalidam tudo: claims, recados, props, mapa, reuniões e Chat aceitam só membros.
 */
export type OfficeCapabilities = {
  audience: OfficeAudience;
  canTeleport: boolean;
  canClaimDesk: boolean;
  canLeaveDeskNotes: boolean;
  canInteractProps: boolean;
  canEditMap: boolean;
  canUseChat: boolean;
  canUseMeetings: boolean;
  canRecordMeetings: boolean;
  canInviteVisitors: boolean;
  canEditProfile: boolean;
  canFollowOrJoin: boolean;
};

export const VISITOR_PROP_BLOCKED_MESSAGE = "Visitantes não podem interagir com este item.";

export function officeCapabilitiesFor(audience: OfficeAudience, opts: { isWorkspaceAdmin?: boolean } = {}): OfficeCapabilities {
  if (audience === "visitor") {
    return {
      audience, canTeleport: false, canClaimDesk: false, canLeaveDeskNotes: false, canInteractProps: false,
      canEditMap: false, canUseChat: false, canUseMeetings: false, canRecordMeetings: false,
      canInviteVisitors: false, canEditProfile: false, canFollowOrJoin: false,
    };
  }
  return {
    audience, canTeleport: true, canClaimDesk: true, canLeaveDeskNotes: true, canInteractProps: true,
    canEditMap: true, canUseChat: true, canUseMeetings: true, canRecordMeetings: true,
    canInviteVisitors: opts.isWorkspaceAdmin === true, canEditProfile: true, canFollowOrJoin: true,
  };
}

export const OfficeCapabilitiesContext = createContext<OfficeCapabilities>(officeCapabilitiesFor("member"));
export function useOfficeCapabilities(): OfficeCapabilities {
  return useContext(OfficeCapabilitiesContext);
}

/** Estado de uma visita a partir do relógio do servidor (expires/revoked). Cliente só usa para UX. */
export type VisitPhase = "scheduled" | "waiting" | "active" | "ended";
export function visitPhase(
  v: { starts_at: string; expires_at: string; activated_at: string | null; revoked_at: string | null },
  now: number = Date.now(),
): VisitPhase {
  if (v.revoked_at || Date.parse(v.expires_at) <= now) return "ended";
  if (Date.parse(v.starts_at) > now) return "scheduled";
  return v.activated_at ? "active" : "waiting";
}
