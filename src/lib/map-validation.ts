import { ZONES, isMapWalkable, canMoveOnMap, type Point } from "./office-map";
import type { MapOverrides } from "./map-overrides";
import { resolveZoneKind } from "./map-zone-kind";
import { navigationDimensions, walkablePointInZone } from "./map-navigation";
import { mapZoneId } from "./workspace-zones";
export type MapIssue = {
  severity: "error" | "warning";
  code: string;
  zoneId: string | null;
  message: string;
  cells: number[];
};
export type MapValidation = { valid: boolean; issues: MapIssue[] };
/** Editor/save-only analysis. Never called by movement or the frame loop. */
export function validateMap(map: MapOverrides): MapValidation {
  const issues: MapIssue[] = [];
  if (
    !Number.isSafeInteger(map.cols) ||
    !Number.isSafeInteger(map.rows) ||
    map.cols <= 0 ||
    map.rows <= 0 ||
    map.blocked.length !== map.cols * map.rows ||
    map.zones.length !== map.cols * map.rows
  )
    return {
      valid: false,
      issues: [
        {
          severity: "error",
          code: "GRID_INVALID",
          zoneId: null,
          message: "Grade do mapa inválida.",
          cells: [],
        },
      ],
    };
  const definitions = new Map<string, string>();
  for (const z of map.customZones ?? []) definitions.set(z.id, z.label);
  const cellsByZone = new Map<string, number[]>();
  for (let i = 0; i < map.zones.length; i++) {
    const id = map.zones[i];
    if (!id) continue;
    const cells = cellsByZone.get(id) ?? [];
    cells.push(i);
    cellsByZone.set(id, cells);
    if (!definitions.has(id))
      definitions.set(id, map.zoneLabels?.[id] || ZONES.find((z) => z.id === id)?.label || id);
  }
  for (const id of Object.keys(map.spawnPoints ?? {}))
    if (!definitions.has(id))
      definitions.set(id, map.zoneLabels?.[id] || ZONES.find((z) => z.id === id)?.label || id);
  // Implicit lobby consists of unpainted cells and may own a configured spawn.
  if (definitions.has("lobby"))
    cellsByZone.set(
      "lobby",
      map.zones.flatMap((id, i) => (!id || id === "lobby" ? [i] : [])),
    );
  if (!definitions.size) return { valid: true, issues };
  const { cols, rows } = navigationDimensions(map),
    width = cols + 1,
    size = width * (rows + 1);
  const walk = new Uint8Array(size),
    components = new Int32Array(size).fill(-1),
    nodeZones = new Array<string>(size);
  const point = (index: number): Point => ({
    x: (index % width) / cols,
    y: Math.floor(index / width) / rows,
  });
  const samples = new Map<string, number[]>();
  for (let i = 0; i < size; i++)
    if (isMapWalkable(map, point(i))) {
      walk[i] = 1;
      const id = mapZoneId(map, point(i));
      nodeZones[i] = id;
      const list = samples.get(id) ?? [];
      list.push(i);
      samples.set(id, list);
    }
  const componentZones: Set<string>[] = [];
  const queue = new Int32Array(size);
  for (let seed = 0; seed < size; seed++)
    if (walk[seed] && components[seed] < 0) {
      const component = componentZones.length,
        zones = new Set<string>();
      componentZones.push(zones);
      let head = 0,
        tail = 1;
      queue[0] = seed;
      components[seed] = component;
      while (head < tail) {
        const i = queue[head++],
          c = i % width,
          r = Math.floor(i / width);
        zones.add(nodeZones[i]);
        const visit = (next: number) => {
          if (walk[next] && components[next] < 0 && canMoveOnMap(map, point(i), point(next))) {
            components[next] = component;
            queue[tail++] = next;
          }
        };
        if (c > 0) visit(i - 1);
        if (c < cols) visit(i + 1);
        if (r > 0) visit(i - width);
        if (r < rows) visit(i + width);
      }
    }
  const add = (
    severity: MapIssue["severity"],
    code: string,
    id: string,
    message: string,
    cells = cellsByZone.get(id) ?? [],
  ) => issues.push({ severity, code, zoneId: id, message, cells });
  for (const [id, label] of definitions) {
    const cells = cellsByZone.get(id) ?? [];
    if (!ZONES.some((z) => z.id === id) && !map.customZones?.some((z) => z.id === id)) {
      add("error", "ZONE_UNKNOWN", id, `${label}: área pintada sem definição.`);
      continue;
    }
    if (!cells.length) {
      add("error", "ZONE_EMPTY", id, `${label}: nenhuma célula pintada.`);
      continue;
    }
    const nodes = samples.get(id) ?? [];
    if (!nodes.length)
      add(
        "error",
        "ZONE_BLOCKED",
        id,
        `${label}: área totalmente bloqueada; não há ponto caminhável para o avatar.`,
      );
    const spawn = map.spawnPoints?.[id];
    let spawnValid = true;
    if (spawn) {
      if (mapZoneId(map, spawn) !== id) {
        add("error", "SPAWN_OUTSIDE", id, `${label}: ponto de surgimento fora da própria área.`);
        spawnValid = false;
      }
      if (!isMapWalkable(map, spawn)) {
        add(
          "error",
          "SPAWN_BLOCKED",
          id,
          `${label}: ponto de surgimento em parede, limite ou sem espaço para o avatar.`,
        );
        spawnValid = false;
      }
    }
    if (resolveZoneKind(map, id) !== "workspace" || !nodes.length || !spawnValid) continue;
    if (!spawn)
      add(
        "warning",
        "SPAWN_MISSING",
        id,
        `${label}: sem ponto explícito; será usado um ponto caminhável da própria área.`,
        [],
      );
    const origin = spawn ?? walkablePointInZone(map, id);
    if (!origin) continue;
    let closest = -1,
      distance = Infinity;
    // Attach the precise spawn to nearby half-grid nodes through a clear path.
    const centreC = Math.round(origin.x * cols),
      centreR = Math.round(origin.y * rows);
    for (let r = Math.max(0, centreR - 2); r <= Math.min(rows, centreR + 2); r++)
      for (let c = Math.max(0, centreC - 2); c <= Math.min(cols, centreC + 2); c++) {
        const i = r * width + c,
          p = point(i),
          d = (p.x - origin.x) ** 2 + (p.y - origin.y) ** 2;
        if (walk[i] && nodeZones[i] === id && d < distance && canMoveOnMap(map, origin, p)) {
          closest = i;
          distance = d;
        }
      }
    if (closest < 0) {
      add(
        "error",
        "SPAWN_DISCONNECTED",
        id,
        `${label}: o ponto não se conecta à malha caminhável.`,
      );
      continue;
    }
    const component = components[closest];
    if (![...componentZones[component]].some((zone) => zone !== id))
      add(
        "error",
        "WORKSPACE_NO_EXIT",
        id,
        `${label}: sem caminho caminhável do ponto até fora da área/corredor.`,
      );
    const isolated = nodes.filter((i) => components[i] !== component);
    if (isolated.length)
      add(
        "warning",
        "ZONE_PARTIAL_DISCONNECTED",
        id,
        `${label}: há trechos caminháveis isolados do ponto de surgimento.`,
        [
          ...new Set(
            isolated.map(
              (i) =>
                Math.min(map.rows - 1, Math.floor(point(i).y * map.rows)) * map.cols +
                Math.min(map.cols - 1, Math.floor(point(i).x * map.cols)),
            ),
          ),
        ],
      );
  }
  return { valid: !issues.some((i) => i.severity === "error"), issues };
}
