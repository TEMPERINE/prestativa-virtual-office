/**
 * Office Overlay Manager — estado puro dos painéis que abrem SOBRE o Office.
 * Só UI: nunca toca RTC/Presence/sessão/posição. Persistido em ?panel=.
 */
export const OFFICE_PANELS = ["chat", "meetings", "profile", "character", "notes", "settings"] as const;
export type OfficePanel = (typeof OFFICE_PANELS)[number];

export function parseOfficePanel(v: unknown): OfficePanel | undefined {
  return typeof v === "string" && (OFFICE_PANELS as readonly string[]).includes(v)
    ? (v as OfficePanel)
    : undefined;
}

/** Qualquer painel aberto bloqueia apenas o input local de movimento. */
export function isMovementInputBlocked(panel: OfficePanel | null | undefined): boolean {
  return !!panel;
}
