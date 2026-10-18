import { useEffect, useState } from "react";
import { isCoarsePointer } from "./input-mode";

/**
 * Single source for the mobile layout shell (Office, Chat, zone sheet and,
 * later, meetings): coarse pointer, orientation, visible viewport (keyboard)
 * and safe-area insets as CSS. Never decides behaviour by width alone.
 */
export type MobileViewport = {
  coarse: boolean;
  orientation: "portrait" | "landscape";
  /** visible height/top from VisualViewport; null when unavailable (use 100dvh). */
  visibleHeight: number | null;
  visibleTop: number;
  keyboardOpen: boolean;
};

/** Keyboard is "open" when the visual viewport loses a significant chunk of the layout viewport. */
export const KEYBOARD_THRESHOLD_PX = 120;

export function readMobileViewport(win: Window = window): MobileViewport {
  const coarse = isCoarsePointer();
  const vv = win.visualViewport ?? null;
  const layoutH = win.innerHeight;
  const orientation = win.innerWidth > win.innerHeight ? "landscape" : "portrait";
  if (!vv) return { coarse, orientation, visibleHeight: null, visibleTop: 0, keyboardOpen: false };
  return {
    coarse,
    orientation,
    visibleHeight: vv.height,
    visibleTop: vv.offsetTop,
    keyboardOpen: coarse && layoutH - vv.height > KEYBOARD_THRESHOLD_PX,
  };
}

const SSR: MobileViewport = { coarse: false, orientation: "landscape", visibleHeight: null, visibleTop: 0, keyboardOpen: false };

/**
 * `trackVisual` attaches VisualViewport resize/scroll only while needed
 * (e.g. while the mobile Chat is open). Orientation/coarse are always tracked.
 */
export function useMobileViewport({ trackVisual = false }: { trackVisual?: boolean } = {}): MobileViewport {
  const [state, setState] = useState<MobileViewport>(SSR);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = readMobileViewport();
        setState((prev) =>
          prev.coarse === next.coarse && prev.orientation === next.orientation &&
          prev.visibleHeight === next.visibleHeight && prev.visibleTop === next.visibleTop &&
          prev.keyboardOpen === next.keyboardOpen ? prev : next,
        );
      });
    };
    setState(readMobileViewport());
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    const mql = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null;
    mql?.addEventListener?.("change", update);
    const vv = trackVisual && isCoarsePointer() ? window.visualViewport : null;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      mql?.removeEventListener?.("change", update);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, [trackVisual]);
  return state;
}

/** Inline style for a full-screen mobile sheet that stays above the keyboard. */
export function mobileFullscreenStyle(vp: MobileViewport): React.CSSProperties | undefined {
  if (!vp.coarse) return undefined;
  if (vp.visibleHeight == null) return { top: 0, height: "100dvh" };
  return { top: vp.visibleTop, height: vp.visibleHeight, bottom: "auto" };
}
