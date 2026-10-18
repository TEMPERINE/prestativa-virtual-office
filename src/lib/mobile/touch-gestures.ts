/**
 * Touch-only gesture recognizer for the Office stage. Pure (no DOM): the
 * stage forwards pointer events with pointerType === "touch"; mouse/pen
 * input never reaches it, so desktop drag/wheel/keyboard stay untouched.
 */
export type Pt = { x: number; y: number };
export type Camera = { zoom: number; pan: Pt };

export const TAP_SLOP_PX = 10;
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_DIST_PX = 36;

/** Screen point (relative to stage) → normalized map point. */
export function screenToMap(local: Pt, cam: Camera, stage: { w: number; h: number }): Pt {
  return { x: (local.x - cam.pan.x) / (cam.zoom * stage.w), y: (local.y - cam.pan.y) / (cam.zoom * stage.h) };
}

/** Pinch: keeps the map point under the initial finger centre under the current centre. */
export function pinchCamera(start: Camera, c0: Pt, d0: number, c: Pt, d: number, min: number, max: number): Camera {
  const zoom = Math.max(min, Math.min(max, start.zoom * (d0 > 0 ? d / d0 : 1)));
  const mx = (c0.x - start.pan.x) / start.zoom, my = (c0.y - start.pan.y) / start.zoom;
  return { zoom, pan: { x: c.x - mx * zoom, y: c.y - my * zoom } };
}

export type GestureCallbacks = {
  getCamera: () => Camera;
  setCamera: (cam: Camera) => void; // caller clamps
  onManualCamera: () => void; // disables followMe
  onTap: (p: Pt) => void;
  onDoubleTap: (p: Pt) => void;
  minZoom: number;
  maxZoom: number;
  now?: () => number;
};

type Mode =
  | { kind: "idle" }
  | { kind: "pending"; start: Pt; cam: Camera }
  | { kind: "pan"; start: Pt; cam: Camera }
  | { kind: "pinch"; c0: Pt; d0: number; cam: Camera };

export function createTouchGestures(cb: GestureCallbacks) {
  const pts = new Map<number, Pt>();
  let mode: Mode = { kind: "idle" };
  let lastTap: { t: number; p: Pt } | null = null;
  let hadMulti = false;
  const now = cb.now ?? (() => performance.now());
  const two = () => {
    const [a, b] = Array.from(pts.values());
    return { c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  return {
    down(id: number, p: Pt) {
      pts.set(id, p);
      if (pts.size === 1) { hadMulti = false; mode = { kind: "pending", start: p, cam: cb.getCamera() }; }
      else if (pts.size === 2) {
        hadMulti = true;
        const { c, d } = two();
        mode = { kind: "pinch", c0: c, d0: d, cam: cb.getCamera() };
        cb.onManualCamera();
      }
    },
    move(id: number, p: Pt) {
      if (!pts.has(id)) return;
      pts.set(id, p);
      if (mode.kind === "pinch" && pts.size >= 2) {
        const { c, d } = two();
        cb.setCamera(pinchCamera(mode.cam, mode.c0, mode.d0, c, d, cb.minZoom, cb.maxZoom));
        return;
      }
      if (mode.kind === "pending") {
        if (Math.hypot(p.x - mode.start.x, p.y - mode.start.y) < TAP_SLOP_PX) return;
        mode = { kind: "pan", start: mode.start, cam: mode.cam };
        cb.onManualCamera();
      }
      if (mode.kind === "pan") {
        cb.setCamera({ zoom: mode.cam.zoom, pan: { x: mode.cam.pan.x + p.x - mode.start.x, y: mode.cam.pan.y + p.y - mode.start.y } });
      }
    },
    up(id: number, p: Pt) {
      if (!pts.has(id)) return;
      pts.delete(id);
      if (pts.size === 1 && mode.kind === "pinch") {
        // Continue as pan with the remaining finger (no tap).
        const rest = Array.from(pts.values())[0];
        mode = { kind: "pan", start: rest, cam: cb.getCamera() };
        return;
      }
      if (pts.size > 0) return;
      const wasTap = mode.kind === "pending" && !hadMulti;
      mode = { kind: "idle" };
      if (!wasTap) { lastTap = null; return; }
      const t = now();
      if (lastTap && t - lastTap.t <= DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.p.x, p.y - lastTap.p.y) <= DOUBLE_TAP_DIST_PX) {
        lastTap = null;
        cb.onDoubleTap(p);
      } else {
        lastTap = { t, p };
        cb.onTap(p);
      }
    },
    cancel(id: number) {
      pts.delete(id);
      if (pts.size === 0) { mode = { kind: "idle" }; lastTap = null; }
    },
    reset() { pts.clear(); mode = { kind: "idle" }; lastTap = null; },
  };
}

/** Targets that own their own gestures; the map must never react to them. */
export const GESTURE_EXEMPT =
  "button, a, input, textarea, select, [role='button'], [role='menu'], [role='menuitem'], [role='dialog'], [contenteditable='true'], [data-avatar-menu], [data-office-chat-panel], [data-touch-prop], [data-no-map-gesture]";
