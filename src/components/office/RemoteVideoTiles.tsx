import { useEffect, useRef } from "react";
import { Mic, MicOff, VideoOff, Hand } from "lucide-react";

type Profile = { id: string; display_name: string; avatar_color: string };

type Props = {
  // Self
  myId: string | null;
  myProfile: Profile | null;
  localStream: MediaStream | null;
  localCamOn: boolean;
  localMicOn: boolean;
  selfSpeaking?: boolean;
  // Remotes
  streams: Record<string, MediaStream>;
  profiles: Record<string, Profile>;
  speakingPeers: Record<string, boolean>;
  connectedPeers: string[];
  raisedHands?: Record<string, boolean>;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hasLiveVideo(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  return stream.getVideoTracks().some((t) => t.enabled && t.readyState === "live");
}

export function RemoteVideoTiles({
  myId,
  myProfile,
  localStream,
  localCamOn,
  localMicOn,
  selfSpeaking = false,
  streams,
  profiles,
  speakingPeers,
  connectedPeers,
  raisedHands = {},
}: Props) {
  const hasAnyone = !!myId && (connectedPeers.length > 0 || localCamOn || localMicOn);
  const [collapsed, setCollapsed] = useState(false);
  const { vw, vh, teamInset } = useGalleryBounds(hasAnyone);

  // Ordem estável: mão levantada primeiro (sort estável), speaking só destaca.
  const orderedPeers = [...connectedPeers].sort(
    (a, b) => Number(!!raisedHands[b]) - Number(!!raisedHands[a]),
  );
  const count = orderedPeers.length + (myProfile ? 1 : 0);
  const right = 12 + teamInset;
  const TOP = 52; // barra superior
  const BOTTOM = 96; // controles inferiores
  const availW = Math.max(160, Math.min(vw * 0.42, vw - right - 24));
  const availH = Math.max(120, vh - TOP - BOTTOM - 36 /* cabeçalho da galeria */);
  const plan = planOfficeVideoGrid(count, availW, availH);
  const compact = plan.tileWidth < 190;

  return (
    <>
      <HiddenAudioPlayers streams={streams} />
      {hasAnyone && (
        <div
          data-office-video-gallery
          className="absolute z-[110] flex flex-col items-end gap-1.5 pointer-events-none"
          style={{
            top: `${TOP}px`,
            right: `${right}px`,
            maxHeight: `calc(100% - ${TOP + BOTTOM}px)`,
            transition: "right 250ms ease",
          }}
        >
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white shadow-md backdrop-blur-sm hover:bg-black/75"
            title={collapsed ? "Mostrar vídeos" : "Recolher vídeos"}
          >
            <Users className="h-3.5 w-3.5" />
            <span>{count} na chamada</span>
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            <span className="sr-only">{collapsed ? "Mostrar vídeos" : "Recolher vídeos"}</span>
          </button>
          {!collapsed && (
            <div
              className="grid overflow-y-auto pointer-events-auto pr-0.5"
              style={{
                gridTemplateColumns: `repeat(${plan.cols}, ${plan.tileWidth}px)`,
                gap: "8px",
                maxHeight: `${availH}px`,
              }}
            >
              {myProfile && (
                <Tile
                  profile={myProfile}
                  stream={localStream}
                  hasVideo={localCamOn && hasLiveVideo(localStream)}
                  micOn={localMicOn}
                  speaking={localMicOn && selfSpeaking}
                  handRaised={!!raisedHands[myProfile.id]}
                  isSelf
                  width={plan.tileWidth}
                  height={plan.tileHeight}
                  compact={compact}
                />
              )}
              {orderedPeers.map((peerId) => {
                const profile = profiles[peerId] ?? {
                  id: peerId,
                  display_name: "Convidado",
                  avatar_color: "#475569",
                };
                const stream = streams[peerId];
                return (
                  <Tile
                    key={peerId}
                    profile={profile}
                    stream={stream ?? null}
                    hasVideo={hasLiveVideo(stream)}
                    micOn={true}
                    speaking={!!speakingPeers[peerId]}
                    handRaised={!!raisedHands[peerId]}
                    width={plan.tileWidth}
                    height={plan.tileHeight}
                    compact={compact}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Mede viewport e o painel Equipe ([data-office-team]) para não ficar por baixo dele. */
function useGalleryBounds(active: boolean) {
  const [state, setState] = useState({ vw: 1280, vh: 800, teamInset: 0 });
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const measure = () => {
      const team = document.querySelector<HTMLElement>("[data-office-team]");
      let teamInset = 0;
      if (team) {
        const r = team.getBoundingClientRect();
        teamInset = Math.max(0, window.innerWidth - r.left);
      }
      setState((s) =>
        s.vw === window.innerWidth && s.vh === window.innerHeight && s.teamInset === teamInset
          ? s
          : { vw: window.innerWidth, vh: window.innerHeight, teamInset },
      );
    };
    measure();
    window.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure);
    // Equipe abre/fecha sem resize: observa a árvore e mede de novo.
    const mo = new MutationObserver(measure);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("fullscreenchange", measure);
      mo.disconnect();
    };
  }, [active]);
  return state;
}

function Tile({
  profile,
  stream,
  hasVideo,
  micOn,
  speaking,
  handRaised,
  isSelf,
}: {
  profile: Profile;
  stream: MediaStream | null;
  hasVideo: boolean;
  micOn: boolean;
  speaking: boolean;
  handRaised?: boolean;
  isSelf?: boolean;
}) {
  const borderColor = handRaised
    ? "border-amber-400"
    : speaking
    ? "border-emerald-400"
    : "border-white/15";
  const glow = handRaised
    ? "0 0 0 2px color-mix(in oklab, #fbbf24 75%, transparent), 0 8px 28px -8px rgba(251,191,36,0.45)"
    : speaking
    ? "0 0 0 2px color-mix(in oklab, #34d399 70%, transparent), 0 6px 24px -8px rgba(0,0,0,0.45)"
    : undefined;
  return (
    <div
      className={`relative w-48 h-28 rounded-xl overflow-hidden shadow-lg border-2 transition-all ${borderColor}`}
      style={{
        background: profile.avatar_color || "#1f2937",
        boxShadow: glow,
      }}
    >
      {hasVideo && stream ? (
        <VideoEl stream={stream} mirrored={!!isSelf} />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/35">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-semibold shadow-inner"
            style={{ background: profile.avatar_color || "#475569" }}
          >
            {initials(profile.display_name)}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-white/85">
            <VideoOff className="w-3 h-3" />
            <span>sem vídeo</span>
          </div>
        </div>
      )}

      {/* Raised hand badge (top-left) */}
      {handRaised && (
        <div
          className="absolute top-1.5 left-1.5 px-2 h-7 rounded-full flex items-center gap-1 bg-amber-400 text-amber-950 shadow-md ring-2 ring-amber-200/70 animate-pulse"
          title="Mão levantada"
        >
          <Hand className="w-4 h-4" />
          <span className="text-[10px] font-semibold tracking-wide">MÃO</span>
        </div>
      )}

      {/* Bottom name + mic state bar (Meet-like) */}
      <div className="absolute bottom-0 inset-x-0 px-2 py-1 bg-black/55 text-white text-xs flex items-center gap-1.5">
        {micOn ? (
          <Mic className={`w-3 h-3 shrink-0 ${speaking ? "text-emerald-400" : "text-white/80"}`} />
        ) : (
          <MicOff className="w-3 h-3 shrink-0 text-red-400" />
        )}
        <span className="truncate">
          {profile.display_name}
          {isSelf ? " (você)" : ""}
        </span>
      </div>
    </div>
  );
}

function VideoEl({ stream, mirrored }: { stream: MediaStream; mirrored?: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      ref.current.play?.().catch(() => {});
    }
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className="w-full h-full object-cover"
      style={mirrored ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}

export function HiddenAudioPlayers({ streams }: { streams: Record<string, MediaStream> }) {
  return (
    <div className="absolute -left-[9999px] top-0 w-px h-px overflow-hidden" aria-hidden>
      {Object.entries(streams).map(([peerId, stream]) => (
        <AudioEl key={peerId} stream={stream} />
      ))}
    </div>
  );
}

function AudioEl({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (ref.current.srcObject !== stream) ref.current.srcObject = stream;
    void ref.current.play().catch(() => {});
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}
