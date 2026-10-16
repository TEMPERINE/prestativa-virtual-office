import type { MapOverrides, CustomZone, ZoneKind } from "./map-overrides";

export const DEFAULT_ZONE_KINDS: Record<string, ZoneKind> = {
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`atendente-${i + 1}`, "workspace" as const]),
  ),
  supervisao: "workspace",
  diretoria: "workspace",
  reuniao: "common",
  feedback: "common",
  descompressao: "common",
  lobby: "common",
};
const valid = (kind: unknown): kind is ZoneKind => kind === "workspace" || kind === "common";
/** Pure domain rule shared by editor, map consumers and canonical classification. */
export function resolveZoneKind(map: MapOverrides | null, id: string): ZoneKind {
  const override = map?.zoneKinds?.[id];
  if (valid(override)) return override;
  const custom = map?.customZones?.find((zone) => zone.id === id);
  if (valid(custom?.kind)) return custom.kind;
  return DEFAULT_ZONE_KINDS[id] ?? (custom ? "workspace" : "common");
}
export function createCustomZone(id: string, label: string, color: string): CustomZone {
  return { id, label, color, kind: "workspace" };
}
