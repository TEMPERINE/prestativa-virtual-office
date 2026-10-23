// TEMPORÁRIO — comparação atual vs V5 (Fase 2) e runtime-1x/2x/px (Fase 3). Remover após decisão de adoção.
// Não altera catálogo persistido: registra cópias "-v5" em memória só quando esta rota carrega.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlignedSprite } from "@/components/sprites/AlignedSprite";
import { SPRITES, getSprite, SPRITE_FRAMES, type Facing } from "@/lib/sprite-catalog";
import { ensureFrameOffsets, getFrameOffsets, subscribeFrameOffsets } from "@/lib/sprite-alignment";
import { RUNTIME } from "@/lib/sprites/runtime-fase3";
import mDown from "@/assets/sprites/v5/marcio-down.png";
import mUp from "@/assets/sprites/v5/marcio-up.png";
import mLeft from "@/assets/sprites/v5/marcio-left.png";
import mRight from "@/assets/sprites/v5/marcio-right.png";
import kDown from "@/assets/sprites/v5/karen-down.png";
import kUp from "@/assets/sprites/v5/karen-up.png";
import kLeft from "@/assets/sprites/v5/karen-left.png";
import kRight from "@/assets/sprites/v5/karen-right.png";
import bDown from "@/assets/sprites/v5/bia-down.png";
import bUp from "@/assets/sprites/v5/bia-up.png";
import bLeft from "@/assets/sprites/v5/bia-left.png";

const V5: Record<string, Record<Facing, string>> = {
  marcio: { down: mDown, up: mUp, left: mLeft, right: mRight },
  karen: { down: kDown, up: kUp, left: kLeft, right: kRight },
  bia: { down: bDown, up: bUp, left: bLeft, right: bLeft },
};
for (const id of Object.keys(V5)) {
  if (!SPRITES.some((s) => s.id === `${id}-v5`)) {
    const base = getSprite(id);
    SPRITES.push({ ...base, id: `${id}-v5`, label: `${base.label} V5`, sheets: V5[id], variant: true });
  }
}

// Fase 3: texturas pré-reduzidas (sprites ATUAIS) registradas em memória como "-r1"/"-r2".
const FAC: Facing[] = ["down", "up", "left", "right"];
for (const id of Object.keys(RUNTIME)) {
  for (const k of ["1x", "2x"] as const) {
    const sid = `${id}-r${k[0]}`;
    if (SPRITES.some((s) => s.id === sid)) continue;
    const base = getSprite(id);
    const r = RUNTIME[id][k];
    const sheets = Object.fromEntries(FAC.map((f) => [f, (r[f] ?? r.left)!.src])) as Record<Facing, string>;
    SPRITES.push({ ...base, id: sid, label: `${base.label} ${k}`, sheets, variant: true });
  }
}

/** Variante experimental: crop do atlas em pixels exatos (CSS px do runtime-1x). */
function PxSprite({ id, k, facing, frame }: { id: string; k: "1x" | "2x"; facing: Facing; frame: number }) {
  const base = getSprite(id);
  const [, bump] = useState(0);
  const src = (f: Facing) => {
    const mirror = (f === "right" && base.mirrorRightFromLeft) || (f === "left" && base.mirrorLeftFromRight);
    const sf: Facing = mirror ? (f === "right" ? "left" : "right") : f;
    return { mirror: Boolean(mirror), tex: RUNTIME[id][k][sf] ?? RUNTIME[id][k].left!, one: RUNTIME[id]["1x"][sf] ?? RUNTIME[id]["1x"].left! };
  };
  useEffect(() => {
    FAC.forEach((f) => void ensureFrameOffsets(src(f).tex.src));
    return subscribeFrameOffsets(() => bump((v) => v + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, k]);
  const refH = Math.max(...FAC.map((f) => base.dims[f].h)) * 1.18;
  const refW = Math.max(...FAC.map((f) => base.dims[f].w)) * 1.18;
  const df = (facing === "left" || facing === "right") && frame === 3 ? 0 : frame;
  return (
    <div style={{ position: "relative", height: "min(9vh, 94px)", aspectRatio: `${refW} / ${refH}` }}>
      <div aria-hidden style={{ position: "absolute", left: "50%", bottom: "-2%", width: "62%", height: "10%", transform: "translateX(-50%)", background: "var(--sprite-ground-shadow-scene)", filter: "blur(1.5px)" }} />
      {FAC.map((f) => {
        const { mirror, tex, one } = src(f);
        const off = getFrameOffsets(tex.src)?.[df] ?? { dx: 0, dy: 0 };
        return (
          <div key={f} style={{
            position: "absolute", left: "50%", bottom: 0, width: one.w, height: one.h,
            backgroundImage: `url(${tex.src})`, backgroundRepeat: "no-repeat",
            backgroundSize: `${one.w * SPRITE_FRAMES}px ${one.h}px`,
            backgroundPosition: `${-df * one.w}px 0px`,
            transform: `translate(calc(-50% + ${(mirror ? off.dx : -off.dx) * 100}%), ${-off.dy * 100}%)${mirror ? " scaleX(-1)" : ""}`,
            visibility: f === facing ? "visible" : "hidden", zIndex: 1,
          }} />
        );
      })}
    </div>
  );
}

export const Route = createFileRoute("/sprite-compare")({
  head: () => ({
    meta: [
      { title: "Comparação temporária de sprites V5" },
      { name: "description", content: "Harness interno temporário atual vs V5." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Comparação temporária de sprites V5" },
      { property: "og:description", content: "Harness interno temporário atual vs V5." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Compare,
});

type W = Window & { __pos?: { x: number; y: number; facing: Facing; frame: number } };

function Compare() {
  const [p, setP] = useState({ x: 0, y: 0, facing: "down" as Facing, frame: 0 });
  const [q, setQ] = useState({ zoom: 1, floor: "light", chars: "marcio,karen,bia", vars: ",-v5" });
  useEffect(() => {
    const s = new URLSearchParams(location.search);
    setQ({ zoom: Number(s.get("zoom") ?? 1), floor: s.get("floor") ?? "light", chars: s.get("chars") ?? "marcio,karen,bia", vars: s.get("vars") ?? ",-v5" });
    const w = window as W;
    Object.defineProperty(w, "__pos", { configurable: true, set: (v) => setP({ ...v }), get: () => p });
  }, []);
  const bg = q.floor === "light" ? "#e9e2d4" : "#2b2a33";
  const chars = q.chars.split(",");
  return (
    <div style={{ background: bg, width: 1280, height: 1800, overflow: "hidden" }}>
      <div style={{ transform: `scale(${q.zoom})`, transformOrigin: "0 0" }}>
        {chars.map((c, r) =>
          q.vars.split(",").map((suf, col) => (
            <div key={c + suf} data-cell={`${c}${suf}`}
              style={{ position: "absolute", left: 20 + col * 180, top: 20 + r * 200, width: 170, height: 180 }}>
              <div style={{ position: "absolute", left: 40 + p.x, top: 30 + p.y }}>
                {suf.startsWith("px") ? (
                  <PxSprite id={c} k={suf === "px2" ? "2x" : "1x"} facing={p.facing} frame={p.frame} />
                ) : (
                  <AlignedSprite spriteId={`${c}${suf}`} facing={p.facing} frame={p.frame} mode="scene" />
                )}
              </div>
            </div>
          )),
        )}
      </div>
    </div>
  );
}
