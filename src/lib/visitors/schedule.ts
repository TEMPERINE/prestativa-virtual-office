/** Durações oferecidas ao convidar um visitante (em horas). Todo convite tem fim. */
export const VISIT_DURATIONS: { label: string; hours: number }[] = [
  { label: "1 hora", hours: 1 },
  { label: "4 horas", hours: 4 },
  { label: "8 horas", hours: 8 },
  { label: "12 horas", hours: 12 },
  { label: "24 horas", hours: 24 },
  { label: "2 dias", hours: 48 },
  { label: "3 dias", hours: 72 },
  { label: "7 dias", hours: 168 },
  { label: "14 dias", hours: 336 },
  { label: "30 dias", hours: 720 },
];
export const VISIT_EXTENSIONS_HOURS = [1, 4, 12, 24] as const;

export function computeVisitWindow(start: Date, opts: { hours?: number; customEnd?: Date | null }): { startsAt: Date; expiresAt: Date } | null {
  const expiresAt = opts.customEnd ?? (opts.hours ? new Date(start.getTime() + opts.hours * 3_600_000) : null);
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= start.getTime()) return null;
  return { startsAt: start, expiresAt };
}

/** Extensão parte do fim atual, nunca reativa visita encerrada. */
export function extendedExpiry(currentExpiresAt: string, hours: number, now = Date.now()): Date | null {
  const cur = Date.parse(currentExpiresAt);
  if (cur <= now) return null;
  return new Date(cur + hours * 3_600_000);
}
