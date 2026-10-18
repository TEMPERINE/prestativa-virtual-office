import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft, ChevronRight, Hand, Map as MapIcon, Maximize2, Mic, MicOff,
  MonitorUp, PanelBottom, PanelRight, Users, Video, VideoOff, X, Grid2x2, ChevronsDown, ChevronsUp,
} from "lucide-react";
import { clampPage, pageSlice, planGrid, type MeetingDisplayMode } from "@/lib/meeting-ui/layout";
import { GlobalMeetingControlsLayer } from "./GlobalMeetingControlsLayer";
import { DeviceMenu } from "./DeviceMenu";
import { MicLevelMeter } from "./MicLevelMeter";

type Profile = { id: string; display_name: string; avatar_color: string };
export type StageParticipant = {
  id: string;
  profile: Profile;
  stream: MediaStream | null;
  hasVideo: boolean;
  micOn: boolean;
  speaking: boolean;
  isSelf?: boolean;
};
export type StageScreen = { key: string; label: string; stream: MediaStream; isLocal: boolean };

/** Espelho do estado de mídia do Office; handlers são os mesmos da barra do Office. */
export type StageControls = {
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  canShare: boolean;
  handUp: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleScreen: () => void;
  onToggleHand: () => void;
  /** Opcionais: mesmas listas/seleções/handlers do Office (nenhuma captura nova). */
  micTrack?: unknown | null;
  audioInputs?: MediaDeviceInfo[];
  selectedAudioInputId?: string | null;
  onSelectAudioInput?: (id: string) => void;
  videoInputs?: MediaDeviceInfo[];
  selectedVideoId?: string | null;
  onSelectVideo?: (id: string) => void;
};

type Props = {
  mode: Exclude<MeetingDisplayMode, "office">;
  participants: StageParticipant[];
  screens: StageScreen[];
  raisedHands: Record<string, boolean>;
  onStopLocalShare: () => void;
  onViewOffice: () => void;
  controls?: StageControls;
};

/** Fullscreen real do navegador: renderizar dentro do elemento em tela cheia. */
function useFullscreenHost(): Element | null {
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => {
    const update = () => setHost(document.fullscreenElement ?? null);
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  return host;
}

/**
 * Meeting UI V2 — composição visual apenas. Consome as mesmas streams já
 * existentes; cada stream é anexada a no máximo um <video> visível por vez
 * (grid OU filmstrip OU foco, nunca dois layouts montados simultaneamente).
 */
export function MeetingStage({ mode, participants, screens, raisedHands, onStopLocalShare, onViewOffice, controls }: Props) {
  const fsHost = useFullscreenHost();
  const [rosterOpen, setRosterOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [strip, setStrip] = useState<"bottom" | "side">("bottom");
  const [collapsed, setCollapsed] = useState(false);
  const [activeScreen, setActiveScreen] = useState<string | null>(null);

  useEffect(() => {
    if (focusId && !participants.some((p) => p.id === focusId)) setFocusId(null);
  }, [participants, focusId]);
  useEffect(() => {
    if (!activeScreen || !screens.some((s) => s.key === activeScreen)) setActiveScreen(screens[0]?.key ?? null);
  }, [screens, activeScreen]);

  const screen = screens.find((s) => s.key === activeScreen) ?? screens[0] ?? null;
  const focused = mode === "meeting" ? participants.find((p) => p.id === focusId) ?? null : null;
  const hasMain = mode === "presentation" ? !!screen : !!focused;
  const stripItems = focused ? participants.filter((p) => p.id !== focused.id) : participants;

  const overlay = (
    <div
      data-testid="meeting-stage"
      data-mode={mode}
      translate="no"
      className="notranslate fixed inset-x-0 bottom-0 flex flex-col bg-background/95 text-foreground backdrop-blur-sm animate-in fade-in duration-150"
      style={{ top: "3rem", zIndex: 105 }}
    >
      {/* Barra do palco */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0 text-sm font-medium">
          {mode === "presentation" ? <MonitorUp className="w-4 h-4 text-primary shrink-0" /> : <Users className="w-4 h-4 text-primary shrink-0" />}
          <span className="truncate">
            {mode === "presentation" ? screen?.label ?? "Apresentação" : focused ? `Foco: ${focused.profile.display_name}` : `Reunião • ${participants.length} pessoas`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {screens.length > 1 && mode === "presentation" && screens.map((s) => (
            <StageBtn key={s.key} active={s.key === screen?.key} onClick={() => setActiveScreen(s.key)} label={s.isLocal ? "Você" : s.label.replace(/^Tela de /, "")} />
          ))}
          {screen?.isLocal && mode === "presentation" && (
            <button type="button" onClick={onStopLocalShare} className="px-2.5 py-1 rounded-md text-xs bg-destructive text-destructive-foreground hover:opacity-90">
              Parar compartilhamento
            </button>
          )}
          {focused && <StageBtn icon={<Grid2x2 className="w-3.5 h-3.5" />} label="Voltar ao grid" onClick={() => setFocusId(null)} />}
          {hasMain && (
            <>
              <StageBtn icon={<PanelBottom className="w-3.5 h-3.5" />} title="Participantes embaixo" active={strip === "bottom"} onClick={() => setStrip("bottom")} />
              <StageBtn icon={<PanelRight className="w-3.5 h-3.5" />} title="Participantes na lateral" active={strip === "side"} onClick={() => setStrip("side")} />
              <StageBtn
                icon={collapsed ? <ChevronsUp className="w-3.5 h-3.5" /> : <ChevronsDown className="w-3.5 h-3.5" />}
                label={collapsed ? "Mostrar participantes" : "Recolher participantes"}
                onClick={() => setCollapsed((c) => !c)}
              />
            </>
          )}
          <StageBtn icon={<Users className="w-3.5 h-3.5" />} label="Participantes" active={rosterOpen} onClick={() => setRosterOpen((o) => !o)} />
          <StageBtn icon={<MapIcon className="w-3.5 h-3.5" />} label="Ver escritório" onClick={onViewOffice} />
        </div>
      </div>

      <div className={`relative flex-1 min-h-0 ${controls ? "mb-20" : ""}`}>
        {hasMain ? (
          <div className={`absolute inset-0 flex gap-3 p-3 ${strip === "side" ? "flex-row" : "flex-col"}`}>
            <div className="relative flex-1 min-h-0 min-w-0 rounded-xl overflow-hidden bg-card border border-border">
              {mode === "presentation" && screen ? (
                <MediaVideo key={screen.key} stream={screen.stream} fit="contain" muted={screen.isLocal} />
              ) : focused ? (
                <Tile p={focused} hand={!!raisedHands[focused.id]} large />
              ) : null}
            </div>
            {!collapsed && stripItems.length > 0 && (
              <Filmstrip items={stripItems} side={strip === "side"} raisedHands={raisedHands} onFocus={mode === "meeting" ? setFocusId : undefined} />
            )}
          </div>
        ) : (
          <Grid participants={participants} raisedHands={raisedHands} onFocus={setFocusId} />
        )}

        {rosterOpen && (
          <aside data-testid="meeting-roster" className="absolute top-0 right-0 bottom-0 w-72 bg-card border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right duration-150">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border text-sm font-medium">
              <span>Participantes ({participants.length})</span>
              <button type="button" onClick={() => setRosterOpen(false)} aria-label="Fechar participantes" className="p-1 rounded hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto p-2 space-y-1">
              {participants.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted">
                  <Initials p={p} size="w-7 h-7 text-[11px]" ring={p.speaking} />
                  <span className="flex-1 min-w-0 truncate text-sm">{p.profile.display_name}{p.isSelf ? " (você)" : ""}</span>
                  {raisedHands[p.id] && <Hand className="w-3.5 h-3.5 text-primary shrink-0" />}
                  {p.hasVideo ? <Video className="w-3.5 h-3.5 shrink-0 text-muted-foreground" /> : <VideoOff className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                  {p.micOn ? <Mic className={`w-3.5 h-3.5 shrink-0 ${p.speaking ? "text-primary" : "text-muted-foreground"}`} /> : <MicOff className="w-3.5 h-3.5 shrink-0 text-destructive" />}
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
      {controls && <GlobalMeetingControlsLayer controls={controls} />}
    </div>
  );

  return typeof document !== "undefined" ? createPortal(overlay, fsHost ?? document.body) : overlay;
}

export function MeetingControlsBar({ c }: { c: StageControls }) {
  const [level, setLevel] = useState(0);
  const btn = (on: boolean, offDanger: boolean) =>
    `h-11 w-11 sm:h-12 sm:w-12 rounded-full flex items-center justify-center transition-colors ${
      on ? (offDanger ? "bg-muted text-foreground hover:bg-accent" : "bg-primary text-primary-foreground hover:opacity-90")
        : offDanger ? "bg-destructive text-destructive-foreground hover:opacity-90" : "bg-muted text-foreground hover:bg-accent"
    }`;
  const chevron = "inline-flex items-center justify-center w-6 h-11 sm:h-12 rounded-full text-foreground/70 hover:text-foreground hover:bg-accent transition";
  const voice = c.micOn && level > 0.08;
  return (
    <div
      data-testid="meeting-controls"
      role="toolbar"
      aria-label="Controles da reunião"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 sm:gap-3 px-3 py-2 rounded-full bg-card/90 border border-border shadow-2xl backdrop-blur-md pointer-events-auto"
      style={{ zIndex: 2 }}
    >
      <div className="flex items-center" data-testid="mic-group">
        <button
          type="button" aria-pressed={c.micOn} aria-label={c.micOn ? "Desligar microfone" : "Ligar microfone"}
          title={c.micOn ? "Desligar microfone (Alt+M)" : "Ligar microfone (Alt+M)"} onClick={c.onToggleMic}
          data-voice={voice ? "on" : "off"}
          className={`${btn(c.micOn, true)} ${voice ? "ring-primary" : "ring-transparent"} ring-offset-2 ring-offset-card`}
          style={{ boxShadow: voice ? `0 0 0 ${2 + Math.round(level * 6)}px var(--primary)` : undefined }}
        >
          {c.micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </button>
        {c.micOn && c.micTrack !== undefined && (
          <MicLevelMeter track={c.micTrack ?? null} onLevel={setLevel} />
        )}
        {c.onSelectAudioInput && (
          <DeviceMenu
            title="Selecionar microfone"
            placement="up"
            buttonClassName={chevron}
            sections={[{ label: "Microfone", devices: c.audioInputs ?? [], selectedId: c.selectedAudioInputId ?? null, onSelect: c.onSelectAudioInput, fallbackLabel: "Microfone do sistema" }]}
          />
        )}
      </div>
      <div className="flex items-center" data-testid="cam-group">
        <button type="button" aria-pressed={c.camOn} aria-label={c.camOn ? "Desligar câmera" : "Ligar câmera"} title={c.camOn ? "Desligar câmera (Alt+V)" : "Ligar câmera (Alt+V)"} onClick={c.onToggleCam} className={btn(c.camOn, true)}>
          {c.camOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </button>
        {c.onSelectVideo && (
          <DeviceMenu
            title="Selecionar câmera"
            placement="up"
            buttonClassName={chevron}
            sections={[{ label: "Câmera", devices: c.videoInputs ?? [], selectedId: c.selectedVideoId ?? null, onSelect: c.onSelectVideo, fallbackLabel: "Câmera do sistema" }]}
          />
        )}
      </div>
      {c.canShare && (
        <button type="button" aria-pressed={c.screenOn} aria-label={c.screenOn ? "Parar compartilhamento" : "Compartilhar tela"} title={c.screenOn ? "Parar compartilhamento" : "Compartilhar tela"} onClick={c.onToggleScreen} className={btn(c.screenOn, false)}>
          <MonitorUp className="w-5 h-5" />
        </button>
      )}
      <button
        type="button" aria-pressed={c.handUp} aria-label={c.handUp ? "Baixar a mão" : "Levantar a mão"}
        title={c.handUp ? "Baixar a mão (Alt+H)" : "Levantar a mão (Alt+H)"} onClick={c.onToggleHand}
        className={`h-11 sm:h-12 rounded-full flex items-center justify-center gap-1.5 transition-colors ${
          c.handUp ? "px-4 bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-card animate-pulse" : "w-11 sm:w-12 bg-muted text-foreground hover:bg-accent"
        }`}
      >
        <Hand className="w-5 h-5" />
        {c.handUp && <span className="text-xs font-semibold">Baixar a mão</span>}
      </button>
    </div>
  );
}

function Grid({ participants, raisedHands, onFocus }: { participants: StageParticipant[]; raisedHands: Record<string, boolean>; onFocus: (id: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 1200, h: 700 });
  const [page, setPage] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth - 24, h: el.clientHeight - 64 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const plan = planGrid(participants.length, size.w, size.h);
  const cur = clampPage(page, plan.pages);
  const items = pageSlice(participants, cur, plan.perPage);
  return (
    <div ref={ref} className="absolute inset-0 flex flex-col p-3 gap-2">
      <div
        className="flex-1 min-h-0 grid gap-3 place-content-center"
        style={{ gridTemplateColumns: `repeat(${plan.cols}, minmax(0, 1fr))`, gridAutoRows: `minmax(0, ${100 / plan.rows}%)` }}
      >
        {items.map((p) => (
          <div key={p.id} className="relative min-h-0 rounded-xl overflow-hidden" onDoubleClick={() => onFocus(p.id)}>
            <Tile p={p} hand={!!raisedHands[p.id]} onFocus={() => onFocus(p.id)} />
          </div>
        ))}
      </div>
      {plan.pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm shrink-0" data-testid="grid-pager">
          <button type="button" aria-label="Página anterior" disabled={cur === 0} onClick={() => setPage(cur - 1)} className="p-1.5 rounded-md bg-muted disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
          <span>{cur + 1} / {plan.pages}</span>
          <button type="button" aria-label="Próxima página" disabled={cur >= plan.pages - 1} onClick={() => setPage(cur + 1)} className="p-1.5 rounded-md bg-muted disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
}

function Filmstrip({ items, side, raisedHands, onFocus }: { items: StageParticipant[]; side: boolean; raisedHands: Record<string, boolean>; onFocus?: (id: string) => void }) {
  return (
    <div
      data-testid="filmstrip"
      data-position={side ? "side" : "bottom"}
      className={`shrink-0 flex gap-2 ${side ? "flex-col w-56 overflow-y-auto" : "flex-row h-32 overflow-x-auto"}`}
    >
      {items.map((p) => (
        <div key={p.id} className={`relative shrink-0 rounded-lg overflow-hidden ${side ? "w-full aspect-video" : "h-full aspect-video"}`} onDoubleClick={() => onFocus?.(p.id)}>
          <Tile p={p} hand={!!raisedHands[p.id]} onFocus={onFocus ? () => onFocus(p.id) : undefined} />
        </div>
      ))}
    </div>
  );
}

function Tile({ p, hand, large, onFocus }: { p: StageParticipant; hand: boolean; large?: boolean; onFocus?: () => void }) {
  return (
    <div
      className={`group absolute inset-0 bg-muted border-2 rounded-[inherit] transition-colors ${hand ? "border-primary" : p.speaking ? "border-primary/70" : "border-transparent"}`}
    >
      {p.hasVideo && p.stream ? (
        <MediaVideo stream={p.stream} fit="cover" muted mirrored={!!p.isSelf} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Initials p={p} size={large ? "w-24 h-24 text-3xl" : "w-14 h-14 text-lg"} ring={p.speaking} />
        </div>
      )}
      {hand && (
        <div data-testid="hand-badge" aria-label="Mão levantada" title="Mão levantada" className="absolute top-2 left-2 h-6 px-2 rounded-full flex items-center gap-1 bg-primary text-primary-foreground text-[10px] font-semibold shadow-md"><Hand className="w-3.5 h-3.5" />Mão levantada</div>
      )}
      {onFocus && (
        <button type="button" onClick={onFocus} title="Focar" className="absolute top-2 right-2 p-1 rounded-md bg-background/70 opacity-0 group-hover:opacity-100 transition-opacity">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-12px)] px-1.5 py-0.5 rounded bg-background/70 text-[11px] flex items-center gap-1">
        {p.micOn ? <Mic className={`w-3 h-3 shrink-0 ${p.speaking ? "text-primary" : ""}`} /> : <MicOff className="w-3 h-3 shrink-0 text-destructive" />}
        <span className="truncate">{p.profile.display_name}{p.isSelf ? " (você)" : ""}</span>
      </div>
    </div>
  );
}

function Initials({ p, size, ring }: { p: StageParticipant; size: string; ring?: boolean }) {
  const parts = p.profile.display_name.trim().split(/\s+/).filter(Boolean);
  const ini = !parts.length ? "?" : parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (
    <div
      className={`${size} shrink-0 rounded-full flex items-center justify-center font-semibold text-primary-foreground ${ring ? "ring-2 ring-primary" : ""}`}
      style={{ background: p.profile.avatar_color || "var(--muted-foreground)" }}
    >
      {ini}
    </div>
  );
}

function StageBtn({ icon, label, title, active, onClick }: { icon?: React.ReactNode; label?: string; title?: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs ${active ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"}`}
    >
      {icon}
      {label && <span className="hidden md:inline">{label}</span>}
    </button>
  );
}

function MediaVideo({ stream, fit, muted, mirrored }: { stream: MediaStream; fit: "cover" | "contain"; muted?: boolean; mirrored?: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play?.().catch(() => {});
    return () => { el.srcObject = null; }; // libera o attachment visual ao trocar layout
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted ?? true}
      className={`absolute inset-0 w-full h-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
      style={mirrored ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}
