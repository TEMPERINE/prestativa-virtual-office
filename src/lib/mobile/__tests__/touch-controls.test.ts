import { describe, expect, it, vi } from "vitest";
import { createTouchGestures, pinchCamera, screenToMap, type Camera } from "../touch-gestures";
import { findTouchRoute } from "../touch-route";
import { canMoveOnMap } from "@/lib/office-map";
import type { MapOverrides } from "@/lib/map-overrides";

function gridMap(cols: number, rows: number, blockedCells: [number, number][]): MapOverrides {
  const blocked = new Array(cols * rows).fill(0);
  for (const [c, r] of blockedCells) blocked[r * cols + c] = 1;
  return { cols, rows, blocked } as unknown as MapOverrides;
}
// Vertical wall at column 20 from row 5..34 with a gap at the bottom (rows 35+).
const wall: [number, number][] = [];
for (let r = 0; r < 35; r++) wall.push([20, r]);
const MAP = gridMap(40, 40, wall);
const A = { x: 0.3, y: 0.3 }, B = { x: 0.7, y: 0.3 };

describe("touch route (A*)", () => {
  it("contorna a parede e cada trecho é caminhável", () => {
    expect(canMoveOnMap(MAP, A, B)).toBe(false);
    const r = findTouchRoute(MAP, A, B)!;
    expect(r).not.toBeNull();
    let prev = A;
    for (const w of r.waypoints) { expect(canMoveOnMap(MAP, prev, w)).toBe(true); prev = w; }
    expect(prev).toEqual(B);
    expect(r.waypoints.some((w) => w.y > 0.85)).toBe(true);
  });
  it("destino dentro da parede é corrigido para ponto próximo", () => {
    const r = findTouchRoute(MAP, A, { x: 0.5125, y: 0.3 })!;
    expect(r).not.toBeNull();
    expect(Math.abs(r.goal.x - 0.5125)).toBeLessThan(0.04);
  });
  it("destino inválido sem ponto próximo é rejeitado", () => {
    const solid = gridMap(40, 40, Array.from({ length: 40 * 40 }, (_, i) => [i % 40, Math.floor(i / 40)] as [number, number]).filter(([c, r]) => c > 25 || r > 25 ? false : c > 10));
    expect(findTouchRoute(solid, { x: 0.1, y: 0.1 }, { x: 0.45, y: 0.45 }, { snapTolerance: 0.02 })).toBeNull();
  });
  it("porta fechada: para antes do bloqueio, nunca atravessa", () => {
    const open = gridMap(40, 40, []);
    const gated = (a: { x: number }, b: { x: number }) => (a.x < 0.5) !== (b.x < 0.5);
    const r = findTouchRoute(open, A, B, { isGated: gated })!;
    expect(r.blockedByGate).toBe(true);
    expect(r.waypoints.every((w) => w.x < 0.5)).toBe(true);
  });
  it("é determinístico", () => {
    expect(findTouchRoute(MAP, A, B)).toEqual(findTouchRoute(MAP, A, B));
  });
});

function setup() {
  let cam: Camera = { zoom: 1, pan: { x: 0, y: 0 } };
  let t = 0;
  const cb = {
    getCamera: () => cam,
    setCamera: vi.fn((c: Camera) => { cam = c; }),
    onManualCamera: vi.fn(),
    onTap: vi.fn(),
    onDoubleTap: vi.fn(),
    minZoom: 1,
    maxZoom: 4,
    now: () => t,
  };
  const g = createTouchGestures(cb);
  return { g, cb, cam: () => cam, advance: (ms: number) => { t += ms; } };
}

describe("touch gestures", () => {
  it("single tap não move; double tap dispara movimento", () => {
    const s = setup();
    s.g.down(1, { x: 100, y: 100 }); s.g.up(1, { x: 100, y: 100 });
    expect(s.cb.onTap).toHaveBeenCalledTimes(1);
    expect(s.cb.onDoubleTap).not.toHaveBeenCalled();
    s.advance(150);
    s.g.down(2, { x: 104, y: 102 }); s.g.up(2, { x: 104, y: 102 });
    expect(s.cb.onDoubleTap).toHaveBeenCalledWith({ x: 104, y: 102 });
  });
  it("toques lentos não viram double tap", () => {
    const s = setup();
    s.g.down(1, { x: 0, y: 0 }); s.g.up(1, { x: 0, y: 0 });
    s.advance(800);
    s.g.down(2, { x: 0, y: 0 }); s.g.up(2, { x: 0, y: 0 });
    expect(s.cb.onDoubleTap).not.toHaveBeenCalled();
  });
  it("arrasto de um dedo faz pan, desliga follow e não é tap", () => {
    const s = setup();
    s.g.down(1, { x: 100, y: 100 });
    s.g.move(1, { x: 60, y: 80 });
    s.g.up(1, { x: 60, y: 80 });
    expect(s.cam().pan).toEqual({ x: -40, y: -20 });
    expect(s.cb.onManualCamera).toHaveBeenCalled();
    expect(s.cb.onTap).not.toHaveBeenCalled();
  });
  it("pinch dá zoom mantendo o ponto sob os dedos e respeita MAX_ZOOM", () => {
    const s = setup();
    s.g.down(1, { x: 100, y: 100 }); s.g.down(2, { x: 200, y: 100 });
    s.g.move(2, { x: 300, y: 100 }); // distância 100 → 200 = 2x
    const c = s.cam();
    expect(c.zoom).toBe(2);
    // ponto do mapa sob o centro inicial (150,100) agora está sob (200,100)
    expect(screenToMap({ x: 200, y: 100 }, c, { w: 1, h: 1 })).toEqual(screenToMap({ x: 150, y: 100 }, { zoom: 1, pan: { x: 0, y: 0 } }, { w: 1, h: 1 }));
    expect(pinchCamera({ zoom: 3, pan: { x: 0, y: 0 } }, { x: 0, y: 0 }, 10, { x: 0, y: 0 }, 100, 1, 4).zoom).toBe(4);
    s.g.up(1, { x: 100, y: 100 }); s.g.up(2, { x: 300, y: 100 });
    expect(s.cb.onTap).not.toHaveBeenCalled();
  });
  it("screenToMap considera zoom e pan", () => {
    expect(screenToMap({ x: 300, y: 200 }, { zoom: 2, pan: { x: -100, y: -200 } }, { w: 1000, h: 500 })).toEqual({ x: 0.2, y: 0.4 });
  });
  it("reset (background) descarta toque pendente — não repete comandos", () => {
    const s = setup();
    s.g.down(1, { x: 0, y: 0 }); s.g.up(1, { x: 0, y: 0 });
    s.g.reset();
    s.g.down(2, { x: 0, y: 0 }); s.g.up(2, { x: 0, y: 0 });
    expect(s.cb.onDoubleTap).not.toHaveBeenCalled();
  });
});

describe("ajustes de campo (celular)", () => {
  it("rota anda só na horizontal/vertical, com poucas curvas", () => {
    const open = gridMap(40, 40, []);
    const r = findTouchRoute(open, { x: 0.1, y: 0.1 }, { x: 0.8, y: 0.7 })!;
    let prev = { x: 0.1, y: 0.1 };
    const pts = r.waypoints.slice(1, -1); // ignora engates de início/fim
    for (const w of pts) { prev = w; }
    for (let i = 1; i < pts.length; i++) {
      const dx = Math.abs(pts[i].x - pts[i - 1].x), dy = Math.abs(pts[i].y - pts[i - 1].y);
      expect(dx < 1e-9 || dy < 1e-9).toBe(true);
    }
    expect(r.waypoints.length).toBeLessThanOrEqual(5);
    void prev;
  });
  it("tocar e segurar (500ms) chama onLongPress e não vira toque nem duplo toque", () => {
    const timers: (() => void)[] = [];
    const onTap = vi.fn(), onDoubleTap = vi.fn(), onLongPress = vi.fn();
    const g = createTouchGestures({
      getCamera: () => ({ zoom: 1, pan: { x: 0, y: 0 } }), setCamera: vi.fn(), onManualCamera: vi.fn(),
      onTap, onDoubleTap, onLongPress, minZoom: 1, maxZoom: 4, now: () => 0,
      setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {},
    });
    g.down(1, { x: 10, y: 10 });
    timers.forEach((f) => f());
    g.up(1, { x: 10, y: 10 });
    expect(onLongPress).toHaveBeenCalledWith({ x: 10, y: 10 });
    expect(onTap).not.toHaveBeenCalled();
    expect(onDoubleTap).not.toHaveBeenCalled();
  });
});
