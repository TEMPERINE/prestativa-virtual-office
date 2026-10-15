import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Point = { x: number; y: number };
type Drag = { id: number; target: HTMLElement; start: Point; origin: Point };
const KEY = "office-chat-panel-position";
const MARGIN = 12;
const SM = 640;
const INTERACTIVE =
  'button,a,input,textarea,select,label,summary,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="combobox"],[role="menuitem"],[role="slider"],[role="switch"],[tabindex],[contenteditable]:not([contenteditable="false"]),[data-no-drag]';

function restore(): Point | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "x" in value &&
      "y" in value &&
      typeof value.x === "number" &&
      Number.isFinite(value.x) &&
      typeof value.y === "number" &&
      Number.isFinite(value.y)
    )
      return { x: value.x, y: value.y };
  } catch {
    /* Storage can be disabled or contain invalid JSON. */
  }
  return null;
}
function save(point: Point | null) {
  if (!point) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ x: point.x, y: point.y }));
  } catch {
    /* Position persistence must never prevent using Chat. */
  }
}

/** Visual state only. No conversation, Office, media or network state. */
export function useChatPanelPosition(host: Element | null) {
  const panelRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const pointRef = useRef<Point | null>(null);
  const loaded = useRef(false);
  const drag = useRef<Drag | null>(null);
  const [layout, setLayout] = useState<{ desktop: boolean; point: Point | null }>({
    desktop: false,
    point: null,
  });
  const [dragging, setDragging] = useState(false);

  const constrain = useCallback((point: Point): Point => {
    const width =
      panelRef.current?.getBoundingClientRect().width || Math.min(760, window.innerWidth - 24);
    const headerHeight = headerRef.current?.getBoundingClientRect().height || 52;
    return {
      x: Math.min(Math.max(MARGIN, point.x), Math.max(MARGIN, window.innerWidth - width - MARGIN)),
      // The body may extend below the viewport; the full drag handle stays reachable.
      y: Math.min(
        Math.max(MARGIN, point.y),
        Math.max(MARGIN, window.innerHeight - headerHeight - MARGIN),
      ),
    };
  }, []);
  const endDrag = useCallback((update = true) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    try {
      active.target.releasePointerCapture(active.id);
    } catch {
      /* The browser can already have released a cancelled/lost pointer. */
    }
    save(pointRef.current);
    if (update) setDragging(false);
  }, []);
  useLayoutEffect(() => {
    if (!host) return;
    function update() {
      endDrag();
      setDragging(false);
      if (window.innerWidth < SM) {
        setLayout({ desktop: false, point: null });
        return;
      }
      if (!loaded.current) {
        pointRef.current = restore();
        loaded.current = true;
      }
      const width =
        panelRef.current?.getBoundingClientRect().width || Math.min(760, window.innerWidth - 24);
      const point = constrain(pointRef.current ?? { x: window.innerWidth - width - MARGIN, y: 56 });
      pointRef.current = point;
      setLayout({ desktop: true, point });
      save(point);
    }
    update();
    window.addEventListener("resize", update);
    document.addEventListener("fullscreenchange", update);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("fullscreenchange", update);
      endDrag(false);
    };
    // Reattach to the newly mounted portal nodes when fullscreen changes its host.
  }, [host, constrain, endDrag]);

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    const interactive = event.target instanceof Element ? event.target.closest(INTERACTIVE) : null;
    if (
      window.innerWidth < SM ||
      !layout.desktop ||
      !pointRef.current ||
      drag.current ||
      event.button !== 0 ||
      event.isPrimary === false ||
      (interactive && event.currentTarget.contains(interactive))
    )
      return;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    drag.current = {
      id: event.pointerId,
      target,
      start: { x: event.clientX, y: event.clientY },
      origin: pointRef.current,
    };
    setDragging(true);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = constrain({
      x: active.origin.x + event.clientX - active.start.x,
      y: active.origin.y + event.clientY - active.start.y,
    });
    pointRef.current = point;
    setLayout({ desktop: true, point });
  }
  function onPointerEnd(event: ReactPointerEvent<HTMLElement>) {
    if (drag.current?.id !== event.pointerId) return;
    event.stopPropagation();
    endDrag();
  }
  return {
    panelRef,
    headerRef,
    style:
      layout.desktop && layout.point
        ? {
            left: layout.point.x,
            top: layout.point.y,
            right: "auto",
            bottom: "auto",
            height: "min(850px, calc(100dvh - 72px))",
          }
        : undefined,
    headerStyle: layout.desktop
      ? {
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
          userSelect: "none" as const,
        }
      : undefined,
    headerEvents: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture: onPointerEnd,
    },
  };
}
