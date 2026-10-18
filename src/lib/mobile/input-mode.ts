import { useEffect, useState } from "react";

const QUERY = "(pointer: coarse)";

/** True only for touch/coarse primary pointers — never decided by width. */
export function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

/** Hydration-safe: always false on the server and first render. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    const on = () => setCoarse(mql.matches);
    on();
    mql.addEventListener?.("change", on);
    return () => mql.removeEventListener?.("change", on);
  }, []);
  return coarse;
}
