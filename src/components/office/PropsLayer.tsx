import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadOverrides, subscribeOverridesFromCloud, zoneFromOverrides, type PropInstance } from "@/lib/map-overrides";
import { getPropDef, subscribePropCatalog } from "@/lib/prop-catalog";
import { loadCustomPropsFromCloud } from "@/lib/custom-props";
import { publishProps, publishFrames } from "@/lib/prop-gates";
import { getCurrentWorkspaceId, subscribeCurrentWorkspaceId } from "@/lib/workspace/current";
import { toast } from "sonner";
import { useCoarsePointer } from "@/lib/mobile/input-mode";
import { BellPopover } from "./BellPopover";
import { useOfficeCapabilities, VISITOR_PROP_BLOCKED_MESSAGE } from "@/lib/visitors/capabilities";
import { OfficeCelebrationPopup } from "./OfficeCelebrationPopup";
import {
  CELEBRATION_EVENT, buildCelebration, createCelebrationCenter, type CelebrationReason, type ShownCelebration,
} from "@/lib/office/bell-celebration";

/** Props que abrem o popover de celebração em vez de tocar direto. */
const CELEBRATION_PROP_DEFS = new Set(["bell-meta"]);

const INTERACT_RADIUS = 0.1; // distância (em fração do mapa) para o avatar poder interagir

type Props = {
  /** posição normalizada (0..1) do avatar local; usada para gating de tecla */
  selfX: number;
  selfY: number;
  /** quando uma zona está focada, props dentro dela recebem o mesmo boost de
   *  z-index dos avatares para se intercalarem corretamente. */
  focusedRect?: { x1: number; y1: number; x2: number; y2: number } | null;
};

type PropStateRow = { prop_id: string; frame: number };

export function PropsLayer({ selfX, selfY, focusedRect = null }: Props) {
  const [propsList, setPropsList] = useState<PropInstance[]>(
    () => loadOverrides()?.props ?? []
  );
  const [frames, setFrames] = useState<Record<string, number>>({});
  // Override local de frame durante animação one-shot (não persiste no servidor).
  const [animFrames, setAnimFrames] = useState<Record<string, number>>({});
  const animTimersRef = useRef<Record<string, number>>({});
  // Ticks já processados localmente — evita que o eco realtime do nosso
  // próprio clique reinicie a animação no meio.
  const handledTicksRef = useRef<Record<string, number>>({});
  // Último tick que ESTE cliente já enviou para o servidor — usado para
  // calcular o próximo tick sem depender do eco do realtime voltar primeiro.
  const lastSentTickRef = useRef<Record<string, number>>({});
  const [, setCatalogVersion] = useState(0);
  const coarse = useCoarsePointer();
  const [pressedId, setPressedId] = useState<string | null>(null);
  const selfRef = useRef({ x: selfX, y: selfY });
  selfRef.current = { x: selfX, y: selfY };
  const propsRef = useRef(propsList);
  propsRef.current = propsList;


  // Carrega elementos personalizados e re-renderiza quando o catálogo muda
  useEffect(() => {
    void loadCustomPropsFromCloud();
    return subscribePropCatalog(() => setCatalogVersion((v) => v + 1));
  }, []);

  // Recarrega lista quando os overrides do mapa mudam
  useEffect(() => {
    const onLocal = () => setPropsList(loadOverrides()?.props ?? []);
    onLocal();
    window.addEventListener("map-overrides-changed", onLocal);
    const unsub = subscribeOverridesFromCloud((o) => {
      setPropsList(o?.props ?? []);
    });
    return () => {
      window.removeEventListener("map-overrides-changed", onLocal);
      unsub();
    };
  }, []);

  // Publica props/frames atuais no store global para que o sistema de
  // movimento (OfficeScene) saiba quais zonas estão trancadas.
  useEffect(() => { publishProps(propsList); }, [propsList]);

  // Carrega estados (frames) e escuta realtime — escopado por workspace.
  // PK real é (workspace_id, prop_id) e a tabela é per-workspace, então
  // precisamos refazer fetch/subscribe sempre que o workspace ativo muda.
  const [wsId, setWsId] = useState<string | null>(() => getCurrentWorkspaceId());
  useEffect(() => { const u = subscribeCurrentWorkspaceId(setWsId); return () => { u(); }; }, []);

  // Canal de Broadcast por workspace — usado para sincronizar animação do
  // sino (e qualquer prop animado) entre clientes em tempo real, sem depender
  // da replicação do Postgres. O `prop_states` continua existindo apenas como
  // SNAPSHOT (último estado) para quem entrar depois.
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ---- Celebração do sino ----
  const [bellMenuFor, setBellMenuFor] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<(ShownCelebration & { senderName: string; spriteId: string | null }) | null>(null);
  const resolveSender = useCallback(async (uid: string) => {
    const { data } = await supabase.from("profiles").select("display_name, sprite_id").eq("id", uid).maybeSingle();
    return { senderName: data?.display_name?.trim() || "Alguém", spriteId: data?.sprite_id ?? null };
  }, []);
  const centerRef = useRef<ReturnType<typeof createCelebrationCenter> | null>(null);
  if (!centerRef.current) {
    centerRef.current = createCelebrationCenter({
      workspaceId: () => getCurrentWorkspaceId(),
      isBackground: () => typeof document !== "undefined" && (document.visibilityState === "hidden" || !document.hasFocus()),
      show: (c) => { void resolveSender(c.senderId).then((sender) => {
        if (getCurrentWorkspaceId() === c.workspaceId) setCelebration({ ...c, ...sender });
      }); },
    });
  }
  useEffect(() => {
    const onBack = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) centerRef.current?.onForeground();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => { document.removeEventListener("visibilitychange", onBack); window.removeEventListener("focus", onBack); };
  }, []);
  const closeCelebration = useCallback(() => setCelebration(null), []);

  useEffect(() => {
    if (!wsId) { setFrames({}); channelRef.current = null; return; }
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      // Snapshot inicial (estado persistido).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("prop_states")
        .select("prop_id, frame")
        .eq("workspace_id", wsId);
      if (cancelled) return;
      if (data) {
        const map: Record<string, number> = {};
        for (const row of data as PropStateRow[]) {
          map[row.prop_id] = row.frame;
          // Marca tick atual como já tratado — não dispara animação ao carregar.
          handledTicksRef.current[row.prop_id] = row.frame;
        }
        setFrames(map);
      }
      if (cancelled) return;
      // Canal de broadcast — não depende de RLS nem de replicação.
      // `self: false` para não receber o eco do próprio envio (já animamos local).
      channel = supabase.channel(`props-bcast-${wsId}`, {
        config: { broadcast: { self: false, ack: false } },
      });
      channel.on(
        "broadcast",
        { event: "prop_tick" },
        (msg) => {
          const payload = msg.payload as { propId?: string; tick?: number } | undefined;
          const propId = payload?.propId;
          const tick = payload?.tick;
          if (!propId || typeof tick !== "number") return;
          console.log("[PropsLayer] broadcast prop_tick:", propId, tick);
          setFrames((p) => ({ ...p, [propId]: tick }));
        },
      );
      channel.on("broadcast", { event: CELEBRATION_EVENT }, (msg) => {
        centerRef.current?.receive(msg.payload);
      });
      // Compatibilidade retroativa: clientes antigos (ex.: app desktop com a
      // versão publicada) ainda sincronizam via UPDATE em prop_states. Escutar
      // postgres_changes garante interop nos dois sentidos até todo mundo
      // estar na versão com broadcast. Duplicatas são ignoradas: mesmo tick
      // não altera o estado e handledTicksRef impede re-animação.
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prop_states", filter: `workspace_id=eq.${wsId}` },
        (payload) => {
          const row = (payload.new ?? {}) as { prop_id?: string; frame?: number };
          const propId = row.prop_id;
          const frame = row.frame;
          if (!propId || typeof frame !== "number") return;
          console.log("[PropsLayer] pg_changes prop_state:", propId, frame);
          setFrames((p) => (p[propId] === frame ? p : { ...p, [propId]: frame }));
        },
      );
      channel.subscribe((status) => {
        console.log("[PropsLayer] broadcast channel status:", status);
      });
      channelRef.current = channel;
    })();
    return () => {
      cancelled = true;
      channelRef.current = null;
      if (channel) supabase.removeChannel(channel);
    };
  }, [wsId]);



  useEffect(() => { publishFrames(frames); }, [frames]);


  // Roda animação one-shot localmente (sem persistir no servidor).
  // Reproduz def.animation.sequence e termina no restFrame.
  const playAnimation = useCallback((propId: string) => {
    console.log("[PropsLayer] playAnimation:", propId);
    const prop = propsRef.current.find((p) => p.id === propId);
    if (!prop) return;
    const def = getPropDef(prop.defId);
    // Som: cada disparo cria uma nova instância e sobrepõe sem cortar
    // (campainha tocada múltiplas vezes). Roda independente da animação.
    if (def?.soundUrl) {
      try {
        const audio = new Audio(def.soundUrl);
        audio.volume = 0.9;
        void audio.play().catch(() => { /* autoplay bloqueado */ });
      } catch { /* noop */ }
    }
    const anim = def?.animation;
    if (!anim) return;
    // Se já está animando, reinicia do começo (não acumula timers).
    if (animTimersRef.current[propId]) {
      window.clearTimeout(animTimersRef.current[propId]);
      delete animTimersRef.current[propId];
    }
    const rest = anim.restFrame ?? 0;
    // IMPORTANTE: capturar o frame ANTES do setState. O updater do React roda
    // de forma assíncrona (no render), e ler `sequence[i]` lá dentro pega o
    // `i` já incrementado — sob lag de render todos os updates colapsam para
    // `undefined` e a animação parece "não rodar".
    let i = 0;
    const step = () => {
      if (i >= anim.sequence.length) {
        delete animTimersRef.current[propId];
        setAnimFrames((p) => {
          const n = { ...p };
          delete n[propId];
          return n;
        });
        return;
      }
      const frameValue = anim.sequence[i];
      i++;
      setAnimFrames((p) => ({ ...p, [propId]: frameValue }));
      animTimersRef.current[propId] = window.setTimeout(step, anim.frameMs);
    };
    setAnimFrames((p) => ({ ...p, [propId]: rest }));
    animTimersRef.current[propId] = window.setTimeout(step, 0);
  }, []);

  // Cleanup timers no unmount
  useEffect(() => {
    return () => {
      for (const id of Object.keys(animTimersRef.current)) {
        window.clearTimeout(animTimersRef.current[id]);
      }
      animTimersRef.current = {};
    };
  }, []);

  // Ação de interação reutilizável (chamada pelo teclado e pelo botão flutuante)
  const triggerInteract = useCallback((prop: PropInstance) => {
    const def = getPropDef(prop.defId);
    if (!def?.interactive) return;
    const ws = getCurrentWorkspaceId();
    if (!ws) return;
    // Animação one-shot: dispara local e broadcasta um "tick" via upsert.
    // Cada clique incrementa um contador no campo frame para garantir que
    // o realtime envie o evento mesmo se o valor não mudou.
    if (def.animation) {
      playAnimation(prop.id);
      const prev = Math.max(
        lastSentTickRef.current[prop.id] ?? 0,
        frames[prop.id] ?? 0,
      );
      const tick = (prev % 1_000_000) + 1;
      lastSentTickRef.current[prop.id] = tick;
      handledTicksRef.current[prop.id] = tick;
      // 1) Broadcast IMEDIATO para outros clientes (latência ~ms, sem RLS).
      const ch = channelRef.current;
      if (ch) {
        void ch.send({
          type: "broadcast",
          event: "prop_tick",
          payload: { propId: prop.id, tick },
        });
      }
      // 2) Snapshot persistente (fire-and-forget) — para quem entrar depois.
      void (async () => {
        const { data: u } = await supabase.auth.getUser();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).from("prop_states").upsert(
          {
            workspace_id: ws,
            prop_id: prop.id,
            frame: tick,
            updated_by: u.user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,prop_id" }
        );
        if (error) console.error("[PropsLayer] upsert snapshot failed:", error);
      })();
      return;
    }

    setFrames((p) => {
      const cur = p[prop.id] ?? 0;
      const next = (cur + 1) % def.frames.length;
      handledTicksRef.current[prop.id] = next;
      const ch = channelRef.current;
      if (ch) {
        void ch.send({
          type: "broadcast",
          event: "prop_tick",
          payload: { propId: prop.id, tick: next },
        });
      }
      void (async () => {
        const { data: u } = await supabase.auth.getUser();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).from("prop_states").upsert(
          {
            workspace_id: ws,
            prop_id: prop.id,
            frame: next,
            updated_by: u.user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,prop_id" }
        );
        if (error) console.error("[PropsLayer] upsert snapshot failed:", error);
      })();
      return { ...p, [prop.id]: next };
    });
  }, [frames, playAnimation]);

  // Sino abre o popover; demais props seguem interação direta.
  const officeCaps = useOfficeCapabilities();
  const canInteractRef = useRef(officeCaps.canInteractProps);
  canInteractRef.current = officeCaps.canInteractProps;
  const requestInteract = useCallback((prop: PropInstance) => {
    if (!canInteractRef.current) { toast.info(VISITOR_PROP_BLOCKED_MESSAGE); return; }
    if (CELEBRATION_PROP_DEFS.has(prop.defId)) { setBellMenuFor(prop.id); return; }
    triggerInteract(prop);
  }, [triggerInteract]);

  const celebrate = useCallback(async (prop: PropInstance, reason: CelebrationReason | null, message: string) => {
    const ws = getCurrentWorkspaceId();
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!ws || !uid) { toast.error("Não foi possível identificar você. Recarregue o Office."); return; }
    const center = centerRef.current;
    if (!center) return;
    const remaining = center.cooldownRemaining(uid);
    if (remaining > 0) {
      toast.info(`Calma, o sino ainda está balançando! Tente de novo em ${Math.ceil(remaining / 1000)} s.`);
      return;
    }
    const c = buildCelebration({ workspaceId: ws, senderId: uid, reason, message, at: Date.now() });
    if (!c) return;
    setBellMenuFor(null);
    center.trySend(uid, c);
    triggerInteract(prop); // toca o sino para todos (comportamento atual)
    void channelRef.current?.send({ type: "broadcast", event: CELEBRATION_EVENT, payload: c });
  }, [triggerInteract]);

  // Dispara animação local quando o frame remoto muda em props animados.
  // Ignora ticks que nós mesmos originamos (já animados localmente).
  useEffect(() => {
    for (const prop of propsList) {
      const def = getPropDef(prop.defId);
      if (!def?.animation) continue;
      const f = frames[prop.id];
      if (f === undefined || f === (def.animation.restFrame ?? 0)) continue;
      if (handledTicksRef.current[prop.id] === f) continue;
      handledTicksRef.current[prop.id] = f;
      playAnimation(prop.id);
    }
  }, [frames, propsList, playAnimation]);


  // Prop interativo mais próximo dentro do raio — usado pelo botão flutuante
  const nearestInteractive = useMemo(() => {
    let best: { prop: PropInstance; dist: number } | null = null;
    for (const prop of propsList) {
      if (!prop.interactive) continue;
      const def = getPropDef(prop.defId);
      if (!def?.interactive) continue;
      const d = Math.hypot(prop.x - selfX, prop.y - selfY);
      if (d <= INTERACT_RADIUS && (!best || d < best.dist)) {
        best = { prop, dist: d };
      }
    }
    return best?.prop ?? null;
  }, [propsList, selfX, selfY]);

  // Tecla de interação — alterna o frame do prop interativo mais próximo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const key = e.key.toLowerCase();
      const me = selfRef.current;
      let best: { prop: PropInstance; dist: number } | null = null;
      for (const prop of propsRef.current) {
        if (!prop.interactive) continue;
        const def = getPropDef(prop.defId);
        if (!def?.interactive || def.interactKey !== key) continue;
        const d = Math.hypot(prop.x - me.x, prop.y - me.y);
        if (d <= INTERACT_RADIUS && (!best || d < best.dist)) {
          best = { prop, dist: d };
        }
      }
      if (!best) return;
      e.preventDefault();
      requestInteract(best.prop);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestInteract]);

  // Atalho global: Ctrl+X alterna qualquer prop com ação `gate-zone` cuja
  // zona alvo seja a zona onde o avatar está atualmente. Permite "trancar
  // a sala" de dentro sem precisar estar perto da porta.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== "x") return;
      if (!canInteractRef.current) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const me = selfRef.current;
      const currentZone = zoneFromOverrides({ x: me.x, y: me.y });
      if (!currentZone) return;
      const candidates = propsRef.current.filter((p) => {
        if (!p.interactive || !p.actions) return false;
        const def = getPropDef(p.defId);
        if (!def?.interactive) return false;
        return p.actions.some((a) => a.type === "gate-zone" && a.zoneId === currentZone);
      });
      if (candidates.length === 0) return;
      e.preventDefault();
      for (const p of candidates) triggerInteract(p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triggerInteract]);

  const rendered = useMemo(() => propsList, [propsList]);

  return (
    <>
      {rendered.map((p) => {
        const def = getPropDef(p.defId);
        if (!def) return null;
        const baseFrame = def.animation
          ? (def.animation.restFrame ?? 0)
          : (frames[p.id] ?? p.frame ?? 0);
        const frame = animFrames[p.id] ?? baseFrame;
        const src = def.frames[frame] ?? def.frames[0];

        const wPct = p.w * 100;
        const hPct = (p.w / def.aspectRatio) * 100;
        const hNorm = p.w / def.aspectRatio;
        const refY = p.y - hNorm * (1 - (def.depthRefY ?? 1));
        const focusOffset = focusedRect && def.foregroundWhenFocused ? 60000 : 0;
        const zIndex = focusOffset + Math.max(1, Math.round(refY * 1000));
        const style = {
          left: `${p.x * 100}%`,
          top: `${p.y * 100}%`,
          width: `${wPct}%`,
          height: `${hPct}%`,
          transform: "translate(-50%, -100%)",
          objectFit: "contain" as const,
          objectPosition: "bottom center",
          zIndex,
          imageRendering: "pixelated" as const,
        };
        // Props animados: todos os quadros ficam carregados e empilhados; a
        // animação só alterna qual está visível. Assim a troca é instantânea
        // mesmo com conexão lenta (antes cada quadro só começava a baixar na
        // hora do toque e o sino parecia congelado).
        if (def.animation) {
          const current = def.frames[frame] ? frame : 0;
          return def.frames.map((frameSrc, idx) => (
            <img
              key={`${p.id}-${idx}`}
              src={frameSrc}
              alt={idx === current ? def.label : ""}
              aria-hidden={idx === current ? undefined : true}
              draggable={false}
              loading="eager"
              className="absolute pointer-events-none select-none"
              style={{ ...style, visibility: idx === current ? "visible" : "hidden" }}
            />
          ));
        }
        return (
          <img
            key={p.id}
            src={src}
            alt={def.label}
            draggable={false}
            className="absolute pointer-events-none select-none"
            style={style}
          />
        );
      })}

      {/* Touch: todo prop interativo é tocável à distância e chama o MESMO
          handler da tecla X (requestInteract). Não renderiza para mouse. */}
      {coarse && rendered.map((p) => {
        if (!p.interactive) return null;
        const def = getPropDef(p.defId);
        if (!def?.interactive) return null;
        const hNorm = p.w / def.aspectRatio;
        const refY = p.y - hNorm * (1 - (def.depthRefY ?? 1));
        const focusOffset = focusedRect && def.foregroundWhenFocused ? 60000 : 0;
        return (
          <button
            key={`touch-${p.id}`}
            type="button"
            data-touch-prop={p.id}
            aria-label={`Interagir com ${def.label}`}
            className={`absolute bg-transparent border-0 p-0 rounded-md transition-transform duration-150 motion-reduce:transition-none ${pressedId === p.id ? "scale-95 ring-2 ring-primary/60 motion-reduce:scale-100" : ""}`}
            style={{
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              width: `${p.w * 100}%`,
              height: `${hNorm * 100}%`,
              minWidth: 44,
              minHeight: 44,
              transform: "translate(-50%, -100%)",
              zIndex: 500_000 + focusOffset + Math.max(1, Math.round(refY * 1000)),
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setPressedId(p.id);
              window.setTimeout(() => setPressedId((c) => (c === p.id ? null : c)), 160);
              requestInteract(p);
            }}
          />
        );
      })}

      {nearestInteractive && (() => {
        const def = getPropDef(nearestInteractive.defId);
        if (!def?.interactive) return null;
        const hNorm = nearestInteractive.w / def.aspectRatio;
        const topPct = (nearestInteractive.y - hNorm) * 100; // topo do bounding box
        const keyLabel = (def.interactKey ?? "x").toUpperCase();
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              requestInteract(nearestInteractive);
            }}
            className="absolute -translate-x-1/2 -translate-y-full flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm text-[11px] text-white/90 shadow-lg hover:bg-black/80 transition-colors"
            style={{
              left: `${nearestInteractive.x * 100}%`,
              top: `${topPct}%`,
              zIndex: 1_000_000,
              fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
            }}
            aria-label={`Interagir com ${def.label}`}
          >
            {coarse ? (
              <span className="opacity-90">Toque para interagir</span>
            ) : (
              <>
                <span className="opacity-80">Aperte</span>
                <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/15 border border-white/20 font-bold text-white text-[10px] leading-none">
                  {keyLabel}
                </kbd>
              </>
            )}
          </button>
        );
      })()}

      {bellMenuFor && (() => {
        const prop = propsList.find((p) => p.id === bellMenuFor);
        const def = prop ? getPropDef(prop.defId) : undefined;
        if (!prop || !def) return null;
        const topPct = (prop.y - prop.w / def.aspectRatio) * 100;
        return (
          <BellPopover
            key={prop.id}
            leftPct={prop.x * 100}
            topPct={topPct}
            onClose={() => setBellMenuFor(null)}
            onRingOnly={() => { setBellMenuFor(null); triggerInteract(prop); }}
            onCelebrate={(r, m) => { void celebrate(prop, r, m); }}
          />
        );
      })()}

      {celebration && (
        <OfficeCelebrationPopup
          key={celebration.celebrationId}
          id={celebration.celebrationId}
          senderName={celebration.senderName}
          message={celebration.message}
          spriteId={celebration.spriteId}
          onClose={closeCelebration}
        />
      )}
    </>
  );
}

