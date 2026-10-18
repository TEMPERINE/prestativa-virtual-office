import { OfficeChatButton, useOfficeChat } from "@/components/chat/OfficeChat";
import { getRtcOnDemand } from "@/lib/rtc/rtc-demand-controller";
import { MicLevelMeter } from "./MicLevelMeter";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RemoteMotionPredictor, facingFromVector } from "@/lib/rtc/remote-motion";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  ZONES,
  SPAWN,
  collides,
  canMoveOnMap,
  zoneAtWithOverrides as zoneAt,
  findZoneById,
  type Point,
  type ZoneId,
} from "@/lib/office-map";
import { loadOverrides, zoneRectFromOverrides, getZoneKind, getMapSync, pullOverridesFromCloud, subscribeOverridesFromCloud } from "@/lib/map-overrides";
import { workspaceZonesForMap, pointInMapZone } from "@/lib/workspace-zones";
import { positionRecoveryDecision, walkablePointInZone, nearestWalkablePoint } from "@/lib/map-navigation";
import { legacyCallZoneAt } from "@/lib/legacy-call-zone";
import { zoneIdAtPoint } from "@/lib/rtc/canonical-zones";
import { useOfficeTheme } from "@/hooks/useOfficeTheme";
import parkLeft from "@/assets/scene-park-left.webp";
import roadRight from "@/assets/scene-road-right.webp";
import { SPRITES, getSprite, SPRITE_FRAMES as FRAMES, type Facing } from "@/lib/sprite-catalog";
import { ensureFrameOffsets, getFrameOffsets, subscribeFrameOffsets } from "@/lib/sprite-alignment";
import { AlignedSprite } from "@/components/sprites/AlignedSprite";
import { PropsLayer } from "./PropsLayer";
import { OfficeToastLayer, OfficeNotice, OfficeAreaNotice } from "./OfficeToastLayer";
import { isMoveGated } from "@/lib/prop-gates";
import { findTouchRoute } from "@/lib/mobile/touch-route";
import { createTouchGestures, screenToMap, GESTURE_EXEMPT } from "@/lib/mobile/touch-gestures";
import { isCoarsePointer } from "@/lib/mobile/input-mode";
import { useMobileViewport } from "@/lib/mobile/viewport";
import { MobileZoneSheet } from "./MobileZoneSheet";

const WALK_FRAME_MS = 110;

function dirFromKey(k: string): Facing | null {
  if (k === "arrowup" || k === "w") return "up";
  if (k === "arrowdown" || k === "s") return "down";
  if (k === "arrowleft" || k === "a") return "left";
  if (k === "arrowright" || k === "d") return "right";
  return null;
}

const EMOJI_MAP: Record<string, string> = {
  "1": "❤️",
  "2": "👏",
  "3": "🤣",
  "4": "🙌",
  "5": "🤯",
  "6": "💩",
  "7": "🔥",
  "8": "🥹",
  "9": "🤯",
  "0": "✅",
};
// Mapeia cada emoji do atalho 0-9 para o "unified" code-point usado pelo
// dataset Apple (iamcal/emoji-data). Renderizamos o PNG do CDN em vez do
// glyph nativo p/ ficar visualmente igual ao WhatsApp/iOS em qualquer SO.
const EMOJI_UNIFIED: Record<string, string> = {
  "❤️": "2764-fe0f",
  "👏": "1f44f",
  "🤣": "1f923",
  "🙌": "1f64c",
  "🤯": "1f92f",
  "💩": "1f4a9",
  "🔥": "1f525",
  "🥹": "1f979",
  "✅": "2705",
};
function appleEmojiUrl(emoji: string): string | null {
  const code = EMOJI_UNIFIED[emoji];
  if (!code) return null;
  return `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-64/${code}.png`;
}
const REACTION_DURATION_MS = 3000;
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { LogOut, Mic, MicOff, Video, VideoOff, MonitorUp, Users, Pencil, User as UserIcon, MessageCircle, StickyNote, X as XIcon, Plus, Minus, Locate, ChevronLeft, ChevronRight, Footprints, UserPlus, Hand, Circle, Square, Loader2, Smile } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import EmojiPicker, { EmojiStyle, Theme as EmojiTheme } from "emoji-picker-react";
import { Link } from "@tanstack/react-router";
import { useLiveKit, ACTIVE_RTC_ENGINE, type RtcV2HookConfig } from "@/lib/rtc/useLiveKit";

// Motor RTC escolhido uma vez por execução (VITE_RTC_ENGINE; default v1).
const IS_RTC_V2 = ACTIVE_RTC_ENGINE === "v2";
const RTC_ON_DEMAND_ACTIVE = IS_RTC_V2 && getRtcOnDemand() !== "off";
import { installAudioUnlockListeners, unlockAudioPlayback } from "@/lib/rtc/audio-unlock";
import { RemoteVideoTiles, HiddenAudioPlayers } from "./RemoteVideoTiles";
import { MeetingStage, type StageControls, type StageParticipant, type StageScreen } from "./MeetingStage";
import { MEETING_UI_V2, resolveMeetingDisplayMode, type MeetingDisplayMode } from "@/lib/meeting-ui/layout";
import {
  createFollowRequestCenter, presenterFromService, playFollowChime, primeNotificationSound, type FollowRequestCenter,
} from "@/lib/notifications/follow-requests";
import { createJoinInviteCenter, type JoinInviteCenter } from "@/lib/notifications/join-invitations";
import { CamPreviewAndPicker } from "./CamPreviewAndPicker";
import { DeviceMenu } from "./DeviceMenu";
import prestativaIcon from "@/assets/virtual-office-logo.png.asset.json";
import { ScreenShareViewer } from "./ScreenShareViewer";
import { ConfettiBurst } from "./ConfettiBurst";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ProfileMenu } from "@/components/profile/ProfileMenu";
import { SpriteAvatar as ProfileSpriteAvatar } from "@/components/profile/SpriteAvatar";
import { SavedNotesDialog } from "@/components/profile/SavedNotesDialog";
import { EditCharacterModal } from "@/components/profile/EditCharacterModal";
import { EditProfileModal } from "@/components/profile/EditProfileModal";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { NotificationsPrompt } from "@/components/onboarding/NotificationsPrompt";
import { FollowRequestsOverlay } from "@/components/office/FollowRequestsOverlay";
import { createOfficeNotificationAdapter } from "@/lib/notifications/office-notification-adapter";
import { setNotificationService, clearNotificationService, isNotificationSetupDone, type OfficeNotificationService } from "@/lib/notifications/notification-service";
import { useMeetingTracker } from "@/lib/meetings/useMeetingTracker";
import { useMeetingRecorder } from "@/lib/meetings/useMeetingRecorder";
import { useServerRecorder } from "@/lib/meetings/useServerRecorder";
import { useMeetingIdleGuard } from "@/lib/meetings/useMeetingIdleGuard";
import { MeetingReturnPosition } from "@/lib/meetings/meeting-inactivity-controller";
import { MeetingIdleWarning } from "@/components/office/MeetingIdleWarning";
import { emitTelemetry } from "@/lib/rtc/rtc-telemetry-types";
import { useCanRecordMeeting } from "@/lib/meetings/useCanRecordMeeting";
import { RecordingNameDialog } from "@/components/office/RecordingNameDialog";
import { getCurrentWorkspaceId } from "@/lib/workspace/current";
import { useWorkspaceTier } from "@/lib/workspace/useWorkspaceTier";

import { isMovementInputBlocked, type OfficePanel } from "@/lib/office/overlay";
type Profile = {
  id: string;
  display_name: string;
  avatar_color: string;
  sprite_id?: string | null;
  tagline?: string | null;
  status?: "available" | "busy" | "away" | null;
  onboarded_at?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  city?: string | null;
  state?: string | null;
  country_code?: string | null;
};

type RemotePos = {
  user_id: string;
  x: number;
  y: number;
  zone: string;
  is_online: boolean;
  facing?: Facing;
  updated_at?: string;
  ts?: number;
};
type LocalSavedPosition = {
  x: number;
  y: number;
  zone?: string;
  facing?: Facing;
  ts: number;
};
type DeskNote = {
  id: string;
  zone_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  x: number;
  y: number;
  created_at: string;
  read_at: string | null;
};

const SPEED = 0.0042;            // tamanho do passo na cadência alvo de 60 fps
const SPEED_PER_SEC = SPEED * 60; // velocidade real (frações de mapa por segundo)
const MIN_STEP_FACTOR = 0.5;     // não deixa o passo ficar minúsculo em FPS alto
const MAX_STEP_FACTOR = 3;       // evita pulos enormes quando a aba volta do background
const SEND_INTERVAL_MS = 120;
const POSITION_BROADCAST_CHANNEL = "positions-broadcast-v1";
const POSITION_PRESENCE_CHANNEL = "positions-presence-v1";
const REMOTE_TELEPORT_MIN_DISTANCE = 0.075;
const STATE_REQUEST_RETRIES_MS = [0, 450, 1200, 2500];

const timestampForPosition = (p: Partial<Pick<RemotePos, "updated_at" | "ts">>) =>
  p.ts ?? (p.updated_at ? Date.parse(p.updated_at) : 0);

const distanceBetween = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const validPoint = (p: Point | undefined): p is Point =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const LAST_POSITION_KEY_PREFIX = "office:last-position:v1:";

function readLocalSavedPosition(userId: string): LocalSavedPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${LAST_POSITION_KEY_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalSavedPosition>;
    const x = parsed.x;
    const y = parsed.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      x: x as number,
      y: y as number,
      zone: typeof parsed.zone === "string" ? parsed.zone : undefined,
      facing: parsed.facing,
      ts: Number.isFinite(parsed.ts) ? parsed.ts! : 0,
    };
  } catch {
    return null;
  }
}

function writeLocalSavedPosition(userId: string, point: Point, zone: string, facing: Facing) {
  if (typeof window === "undefined" || !validPoint(point)) return;
  try {
    window.localStorage.setItem(
      `${LAST_POSITION_KEY_PREFIX}${userId}`,
      JSON.stringify({ x: point.x, y: point.y, zone, facing, ts: Date.now() } satisfies LocalSavedPosition),
    );
  } catch {
    // localStorage can be unavailable in private modes; DB persistence remains the source of truth.
  }
}

function describeMediaError(err: unknown, kind: "microfone" | "câmera"): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  const msg = (err as { message?: string } | null)?.message ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return `Permissão para ${kind} foi negada. Libere o acesso nas configurações do navegador/sistema.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return `Nenhum(a) ${kind} compatível encontrado(a) neste dispositivo.`;
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return `O(a) ${kind} está em uso por outro aplicativo. Feche-o e tente novamente.`;
  }
  if (name === "AbortError") {
    return `Acesso ao(à) ${kind} foi interrompido. Tente novamente.`;
  }
  return msg ? `Não foi possível acessar o(a) ${kind}: ${msg}` : `Não foi possível acessar o(a) ${kind}.`;
}

// v1: regra legada (lê o cache global do mapa). v2: regra canônica pura
// compartilhada com o Token V2 (canonical-zones), recebendo o mesmo mapa.
function callZoneAt(p: Point): ZoneId {
  return IS_RTC_V2 ? (zoneIdAtPoint(loadOverrides(), p) as ZoneId) : legacyCallZoneAt(p);
}

const MEETING_AREA_RECT_PADDING = 0.018;

function effectiveZoneRect(id: string): { x1: number; y1: number; x2: number; y2: number } | null {
  const z = findZoneById(id);
  return zoneRectFromOverrides(id as ZoneId) ?? z?.rect ?? null;
}

function zonesShareMeetingArea(a: string, b: string): boolean {
  if (a === b) return a !== "lobby";
  if (a === "lobby" || b === "lobby") return false;
  const ar = effectiveZoneRect(a);
  const br = effectiveZoneRect(b);
  if (!ar || !br) return false;
  const pad = MEETING_AREA_RECT_PADDING;
  const separated =
    ar.x2 + pad < br.x1 ||
    br.x2 + pad < ar.x1 ||
    ar.y2 + pad < br.y1 ||
    br.y2 + pad < ar.y1;
  if (separated) return false;
  const overlapX = Math.min(ar.x2, br.x2) - Math.max(ar.x1, br.x1);
  const overlapY = Math.min(ar.y2, br.y2) - Math.max(ar.y1, br.y1);
  const minW = Math.min(ar.x2 - ar.x1, br.x2 - br.x1);
  const minH = Math.min(ar.y2 - ar.y1, br.y2 - br.y1);
  return overlapX / Math.max(minW, 0.001) > 0.35 || overlapY / Math.max(minH, 0.001) > 0.35;
}

// Pick a random walkable spot in the corridor/lobby (no claimed zone).
// Used when the user has no workstation assigned so they don't all stack on SPAWN.
function randomCorridorPoint(): Point {
  for (let i = 0; i < 80; i++) {
    const x = 0.18 + Math.random() * 0.72;
    const y = 0.18 + Math.random() * 0.72;
    const p = { x, y };
    if (collides(p)) continue;
    // Must be in the lobby (corridor) — not inside any built-in zone rect.
    const z = callZoneAt(p);
    if (z !== "lobby") continue;
    return p;
  }
  return SPAWN;
}

// Random walkable point inside a given zone rect. Used by teleport so two
// avatars don't stack on the same fixed seat point.
function randomPointInRect(
  rect: { x1: number; y1: number; x2: number; y2: number },
  avoid: Point[] = [],
  minDist = 0.04,
  zoneId?: string,
): Point | null {
  const pad = 0.008;
  for (let i = 0; i < 120; i++) {
    const x = rect.x1 + pad + Math.random() * Math.max(0, rect.x2 - rect.x1 - pad * 2);
    const y = rect.y1 + pad + Math.random() * Math.max(0, rect.y2 - rect.y1 - pad * 2);
    const p = { x, y };
    if (collides(p) || (zoneId && !pointInMapZone(loadOverrides(), zoneId, p))) continue;
    if (avoid.some((a) => Math.hypot(a.x - x, a.y - y) < minDist)) continue;
    return p;
  }
  return zoneId ? walkablePointInZone(loadOverrides(), zoneId) : nearestWalkablePoint(loadOverrides(), { x: (rect.x1 + rect.x2) / 2, y: (rect.y1 + rect.y2) / 2 });
}

// Find a walkable point next to `anchor` (used by "Junte-se a mim" teleport
// so the called user lands beside the caller, not on top of them).
function nearbyWalkablePoint(anchor: Point, avoid: Point[] = [], preferredZoneId?: ZoneId): Point | null {
  const rings = [0.035, 0.05, 0.07, 0.09, 0.12, 0.16];
  for (const r of rings) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const p = { x: anchor.x + Math.cos(a) * r, y: anchor.y + Math.sin(a) * r };
      if (p.x < 0.02 || p.x > 0.98 || p.y < 0.02 || p.y > 0.98) continue;
      if (collides(p)) continue;
      if (preferredZoneId && preferredZoneId !== "lobby" && callZoneAt(p) !== preferredZoneId) continue;
      if (avoid.some((v) => Math.hypot(v.x - p.x, v.y - p.y) < 0.025)) continue;
      return p;
    }
  }
  if (preferredZoneId && preferredZoneId !== "lobby") {
    const z = findZoneById(preferredZoneId);
    const rect = zoneRectFromOverrides(preferredZoneId) ?? z?.rect;
    if (rect) return randomPointInRect(rect, avoid, 0.04, preferredZoneId);
  }
  return nearestWalkablePoint(loadOverrides(), anchor);
}

export function OfficeScene({
  onHydrated,
  rtcSession = null,
  panel = null,
  onPanelChange,
}: {
  onHydrated?: () => void;
  rtcSession?: RtcV2HookConfig | null;
  panel?: OfficePanel | null;
  onPanelChange?: (p: OfficePanel | null) => void;
} = {}) {
  const officeTheme = useOfficeTheme();
  const officeChat = useOfficeChat();
  // Painel aberto bloqueia só o input local de movimento (avatar/RTC intactos).
  const panelRef = useRef(panel);
  panelRef.current = panel;
  // Capacidades por nível do espaço atual — controlam botões de gravar,
  // teleporte e troca de personagem.
  const { caps: tierCaps } = useWorkspaceTier(getCurrentWorkspaceId());
  const canRecordMeeting = useCanRecordMeeting(getCurrentWorkspaceId());
  const tierCapsRef = useRef(tierCaps);
  tierCapsRef.current = tierCaps;
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [positions, setPositions] = useState<Record<string, RemotePos>>({});
  const positionsRef = useRef<Record<string, RemotePos>>({});
  positionsRef.current = positions;
  // Per-remote interpolation state. The rAF loop in this component lerps
  // each remote avatar's wrapper toward the latest target position so they
  // glide between ~120 ms broadcast samples instead of teleporting.
  const remoteWrapRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const remoteSmoothRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // RTC v2: predição visual entre eventos de Movement (START/CHANGE/STOP/SYNC).
  // Diagnóstico 14C (temporário): localStorage.rtcMotionTrace = "1" → window.__rtcMotionTrace
  const v2PredictorRef = useRef(
    new RemoteMotionPredictor(
      typeof window !== "undefined" && window.localStorage?.getItem("rtcMotionTrace") === "1"
        ? (t) => {
            const w = window as unknown as { __rtcMotionTrace?: unknown[] };
            const buf = (w.__rtcMotionTrace ??= []);
            buf.push(t);
            if (buf.length > 2000) buf.shift();
          }
        : undefined,
    ),
  );
  // Fast realtime presence signal. It accelerates discovery, but is NOT the
  // authority for visibility: the database `is_online` flag is the durable
  // game-state source, so idle players never disappear just because a presence
  // heartbeat or browser tab event was missed.
  const [presentPeerIds, setPresentPeerIds] = useState<Set<string>>(() => new Set());
  // LWW tracker — freshest per-peer ts from BROADCAST/PRESENCE (peer client clock).
  // Used to dedupe duplicate live samples from the same producer.
  // IMPORTANT: do NOT mix with DB updated_at — server clock vs peer client clock
  // skew would cause valid live updates to be discarded, freezing avatars.
  const positionFreshTs = useRef<Map<string, number>>(new Map());
  // Separate LWW tracker for DB-sourced rows (server clock). Used only to dedupe
  // postgres_changes / poll responses against each other.
  const dbFreshTs = useRef<Map<string, number>>(new Map());
  // Prevents the initial SPAWN placeholder from being advertised/persisted before
  // the user's real saved position has loaded.
  const positionHydratedRef = useRef(false);
  const [pos, setPos] = useState<Point>(SPAWN);
  const [mapVersion, setMapVersion] = useState(0);
  const [positionLoaded, setPositionLoaded] = useState(false);
  const [canonicalMapReady, setCanonicalMapReady] = useState(false);
  const [zone, setZone] = useState<ZoneId>("lobby");
  const [showTeam, setShowTeam] = useState(true);
  const [isMasterAdmin, setIsMasterAdmin] = useState(false);
  useEffect(() => {
    if (!me?.id) { setIsMasterAdmin(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_roles").select("role")
        .eq("user_id", me.id).eq("role", "superadmin").maybeSingle();
      if (!cancelled) setIsMasterAdmin(!!data);
    })();
    return () => { cancelled = true; };
  }, [me?.id]);
  const [showHint, setShowHint] = useState(true);
  const [facing, setFacing] = useState<Facing>("down");
  const facingRef = useRef<Facing>("down");
  const [reactions, setReactions] = useState<Record<string, { emoji: string; ts: number }>>({});
  const [confettis, setConfettis] = useState<Array<{ id: string; x: number; y: number; facing: Facing; ts: number }>>([]);
  // Active remote-user teleport effects (so others see the sparkle/fade like a game).
  const [remoteTeleports, setRemoteTeleports] = useState<
    Record<string, { from: Point; to: Point; phase: "out" | "in"; id: number }>
  >({});
  const remoteTeleportTimers = useRef<Map<string, number[]>>(new Map());
  const startRemoteTeleport = useCallback((userId: string, from: Point, to: Point) => {
    if (!userId || userId === meIdRef.current || !validPoint(from) || !validPoint(to)) return;
    const id = Date.now() + Math.random();
    const prevTimers = remoteTeleportTimers.current.get(userId) ?? [];
    prevTimers.forEach((t) => window.clearTimeout(t));
    const timers: number[] = [];
    setRemoteTeleports((p) => ({ ...p, [userId]: { from, to, phase: "out", id } }));
    timers.push(
      window.setTimeout(() => {
        setRemoteTeleports((p) =>
          p[userId]?.id === id ? { ...p, [userId]: { ...p[userId], phase: "in" } } : p
        );
      }, 450)
    );
    timers.push(
      window.setTimeout(() => {
        setRemoteTeleports((p) => {
          if (p[userId]?.id !== id) return p;
          const next = { ...p };
          delete next[userId];
          return next;
        });
        remoteTeleportTimers.current.delete(userId);
      }, 1100)
    );
    remoteTeleportTimers.current.set(userId, timers);
  }, []);
  const maybeStartRemoteTeleportFromCurrent = useCallback((userId: string, to: Point, incomingTs: number) => {
    if (!userId || userId === meIdRef.current || !validPoint(to)) return;
    if (remoteTeleportTimers.current.has(userId)) return;
    const cur = positionsRef.current[userId];
    if (!cur || !validPoint(cur)) return;
    const curTs = timestampForPosition(cur) || (positionFreshTs.current.get(userId) ?? 0);
    if (incomingTs && curTs && incomingTs < curTs) return;
    const from = { x: cur.x, y: cur.y };
    if (distanceBetween(from, to) < REMOTE_TELEPORT_MIN_DISTANCE) return;
    startRemoteTeleport(userId, from, to);
  }, [startRemoteTeleport]);
  // Per-remote-user walking animation state. Advances frame while position is changing.
  const remoteAnimRef = useRef<Map<string, { frame: number; lastMove: number; lastX: number; lastY: number; lastTick: number }>>(new Map());
  const [remoteFrames, setRemoteFrames] = useState<Record<string, number>>({});
  // zone_id -> user_id (claims)
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [notes, setNotes] = useState<DeskNote[]>([]);
  const [composeFor, setComposeFor] = useState<{ zoneId: string; recipientId: string; recipientName: string } | null>(null);
  const [composeText, setComposeText] = useState("");
  const [placing, setPlacing] = useState<{ zoneId: string; recipientId: string; body: string } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [openingNote, setOpeningNote] = useState<DeskNote | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const savedNotesOpen = panel === "notes";
  const setSavedNotesOpen = (o: boolean) => onPanelChange?.(o ? "notes" : null);
  const [raisedHands, setRaisedHands] = useState<Record<string, boolean>>({});
  const handChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const handChannelReadyRef = useRef(false);
  const reactionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const positionBroadcastChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const positionBroadcastReadyRef = useRef(false);
  const clientInstanceIdRef = useRef(`client:${Date.now()}:${Math.random().toString(36).slice(2)}`);

  const meIdRef = useRef<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const [myEmail, setMyEmail] = useState<string>("");
  const editCharOpen = panel === "character";
  const editProfOpen = panel === "profile";
  const setEditCharOpen = (o: boolean) => onPanelChange?.(o ? "character" : null);
  const setEditProfOpen = (o: boolean) => onPanelChange?.(o ? "profile" : null);
  const [forceOnboarding, setForceOnboarding] = useState(false);

  const refreshMe = useCallback(async () => {
    const uid = meIdRef.current;
    if (!uid) return;
    const { data } = await supabase.from("profiles").select("id, display_name, avatar_color, sprite_id, tagline, status, onboarded_at, first_name, last_name, birth_date, city, state, country_code").eq("id", uid).maybeSingle();
    if (data) {
      setMe(data as Profile);
      setProfiles((prev) => ({ ...prev, [uid]: data as Profile }));
    }
  }, []);

  // ===== Camera (zoom + pan + follow) =====
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4; // ~roughly one workspace fills the screen
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 }); // pixel offset of scaled content in stage
  const [followMe, setFollowMe] = useState(true);

  // Auto-hide the welcome hint after 5s.
  useEffect(() => {
    const t = window.setTimeout(() => setShowHint(false), 5000);
    return () => window.clearTimeout(t);
  }, []);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const followRef = useRef(true);
  zoomRef.current = zoom;
  panRef.current = pan;
  followRef.current = followMe;
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const wasDragRef = useRef(false);

  const clampPan = useCallback((s: number, p: { x: number; y: number }) => {
    const stage = stageRef.current;
    if (!stage) return p;
    const W = stage.clientWidth, H = stage.clientHeight;
    const minX = W - W * s, minY = H - H * s;
    return {
      x: Math.min(0, Math.max(minX, p.x)),
      y: Math.min(0, Math.max(minY, p.y)),
    };
  }, []);

  const centerOn = useCallback((nx: number, ny: number, s = zoomRef.current) => {
    const stage = stageRef.current;
    if (!stage) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    const tx = W / 2 - nx * W * s;
    const ty = H / 2 - ny * H * s;
    setPan(clampPan(s, { x: tx, y: ty }));
  }, [clampPan]);

  // Smoothly tween zoom + pan to center on a normalized point.
  const tweenRafRef = useRef<number | null>(null);
  const tweenCenterOn = useCallback((nx: number, ny: number, targetZoom: number, duration = 650, onDone?: () => void) => {
    const stage = stageRef.current;
    if (!stage) return;
    if (tweenRafRef.current != null) cancelAnimationFrame(tweenRafRef.current);
    const W = stage.clientWidth, H = stage.clientHeight;
    const startZoom = zoomRef.current;
    const startPan = { ...panRef.current };
    const endZoom = targetZoom;
    const endPan = clampPan(endZoom, {
      x: W / 2 - nx * W * endZoom,
      y: H / 2 - ny * H * endZoom,
    });
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const k = ease(t);
      const z = startZoom + (endZoom - startZoom) * k;
      const px = startPan.x + (endPan.x - startPan.x) * k;
      const py = startPan.y + (endPan.y - startPan.y) * k;
      // Só atualiza quando realmente muda — setState com objeto novo a cada
      // frame dispara re-render 60x/s e pode estourar o limite do React.
      setZoom((prev) => (prev === z ? prev : z));
      setPan((prev) => (prev.x === px && prev.y === py ? prev : { x: px, y: py }));
      if (t < 1) {
        tweenRafRef.current = requestAnimationFrame(step);
      } else {
        tweenRafRef.current = null;
        onDone?.();
      }
    };
    tweenRafRef.current = requestAnimationFrame(step);
  }, [clampPan]);

  // Follow avatar smoothly when enabled
  useEffect(() => {
    if (!followMe) return;
    centerOn(pos.x, pos.y, zoom);
  }, [pos.x, pos.y, zoom, followMe, centerOn]);

  // Re-clamp pan on window resize
  useEffect(() => {
    const onResize = () => setPan((p) => clampPan(zoomRef.current, p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampPan]);


  const keysDown = useRef<Set<Facing>>(new Set());
  const lastDir = useRef<Facing | null>(null);
  const lastSent = useRef(0);
  const lastPersisted = useRef(0);
  const lastPosCommit = useRef(0);
  const posRef = useRef(pos);
  posRef.current = pos;

  // Walk animation frame (0 = idle, 1..5 = walk cycle)
  const [frame, setFrame] = useState(0);
  const frameRef = useRef(0);
  const lastFrameTick = useRef(0);

  const setLocalFacing = useCallback((nextFacing: Facing) => {
    if (facingRef.current === nextFacing) return;
    facingRef.current = nextFacing;
    setFacing(nextFacing);
  }, []);

  const localZoneId = useMemo(() => callZoneAt({ x: pos.x, y: pos.y }), [pos.x, pos.y, mapVersion]);
  const localZoneSupportsVideo = useMemo(
    () => findZoneById(localZoneId)?.supportsVideo ?? getZoneKind(localZoneId) === "common",
    [localZoneId, mapVersion],
  );

  // ---- ARQUITETURA: LiveKit centralizado por área de mídia ----
  // 1) A mídia entra em uma Room LiveKit da zona atual (`workspace:zone`).
  //    Isso evita manter todo o escritório conectado em um único room global,
  //    que gerava 429/limite de sinalização antes mesmo da reunião começar.
  // 2) A zona do avatar segue controlando a política de mídia: em uma sala,
  //    todos que estão fisicamente no mesmo rect entram no mesmo room SFU.
  // 3) Fora de salas com vídeo, não abrimos room de mídia — o mapa e a
  //    presença visual continuam funcionando sem consumir sinalização.
  const PROXIMITY_CONNECT = 0.038;
  const PROXIMITY_DISCONNECT = 0.052;
  const connectedPeersRef = useRef<Set<string>>(new Set());

  // Room LiveKit estável enquanto o avatar permanece na mesma área de mídia.
  const roomKey = useMemo(() => {
    if (!me?.id) return null;
    const ws = getCurrentWorkspaceId();
    if (!ws) return null;
    if (localZoneId === "lobby" || !localZoneSupportsVideo) return null;
    return `prestativa-office:${ws}:${localZoneId}`;
  }, [me?.id, localZoneId, localZoneSupportsVideo]);

  // Política de mídia: quem o LiveKit deve subscrever para mim agora.
  // Calculado puramente de `positions` (broadcast Supabase) + classificação
  // local de zona. Todos os clientes chegam à mesma resposta → simétrico.
  const desiredPeers = useMemo(() => {
    const meId = me?.id;
    if (!meId) return [] as string[];
    const myZoneId = localZoneId;
    if (!localZoneSupportsVideo) return [] as string[];

    // Zona privada: TODOS os peers cuja posição cai no mesmo rect entram.
    if (myZoneId !== "lobby") {
      const out: string[] = [];
      for (const [uid, p] of Object.entries(positions)) {
        if (uid === meId) continue;
        if (!p.is_online && !presentPeerIds.has(uid)) continue;
        if (callZoneAt({ x: p.x, y: p.y }) !== myZoneId) continue;
        out.push(uid);
      }
      return out.slice(0, 24);
    }

    // Lobby/corredor: proximidade com histerese pequena.
    const candidates: { uid: string; score: number }[] = [];
    for (const [uid, p] of Object.entries(positions)) {
      if (uid === meId) continue;
      if (!p.is_online && !presentPeerIds.has(uid)) continue;
      const dx = p.x - pos.x;
      const dy = p.y - pos.y;
      const dist = Math.hypot(dx, dy);
      const already = connectedPeersRef.current.has(uid);
      const closeEnough = already ? dist <= PROXIMITY_DISCONNECT : dist <= PROXIMITY_CONNECT;
      if (closeEnough) candidates.push({ uid, score: dist });
    }
    return candidates.sort((a, b) => a.score - b.score).slice(0, 14).map((c) => c.uid);
  }, [me?.id, positions, presentPeerIds, pos.x, pos.y, localZoneId, localZoneSupportsVideo, mapVersion]);

  const audiblePeerIds = useMemo(() => new Set(desiredPeers), [desiredPeers]);
  // Conexão LiveKit por zona; `audiblePeerIds` controla setSubscribed nas
  // tracks remotas e mantém a experiência simétrica dentro da sala.
  // v1: comportamento legado (roomKey + filtro). v2: sessão ACTIVE da rota;
  // roster privado vem do LiveKit e o lobby é filtrado por SpatialSubscriptions.
  const rtc = useLiveKit(
    me?.id ?? null,
    IS_RTC_V2 ? null : roomKey,
    IS_RTC_V2 ? null : audiblePeerIds,
    IS_RTC_V2 ? rtcSession : null,
  );
  const rtcV2Ref = useRef(rtc.v2);
  rtcV2Ref.current = rtc.v2;
  const lastMotionAtRef = useRef(0);
  useEffect(() => {
    connectedPeersRef.current = new Set(desiredPeers);
  }, [desiredPeers]);

  // Peers audíveis = quem está conectado no LiveKit ∩ política de mídia atual.
  const audibleConnectedPeers = useMemo(
    () => (IS_RTC_V2 ? rtc.connectedPeers : rtc.connectedPeers.filter((id) => audiblePeerIds.has(id))),
    [rtc.connectedPeers, audiblePeerIds],
  );
  const audibleStreams = useMemo(() => {
    if (IS_RTC_V2) return rtc.remoteStreams;
    const out: Record<string, MediaStream> = {};
    for (const id of audibleConnectedPeers) {
      const s = rtc.remoteStreams[id];
      if (s) out[id] = s;
    }
    return out;
  }, [audibleConnectedPeers, rtc.remoteStreams]);
  const audibleScreenStreams = useMemo(() => {
    if (IS_RTC_V2) return rtc.remoteScreenStreams;
    const out: Record<string, MediaStream> = {};
    for (const id of audibleConnectedPeers) {
      const s = rtc.remoteScreenStreams[id];
      if (s) out[id] = s;
    }
    return out;
  }, [audibleConnectedPeers, rtc.remoteScreenStreams]);

  // ---- RTC v2: posição própria → runtime (contexto, spatial, movement) ----
  const rtcV2Ready = !!rtc.v2;
  useEffect(() => {
    if (!IS_RTC_V2 || !rtcV2Ready || !positionHydratedRef.current) return;
    const v2 = rtcV2Ref.current;
    if (!v2) return;
    // Caminhada já reportou via reportMotion; salto sem caminhada = teleporte.
    if (performance.now() - lastMotionAtRef.current < 250) v2.setSelfPosition(pos.x, pos.y);
    else v2.announceJump(pos.x, pos.y);
  }, [pos.x, pos.y, rtcV2Ready]);

  // ---- RTC v2: Movement V2 + Presence V2 → estado já usado pelo renderer ----
  const v2Avatars = rtc.v2?.avatars ?? null;
  const v2Online = rtc.v2?.online ?? null;
  useEffect(() => {
    if (!IS_RTC_V2 || !v2Avatars || !v2Online) return;
    const myId = meIdRef.current;
    const now = performance.now();
    const predictor = v2PredictorRef.current;
    for (const [uid, a] of v2Avatars) {
      if (uid === myId || !v2Online.has(uid)) continue;
      // Só salto explícito (announceJump) usa o efeito de teleporte.
      // POSITION_SYNC/CHANGE/STOP viram correção suave no predictor visual.
      if (predictor.ingest(a, now) === "jump") {
        remoteSmoothRef.current.delete(uid);
        maybeStartRemoteTeleportFromCurrent(uid, { x: a.x, y: a.y }, 0);
      }
    }
    for (const uid of Array.from(predictor.keys())) {
      if (!v2Avatars.has(uid) || !v2Online.has(uid)) predictor.forget(uid);
    }
    setPositions((prev) => {
      const next: Record<string, RemotePos> = { ...prev };
      for (const [uid, cur] of Object.entries(prev)) {
        if (uid === myId) continue;
        const online = v2Online.has(uid);
        if (cur.is_online !== online) next[uid] = { ...cur, is_online: online };
      }
      for (const [uid, a] of v2Avatars) {
        if (uid === myId || !v2Online.has(uid)) continue;
        const cur = prev[uid];
        const facing: Facing = facingFromVector(a.vx, a.vy, cur?.facing ?? "down");
        next[uid] = { user_id: uid, x: a.x, y: a.y, zone: callZoneAt(a), facing, is_online: true, ts: a.seq };
      }
      return next;
    });
    setPresentPeerIds((prev) => {
      const ids = new Set([...v2Online.keys()].filter((id) => id !== myId));
      if (prev.size === ids.size && [...ids].every((id) => prev.has(id))) return prev;
      return ids;
    });
  }, [v2Avatars, v2Online, maybeStartRemoteTeleportFromCurrent]);

  // Wires global audio unlock so remote <audio> tags can autoplay.
  // Camera/mic access stays inside the user's click/keyboard gesture.
  useEffect(() => {
    const off = installAudioUnlockListeners();
    return off;
  }, []);

  // Keep realtime authenticated forever: re-attach JWT on every token refresh,
  // otherwise the websocket silently loses access to RLS-protected tables
  // after ~1h and movement events stop arriving.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      accessTokenRef.current = data.session?.access_token ?? null;
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      accessTokenRef.current = session?.access_token ?? null;
      if (event === "SIGNED_OUT") {
        window.location.href = "/auth";
        return;
      }
      const nextUserId = session?.user?.id ?? null;
      const currentUserId = meIdRef.current;
      if (event === "SIGNED_IN" && nextUserId && currentUserId && nextUserId !== currentUserId) {
        window.location.reload();
        return;
      }
      if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && session?.access_token) {
        try { void supabase.realtime.setAuth(session.access_token); } catch { /* noop */ }
      }
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  const sendPos = useCallback((x: number, y: number, z: ZoneId, f: Facing, persistNow = false) => {
    if (!positionHydratedRef.current) return;
    const userId = meIdRef.current;
    // Without a known user id we drop the sample. The presence hydration
    // effect guarantees meIdRef is set before movement is allowed; the old
    // async getUser() fallback turned every step into a network round-trip
    // when there was a boot race, which we want to avoid in the hot path.
    if (!userId) return;
    const payload = { user_id: userId, x, y, zone: z, facing: f, is_online: true, ts: Date.now() };
    const updatedAt = new Date(payload.ts).toISOString();
    writeLocalSavedPosition(userId, { x, y }, z, f);
    const ch = positionBroadcastChannelRef.current;
    if (!IS_RTC_V2 && ch && positionBroadcastReadyRef.current) {
      void ch.send({ type: "broadcast", event: "position", payload });
    }
    const now = performance.now();
    // v2: movimento ao vivo é do Movement V2; sem escrita periódica no banco.
    if (IS_RTC_V2 && !persistNow) return;
    // Persistência leve: broadcast já cobre tempo real, então salvamos no DB
    // só de 2 em 2s enquanto anda. Snapshot final no keyup/pagehide já força
    // persistNow=true, mantendo a posição correta ao desconectar.
    if (persistNow || now - lastPersisted.current > 2000) {
      lastPersisted.current = now;
      const _ws = getCurrentWorkspaceId();
      if (_ws) void supabase.from("positions").upsert({
        workspace_id: _ws,
        user_id: userId,
        x,
        y,
        zone: z,
        facing: f,
        is_online: true,
        updated_at: updatedAt,
      }, { onConflict: "workspace_id,user_id" });
    }
  }, []);

  // Preload all directional sprites so swapping facing never shows a blank frame
  useEffect(() => {
    SPRITES.forEach((sp) =>
      Object.values(sp.sheets).forEach((src) => {
        const img = new Image();
        img.src = src;
      }),
    );
  }, []);

  // Hydrate the office map from Lovable Cloud on mount so the layout drawn
  // in the editor (and saved to the `map_overrides` table) is visible to
  // every user on every device. Subscribe to realtime updates and force a
  // re-render when overrides change.
  useEffect(() => {
    let mounted = true;
    let fetched = false;
    const bump = () => {
      if (!mounted) return;
      setCanonicalMapReady(fetched && getMapSync().snapshot().state === "READY");
      setMapVersion((v) => v + 1);
    };
    void pullOverridesFromCloud().then(() => { fetched = true; bump(); });
    const off = subscribeOverridesFromCloud(() => bump());
    window.addEventListener("map-overrides-changed", bump);
    return () => {
      mounted = false;
      off();
      window.removeEventListener("map-overrides-changed", bump);
    };
  }, []);

  // Remote avatar walk-cycle animation. Detect (x,y) changes per user and
  // step through frames 1..5 while moving; freeze on frame 0 when idle for
  // more than ~220ms. Runs on a single timer so all remotes stay in sync.
  // Item 4: short-circuit cedo quando ninguém está animando — o caso comum
  // num escritório parado é "todos no frame 0", e gastar JS+setState a cada
  // 110 ms aí é desperdício puro. Só fazemos trabalho quando alguém moveu
  // recentemente ou ainda há frame > 0 para zerar.
  useEffect(() => {
    const MOVE_DECAY_MS = 220;
    const TICK_MS = 110;
    const id = window.setInterval(() => {
      const now = performance.now();
      const tracker = remoteAnimRef.current;

      // Fast path: descobrir se temos qualquer trabalho a fazer.
      // - Algum remoto com lastMove recente → precisamos avançar frame.
      // - Algum tracker com frame > 0 mas parado → precisamos zerar.
      // - Qualquer posição nova ainda não rastreada → precisamos registrar.
      let hasWork = false;
      const myId = meIdRef.current;
      const posList = Object.values(positions);
      for (const p of posList) {
        if (p.user_id === myId) continue;
        const t = tracker.get(p.user_id);
        if (!t) { hasWork = true; break; }
        if (t.lastX !== p.x || t.lastY !== p.y) { hasWork = true; break; }
        if (IS_RTC_V2 && v2PredictorRef.current.isMoving(p.user_id)) { hasWork = true; break; }
        if (now - t.lastMove < MOVE_DECAY_MS) { hasWork = true; break; }
        if (t.frame !== 0) { hasWork = true; break; }
      }
      if (!hasWork) {
        // Ainda precisa limpar trackers órfãos? Verifica rápido.
        if (tracker.size > 0) {
          const live = new Set(posList.filter((p) => p.user_id !== myId).map((p) => p.user_id));
          for (const key of tracker.keys()) {
            if (!live.has(key)) { hasWork = true; break; }
          }
        }
        if (!hasWork) return;
      }

      let changed = false;
      const next: Record<string, number> = {};

      // Sync tracker with current positions (add/update entries).
      for (const p of posList) {
        if (p.user_id === myId) continue;
        const t = tracker.get(p.user_id);
        if (!t) {
          tracker.set(p.user_id, { frame: 0, lastMove: 0, lastX: p.x, lastY: p.y, lastTick: now });
          next[p.user_id] = 0;
          continue;
        }
        if (t.lastX !== p.x || t.lastY !== p.y) {
          t.lastX = p.x;
          t.lastY = p.y;
          t.lastMove = now;
        }
        // V2: walk enquanto o estado remoto for moving=true (não depende de
        // chegar pacote novo); moving=false → idle imediato.
        const moving = IS_RTC_V2
          ? v2PredictorRef.current.isMoving(p.user_id)
          : now - t.lastMove < MOVE_DECAY_MS;
        const newFrame = moving
          ? (t.frame >= 5 || t.frame < 1 ? 1 : t.frame + 1)
          : 0;
        if (newFrame !== t.frame) {
          t.frame = newFrame;
          changed = true;
        }
        t.lastTick = now;
        next[p.user_id] = newFrame;
      }

      // Drop trackers for users no longer present.
      for (const key of Array.from(tracker.keys())) {
        if (!(key in next)) {
          tracker.delete(key);
          changed = true;
        }
      }

      if (changed) setRemoteFrames(next);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [positions]);




  const lastGatedToastRef = useRef(0);
  const tryMove = useCallback((dir: Facing, stepFactor = 1) => {
    const cur = posRef.current;
    const step = SPEED * Math.max(MIN_STEP_FACTOR, Math.min(MAX_STEP_FACTOR, stepFactor));
    const dx = dir === "left" ? -step : dir === "right" ? step : 0;
    const dy = dir === "up" ? -step : dir === "down" ? step : 0;
    let nx = cur.x + dx;
    let ny = cur.y + dy;
    const map = loadOverrides();
    if (!canMoveOnMap(map, cur, { x: nx, y: cur.y })) nx = cur.x;
    if (!canMoveOnMap(map, { x: nx, y: cur.y }, { x: nx, y: ny })) ny = cur.y;
    if (nx === cur.x && ny === cur.y) {
      // Bloqueado por parede: para imediatamente para os remotos.
      if (IS_RTC_V2) rtcV2Ref.current?.reportMotion(cur.x, cur.y, 0, 0);
      return false;
    }
    const np = { x: nx, y: ny };
    // Bloqueio por porta/elemento: se o passo cruza a fronteira de uma zona
    // trancada (por ex. porta fechada), reverte o movimento.
    const fromZoneId = callZoneAt(cur);
    const toZoneId = callZoneAt(np);
    if (isMoveGated(fromZoneId, toZoneId)) {
      const now = performance.now();
      if (now - lastGatedToastRef.current > 1500) {
        lastGatedToastRef.current = now;
        toast("Porta fechada", { description: isCoarsePointer() ? "Toque na porta para abrir." : "Aperte X para abrir." });
      }
      if (IS_RTC_V2) rtcV2Ref.current?.reportMotion(cur.x, cur.y, 0, 0);
      return false;
    }
    posRef.current = np;
    const z = { id: toZoneId };
    const zoneChanged = fromZoneId !== toZoneId;
    const uid = meIdRef.current;
    if (uid) writeLocalSavedPosition(uid, np, z.id, dir);
    setZone((prev) => (prev !== z.id ? z.id : prev));
    // Commit a cada frame: o avatar local renderiza a partir de `pos`, então
    // throttlar setPos visualmente trava a caminhada. O custo extra de
    // re-render é aceitável — só roda enquanto há tecla pressionada.
    lastPosCommit.current = performance.now();
    setPos(np);
    if (IS_RTC_V2) {
      lastMotionAtRef.current = performance.now();
      rtcV2Ref.current?.reportMotion(np.x, np.y, (dx / step) * SPEED_PER_SEC, (dy / step) * SPEED_PER_SEC);
    }
    const now = performance.now();

    if (now - lastSent.current > SEND_INTERVAL_MS) {
      lastSent.current = now;
      sendPos(np.x, np.y, z.id, dir);
    }
    return true;
  }, [sendPos]);


  // Load me + all profiles + initial positions
  useEffect(() => {
    const requestLiveState = () => {
      const uid = meIdRef.current;
      const ch = positionBroadcastChannelRef.current;
      if (!uid || !ch || !positionBroadcastReadyRef.current) return;
      const requestId = `${clientInstanceIdRef.current}:${Date.now()}`;
      STATE_REQUEST_RETRIES_MS.forEach((delay) => {
        window.setTimeout(() => {
          const curUid = meIdRef.current;
          const curCh = positionBroadcastChannelRef.current;
          if (!curUid || !curCh || !positionBroadcastReadyRef.current) return;
          void curCh.send({
            type: "broadcast",
            event: "state-request",
            payload: { requester_id: curUid, request_id: requestId, ts: Date.now() },
          });
        }, delay);
      });
    };

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { try { onHydrated?.(); } catch { /* noop */ } return; }
      meIdRef.current = userData.user.id;
      setMyEmail(userData.user.email ?? "");

      // Workspace ativo deste OfficeScene. Tudo (positions, claims, notes,
      // realtime, broadcast) é escopado por ele — espaços são independentes
      // independentes e o usuário só pode estar online em um por vez.
      const wsId = getCurrentWorkspaceId();

      // Garante presença única: marca offline qualquer posição minha em
      // OUTROS workspaces antes de entrar neste.
      if (wsId) {
        void supabase
          .from("positions")
          .update({ is_online: false, updated_at: new Date().toISOString() })
          .eq("user_id", userData.user.id)
          .neq("workspace_id", wsId);
      }

      const { data: profs } = await supabase.from("profiles").select("id, display_name, avatar_color, sprite_id, tagline, status, onboarded_at, first_name, last_name, birth_date, city, state, country_code");
      const map: Record<string, Profile> = {};
      (profs ?? []).forEach((p) => (map[p.id] = p as Profile));
      setProfiles(map);
      setMe(map[userData.user.id] ?? null);

      let posQuery = supabase.from("positions").select("user_id, x, y, zone, facing, is_online, updated_at");
      if (wsId) posQuery = posQuery.eq("workspace_id", wsId);
      const { data: posData } = await posQuery;
      const pmap: Record<string, RemotePos> = {};
      (posData ?? []).forEach((p) => {
        pmap[p.user_id] = p as RemotePos;
        if (p.updated_at) dbFreshTs.current.set(p.user_id, Date.parse(p.updated_at));
      });

      // Load workspace claims (escopado pelo workspace atual)
      let claimQuery = supabase
        .from("workspace_claims")
        .select("zone_id, user_id");
      if (wsId) claimQuery = claimQuery.eq("workspace_id", wsId);
      const { data: claimData } = await claimQuery;
      const cmap: Record<string, string> = {};
      (claimData ?? []).forEach((c: { zone_id: string; user_id: string }) => {
        cmap[c.zone_id] = c.user_id;
      });
      setClaims(cmap);

      // Preserve the last known position on refresh — never snap an existing
      // user back to a spawn point. Only first-time entry uses spawn logic.
      const myClaimZone = Object.entries(cmap).find(([, uid]) => uid === userData.user!.id)?.[0];
      const localSaved = readLocalSavedPosition(userData.user.id);
      let startPoint: Point;
      const existing = pmap[userData.user.id];
      const hasSavedPos = existing && typeof existing.x === "number" && typeof existing.y === "number";
      const dbTs = timestampForPosition(existing ?? {});
      const dbLooksLikeSpawn = hasSavedPos && existing.x === SPAWN.x && existing.y === SPAWN.y;
      const localLooksLikeSpawn = !!localSaved && localSaved.x === SPAWN.x && localSaved.y === SPAWN.y;
      // ESTRITAMENTE o mais novo vence — não dá pra dar grace window pro
      // localStorage, porque se a última escrita local falhou silenciosamente
      // (cota cheia, modo anônimo, aba congelada), o valor antigo "ganharia"
      // do DB recente e o avatar voltaria pro penúltimo ponto. Em empate
      // perfeito o localStorage decide só pra estabilizar o tie-break.
      const localTs = localSaved?.ts ?? 0;
      const localWins =
        !!localSaved && (
          !hasSavedPos ||
          (dbLooksLikeSpawn && !localLooksLikeSpawn) ||
          localTs > dbTs
        );
      if (localWins) {
        // The browser copy is written on every movement/unload before the DB
        // roundtrip finishes, so on hard refresh it is the safest resume point.
        startPoint = { x: localSaved.x, y: localSaved.y };
      } else if (hasSavedPos) {
        // Current DB/presence position is authoritative for returning users.
        // Do not collision-correct it here: map overrides can still be loading,
        // and "fixing" it would clobber the live position with a spawn point.
        startPoint = { x: existing.x, y: existing.y };
      } else if (myClaimZone) {
        // First entry with a claim → spawn at the workstation seat.
        startPoint = walkablePointInZone(loadOverrides(), myClaimZone) ?? SPAWN;
      } else {
        // First time in: drop somewhere random in the corridors so people
        // don't all pile on top of each other at the default spawn.
        startPoint = randomCorridorPoint();
      }
      const safeStart = hasSavedPos || localWins ? startPoint : (collides(startPoint) ? SPAWN : startPoint);
      posRef.current = safeStart;
      setPos(safeStart);
      const startZone = callZoneAt(safeStart);
      setZone(startZone);
      const startFacing = (localWins ? localSaved?.facing : undefined) ?? (existing?.facing as Facing | undefined) ?? facingRef.current;
      facingRef.current = startFacing;
      setFacing(startFacing);
      positionHydratedRef.current = true;
      setPositionLoaded(true);
      writeLocalSavedPosition(userData.user.id, safeStart, startZone, startFacing);
      // Sinaliza pro preloader que a posição real já foi resolvida — só
      // depois disso o office aparece (sem flash de snap pro spawn).
      try { onHydrated?.(); } catch { /* noop */ }

      pmap[userData.user.id] = {
        user_id: userData.user.id,
        x: safeStart.x,
        y: safeStart.y,
        zone: startZone,
        facing: startFacing,
        is_online: true,
        ts: Date.now(),
      };
      setPositions(pmap);

      const _wsInit = getCurrentWorkspaceId();
      if (_wsInit) await supabase.from("positions").upsert({
        workspace_id: _wsInit,
        user_id: userData.user.id,
        x: safeStart.x,
        y: safeStart.y,
        zone: startZone,
        facing: startFacing,
        is_online: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,user_id" });
      requestLiveState();
    })();

    // IMPORTANT: garantir que o socket de realtime carregue o JWT do usuário
    // ANTES de assinar canais. As tabelas abaixo têm RLS exigindo o role
    // `authenticated`; se assinarmos enquanto o socket ainda está anônimo,
    // os eventos postgres_changes (UPDATE/INSERT/DELETE) são filtrados e os
    // outros usuários parecem "congelados", mesmo com as posições sendo
    // gravadas no banco corretamente.
    const realtimeChannelSuffix = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const _wsChan = getCurrentWorkspaceId();
    const wsSuffix = _wsChan ?? "none";
    const ch = supabase
      .channel(`positions-room:${wsSuffix}:${realtimeChannelSuffix}`)
      .on(
        "postgres_changes",
        _wsChan
          ? { event: "*", schema: "public", table: "positions", filter: `workspace_id=eq.${_wsChan}` }
          : { event: "*", schema: "public", table: "positions" },
        (payload) => {
          const row = (payload.new ?? payload.old) as RemotePos & { updated_at?: string };
          if (!row) return;
          const rowTs = timestampForPosition(row) || Date.now();
          if (row.is_online) maybeStartRemoteTeleportFromCurrent(row.user_id, { x: row.x, y: row.y }, rowTs);
          setPositions((prev) => {
            const next = { ...prev };
            if (payload.eventType === "DELETE") {
              delete next[row.user_id];
              return next;
            }
            const dbTs = row.updated_at ? Date.parse(row.updated_at) : 0;
            const lastDbTs = dbFreshTs.current.get(row.user_id) ?? 0;
            if (dbTs && dbTs < lastDbTs) return next;
            if (dbTs) dbFreshTs.current.set(row.user_id, dbTs);
            const liveTs = positionFreshTs.current.get(row.user_id) ?? 0;
            const cur = prev[row.user_id];
            const curLiveTs = cur?.ts ?? 0;
            // Offline→online (re)entry: trust the DB row completely. Any
            // cached x/y in `prev` is stale state from before the player
            // left, and preserving it would pin them at their previous spot
            // until presence catches up — causing the "teleport between
            // spawn and old position" oscillation peers see when someone
            // reconnects.
            const wasOffline = !cur || cur.is_online === false;
            if (wasOffline && row.is_online) {
              next[row.user_id] = row;
            } else if (liveTs > 0 && curLiveTs > 0 && curLiveTs >= liveTs) {
              // A fresher live sample already won; keep its position and
              // refresh only the non-positional fields from this DB row.
              next[row.user_id] = { ...row, x: cur.x, y: cur.y, facing: cur.facing, ts: cur.ts };
            } else {
              next[row.user_id] = row;
            }
            return next;
          });
        }
      );


    const reactionCh = supabase
      .channel(`reactions-room:${wsSuffix}`)
      .on("broadcast", { event: "reaction" }, (payload) => {
        const { user_id, emoji } = (payload.payload ?? {}) as { user_id?: string; emoji?: string };
        if (!user_id || !emoji) return;
        const ts = Date.now();
        setReactions((prev) => ({ ...prev, [user_id]: { emoji, ts } }));
        setTimeout(() => {
          setReactions((prev) => {
            const cur = prev[user_id];
            if (!cur || cur.ts !== ts) return prev;
            const next = { ...prev };
            delete next[user_id];
            return next;
          });
        }, REACTION_DURATION_MS);
      })
      .on("broadcast", { event: "confetti" }, (payload) => {
        const { user_id, facing: dir, x, y } = (payload.payload ?? {}) as { user_id?: string; facing?: Facing; x?: number; y?: number };
        if (!user_id || !dir || typeof x !== "number" || typeof y !== "number") return;
        const ts = Date.now();
        const id = `${user_id}-${ts}-${Math.random().toString(36).slice(2, 7)}`;
        setConfettis((prev) => [...prev, { id, x, y, facing: dir, ts }]);
        setTimeout(() => {
          setConfettis((prev) => prev.filter((c) => c.id !== id));
        }, 1100);
      });
    reactionChannelRef.current = reactionCh;

    const positionBroadcastCh = supabase
      .channel(`${POSITION_BROADCAST_CHANNEL}:${wsSuffix}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "position" }, (payload) => {
        const row = payload.payload as RemotePos;
        if (!row?.user_id) return;
        const incomingTs = timestampForPosition(row) || Date.now();
        maybeStartRemoteTeleportFromCurrent(row.user_id, { x: row.x, y: row.y }, incomingTs);
        setPositions((prev) => {
          const curTs = timestampForPosition(prev[row.user_id] ?? {}) || (positionFreshTs.current.get(row.user_id) ?? 0);
          if (incomingTs < curTs) return prev;
          positionFreshTs.current.set(row.user_id, incomingTs);
          return { ...prev, [row.user_id]: { ...row, ts: incomingTs } };
        });
      })
      .on("broadcast", { event: "state-request" }, (payload) => {
        const { requester_id, request_id } = (payload.payload ?? {}) as { requester_id?: string; request_id?: string };
        const uid = meIdRef.current;
        if (!uid || !requester_id || requester_id === uid || !positionHydratedRef.current) return;
        const cur = posRef.current;
        const curZone = callZoneAt(cur);
        const ts = Date.now();
        void positionBroadcastCh.send({
          type: "broadcast",
          event: "state-response",
          payload: {
            request_id,
            requester_id,
            user_id: uid,
            x: cur.x,
            y: cur.y,
            zone: curZone,
            facing: facingRef.current,
            is_online: true,
            ts,
            client_id: clientInstanceIdRef.current,
          },
        });
      })
      .on("broadcast", { event: "state-response" }, (payload) => {
        const row = payload.payload as RemotePos & { requester_id?: string; client_id?: string };
        const uid = meIdRef.current;
        if (!uid || row?.requester_id !== uid || !row.user_id || row.client_id === clientInstanceIdRef.current) return;
        const incomingTs = timestampForPosition(row) || Date.now();
        maybeStartRemoteTeleportFromCurrent(row.user_id, { x: row.x, y: row.y }, incomingTs);
        setPositions((prev) => {
          const curTs = timestampForPosition(prev[row.user_id] ?? {}) || (positionFreshTs.current.get(row.user_id) ?? 0);
          if (incomingTs < curTs) return prev;
          positionFreshTs.current.set(row.user_id, incomingTs);
          return { ...prev, [row.user_id]: { ...row, is_online: true, ts: incomingTs } };
        });
      })
      .on("broadcast", { event: "teleport" }, (payload) => {
        const { user_id, from, to } = (payload.payload ?? {}) as {
          user_id?: string;
          from?: Point;
          to?: Point;
        };
        if (!user_id || !from || !to) return;
        startRemoteTeleport(user_id, from, to);
        // Crava o destino em positions[user_id] já no aviso de teleport — sem
        // isso, se o broadcast de "position" pós-snap se perder/atrasar, o
        // avatar volta a renderizar no ponto antigo quando o efeito termina
        // (e pode ficar fora do enquadramento, parecendo que "sumiu" até
        // o próximo poll do DB rodar).
        const ts = Date.now();
        positionFreshTs.current.set(user_id, ts);
        setPositions((prev) => {
          const cur = prev[user_id];
          return {
            ...prev,
            [user_id]: {
              user_id,
              x: to.x,
              y: to.y,
              zone: callZoneAt(to),
              facing: cur?.facing ?? "down",
              is_online: true,
              ts,
            },
          };
        });
      });
    positionBroadcastChannelRef.current = positionBroadcastCh;

    // Presence is only an online heartbeat. It must not be allowed to move an
    // existing avatar, because an old/hidden tab can keep heartbeating SPAWN
    // and pull a stopped colleague back to the origin.
    type PresenceState = { user_id: string; x: number; y: number; zone: string; facing?: Facing; ts: number };
    const presenceCh = supabase.channel(`${POSITION_PRESENCE_CHANNEL}:${wsSuffix}`, {
      config: { presence: { key: meIdRef.current ?? `anon:${realtimeChannelSuffix}` } },
    });
    const presenceLastTs = new Map<string, number>();
    const mergePresence = (raw: unknown) => {
      const arr = raw as PresenceState[] | undefined;
      if (!Array.isArray(arr)) return;
      for (const s of arr) {
        if (!s?.user_id || s.user_id === meIdRef.current) continue;
        const prev = presenceLastTs.get(s.user_id) ?? 0;
        if (s.ts <= prev) continue;
        presenceLastTs.set(s.user_id, s.ts);
        maybeStartRemoteTeleportFromCurrent(s.user_id, { x: s.x, y: s.y }, s.ts);
        setPositions((p) => {
          const cur = p[s.user_id];
          // Presence heartbeat is hydration-guarded (never advertises SPAWN),
          // so its x/y always reflects the peer's real current position.
          // Accept it so an F5'd tab learns "where they are right now" within
          // 1s (the heartbeat cadence) instead of waiting for a DB write.
          positionFreshTs.current.set(s.user_id, s.ts);
          return {
            ...p,
            [s.user_id]: {
              user_id: s.user_id,
              x: s.x,
              y: s.y,
              zone: s.zone,
              facing: s.facing ?? cur?.facing ?? "down",
              is_online: true,
              ts: s.ts,
            },
          };
        });
      }
    };
    // Presence is only a fast discovery/position channel. It must never decide
    // that a player is offline by itself; durable online/offline state is the
    // `positions.is_online` row, updated on entry and on real workspace exit.
    const syncPresentIds = () => {
      const state = presenceCh.presenceState() as Record<string, PresenceState[]>;
      const ids = new Set<string>();
      for (const list of Object.values(state)) {
        for (const s of list) if (s?.user_id) ids.add(s.user_id);
      }
      setPresentPeerIds((prev) => {
        if (prev.size === ids.size) {
          let same = true;
          for (const id of ids) if (!prev.has(id)) { same = false; break; }
          if (same) return prev;
        }
        return ids;
      });
    };
    presenceCh.on("presence", { event: "sync" }, () => {
      const state = presenceCh.presenceState() as Record<string, PresenceState[]>;
      for (const list of Object.values(state)) mergePresence(list);
      syncPresentIds();
    });
    presenceCh.on("presence", { event: "join" }, ({ newPresences }) => {
      mergePresence(newPresences);
      syncPresentIds();
    });
    presenceCh.on("presence", { event: "leave" }, () => {
      syncPresentIds();
    });

    const applyClaimChange = (payload: any) => {
      const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as
        { zone_id?: string; user_id?: string; workspace_id?: string } | null;
      if (!row?.zone_id) return;
      // DELETE não aceita filtro no realtime: descarta eventos de outros espaços.
      if (_wsChan && row.workspace_id && row.workspace_id !== _wsChan) return;
      setClaims((prev) => {
        const next = { ...prev };
        if (payload.eventType === "DELETE") delete next[row.zone_id!];
        else if (row.user_id) next[row.zone_id!] = row.user_id;
        return next;
      });
    };
    const claimsCh = supabase
      .channel(`claims-room:${wsSuffix}:${realtimeChannelSuffix}`)
      .on(
        "postgres_changes",
        _wsChan
          ? { event: "INSERT", schema: "public", table: "workspace_claims", filter: `workspace_id=eq.${_wsChan}` }
          : { event: "INSERT", schema: "public", table: "workspace_claims" },
        applyClaimChange,
      )
      .on(
        "postgres_changes",
        _wsChan
          ? { event: "UPDATE", schema: "public", table: "workspace_claims", filter: `workspace_id=eq.${_wsChan}` }
          : { event: "UPDATE", schema: "public", table: "workspace_claims" },
        applyClaimChange,
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "workspace_claims" },
        applyClaimChange,
      );

    void (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (token) {
        try { await supabase.realtime.setAuth(token); } catch { /* noop */ }
      }
      if (!IS_RTC_V2) ch.subscribe();
      reactionCh.subscribe();
      if (!IS_RTC_V2) positionBroadcastCh.subscribe((status) => {
        positionBroadcastReadyRef.current = status === "SUBSCRIBED";
        if (status === "SUBSCRIBED") requestLiveState();
      });
      claimsCh.subscribe();
      // v2: Presence legado (com posição + heartbeat) não roda; usa Presence V2.
      if (!IS_RTC_V2) presenceCh.subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        const uid = meIdRef.current;
        if (!uid || !positionHydratedRef.current) return;
        const cur = posRef.current;
        try {
          await presenceCh.track({
            user_id: uid, x: cur.x, y: cur.y,
            zone: callZoneAt(cur), facing: facingRef.current, ts: Date.now(),
          });
        } catch { /* noop */ }
      });
    })();

    // Heartbeat presence every second so peers detect each other within 1s of
    // joining and the "frozen avatar" symptom can't happen even if both
    // postgres_changes and broadcasts get dropped on flaky networks.
    const presenceHeartbeat = IS_RTC_V2 ? 0 : window.setInterval(() => {
      const uid = meIdRef.current;
      if (!uid || !positionHydratedRef.current) return;
      const cur = posRef.current;
      void presenceCh.track({
        user_id: uid, x: cur.x, y: cur.y,
        zone: callZoneAt(cur), facing: facingRef.current, ts: Date.now(),
      }).catch(() => { /* noop */ });
    }, 1000);

    // Reconnection + resync watchdog: when the tab regains focus (or the
    // browser wakes from sleep), force a position sync, re-track presence
    // and re-broadcast our position. Supabase Realtime auto-reconnects the
    // socket, but channels can miss events while the page was hidden — this
    // closes the gap so the other avatars don't appear "frozen".
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (IS_RTC_V2) return;
      const uid = meIdRef.current;
      if (!uid || !positionHydratedRef.current) return;
      const cur = posRef.current;
      const curZone = callZoneAt(cur);
      // 1) Re-attach the latest JWT to the realtime socket
      void supabase.auth.getSession().then(({ data }) => {
        const token = data.session?.access_token;
        if (token) { try { void supabase.realtime.setAuth(token); } catch { /* noop */ } }
      });
      // 2) Force a full positions reload from DB
      void syncPositions();
      // 3) Refresh presence heartbeat immediately
      void presenceCh.track({
        user_id: uid, x: cur.x, y: cur.y, zone: curZone,
        facing: facingRef.current, ts: Date.now(),
      }).catch(() => { /* noop */ });
      // 4) Re-broadcast our position so peers update without waiting 1s
      const pbCh = positionBroadcastChannelRef.current;
      if (pbCh && positionBroadcastReadyRef.current) {
        void pbCh.send({
          type: "broadcast", event: "position",
          payload: { user_id: uid, x: cur.x, y: cur.y, zone: curZone, facing: facingRef.current, is_online: true, ts: Date.now() },
        });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    // Fechar a aba/janela = sair do mundo. Marca offline E reseta a posição
    // pro ponto de ressurgimento, para que ao retornar o avatar apareça no
    // início (não no último ponto onde parou). Mesmo comportamento da
    // navegação saindo do workspace.
    const onPageHide = () => { leaveWorkspaceReset(); };
    const onBeforeUnload = () => { leaveWorkspaceReset(); };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);

    // Saída do workspace via navegação (route unmount): trata como "sair do
    // mundo do jogo". O personagem vai offline E volta ao ponto de
    // ressurgimento (seat da claim, spawn da zona ou SPAWN padrão), para que
    // ao retornar apareça no início — não no último lugar onde parou.
    const leaveWorkspaceReset = () => {
      const uid = meIdRef.current;
      const wsId = getCurrentWorkspaceId();
      if (!uid || !wsId) return;
      const myClaimZone = Object.entries(claimsRef.current).find(([, u]) => u === uid)?.[0];
      let spawn: Point = SPAWN;
      if (myClaimZone) {
        spawn = walkablePointInZone(loadOverrides(), myClaimZone) ?? nearestWalkablePoint(loadOverrides(), SPAWN) ?? SPAWN;
      }
      const spawnZone = callZoneAt(spawn);
      try { window.localStorage.removeItem(`${LAST_POSITION_KEY_PREFIX}${uid}`); } catch { /* noop */ }
      const payload = {
        workspace_id: wsId,
        user_id: uid,
        x: spawn.x,
        y: spawn.y,
        zone: spawnZone,
        facing: "down" as Facing,
        is_online: false,
        updated_at: new Date().toISOString(),
      };
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/positions?on_conflict=workspace_id,user_id`;
        const token = accessTokenRef.current;
        const headers = {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          Prefer: "resolution=merge-duplicates",
        };
        void fetch(url, { method: "POST", headers, body: JSON.stringify(payload), keepalive: true }).catch(() => { /* noop */ });
      } catch { /* noop */ }
      void supabase.from("positions").upsert(payload, { onConflict: "workspace_id,user_id" });
    };


    const syncPositions = async () => {
      let q = supabase.from("positions").select("user_id, x, y, zone, facing, is_online, updated_at");
      if (_wsChan) q = q.eq("workspace_id", _wsChan);
      const { data } = await q;
      if (!data) return;
      const uid = meIdRef.current;
      setPositions((prev) => {
        const next: Record<string, RemotePos> = { ...prev };
        (data as Array<RemotePos & { updated_at?: string }>).forEach((p) => {
          if (uid && p.user_id === uid) return; // handled below
          const dbTs = p.updated_at ? Date.parse(p.updated_at) : 0;
          const lastDbTs = dbFreshTs.current.get(p.user_id) ?? 0;
          if (p.is_online) maybeStartRemoteTeleportFromCurrent(p.user_id, { x: p.x, y: p.y }, dbTs || Date.now());
          // DB-clock vs DB-clock only; live samples (peer client clock) are
          // tracked separately to avoid cross-clock skew freezing avatars.
          if (dbTs && dbTs < lastDbTs) {
            const cur = prev[p.user_id];
            if (cur) next[p.user_id] = cur;
            else next[p.user_id] = p;
          } else {
            if (dbTs) dbFreshTs.current.set(p.user_id, dbTs);
            const liveTs = positionFreshTs.current.get(p.user_id) ?? 0;
            const cur = prev[p.user_id];
            const curLiveTs = cur?.ts ?? 0;
            const wasOffline = !cur || cur.is_online === false;
            // Offline→online re-entry: trust the DB row. See postgres_changes
            // handler above for why preserving cached x/y here causes the
            // "teleport between spawn and old position" oscillation.
            if (wasOffline && p.is_online) {
              next[p.user_id] = p;
            } else if (liveTs > 0 && curLiveTs > 0 && curLiveTs >= liveTs) {
              next[p.user_id] = { ...p, x: cur.x, y: cur.y, facing: cur.facing, ts: cur.ts };
            } else {
              next[p.user_id] = p;
            }
          }
        });
        if (uid) {
          const cur = posRef.current;
          const curZone = callZoneAt(cur);
          next[uid] = {
            ...(next[uid] ?? { user_id: uid, x: cur.x, y: cur.y, zone: curZone, is_online: true }),
            x: cur.x,
            y: cur.y,
            zone: curZone,
            facing: facingRef.current,
            is_online: true,
          };
        }
        return next;
      });
    };
    const positionsPoll = IS_RTC_V2 ? 0 : window.setInterval(() => {
      void syncPositions();
    }, 1000);

    // Idle DB heartbeat — persist the local position every 2s even when
    // standing still, so other clients' DB poll never reads a stale row and
    // can't snap our avatar back to a previous spot.
    const persistHeartbeat = IS_RTC_V2 ? 0 : window.setInterval(() => {
      const uid = meIdRef.current;
      if (!uid || !positionHydratedRef.current) return;
      const cur = posRef.current;
      // Don't persist while we're still on the default SPAWN sentinel —
      // the init effect hasn't hydrated the saved position yet, and writing
      // SPAWN here would clobber the real DB row and snap us back for peers.
      if (cur.x === SPAWN.x && cur.y === SPAWN.y) return;
      const curZone = callZoneAt(cur);
      writeLocalSavedPosition(uid, cur, curZone, facingRef.current);
      const _wsHb = getCurrentWorkspaceId();
      if (_wsHb) void supabase.from("positions").upsert({
        workspace_id: _wsHb,
        user_id: uid,
        x: cur.x,
        y: cur.y,
        zone: curZone,
        facing: facingRef.current,
        is_online: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,user_id" });
    }, 750);


    // Load + subscribe to desk notes (post-it gifts left on workstations)
    void (async () => {
      let nq = supabase
        .from("desk_notes")
        .select("id, zone_id, sender_id, recipient_id, body, x, y, created_at, read_at")
        .is("read_at", null);
      if (_wsChan) nq = nq.eq("workspace_id", _wsChan);
      const { data } = await nq;
      if (data) setNotes(data as DeskNote[]);
    })();
    const notesCh = supabase
      .channel(`desk-notes-room:${wsSuffix}:${realtimeChannelSuffix}`)
      .on(
        "postgres_changes",
        _wsChan
          ? { event: "*", schema: "public", table: "desk_notes", filter: `workspace_id=eq.${_wsChan}` }
          : { event: "*", schema: "public", table: "desk_notes" },
        (payload) => {
          setNotes((prev) => {
            if (payload.eventType === "DELETE") {
              const old = payload.old as { id: string };
              return prev.filter((n) => n.id !== old.id);
            }
            const row = payload.new as DeskNote;
            if (row.read_at) return prev.filter((n) => n.id !== row.id);
            const without = prev.filter((n) => n.id !== row.id);
            return [...without, row];
          });
        }
      );
    // Realtime de profiles: quando alguém troca skin/nome/cor/status,
    // todos os outros recebem a atualização sem precisar recarregar.
    const profilesCh = supabase
      .channel(`profiles-room:${wsSuffix}:${realtimeChannelSuffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string };
            if (!old?.id) return;
            setProfiles((prev) => {
              const next = { ...prev };
              delete next[old.id!];
              return next;
            });
            return;
          }
          const row = payload.new as Profile;
          if (!row?.id) return;
          setProfiles((prev) => ({ ...prev, [row.id]: { ...(prev[row.id] ?? {}), ...row } }));
          if (row.id === meIdRef.current) {
            setMe((prev) => ({ ...(prev ?? {} as Profile), ...row }));
          }
        }
      );
    // assina depois que o JWT estiver hidratado no socket de realtime
    void (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (token) {
        try { await supabase.realtime.setAuth(token); } catch { /* noop */ }
      }
      notesCh.subscribe();
      profilesCh.subscribe();
    })();


    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(reactionCh);
      supabase.removeChannel(positionBroadcastCh);
      supabase.removeChannel(claimsCh);
      supabase.removeChannel(presenceCh);
      supabase.removeChannel(notesCh);
      supabase.removeChannel(profilesCh);

      reactionChannelRef.current = null;
      positionBroadcastChannelRef.current = null;
      positionBroadcastReadyRef.current = false;
      window.clearInterval(positionsPoll);
      window.clearInterval(presenceHeartbeat);
      window.clearInterval(persistHeartbeat);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      // Em qualquer caso (fechar aba ou navegar pra fora) o personagem
      // sai do mundo e volta ao ponto de ressurgimento.
      leaveWorkspaceReset();
    };
  }, []);

  // Atalho: pressionar X dentro de uma zona que tenha um recadinho para mim,
  // abre o recadinho (mesmo comportamento da overlay flutuante).
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const zoneRef = useRef(zone);
  zoneRef.current = zone;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() !== "x") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const uid = meIdRef.current;
      if (!uid) return;
      const curZone = zoneRef.current;
      const candidate = notesRef.current.find(
        (n) => n.recipient_id === uid && n.zone_id === curZone
      );
      if (!candidate) return;
      e.preventDefault();
      setOpeningNote(candidate);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // -------- Levantar a mão (broadcast realtime) --------
  const toggleRaiseHand = useCallback(() => {
    const uid = meIdRef.current;
    if (!uid) return;
    setRaisedHands((prev) => {
      const next = { ...prev };
      const newVal = !prev[uid];
      if (newVal) next[uid] = true;
      else delete next[uid];
      const ch = handChannelRef.current;
      if (ch && handChannelReadyRef.current) {
        void ch.send({ type: "broadcast", event: "hand", payload: { user_id: uid, raised: newVal } });
      }
      if (newVal) toast.success("✋ Você levantou a mão", { duration: 1800 });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!me?.id) return;
    const ch = supabase
      .channel("meet-hands-v1", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "hand" }, (payload) => {
        const { user_id, raised } = (payload.payload ?? {}) as { user_id?: string; raised?: boolean };
        if (!user_id) return;
        setRaisedHands((prev) => {
          const next = { ...prev };
          if (raised) next[user_id] = true;
          else delete next[user_id];
          return next;
        });
        if (raised) {
          const name = profiles[user_id]?.display_name ?? "Alguém";
          toast(`✋ ${name} levantou a mão`, { duration: 2500 });
        }
      });
    handChannelRef.current = ch;
    void ch.subscribe((status) => {
      handChannelReadyRef.current = status === "SUBSCRIBED";
    });
    return () => {
      handChannelReadyRef.current = false;
      supabase.removeChannel(ch);
      handChannelRef.current = null;
    };
    // intentionally not depending on profiles (only need name at toast time, read via closure of latest)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // -------- Toasts entrada/saída da chamada --------
  const prevConnectedRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevConnectedRef.current;
    const cur = audibleConnectedPeers;
    const entered = cur.filter((p) => !prev.includes(p));
    const left = prev.filter((p) => !cur.includes(p));
    for (const id of entered) {
      const name = profiles[id]?.display_name ?? "Alguém";
      toast(`🎧 ${name} entrou na chamada`, { duration: 2200 });
    }
    for (const id of left) {
      const name = profiles[id]?.display_name ?? "Alguém";
      toast(`👋 ${name} saiu da chamada`, { duration: 2200 });
      // Limpa mão levantada caso saia da chamada
      setRaisedHands((p) => {
        if (!p[id]) return p;
        const next = { ...p };
        delete next[id];
        return next;
      });
    }
    prevConnectedRef.current = cur;
  }, [audibleConnectedPeers, profiles]);

  // -------- HUD de atalhos da reunião --------
  // Mostra o HUD por alguns segundos quando o usuário entra numa call ou usa
  // um atalho. Some sozinho para não poluir a UI.
  const [shortcutsHudVisible, setShortcutsHudVisible] = useState(false);
  const shortcutsHudTimerRef = useRef<number | null>(null);
  const pingShortcutsHud = useCallback((ms = 3500) => {
    setShortcutsHudVisible(true);
    if (shortcutsHudTimerRef.current) window.clearTimeout(shortcutsHudTimerRef.current);
    shortcutsHudTimerRef.current = window.setTimeout(() => {
      setShortcutsHudVisible(false);
      shortcutsHudTimerRef.current = null;
    }, ms);
  }, []);
  // Mostra o HUD ao entrar numa chamada
  const inCallRef = useRef(false);
  useEffect(() => {
    const inCall = audibleConnectedPeers.length > 0;
    if (inCall && !inCallRef.current) {
      pingShortcutsHud(6000);
    }
    inCallRef.current = inCall;
  }, [audibleConnectedPeers.length, pingShortcutsHud]);
  useEffect(() => () => {
    if (shortcutsHudTimerRef.current) window.clearTimeout(shortcutsHudTimerRef.current);
  }, []);

  // -------- Atalhos estilo Meet --------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      // Alt + M = mic
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        void unlockAudioPlayback();
        const willBeOn = !rtc.micOn;
        rtc.toggleMic()
          .then(() => {
            pingShortcutsHud(2500);
            toast(willBeOn ? "🎤 Microfone ligado" : "🔇 Microfone desligado", { duration: 1400 });
          })
          .catch(() => toast.error("Não foi possível acessar o microfone"));
        return;
      }
      // Alt + V = cam
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        void unlockAudioPlayback();
        const willBeOn = !rtc.camOn;
        rtc.toggleCam()
          .then(() => {
            pingShortcutsHud(2500);
            toast(willBeOn ? "📷 Câmera ligada" : "📷 Câmera desligada", { duration: 1400 });
          })
          .catch(() => toast.error("Não foi possível acessar a câmera"));
        return;
      }
      // Alt + H = levantar a mão
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        toggleRaiseHand();
        pingShortcutsHud(2500);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rtc, toggleRaiseHand, pingShortcutsHud]);


  const claimZone = useCallback(async (zoneId: string) => {
    const uid = meIdRef.current;
    if (!uid) return;
    if (!workspaceZonesForMap(loadOverrides()).some((zone) => zone.id === zoneId)) return;
    const _wsClaim = getCurrentWorkspaceId();
    if (!_wsClaim) { toast.error("Workspace inválido."); return; }
    // Libera só a mesa anterior deste espaço (uma mesa por espaço).
    await supabase.from("workspace_claims").delete().eq("user_id", uid).eq("workspace_id", _wsClaim);
    const { error } = await supabase
      .from("workspace_claims")
      .insert({ workspace_id: _wsClaim, zone_id: zoneId, user_id: uid });
    if (error) {
      toast.error("Não foi possível reivindicar esse espaço.");
      return;
    }
    const label = findZoneById(zoneId)?.label ?? zoneId;
    toast.success(`Você reivindicou ${label}. Esta é a sua posição oficial.`);
    setClaims((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) if (v !== uid) next[k] = v;
      next[zoneId] = uid;
      return next;
    });
  }, []);

  const releaseClaim = useCallback(async () => {
    const uid = meIdRef.current;
    if (!uid) return;
    const _wsRel = getCurrentWorkspaceId();
    let relQ = supabase.from("workspace_claims").delete().eq("user_id", uid);
    if (_wsRel) relQ = relQ.eq("workspace_id", _wsRel);
    const { error } = await relQ;
    if (error) {
      toast.error("Não foi possível deixar a mesa.");
      return;
    }
    toast.success("Você deixou sua mesa. Escolha um novo espaço quando quiser.");
    setClaims((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) if (v !== uid) next[k] = v;
      return next;
    });
  }, []);

  // Live ref to claims so the keyboard handler can read latest values.
  const claimsRef = useRef<Record<string, string>>({});
  useEffect(() => { claimsRef.current = claims; }, [claims]);

  // Auto-walk target: when set, the avatar walks toward this point each tick.
  const autoWalkRef = useRef<{ x: number; y: number } | null>(null);

  // ===== Touch (coarse pointer) controls — never reached by mouse/keyboard =====
  // Rota do double tap: waypoints consumidos pelo mesmo loop de auto-walk.
  const mobileViewport = useMobileViewport();
  const coarsePointer = mobileViewport.coarse;
  const [zoneSheetId, setZoneSheetId] = useState<string | null>(null);
  // Tap (touch) handler lives in a ref so the gesture controller (created once) sees fresh state.
  const touchTapRef = useRef<(p: Point | null) => void>(() => {});
  const routeRef = useRef<Point[]>([]);
  const routeGoalRef = useRef<Point | null>(null);
  const touchPointersRef = useRef<Set<number>>(new Set());
  const [tapMarker, setTapMarker] = useState<{ x: number; y: number; ok: boolean; id: number } | null>(null);
  const markerTimerRef = useRef<number | null>(null);
  const showTapMarker = useCallback((p: Point, ok: boolean) => {
    if (markerTimerRef.current) window.clearTimeout(markerTimerRef.current);
    setTapMarker({ x: p.x, y: p.y, ok, id: Date.now() });
    markerTimerRef.current = window.setTimeout(() => setTapMarker(null), 700);
  }, []);
  useEffect(() => () => { if (markerTimerRef.current) window.clearTimeout(markerTimerRef.current); }, []);
  const stopTouchRoute = useCallback(() => {
    if (!routeGoalRef.current && routeRef.current.length === 0) return;
    routeRef.current = [];
    routeGoalRef.current = null;
    autoWalkRef.current = null;
  }, []);
  const planTouchRoute = useCallback((target: Point) => {
    const res = findTouchRoute(loadOverrides(), posRef.current, target, {
      isGated: (a, b) => isMoveGated(callZoneAt(a), callZoneAt(b)),
    });
    if (!res) return false;
    routeRef.current = res.waypoints.slice();
    routeGoalRef.current = res.goal;
    autoWalkRef.current = null; // nova rota cancela a anterior
    return true;
  }, []);
  const stageLocal = (e: { clientX: number; clientY: number }) => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };
  const gesturesRef = useRef<ReturnType<typeof createTouchGestures> | null>(null);
  if (!gesturesRef.current) {
    gesturesRef.current = createTouchGestures({
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      getCamera: () => ({ zoom: zoomRef.current, pan: { ...panRef.current } }),
      setCamera: (cam) => {
        zoomRef.current = cam.zoom;
        setZoom((z) => (z === cam.zoom ? z : cam.zoom));
        setPan(clampPan(cam.zoom, cam.pan));
      },
      onManualCamera: () => {
        if (tweenRafRef.current != null) { cancelAnimationFrame(tweenRafRef.current); tweenRafRef.current = null; }
        setFollowMe(false);
      },
      // toque simples: só fecha o painel aberto; tocar e segurar abre o painel da mesa/área.
      onTap: () => touchTapRef.current(null),
      onLongPress: (p) => touchTapRef.current(p),
      onDoubleTap: (p) => {
        setZoneSheetId(null);
        if (isMovementInputBlocked(panelRef.current)) return;
        const stage = stageRef.current;
        if (!stage) return;
        const m = screenToMap(p, { zoom: zoomRef.current, pan: panRef.current }, { w: stage.clientWidth, h: stage.clientHeight });
        if (followingUidRef.current) stopFollowing(true);
        const ok = planTouchRoute(m);
        showTapMarker(ok ? (routeGoalRef.current ?? m) : m, ok);
        if (ok && !followRef.current) setFollowMe(true);
      },
    });
  }
  const gestures = gesturesRef.current;
  // Background/offline: pausa a rota; voltar exige novo comando (não repete toques antigos).
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") { stopTouchRoute(); gesturesRef.current?.reset(); touchPointersRef.current.clear(); } };
    const onOffline = () => stopTouchRoute();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("offline", onOffline);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("offline", onOffline); };
  }, [stopTouchRoute]);
  // Mapa mudou durante o percurso: recalcula até o mesmo destino (ou para).
  useEffect(() => {
    const onMap = () => {
      const goal = routeGoalRef.current;
      if (!goal) return;
      if (!planTouchRoute(goal)) stopTouchRoute();
    };
    window.addEventListener("map-overrides-changed", onMap);
    return () => window.removeEventListener("map-overrides-changed", onMap);
  }, [planTouchRoute, stopTouchRoute]);

  // Magic teleport effect: avatar fades out at current spot, then fades in at seat.
  const [teleport, setTeleport] = useState<
    | { from: Point; to: Point; phase: "out" | "in"; id: number }
    | null
  >(null);
  const teleportTimers = useRef<number[]>([]);

  useEffect(() => {
    const decision = positionRecoveryDecision(getMapSync().snapshot(), posRef.current, positionLoaded, canonicalMapReady);
    if (decision.kind !== "recovered") return;
    autoWalkRef.current = null;
    teleportTimers.current.forEach((timer) => window.clearTimeout(timer));
    teleportTimers.current = [];
    setTeleport(null);
    const point = decision.point;
    posRef.current = point;
    setPos(point);
    setZone(callZoneAt(point));
    lastMotionAtRef.current = 0;
    sendPos(point.x, point.y, callZoneAt(point), facingRef.current, true);
  }, [mapVersion, canonicalMapReady, positionLoaded, sendPos]);

  const teleportToZone = useCallback((zoneId: ZoneId, label?: string, useSpawnPoint = false) => {
    if (!tierCapsRef.current.canTeleport) {
      toast.info("Teleporte está disponível a partir do Nível 2.");
      return;
    }
    const z = findZoneById(zoneId);
    if (!z) return;
    // If already inside the target zone, do nothing.
    const currentZone = callZoneAt(posRef.current);
    if (currentZone === zoneId) {
      toast.info(`Você já está em ${label ?? z.label}.`);
      return;
    }
    const rect = zoneRectFromOverrides(zoneId) ?? z.rect;
    let target: Point | null;
    if (useSpawnPoint) {
      // Own workspace: land at the determined spawn point (or fixed seat).
      target = walkablePointInZone(loadOverrides(), zoneId);
    } else {
      // Shared rooms: random walkable point so people don't stack.
      const occupied: Point[] = Object.entries(positionsRef.current)
        .filter(([uid, p]) => uid !== meIdRef.current && p && p.zone === zoneId)
        .map(([, p]) => ({ x: p.x, y: p.y }));
      target = randomPointInRect(rect, occupied, 0.05, zoneId);
    }
    if (!target) { toast.error("Não há ponto caminhável nesta área."); return; }
    const from = { ...posRef.current };


    // Cancel any pending auto-walk and clear stale timers
    autoWalkRef.current = null;
    teleportTimers.current.forEach((t) => window.clearTimeout(t));
    teleportTimers.current = [];

    const id = Date.now();
    setTeleport({ from, to: target, phase: "out", id });

    // Tell peers immediately so they see the sparkle/fade at the origin,
    // BEFORE the position snaps. Without this, remote viewers only see the
    // avatar slide between points.
    const uid = meIdRef.current;
    const ch = positionBroadcastChannelRef.current;
    if (uid && ch && positionBroadcastReadyRef.current) {
      void ch.send({
        type: "broadcast",
        event: "teleport",
        payload: { user_id: uid, from, to: target },
      });
    }

    // Phase 1: fade out + sparkle at origin
    teleportTimers.current.push(
      window.setTimeout(() => {
        // Revalidate against a map that may have changed during the animation.
        if (collides(target) || !pointInMapZone(loadOverrides(), zoneId, target)) { setTeleport(null); toast.error("O destino deixou de pertencer a uma área caminhável."); return; }
        posRef.current = target;
        setPos(target);
        const z2 = callZoneAt(target);
        setZone(z2);
        sendPos(target.x, target.y, z2, facingRef.current, true);
        setTeleport({ from, to: target, phase: "in", id });
      }, 450)
    );
    // Phase 2: clear effect
    teleportTimers.current.push(
      window.setTimeout(() => {
        setTeleport((cur) => (cur && cur.id === id ? null : cur));
      }, 1100)
    );

    toast.success(`✨ Teleportando para ${label ?? z.label}...`);
  }, [sendPos]);

  const teleportToMyClaim = useCallback(() => {
    const uid = meIdRef.current;
    if (!uid) return;
    const myZone = Object.entries(claimsRef.current).find(([, u]) => u === uid)?.[0];
    if (!myZone) {
      toast.info("Você ainda não reivindicou nenhum espaço.");
      return;
    }
    teleportToZone(myZone as ZoneId, undefined, true);
  }, [teleportToZone]);

  useEffect(() => {
    return () => {
      teleportTimers.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  // ===== Follow / Lead (Seguir / Pedir para conduzir) =====
  // followingUid: when set, my avatar auto-walks behind this user until I press
  // a movement key (or the other side cancels).
  const [followingUid, setFollowingUid] = useState<string | null>(null);
  const followingUidRef = useRef<string | null>(null);
  useEffect(() => { followingUidRef.current = followingUid; }, [followingUid]);
  const profilesRef = useRef<Record<string, Profile>>({});
  profilesRef.current = profiles;
  const leadChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [hoveredAvatarUid, setHoveredAvatarUid] = useState<string | null>(null);
  const [avatarMenuUid, setAvatarMenuUid] = useState<string | null>(null);

  const broadcastFollowStop = useCallback((toUid: string) => {
    const ch = leadChannelRef.current;
    const from = meIdRef.current;
    if (!ch || !from || !toUid) return;
    void ch.send({ type: "broadcast", event: "follow-stop", payload: { from, to: toUid } });
  }, []);

  const stopFollowing = useCallback((notify = true) => {
    const cur = followingUidRef.current;
    if (!cur) return;
    if (notify) broadcastFollowStop(cur);
    followingUidRef.current = null;
    setFollowingUid(null);
    autoWalkRef.current = null;
  }, [broadcastFollowStop]);

  const startFollowing = useCallback((uid: string) => {
    if (!uid || uid === meIdRef.current) return;
    followingUidRef.current = uid;
    setFollowingUid(uid);
    const name = profilesRef.current[uid]?.display_name ?? "personagem";
    toast.success(`Seguindo ${name}. Pressione qualquer direção para parar.`);
  }, []);

  const requestLead = useCallback((uid: string) => {
    const ch = leadChannelRef.current;
    const from = meIdRef.current;
    if (!ch || !from) { toast.error("Conexão indisponível."); return; }
    const fromName = profilesRef.current[from]?.display_name ?? "Alguém";
    void ch.send({ type: "broadcast", event: "lead-request", payload: { from, to: uid, fromName } });
    const target = profilesRef.current[uid]?.display_name ?? "personagem";
    toast.info(`Pedido enviado a ${target}. Aguardando resposta...`);
  }, []);

  const acceptLead = useCallback((fromUid: string) => {
    const ch = leadChannelRef.current;
    const me = meIdRef.current;
    if (!ch || !me) return;
    void ch.send({ type: "broadcast", event: "lead-accept", payload: { from: me, to: fromUid } });
    // Requester is the leader → I (receiver) will follow them
    startFollowing(fromUid);
  }, [startFollowing]);

  const declineLead = useCallback((fromUid: string) => {
    const ch = leadChannelRef.current;
    const me = meIdRef.current;
    if (!ch || !me) return;
    void ch.send({ type: "broadcast", event: "lead-decline", payload: { from: me, to: fromUid } });
  }, []);

  // ===== Join ("Junte-se a mim") =====
  // Caller asks target to teleport next to them; target accepts and lands beside caller.
  const teleportToPoint = useCallback((target: Point, label?: string) => {
    if (!tierCapsRef.current.canTeleport) {
      toast.info("Teleporte está disponível a partir do Nível 2.");
      return;
    }
    const from = { ...posRef.current };
    autoWalkRef.current = null;
    teleportTimers.current.forEach((t) => window.clearTimeout(t));
    teleportTimers.current = [];
    const id = Date.now();
    setTeleport({ from, to: target, phase: "out", id });
    const uid = meIdRef.current;
    const ch = positionBroadcastChannelRef.current;
    if (uid && ch && positionBroadcastReadyRef.current) {
      void ch.send({
        type: "broadcast",
        event: "teleport",
        payload: { user_id: uid, from, to: target },
      });
    }
    teleportTimers.current.push(
      window.setTimeout(() => {
        if (collides(target)) { setTeleport(null); toast.error("O destino deixou de ser caminhável."); return; }
        posRef.current = target;
        setPos(target);
        const z2 = callZoneAt(target);
        setZone(z2);
        sendPos(target.x, target.y, z2, facingRef.current, true);
        setTeleport({ from, to: target, phase: "in", id });
      }, 450)
    );
    teleportTimers.current.push(
      window.setTimeout(() => {
        setTeleport((cur) => (cur && cur.id === id ? null : cur));
      }, 1100)
    );
    if (label) toast.success(`✨ Indo até ${label}...`);
  }, [sendPos]);

  const requestJoin = useCallback((uid: string) => {
    const ch = leadChannelRef.current;
    const from = meIdRef.current;
    if (!ch || !from) { toast.error("Conexão indisponível."); return; }
    const fromName = profilesRef.current[from]?.display_name ?? "Alguém";
    const fromPos = { ...posRef.current };
    void ch.send({
      type: "broadcast",
      event: "join-request",
      payload: { from, to: uid, fromName, fromPos },
    });
    const target = profilesRef.current[uid]?.display_name ?? "personagem";
    toast.info(`Convite enviado a ${target}.`);
  }, []);

  const acceptJoin = useCallback((fromUid: string, fromPos: Point) => {
    const ch = leadChannelRef.current;
    const me = meIdRef.current;
    if (!ch || !me) return;
    void ch.send({ type: "broadcast", event: "join-accept", payload: { from: me, to: fromUid } });
    const occupied: Point[] = Object.entries(positionsRef.current)
      .filter(([u]) => u !== me)
      .map(([, p]) => ({ x: p.x, y: p.y }));
    const target = nearbyWalkablePoint(fromPos, occupied, callZoneAt(fromPos));
    const name = profilesRef.current[fromUid]?.display_name ?? "quem chamou";
    if (target) teleportToPoint(target, name);
    else toast.error("Não há ponto caminhável próximo ao chamado.");
  }, [teleportToPoint]);

  const declineJoin = useCallback((fromUid: string) => {
    const ch = leadChannelRef.current;
    const me = meIdRef.current;
    if (!ch || !me) return;
    void ch.send({ type: "broadcast", event: "join-decline", payload: { from: me, to: fromUid } });
  }, []);

  // Alertas de "chamar para seguir": evento de negócio → apresentação web.
  // Não chama RTC/mídia/movimento; "Seguir" executa o acceptLead existente.
  const acceptLeadRef = useRef(acceptLead);
  acceptLeadRef.current = acceptLead;
  const declineLeadRef = useRef(declineLead);
  declineLeadRef.current = declineLead;
  const notifServiceRef = useRef<OfficeNotificationService | null>(null);
  if (!notifServiceRef.current) {
    notifServiceRef.current = createOfficeNotificationAdapter();
  }
  useEffect(() => {
    const service = notifServiceRef.current!;
    setNotificationService(service);
    return () => { service.dispose?.(); clearNotificationService(service); };
  }, []);
  const followCenterRef = useRef<FollowRequestCenter | null>(null);
  if (!followCenterRef.current) {
    // Popup persistente (30s) + indicador vêm do FollowRequestsOverlay.
    followCenterRef.current = createFollowRequestCenter(
      presenterFromService(notifServiceRef.current, () => playFollowChime()),
    );
  }
  useEffect(() => () => followCenterRef.current?.dispose(), []);
  const acceptJoinRef = useRef(acceptJoin);
  acceptJoinRef.current = acceptJoin;
  const declineJoinRef = useRef(declineJoin);
  declineJoinRef.current = declineJoin;
  const joinCenterRef = useRef<JoinInviteCenter | null>(null);
  if (!joinCenterRef.current) {
    joinCenterRef.current = createJoinInviteCenter({
      service: () => notifServiceRef.current,
      isBackground: notifServiceRef.current.kind === "desktop" ? () => notifServiceRef.current!.isAppHidden() : undefined,
      playSound: () => void playFollowChime(),
      showPopup: (inv) => {
        toast(`${inv.fromName} quer que você se junte a ele(a)`, {
          id: `join-${inv.fromUid}`,
          description: "Aceite para se teletransportar para o local dessa pessoa.",
          duration: 20000,
          action: { label: "Aceitar", onClick: () => { joinCenterRef.current?.resolve(inv.fromUid); acceptJoinRef.current(inv.fromUid, inv.fromPos); } },
          cancel: { label: "Recusar", onClick: () => { joinCenterRef.current?.resolve(inv.fromUid); declineJoinRef.current(inv.fromUid); } },
        });
      },
    });
  }
  useEffect(() => {
    // Ao voltar ao Office, chamados recebidos em segundo plano reabrem como popup.
    const back = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        followCenterRef.current?.onAppVisible();
        joinCenterRef.current?.onAppVisible();
      }
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, []);
  const [showNotifPrompt, setShowNotifPrompt] = useState(false);
  useEffect(() => {
    if (me?.id && me.onboarded_at && !isNotificationSetupDone(me.id)) setShowNotifPrompt(true);
  }, [me?.id, me?.onboarded_at]);
  useEffect(() => {
    const prime = () => primeNotificationSound();
    window.addEventListener("pointerdown", prime);
    window.addEventListener("keydown", prime);
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  // Lead channel — separate from positions so we can subscribe independently
  // once we know our user id (the broadcast handlers need stable closures).
  useEffect(() => {
    const uid = me?.id;
    if (!uid) return;
    const ch = supabase
      .channel(`lead-events`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "lead-request" }, ({ payload }) => {
        const p = payload as { from?: string; to?: string; fromName?: string };
        if (!p?.from || p.to !== uid) return;
        followCenterRef.current?.receive({
          fromUid: p.from,
          fromName: p.fromName ?? profilesRef.current[p.from]?.display_name ?? "Alguém",
          at: Date.now(),
        });
      })
      .on("broadcast", { event: "lead-accept" }, ({ payload }) => {
        const p = payload as { from?: string; to?: string };
        if (!p?.from || p.to !== uid) return;
        const name = profilesRef.current[p.from]?.display_name ?? "Alguém";
        toast.success(`${name} aceitou! Pode começar a andar — ${name} vai te seguir.`);
      })
      .on("broadcast", { event: "lead-decline" }, ({ payload }) => {
        const p = payload as { from?: string; to?: string };
        if (!p?.from || p.to !== uid) return;
        toast.info("Pedido recusado.");
      })
      .on("broadcast", { event: "follow-stop" }, ({ payload }) => {
        const p = payload as { from?: string; to?: string };
        if (!p?.from || p.to !== uid) return;
        const name = profilesRef.current[p.from]?.display_name ?? "Alguém";
        toast.info(`${name} parou de te seguir.`);
      })
      .on("broadcast", { event: "join-request" }, ({ payload }) => {
        const p = payload as { from?: string; to?: string; fromName?: string; fromPos?: Point };
        if (!p?.from || p.to !== uid || !p.fromPos) return;
        joinCenterRef.current?.receive({
          fromUid: p.from,
          fromName: p.fromName ?? profilesRef.current[p.from]?.display_name ?? "Alguém",
          fromPos: p.fromPos,
          at: Date.now(),
        });
      })
      .on("broadcast", { event: "join-accept" }, ({ payload }) => {
        const p = payload as { from?: string; to?: string };
        if (!p?.from || p.to !== uid) return;
        const name = profilesRef.current[p.from]?.display_name ?? "Alguém";
        toast.success(`${name} aceitou o convite e está chegando!`);
      })
      .on("broadcast", { event: "join-decline" }, ({ payload }) => {
        const p = payload as { from?: string; to?: string };
        if (!p?.from || p.to !== uid) return;
        toast.info("Convite recusado.");
      })
      .subscribe();
    leadChannelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      if (leadChannelRef.current === ch) leadChannelRef.current = null;
    };
  }, [me?.id, acceptLead, declineLead, acceptJoin, declineJoin]);

  // Close avatar menu on outside click / Esc
  useEffect(() => {
    if (!avatarMenuUid) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest("[data-avatar-menu]")) setAvatarMenuUid(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setAvatarMenuUid(null); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onEsc);
    };
  }, [avatarMenuUid]);






  const sendReaction = useCallback((emoji: string) => {
    const uid = meIdRef.current;
    if (!uid) return;
    const ts = Date.now();
    setReactions((prev) => ({ ...prev, [uid]: { emoji, ts } }));
    setTimeout(() => {
      setReactions((prev) => {
        const cur = prev[uid];
        if (!cur || cur.ts !== ts) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      });
    }, REACTION_DURATION_MS);
    const ch = reactionChannelRef.current;
    if (ch) {
      void ch.send({
        type: "broadcast",
        event: "reaction",
        payload: { user_id: uid, emoji },
      });
    }
  }, []);

  const sendConfetti = useCallback(() => {
    const uid = meIdRef.current;
    if (!uid) return;
    const dir = facingRef.current;
    const cur = posRef.current;
    const ts = Date.now();
    const id = `${uid}-${ts}-${Math.random().toString(36).slice(2, 7)}`;
    setConfettis((prev) => [...prev, { id, x: cur.x, y: cur.y, facing: dir, ts }]);
    setTimeout(() => {
      setConfettis((prev) => prev.filter((c) => c.id !== id));
    }, 1100);
    const ch = reactionChannelRef.current;
    if (ch) {
      void ch.send({
        type: "broadcast",
        event: "confetti",
        payload: { user_id: uid, facing: dir, x: cur.x, y: cur.y },
      });
    }
  }, []);

  // keyboard input — standard 2D game movement (hold to walk, release to idle)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isMovementInputBlocked(panelRef.current)) return;
      const key = e.key.toLowerCase();
      // Ctrl/Cmd + D — teleport to claimed workspace
      if (key === "d" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        teleportToMyClaim();
        return;
      }
      // Ctrl + R — teleport to meeting room
      if (key === "r" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        teleportToZone("reuniao");
        return;
      }
      // Ctrl + F — teleport to the decompression room
      if (key === "f" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        teleportToZone("descompressao");
        return;
      }
      const emoji = EMOJI_MAP[key];
      if (emoji && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && !target?.isContentEditable) {
          e.preventDefault();
          sendReaction(emoji);
          return;
        }
      }
      // F (sem modificadores) — joga confete na direção do personagem 🎉
      if (key === "f" && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && !target?.isContentEditable) {
          e.preventDefault();
          sendConfetti();
          return;
        }
      }
      const dir = dirFromKey(key);
      if (!dir) return;
      // Não capturar setas/WASD quando o usuário está digitando em um input/textarea
      {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      }
      e.preventDefault();
      if (e.repeat) return;
      // Manual movement cancels auto-walk and any active follow
      autoWalkRef.current = null;
      routeRef.current = [];
      if (followingUidRef.current) stopFollowing(true);
      keysDown.current.add(dir);
      lastDir.current = dir;
      setLocalFacing(dir);
      // Re-enable camera follow as soon as the user starts moving
      if (!followRef.current) setFollowMe(true);
    };

    const up = (e: KeyboardEvent) => {
      const dir = dirFromKey(e.key.toLowerCase());
      if (!dir) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      keysDown.current.delete(dir);
      if (lastDir.current === dir) {
        // Fall back to any other key still held
        const remaining = Array.from(keysDown.current);
        lastDir.current = remaining[remaining.length - 1] ?? null;
        if (lastDir.current) setLocalFacing(lastDir.current);
      }
      // Quando o usuário para de andar (nenhuma tecla pressionada), persiste
      // a posição final IMEDIATAMENTE no banco. Isso garante que ao recarregar
      // a página o personagem volte exatamente onde parou — sem cair no spawn.
      if (keysDown.current.size === 0) {
        const cur = posRef.current;
        // STOP imediato no V2 (sem esperar o idle de 150 ms → evita overshoot remoto).
        if (IS_RTC_V2) rtcV2Ref.current?.reportMotion(cur.x, cur.y, 0, 0);
        sendPos(cur.x, cur.y, callZoneAt(cur), facingRef.current, true);
      }
    };
    const blur = () => {
      keysDown.current.clear();
      lastDir.current = null;
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up, { passive: false });
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [setLocalFacing, sendReaction, sendConfetti, teleportToMyClaim, sendPos]);

  // Ao abrir um painel: solta teclas presas (para no lugar). Não mexe em posição/RTC.
  useEffect(() => {
    if (!isMovementInputBlocked(panel)) return;
    if (keysDown.current.size === 0 && !lastDir.current) return;
    keysDown.current.clear();
    lastDir.current = null;
    const cur = posRef.current;
    if (IS_RTC_V2) rtcV2Ref.current?.reportMotion(cur.x, cur.y, 0, 0);
    sendPos(cur.x, cur.y, callZoneAt(cur), facingRef.current, true);
  }, [panel, sendPos]); // eslint-disable-line react-hooks/exhaustive-deps

  // movement + animation loop
  useEffect(() => {
    let raf = 0;
    let lastT = 0;
    const tick = (t: number) => {
      // Delta-time: torna a velocidade independente do FPS. Quando a aba
      // perde frames, o passo cresce proporcionalmente para que o
      // personagem continue parecendo fluido em vez de "arrastado".
      const dtMs = lastT ? t - lastT : 16.667;
      lastT = t;
      const stepFactor = dtMs / 16.667;

      let dir = lastDir.current;

      // Follow: keep autoWalk pointing at the leader as they move.
      if (!dir && followingUidRef.current) {
        const tgt = positionsRef.current[followingUidRef.current];
        if (!tgt || !tgt.is_online) {
          followingUidRef.current = null;
          setFollowingUid(null);
          autoWalkRef.current = null;
        } else {
          const cur = posRef.current;
          const d = Math.hypot(tgt.x - cur.x, tgt.y - cur.y);
          if (d > 0.06) autoWalkRef.current = { x: tgt.x, y: tgt.y };
          else autoWalkRef.current = null;
        }
      }

      // Touch route (double tap): feed the next waypoint to the existing auto-walk.
      if (followingUidRef.current) routeRef.current = [];
      else if (!dir && !autoWalkRef.current && routeRef.current.length) {
        autoWalkRef.current = routeRef.current.shift()!;
      }

      // Auto-walk: if no manual key, compute a direction toward the target.
      if (!dir && autoWalkRef.current) {
        const cur = posRef.current;
        const tgt = autoWalkRef.current;
        const dx = tgt.x - cur.x;
        const dy = tgt.y - cur.y;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        if (adx < SPEED && ady < SPEED) {
          // Arrived
          autoWalkRef.current = null;
          const z = callZoneAt(cur);
          sendPos(cur.x, cur.y, z, facingRef.current, true);
        } else {
          // Prefer the larger axis; if blocked, fall back to the other.
          const primary: Facing = adx >= ady
            ? (dx > 0 ? "right" : "left")
            : (dy > 0 ? "down" : "up");
          const secondary: Facing = adx >= ady
            ? (dy > 0 ? "down" : "up")
            : (dx > 0 ? "right" : "left");
          if (facingRef.current !== primary) setLocalFacing(primary);
          if (tryMove(primary, stepFactor)) {
            dir = primary;
          } else {
            if (facingRef.current !== secondary) setLocalFacing(secondary);
            if (tryMove(secondary, stepFactor)) {
              dir = secondary;
            } else {
              // Stuck — abort auto-walk (and any touch route: e.g. closed door)
              autoWalkRef.current = null;
              routeRef.current = [];
            }
          }
        }
      }

      if (dir) {
        // For manual movement, tryMove was already called via keydown path below;
        // when manual key is held we still need to advance position each frame.
        const isManual = lastDir.current === dir;
        const moved = isManual ? tryMove(dir, stepFactor) : true;
        if (moved) {
          if (t - lastFrameTick.current > WALK_FRAME_MS) {
            lastFrameTick.current = t;
            const next = frameRef.current >= 5 || frameRef.current < 1 ? 1 : frameRef.current + 1;
            frameRef.current = next;
            setFrame(next);
          }
        } else if (frameRef.current !== 0) {
          frameRef.current = 0;
          setFrame(0);
        }
      } else if (frameRef.current !== 0) {
        frameRef.current = 0;
        setFrame(0);
        const cur = posRef.current;
        // Item 2: garante o último commit de posição quando paramos —
        // o throttle de 33 ms em tryMove pode ter "engolido" o frame final.
        setPos((prev) => (prev.x === cur.x && prev.y === cur.y ? prev : cur));
        lastPosCommit.current = t;
        const z = callZoneAt(cur);
        sendPos(cur.x, cur.y, z, facingRef.current, true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tryMove, sendPos, setLocalFacing]);



  const currentZone = useMemo(() => findZoneById(localZoneId) ?? ZONES[ZONES.length - 1], [localZoneId]);
  // Prefer the painted bounding box (editor overrides) over the hardcoded rect
  // so the spotlight visually matches exactly what the user painted.
  const focusedZone = useMemo(() => {
    if (currentZone.id === "lobby") return null;
    const painted = zoneRectFromOverrides(currentZone.id);
    return painted
      ? { ...currentZone, rect: painted }
      : currentZone;
  }, [currentZone, mapVersion]);
  const focusedZoneRef = useRef(focusedZone);
  focusedZoneRef.current = focusedZone;

  // Smooth remote avatars between sparse broadcast samples (~120 ms apart).
  // We lerp each peer's wrapper toward the latest target every animation
  // frame and mutate `style` directly, so no React re-render is triggered.
  useEffect(() => {
    let raf = 0;
    const ALPHA = 0.22; // approach factor per frame (~60fps)
    const SNAP_DIST = 0.0005;
    const loop = () => {
      const positions = positionsRef.current;
      const myId = meIdRef.current;
      const focus = focusedZoneRef.current;
      for (const uid in positions) {
        if (uid === myId) continue;
        const el = remoteWrapRefs.current.get(uid);
        if (!el) continue;
        const net = positions[uid];
        if (!net) continue;
        const target = IS_RTC_V2
          ? (v2PredictorRef.current.sample(uid, performance.now()) ?? net)
          : net;
        let s = remoteSmoothRef.current.get(uid);
        if (!s) {
          s = { x: target.x, y: target.y };
          remoteSmoothRef.current.set(uid, s);
        }
        // While a teleport is animating, let React drive position/opacity.
        if (remoteTeleportTimers.current.has(uid)) {
          s.x = target.x;
          s.y = target.y;
          continue;
        }
        const dx = target.x - s.x;
        const dy = target.y - s.y;
        if (IS_RTC_V2) {
          // Predictor já suaviza; desenha a amostra exata do frame.
          s.x = target.x;
          s.y = target.y;
        } else if (Math.abs(dx) < SNAP_DIST && Math.abs(dy) < SNAP_DIST) {
          if (s.x !== target.x || s.y !== target.y) {
            s.x = target.x;
            s.y = target.y;
          }
        } else {
          s.x += dx * ALPHA;
          s.y += dy * ALPHA;
        }
        el.style.left = `${s.x * 100}%`;
        el.style.top = `${s.y * 100}%`;
        const inFocus =
          !focus ||
          (s.x >= focus.rect.x1 &&
            s.x <= focus.rect.x2 &&
            s.y >= focus.rect.y1 &&
            s.y <= focus.rect.y2);
        el.style.zIndex = String(
          (focus ? (inFocus ? 60000 : 20000) : 0) + Math.round(s.y * 1000)
        );
      }
      // Drop smoothed entries for peers that left.
      for (const uid of Array.from(remoteSmoothRef.current.keys())) {
        if (!(uid in positions)) remoteSmoothRef.current.delete(uid);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Histórico "Minhas reuniões" — registra entrada/saída quando o usuário
  // está efetivamente em uma conversa automática com pelo menos 1 outro peer
  // próximo/na mesma área, não apenas conectado ao SFU global do workspace.
  const isPrivateZone = currentZone.id !== "lobby";
  const currentZoneRef = useRef(currentZone);
  currentZoneRef.current = currentZone;
  const meetingLabelFor = useCallback(
    (zoneId: string) => (currentZoneRef.current.id === zoneId ? currentZoneRef.current.label : zoneId),
    [],
  );
  const { activeMeetingId, endMeetingNow } = useMeetingTracker({
    zoneId: currentZone.id,
    zoneLabel: currentZone.label,
    isMeetingZone: isPrivateZone,
    peerCount: desiredPeers.length,
    enabled: !!me?.id,
    v2Room: rtc.v2?.room ?? null,
    v2RemoteCount: RTC_ON_DEMAND_ACTIVE ? (rtc.v2?.remoteCount ?? 0) : undefined,
    labelFor: meetingLabelFor,
  });

  // Gravação manual (botão). V1: MediaRecorder local (legado).
  // V2 (Etapa 14D): gravação server-side via LiveKit Egress — sem getDisplayMedia.
  const legacyRecorder = useMeetingRecorder({
    getLocalAudioTrack: rtc.getLocalAudioTrack,
    remoteStreams: audibleStreams,
  });
  const v2RoomRef = useRef(rtc.v2?.room ?? null);
  v2RoomRef.current = rtc.v2?.room ?? null;
  const serverRecorder = useServerRecorder({
    meetingId: IS_RTC_V2 ? activeMeetingId : null,
    isRoomConnected: () =>
      v2RoomRef.current?.status === "CONNECTED" &&
      v2RoomRef.current?.connected?.kind === "PRIVATE_ROOM",
  });
  const recorder = IS_RTC_V2 ? serverRecorder : legacyRecorder;
  // RTC On Demand: gravação ativa mantém a Room mesmo com 1 humano.
  const v2SetRecording = rtc.v2?.setRecordingActive;
  useEffect(() => {
    v2SetRecording?.(IS_RTC_V2 && !!serverRecorder.isRecording);
  }, [v2SetRecording, serverRecorder.isRecording]);

  // ---- Meeting Inactivity Guard (camada isolada; VITE_MEETING_IDLE_GUARD) ----
  const returnPosRef = useRef(new MeetingReturnPosition());
  const v2InPrivate = rtc.v2?.context.kind === "PRIVATE_ROOM";
  useEffect(() => {
    returnPosRef.current.observe(pos, v2InPrivate);
  }, [pos.x, pos.y, v2InPrivate]); // eslint-disable-line react-hooks/exhaustive-deps
  const idleRoom = rtc.v2?.room ?? null;
  const idlePrivateZone =
    idleRoom?.status === "CONNECTED" && idleRoom.connected?.kind === "PRIVATE_ROOM"
      ? idleRoom.connected.zoneId
      : null;
  const meetingIdle = useMeetingIdleGuard({
    enabled: IS_RTC_V2 && !!rtc.v2,
    selfId: me?.id ?? null,
    workspaceId: getCurrentWorkspaceId(),
    privateZoneId: idlePrivateZone,
    privateConnected: !!idlePrivateZone,
    remoteIdentities: idlePrivateZone ? rtc.connectedPeers : [],
    speaking: rtc.speakingPeers,
    selfSpeaking: rtc.selfSpeaking,
    screenShareActive: rtc.screenOn || Object.keys(rtc.remoteScreenStreams).length > 0,
    recordingActive: IS_RTC_V2 && !!serverRecorder.isRecording,
    avatars: rtc.v2?.avatars ?? null,
    selfMotionKey: `${pos.x.toFixed(4)},${pos.y.toFixed(4)}`,
    telemetry: rtc.v2?.telemetry ?? null,
    notifications: notifServiceRef.current,
    playSound: () => void playFollowChime(),
    onEject: (zoneId) => {
      const tel = rtcV2Ref.current?.telemetry ?? null;
      // Gravação ativa suspende o guard (nunca chega aqui gravando); o guard nunca para Egress.
      // 2) Histórico: encerramento explícito, sem grace administrativo.
      endMeetingNow?.();
      // 3) Só o MEU avatar volta à última posição segura (fallback: spawn).
      const uid = meIdRef.current;
      let spawn: Point = SPAWN;
      const myClaim = uid ? Object.entries(claimsRef.current).find(([, u]) => u === uid)?.[0] : undefined;
      if (myClaim) {
        spawn = walkablePointInZone(loadOverrides(), myClaim) ?? SPAWN;
      }
      const { point: capturedPoint, fallback } = returnPosRef.current.resolve(spawn);
      // A previous safe point can become a wall after an online map edit.
      const point = nearestWalkablePoint(loadOverrides(), capturedPoint);
      if (!point) { toast.error("Não há ponto seguro no mapa para retornar."); return; }
      if (fallback) emitTelemetry(tel, "MEETING_IDLE_RETURN_POSITION_FALLBACK", { zoneId });
      // Caminho existente: setPos → efeito RTC (announceJump) + sendPos persiste.
      lastMotionAtRef.current = 0;
      posRef.current = point;
      setPos(point);
      sendPos(point.x, point.y, callZoneAt(point), facingRef.current, true);
      toast.message("Reunião encerrada por inatividade.");
    },
  });





  // Bounds place the card; only painted cells form the interactive hit area.
  const workspaceZones = useMemo(() => workspaceZonesForMap(loadOverrides()), [mapVersion]);

  // Touch single tap: abre o painel da mesa/área sob o dedo (membership real do grid pintado).
  touchTapRef.current = (p: Point | null) => {
    if (zoneSheetId) { setZoneSheetId(null); return; }
    if (!p) return;
    const stage = stageRef.current;
    if (!stage) return;
    const m = screenToMap(p, { zoom: zoomRef.current, pan: panRef.current }, { w: stage.clientWidth, h: stage.clientHeight });
    const map = loadOverrides();
    const hit = workspaceZones.find((wz) => pointInMapZone(map, wz.id, m));
    if (hit) setZoneSheetId(hit.id);
  };

  // Rotação/resize: preserva zoom e posição; só reclampa o pan (efeito de resize)
  // e recentra se a câmera estiver seguindo.
  useEffect(() => {
    if (!followRef.current) return;
    centerOn(posRef.current.x, posRef.current.y, zoomRef.current);
  }, [mobileViewport.orientation, centerOn]);



  // "Presente no espaço" segue modelo de jogo colaborativo:
  // - `positions.is_online=true` é o estado durável/autoritativo do lobby.
  // - Presence/broadcast só aceleram descoberta e movimento em tempo real.
  // - Timestamp antigo NÃO remove avatar; jogador parado continua no mundo.
  const onlineList = useMemo(() => {
    const myId = meIdRef.current;
    return Object.values(positions)
      .filter((p) => {
        if (p.user_id === myId) return true; // self sempre visível
        if (p.is_online) return true;
        if (presentPeerIds.has(p.user_id)) return true;
        // Grace curto só cobre o instante entre receber um broadcast/presence
        // e a linha do banco ser marcada online. Não é usado para derrubar
        // jogador parado que já está online no lobby.
        const tsBroadcast = p.ts ?? 0;
        const tsDb = p.updated_at ? new Date(p.updated_at).getTime() : 0;
        const fresh = Math.max(tsBroadcast, tsDb, positionFreshTs.current.get(p.user_id) ?? 0, dbFreshTs.current.get(p.user_id) ?? 0);
        return fresh > 0 && Date.now() - fresh < 5_000;
      })
      .map((p) => ({
        pos: p,
        // Fallback: nunca esconde avatar só porque o profile ainda não chegou
        // do banco. Ele é hidratado pelo efeito de lazy-load abaixo.
        profile: profiles[p.user_id] ?? ({
          id: p.user_id,
          display_name: "…",
          avatar_color: "#475569",
        } as Profile),
      }));
  }, [positions, profiles, presentPeerIds]);

  // Lazy-load de profiles: se aparece um peer nas posições/presença que
  // ainda não temos cacheado, busca sob demanda para hidratar o avatar.
  useEffect(() => {
    const missing = new Set<string>();
    for (const uid of Object.keys(positions)) {
      if (uid !== meIdRef.current && !profiles[uid]) missing.add(uid);
    }
    for (const uid of presentPeerIds) {
      if (uid !== meIdRef.current && !profiles[uid]) missing.add(uid);
    }
    if (missing.size === 0) return;
    let cancelled = false;
    void (async () => {
      const ids = Array.from(missing);
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_color, sprite_id, tagline, status, onboarded_at, first_name, last_name, birth_date, city, state, country_code")
        .in("id", ids);
      if (cancelled || !data || data.length === 0) return;
      setProfiles((prev) => {
        const next = { ...prev };
        for (const row of data) next[(row as Profile).id] = row as Profile;
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [positions, presentPeerIds, profiles]);

  const offlineList = useMemo(() => {
    const onlineIds = new Set(onlineList.map((x) => x.profile.id));
    return Object.values(profiles).filter((p) => !onlineIds.has(p.id));
  }, [profiles, onlineList]);

  // ===== Meeting UI V2 (somente composição visual; não toca RTC) =====
  const inPrivateRoomVisual = IS_RTC_V2
    ? rtc.v2?.room?.status === "CONNECTED" && rtc.v2?.room?.connected?.kind === "PRIVATE_ROOM"
    : isPrivateZone && audibleConnectedPeers.length > 0;
  const remoteScreenEntries = Object.entries(audibleScreenStreams).filter(([, s]) =>
    s.getVideoTracks().some((t) => t.readyState === "live"),
  );
  const hasScreenShareVisual = !!rtc.localScreenStream || remoteScreenEntries.length > 0;
  const meetingDisplayMode: MeetingDisplayMode = resolveMeetingDisplayMode({
    inPrivateRoom: inPrivateRoomVisual,
    hasScreenShare: hasScreenShareVisual,
  });
  const [viewOfficeDuringMeeting, setViewOfficeDuringMeeting] = useState(false);
  useEffect(() => {
    if (meetingDisplayMode === "office") setViewOfficeDuringMeeting(false);
  }, [meetingDisplayMode]);
  const meetingControls: StageControls = {
    micOn: rtc.micOn,
    camOn: rtc.camOn,
    screenOn: rtc.screenOn,
    canShare: currentZone.id !== "lobby",
    handUp: !!(me && raisedHands[me.id]),
    onToggleMic: () => { rtc.toggleMic().catch((e) => toast.error(describeMediaError(e, "microfone"))); },
    onToggleCam: () => { rtc.toggleCam().catch((e) => toast.error(describeMediaError(e, "câmera"))); },
    onToggleScreen: () => { rtc.toggleScreen().catch(() => toast.error("Não foi possível compartilhar a tela")); },
    onToggleHand: toggleRaiseHand,
    micTrack: rtc.v2 ? rtc.v2.localMicTrack : undefined,
    audioInputs: rtc.audioInputDevices,
    selectedAudioInputId: rtc.selectedAudioInputDeviceId,
    onSelectAudioInput: (id) => { rtc.setAudioInputDevice(id).catch(() => toast.error("Falha ao trocar microfone")); },
    videoInputs: rtc.videoDevices,
    selectedVideoId: rtc.selectedVideoDeviceId,
    onSelectVideo: (id) => { rtc.setVideoDevice(id).catch(() => toast.error("Falha ao trocar câmera")); },
  };
  const meetingStageActive = MEETING_UI_V2 && meetingDisplayMode !== "office" && !viewOfficeDuringMeeting;
  const stageParticipants: StageParticipant[] = (() => {
    const list: StageParticipant[] = [];
    const hasLive = (s: MediaStream | null) =>
      !!s && s.getVideoTracks().some((t) => t.enabled && t.readyState === "live");
    if (me) {
      list.push({
        id: me.id,
        profile: { id: me.id, display_name: me.display_name, avatar_color: me.avatar_color },
        stream: rtc.localVideoStream,
        hasVideo: rtc.camOn && hasLive(rtc.localVideoStream),
        micOn: rtc.micOn,
        speaking: rtc.micOn && !!rtc.selfSpeaking,
        isSelf: true,
      });
    }
    for (const peerId of audibleConnectedPeers) {
      const p = profiles[peerId] ?? { id: peerId, display_name: "Convidado", avatar_color: "#475569" };
      const stream = audibleStreams[peerId] ?? null;
      list.push({ id: peerId, profile: p, stream, hasVideo: hasLive(stream), micOn: true, speaking: !!rtc.speakingPeers[peerId] });
    }
    return list;
  })();
  const stageScreens: StageScreen[] = [
    ...(rtc.localScreenStream ? [{ key: "__local__", label: "Sua tela", stream: rtc.localScreenStream, isLocal: true }] : []),
    ...remoteScreenEntries.map(([id, stream]) => ({
      key: id,
      label: `Tela de ${profiles[id]?.display_name ?? "Convidado"}`,
      stream,
      isLocal: false,
    })),
  ];

  return (
    <OfficeToastLayer sceneRef={sceneRef} showTeam={showTeam}>
    <div
      ref={sceneRef}
      tabIndex={0}
      className="relative w-screen h-screen overflow-hidden bg-black outline-none flex items-stretch"
      onMouseDown={(e) => {
        // Eventos de portais (menus/popovers) borbulham pela árvore React até
        // aqui; roubar o foco fecha o popover antes do clique executar.
        if (!sceneRef.current?.contains(e.target as Node)) return;
        sceneRef.current.focus();
      }}
    >
      {/* Extended scenery — park on the left */}
      <div
        className="flex-1 h-full"
        style={{
          backgroundImage: `url(${parkLeft})`,
          backgroundSize: "auto 100%",
          backgroundPosition: "right center",
          backgroundRepeat: "repeat-x",
        }}
        aria-hidden
      />

      {/* Office stage — fixed aspect, full height */}
      <div
        ref={stageRef}
        className="relative h-full shrink-0 overflow-hidden select-none"
        data-testid="office-stage"
        // touch-action só no palco: navegador não faz pinch/scroll nativo aqui;
        // não tem efeito sobre mouse e não afeta o resto do site.
        style={{ aspectRatio: "1536 / 1024", touchAction: "none" }}



        onWheel={(e) => {
          e.preventDefault();
          const stage = stageRef.current;
          if (!stage) return;
          const rect = stage.getBoundingClientRect();
          const cx = e.clientX - rect.left;
          const cy = e.clientY - rect.top;
          const s = zoomRef.current;
          const factor = e.deltaY < 0 ? 1.10 : 1 / 1.10;
          const ns = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s * factor));
          if (ns === s) return;
          const p = panRef.current;
          const np = { x: cx - (cx - p.x) * (ns / s), y: cy - (cy - p.y) * (ns / s) };
          setZoom(ns);
          setPan(clampPan(ns, np));
          setFollowMe(false);
        }}
        onPointerDown={(e) => {
          if (placing) return;
          if (e.pointerType === "touch") {
            // Touch-only path: gestures never reach the mouse drag below.
            const tgt = e.target as HTMLElement;
            if (tgt.closest(GESTURE_EXEMPT)) return;
            touchPointersRef.current.add(e.pointerId);
            gestures.down(e.pointerId, stageLocal(e));
            return;
          }
          if (e.button !== 0) return;
          // Don't start a drag on interactive children (buttons, etc.)
          const tgt = e.target as HTMLElement;
          if (tgt.closest("button, a, input, textarea, [role='button']")) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            panX: panRef.current.x,
            panY: panRef.current.y,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "touch") {
            if (touchPointersRef.current.has(e.pointerId)) gestures.move(e.pointerId, stageLocal(e));
            return;
          }
          const d = dragRef.current;
          if (!d) return;
          const dx = e.clientX - d.startX;
          const dy = e.clientY - d.startY;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          d.moved = true;
          setFollowMe(false);
          setPan(clampPan(zoomRef.current, { x: d.panX + dx, y: d.panY + dy }));
        }}
        onPointerUp={(e) => {
          if (e.pointerType === "touch") {
            if (touchPointersRef.current.delete(e.pointerId)) gestures.up(e.pointerId, stageLocal(e));
            return;
          }
          const d = dragRef.current;
          dragRef.current = null;
          wasDragRef.current = !!d?.moved;
          try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* pointer may already be released */ }
        }}
        onPointerCancel={(e) => {
          if (e.pointerType !== "touch") return;
          if (touchPointersRef.current.delete(e.pointerId)) gestures.cancel(e.pointerId);
        }}
        onClickCapture={(e) => {
          if (placing) {
            wasDragRef.current = false;
            return;
          }
          if (wasDragRef.current) {
            e.stopPropagation();
            e.preventDefault();
            wasDragRef.current = false;
          }
        }}
      >
        {/* Camera pan layer */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
            willChange: "transform",
            cursor: dragRef.current?.moved ? "grabbing" : "grab",
          }}
        >
          {/* Camera zoom layer */}
          <div
            className="absolute inset-0"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "0 0",
              willChange: "transform",
            }}
          >

        <img
          src={officeTheme.url}
          alt="Espaço Virtual Office"
          className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
          draggable={false}
          style={{ imageRendering: "pixelated" }}
        />

        {/* Elementos sobrepostos (mobília, portas etc.) */}
        <PropsLayer selfX={pos.x} selfY={pos.y} focusedRect={focusedZone?.rect ?? null} />

        {tapMarker && (
          <div
            key={tapMarker.id}
            data-testid="touch-route-marker"
            data-ok={tapMarker.ok ? "true" : "false"}
            className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 rounded-full border-2 animate-ping motion-reduce:animate-none"
            style={{
              left: `${tapMarker.x * 100}%`,
              top: `${tapMarker.y * 100}%`,
              width: 22,
              height: 12,
              borderColor: tapMarker.ok ? "var(--primary)" : "var(--destructive)",
              animationIterationCount: 1,
              zIndex: 1,
            }}
          />
        )}




        {/* Private-area overlay (Gather-style): darken everything outside the active zone */}
        {focusedZone && (
          <ZoneSpotlight rect={focusedZone.rect} />
        )}

        {/* Workspace-zone hover overlays (claim button / owner tooltip) */}
        {workspaceZones.map((wz) => {
          const ownerId = claims[wz.id];
          const owner = ownerId ? profiles[ownerId] : null;
          const ownerOnline = ownerId ? positions[ownerId]?.is_online ?? false : false;
          const isMyClaim = !!(ownerId && me && ownerId === me.id);
          const iHaveAClaim = !!(me && Object.values(claims).includes(me.id));
          const isHovered = hoveredZone === wz.id;
          // Skip entirely when there's no function available here:
          // - empty zone but I already have a claim → can't claim, nothing to do
          if (!ownerId && iHaveAClaim) return null;
          // - own claim → não mostramos card (a ação "Deixar mesa" agora vive no menu do perfil)
          if (isMyClaim) return null;
          const showCompose = !!ownerId && !isMyClaim;
          return (
            <WorkspaceZoneHover
              key={`ws-${wz.id}`}
              rect={wz.rect}
              zoneId={wz.id}
              path={wz.path}
              isHovered={isHovered}
              onEnter={() => { if (!coarsePointer) setHoveredZone(wz.id); }}
              onLeave={() => setHoveredZone((cur) => (cur === wz.id ? null : cur))}
            >
              {ownerId ? (
                <OccupantCard
                  profile={owner}
                  online={ownerOnline}
                  isMe={isMyClaim}
                  onLeaveNote={
                    showCompose
                      ? () => {
                          setComposeFor({
                            zoneId: wz.id,
                            recipientId: ownerId,
                            recipientName: owner?.display_name ?? "colega",
                          });
                          setComposeText("");
                          setHoveredZone(null);
                        }
                      : undefined
                  }
                />
              ) : (
                <button
                  onClick={() => claimZone(wz.id)}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold bg-primary text-primary-foreground shadow-soft hover:opacity-90 whitespace-nowrap"
                >
                  Reivindicar espaço
                </button>
              )}
            </WorkspaceZoneHover>
          );

        })}


        {/* Bolhas de "conversa de corredor" — raio de alcance de voz/vídeo
            ao redor de cada personagem que NÃO está numa sala reivindicada.
            Mostra visualmente onde o microfone/câmera se conectam quando
            dois colegas se aproximam no corredor. */}
        {onlineList.map(({ pos: p, profile }) => {
          const isMe = me?.id === profile.id;
          const display = isMe ? pos : { x: p.x, y: p.y };
          const inClaim = Object.values(claims).includes(profile.id);
          const inRoom = (isMe ? zone : p.zone) !== "lobby";
          if (inClaim || inRoom) return null;
          // Diâmetro = 2 * raio de desconexão, em unidades de % do mapa.
          const diameter = PROXIMITY_DISCONNECT * 2 * 100;
          return (
            <div
              key={`chat-radius-${profile.id}`}
              className="absolute pointer-events-none"
              style={{
                left: `${display.x * 100}%`,
                top: `${display.y * 100}%`,
                width: `${diameter}%`,
                // Perspectiva isométrica → elipse achatada (~45% da largura).
                height: `${diameter * 0.45}%`,
                transform: "translate(-50%, -50%)",
                borderRadius: "50%",
                background:
                  "radial-gradient(ellipse at center, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.12) 55%, rgba(255,255,255,0) 100%)",
                border: "1px solid rgba(255,255,255,0.35)",
                boxShadow: "inset 0 0 24px rgba(255,255,255,0.15)",
                zIndex: Math.round(display.y * 1000) - 1,
                transition: isMe ? "none" : "left 120ms linear, top 120ms linear",
              }}
            />
          );
        })}

        {/* Avatars */}



        {onlineList.map(({ pos: p, profile }) => {
          const isMe = me?.id === profile.id;
          const display = isMe ? pos : { x: p.x, y: p.y };
          // When zone overlay active, dim avatars outside the zone
          const inFocus =
            !focusedZone ||
            (display.x >= focusedZone.rect.x1 &&
              display.x <= focusedZone.rect.x2 &&
              display.y >= focusedZone.rect.y1 &&
              display.y <= focusedZone.rect.y2);
          const myTeleporting = isMe && teleport;
          const remoteTp = !isMe ? remoteTeleports[profile.id] : null;
          const teleporting = myTeleporting || remoteTp;
          // While the "out" phase plays, render the avatar at the ORIGIN so the
          // sparkle is anchored there; on "in", render at destination. This
          // matches what the teleporter themself sees.
          const tpData = myTeleporting ? teleport! : remoteTp;
          const renderPoint = tpData
            ? (tpData.phase === "out" ? tpData.from : tpData.to)
            : display;
          const tpOpacity = tpData ? (tpData.phase === "out" ? 0 : 1) : 1;
          return (
            <div
              key={profile.id}
              ref={(el) => {
                if (isMe) return;
                if (el) remoteWrapRefs.current.set(profile.id, el);
                else remoteWrapRefs.current.delete(profile.id);
              }}
              className="absolute pointer-events-none"
              style={{
                left: `${renderPoint.x * 100}%`,
                top: `${renderPoint.y * 100}%`,
                transform: "translate(-50%, -90%)",
                transition: teleporting
                  ? "opacity 420ms ease-in-out, filter 420ms ease-in-out"
                  : "none",
                zIndex: (focusedZone ? (inFocus ? 60000 : 20000) : 0) + Math.round(renderPoint.y * 1000),
                opacity: tpOpacity,
                filter: tpData
                  ? `drop-shadow(0 0 18px ${profile.avatar_color}) drop-shadow(0 0 36px ${profile.avatar_color}) brightness(${tpData.phase === "out" ? 1.8 : 1.4})`
                  : "none",
              }}
            >
              <div className="flex flex-col items-center">
                {!isMe && !!rtc.speakingPeers[profile.id] && (
                  <SpeechBubble />
                )}
                <div
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap mb-0.5 shadow-soft backdrop-blur-sm text-white"
                  style={{
                    background: profile.avatar_color,
                    border: isMe ? "none" : `1.5px solid ${profile.avatar_color}`,
                  }}
                >
                  {profile.display_name}
                </div>
                <div className="relative">
                  {/* Selection ring on the floor (perspective ellipse) for remote avatars */}
                  {!isMe && (hoveredAvatarUid === profile.id || avatarMenuUid === profile.id) && (
                    <div
                      className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
                      style={{ bottom: -6, width: 56, height: 16, zIndex: 1 }}
                    >
                      <div
                        className="w-full h-full rounded-[50%] border-2"
                        style={{
                          borderColor: "var(--primary)",
                          boxShadow: "0 0 14px var(--primary), inset 0 0 8px color-mix(in oklab, var(--primary) 40%, transparent)",
                          animation: "pulse 1.4s ease-in-out infinite",
                        }}
                      />
                    </div>
                  )}
                  <div className="absolute left-1/2 -translate-x-1/4 -top-5 z-10 pointer-events-none">
                    <ReactionBubble emoji={reactions[profile.id]?.emoji ?? null} />
                  </div>
                  <SpriteAvatar
                    facing={isMe ? facing : (p.facing ?? "down")}
                    frame={isMe ? frame : (remoteFrames[profile.id] ?? 0)}
                    glowColor={isMe ? profile.avatar_color : undefined}
                    spriteId={profile.sprite_id}
                  />
                  {/* Confetti is rendered in a separate layer below so it stays at launch position */}
                  {/* Hover/click hit-area for remote avatars (sits over the sprite) */}
                  {!isMe && (
                    <AvatarHitArea
                      profileId={profile.id}
                      displayName={profile.display_name}
                      isOpen={avatarMenuUid === profile.id}
                      onHoverIn={() => {
                        setHoveredAvatarUid(profile.id);
                        setHoveredZone(null);
                      }}
                      onHoverOut={() =>
                        setHoveredAvatarUid((c) => (c === profile.id ? null : c))
                      }
                      onToggle={() =>
                        setAvatarMenuUid((cur) => (cur === profile.id ? null : profile.id))
                      }
                      menu={
                        <AvatarInteractionMenu
                          profile={profile}
                          onClose={() => setAvatarMenuUid(null)}
                          onFollow={() => { startFollowing(profile.id); setAvatarMenuUid(null); }}
                          onLead={() => { requestLead(profile.id); setAvatarMenuUid(null); }}
                          onJoin={() => { requestJoin(profile.id); setAvatarMenuUid(null); }}
                          onMessage={officeChat ? () => { officeChat.openPeer(profile.id); setAvatarMenuUid(null); } : undefined}
                        />
                      }
                    />
                  )}
                  {isMe && coarsePointer && (
                    <button
                      type="button"
                      data-testid="touch-self-avatar"
                      aria-label="Centralizar câmera em mim"
                      className="absolute left-1/2 -translate-x-1/2 pointer-events-auto bg-transparent border-0 p-0"
                      style={{ bottom: 0, width: 56, height: 96, zIndex: 2_000_000_000 }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        // follow ligado: o efeito de follow centraliza na hora (sem menu, sem rota).
                        if (tweenRafRef.current != null) { cancelAnimationFrame(tweenRafRef.current); tweenRafRef.current = null; }
                        centerOn(posRef.current.x, posRef.current.y, zoomRef.current);
                        setFollowMe(true);
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Magic teleport particles — local + every remote teleport in progress */}
        {teleport && (
          <TeleportFx
            point={teleport.phase === "out" ? teleport.from : teleport.to}
            phase={teleport.phase}
            color={me?.avatar_color}
            key={`me-${teleport.id}-${teleport.phase}`}
          />
        )}
        {Object.entries(remoteTeleports).map(([uid, tp]) => (
          <TeleportFx
            key={`${uid}-${tp.id}-${tp.phase}`}
            point={tp.phase === "out" ? tp.from : tp.to}
            phase={tp.phase}
            color={profiles[uid]?.avatar_color}
          />
        ))}

        {/* Confetti bursts — anchored at the launch position, do NOT follow the avatar */}
        {confettis.map((c) => {
          // Raise the origin to the shoulders so the confetti doesn't appear
          // to come from the floor, regardless of facing direction.
          const yOffsetPx = -28;
          return (
            <div
              key={c.id}
              className="absolute pointer-events-none"
              style={{
                left: `${c.x * 100}%`,
                top: `${c.y * 100}%`,
                transform: `translate(-50%, calc(-90% + ${yOffsetPx}px))`,
                zIndex: Math.round(c.y * 1000) + 1,
              }}
            >
              <ConfettiBurst facing={c.facing} burstKey={c.ts} />
            </div>
          );
        })}




        {/* Desk notes (post-it gifts) sitting on workstations */}
        {notes.map((n) => {
          const isForMe = me?.id === n.recipient_id;
          const isMine = me?.id === n.sender_id;
          const sender = profiles[n.sender_id];
          const interactive = isForMe || isMine;
          const isSelected = selectedNoteId === n.id && isMine;
          const inMyZone = isForMe && zone === n.zone_id;
          return (
            <div
              key={n.id}
              className="absolute"
              style={{
                left: `${n.x * 100}%`,
                top: `${n.y * 100}%`,
                transform: "translate(-50%, -85%)",
                zIndex: Math.round(n.y * 1000) + 5,
                pointerEvents: interactive ? "auto" : "none",
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isForMe) setOpeningNote(n);
                  else if (isMine) setSelectedNoteId((cur) => (cur === n.id ? null : n.id));
                }}
                className="block"
                style={{ cursor: interactive ? "pointer" : "default" }}
                title={
                  isForMe
                    ? `Recadinho de ${sender?.display_name ?? "alguém"} — clique ou aperte X`
                    : isMine
                      ? "Seu recadinho — clique para cancelar"
                      : `Recadinho para ${profiles[n.recipient_id]?.display_name ?? ""}`
                }
              >
                <GiftSprite color={sender?.avatar_color} bounce={isForMe} />
              </button>

              {/* Overlay "Aperte X" para o destinatário quando está na mesma sala */}
              {inMyZone && (
                <div
                  className="absolute left-1/2 -translate-x-1/2 -top-7 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm text-[11px] text-white/90 shadow-lg whitespace-nowrap pointer-events-none"
                  style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}
                >
                  <span className="opacity-80">Aperte</span>
                  <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/15 border border-white/20 font-bold text-white text-[10px] leading-none">X</kbd>
                  <span className="opacity-80">para ler</span>
                </div>
              )}

              {/* Botão excluir para quem enviou */}
              {isSelected && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const id = n.id;
                    const { error } = await supabase.from("desk_notes").delete().eq("id", id);
                    if (error) { toast.error("Não foi possível excluir."); return; }
                    setNotes((p) => p.filter((x) => x.id !== id));
                    setSelectedNoteId(null);
                    toast.success("Recadinho cancelado.");
                  }}
                  className="absolute left-1/2 -translate-x-1/2 -bottom-8 flex items-center gap-1 px-2 py-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-medium shadow-lg hover:opacity-90 whitespace-nowrap"
                >
                  🗑️ Cancelar recadinho
                </button>
              )}
            </div>
          );
        })}

        {/* Placement layer — appears after composing a note */}
        {placing && (
          <PlacementLayer
            placing={placing}
            workspaceZones={workspaceZones}
            onMove={(p) => setCursor(p)}
            onCancel={() => {
              setPlacing(null);
              setCursor(null);
            }}
            onConfirm={async (p) => {
              const uid = meIdRef.current;
              if (!uid) return;
              const _wsNote = getCurrentWorkspaceId();
              if (!_wsNote) { toast.error("Workspace inválido."); return; }
              const { error } = await supabase.from("desk_notes").insert({
                workspace_id: _wsNote,
                zone_id: placing.zoneId,
                sender_id: uid,
                recipient_id: placing.recipientId,
                body: placing.body,
                x: p.x,
                y: p.y,
              });
              if (error) {
                toast.error("Não foi possível deixar o recadinho.");
                return;
              }
              toast.success("✨ Recadinho deixado na mesa!");
              setPlacing(null);
              setCursor(null);
            }}
          />
        )}
        {placing && cursor && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${cursor.x * 100}%`,
              top: `${cursor.y * 100}%`,
              transform: "translate(-50%, -85%)",
              zIndex: 200002,
              opacity: 0.95,
              filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.35))",
            }}
          >
            <GiftSprite color={me?.avatar_color} bounce />
          </div>
        )}

        {!meetingStageActive && <ScreenShareViewer
          localStream={rtc.localScreenStream}
          remoteStreams={audibleScreenStreams}
          profiles={profiles}
          onStopLocal={() => { rtc.toggleScreen().catch(() => {}); }}
          controls={meetingControls}
          participants={(() => {
            const list: Array<{
              id: string;
              profile: { id: string; display_name: string; avatar_color: string };
              stream: MediaStream | null;
              hasVideo: boolean;
              micOn: boolean;
              speaking: boolean;
              isSelf?: boolean;
            }> = [];
            const hasLive = (s: MediaStream | null) =>
              !!s && s.getVideoTracks().some((t) => t.enabled && t.readyState === "live");
            if (me) {
              list.push({
                id: me.id,
                profile: { id: me.id, display_name: me.display_name, avatar_color: me.avatar_color },
                stream: rtc.localVideoStream,
                hasVideo: rtc.camOn && hasLive(rtc.localVideoStream),
                micOn: rtc.micOn,
                speaking: false,
                isSelf: true,
              });
            }
            for (const peerId of audibleConnectedPeers) {
              const p = profiles[peerId] ?? { id: peerId, display_name: "Convidado", avatar_color: "#475569" };
              const stream = audibleStreams[peerId] ?? null;
              list.push({
                id: peerId,
                profile: p,
                stream,
                hasVideo: hasLive(stream),
                micOn: true,
                speaking: !!rtc.speakingPeers[peerId],
              });
            }
            return list;
          })()}
        />}
        </div>
        </div>
        {/* /Camera transform layer */}

        {/* Map navigation controls — float next to team panel (outside the box, follows collapse) */}
        {coarsePointer && zoneSheetId && (() => {
          const wz = workspaceZones.find((z) => z.id === zoneSheetId);
          if (!wz) return null;
          const ownerId = claims[wz.id];
          const owner = ownerId ? profiles[ownerId] : null;
          const isMine = !!(ownerId && me && ownerId === me.id);
          const iHaveAClaim = !!(me && Object.values(claims).includes(me.id));
          const close = () => setZoneSheetId(null);
          const actions = [] as { id: string; label: string; onSelect: () => void; tone?: "primary" | "danger" }[];
          if (!ownerId && !iHaveAClaim) actions.push({ id: "claim", label: "Reivindicar espaço", tone: "primary", onSelect: () => { close(); void claimZone(wz.id); } });
          if (isMine) actions.push({ id: "leave", label: "Deixar mesa", tone: "danger", onSelect: () => { close(); void releaseClaim(); } });
          if (ownerId && !isMine) actions.push({ id: "note", label: "Deixar recado", onSelect: () => {
            close();
            setComposeFor({ zoneId: wz.id, recipientId: ownerId, recipientName: owner?.display_name ?? "colega" });
            setComposeText("");
          } });
          const online = ownerId ? positions[ownerId]?.is_online ?? false : false;
          return (
            <MobileZoneSheet
              title={findZoneById(wz.id)?.label ?? "Espaço"}
              subtitle={ownerId ? `${isMine ? "Sua mesa" : owner?.display_name ?? "Ocupado"}${!isMine ? (online ? " · online" : " · offline") : ""}` : "Espaço livre"}
              actions={actions}
              onClose={close}
            />
          );
        })()}

        <div
          // No toque os três botões ficam ocultos: pinça faz o zoom, arrastar move a câmera
          // e tocar no próprio avatar centraliza/segue — mesma coisa, sem ocupar a tela.
          className="absolute bottom-6 pointer-coarse:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] flex flex-col gap-2 z-[90] pointer-events-auto transition-all pointer-coarse:hidden"
          style={
            coarsePointer && mobileViewport.orientation === "landscape"
              // Deitado: coluna no meio da borda direita, fora do notch/barras e do personagem centralizado.
              ? { right: "calc(0.75rem + env(safe-area-inset-right))", top: "50%", bottom: "auto", transform: "translateY(-50%)" }
              : { right: showTeam ? "calc(19rem + 0.5rem)" : "2rem" }
          }
          data-testid="map-controls"
          data-no-map-gesture
        >
          <button
            type="button"
            title="Aproximar"
            onClick={() => {
              const s = zoomRef.current;
              const ns = Math.min(MAX_ZOOM, s * 1.15);
              const stage = stageRef.current;
              if (!stage || ns === s) return;
              const W = stage.clientWidth, H = stage.clientHeight;
              const cx = W / 2, cy = H / 2;
              const p = panRef.current;
              setZoom(ns);
              setPan(clampPan(ns, { x: cx - (cx - p.x) * (ns / s), y: cy - (cy - p.y) * (ns / s) }));
            }}
            aria-label="Aproximar"
            className="w-9 h-9 pointer-coarse:w-11 pointer-coarse:h-11 pointer-coarse:active:scale-90 transition-transform rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center shadow-soft backdrop-blur-sm"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="Afastar"
            onClick={() => {
              const s = zoomRef.current;
              const ns = Math.max(MIN_ZOOM, s / 1.15);
              const stage = stageRef.current;
              if (!stage || ns === s) return;
              const W = stage.clientWidth, H = stage.clientHeight;
              const cx = W / 2, cy = H / 2;
              const p = panRef.current;
              setZoom(ns);
              setPan(clampPan(ns, { x: cx - (cx - p.x) * (ns / s), y: cy - (cy - p.y) * (ns / s) }));
            }}
            aria-label="Afastar"
            className="w-9 h-9 pointer-coarse:w-11 pointer-coarse:h-11 pointer-coarse:active:scale-90 transition-transform rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center shadow-soft backdrop-blur-sm"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            title={followMe ? "Câmera seguindo você" : "Centralizar em mim"}
            aria-label={followMe ? "Câmera seguindo você" : "Centralizar em mim"}
            data-testid="center-on-me"
            onClick={() => {
              setFollowMe(false);
              const targetZoom = Math.max(zoomRef.current, 2.0);
              tweenCenterOn(posRef.current.x, posRef.current.y, targetZoom, 700, () => {
                setFollowMe(true);
              });
            }}
            className={`w-9 h-9 pointer-coarse:w-11 pointer-coarse:h-11 pointer-coarse:active:scale-90 transition-transform rounded-full flex items-center justify-center shadow-soft backdrop-blur-sm ${
              followMe ? "bg-primary text-primary-foreground" : "bg-black/60 hover:bg-black/80 text-white"
            }`}
          >
            <Locate className="w-4 h-4" />
          </button>
        </div>
      </div>
      



      {/* Compose note dialog */}
      <Dialog
        open={!!composeFor}
        onOpenChange={(o) => {
          if (!o) setComposeFor(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">Deixar um recado</DialogTitle>
          </DialogHeader>
          <div className="relative pt-4">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-4xl z-20 drop-shadow-md pointer-events-none select-none">🎁</div>
            <div
              className="rounded-lg p-4 shadow-soft relative"
              style={{
                background: "linear-gradient(180deg, #FFE680 0%, #FFD84D 100%)",
                color: "#3a2e00",
                minHeight: 180,
              }}
            >
              <Textarea
                value={composeText}
                onChange={(e) => setComposeText(e.target.value.slice(0, 280))}
                placeholder="Escreva uma mensagem!"
                className="bg-transparent border-0 focus-visible:ring-0 resize-none text-sm placeholder:text-amber-900/50 min-h-[150px] pb-8"
                autoFocus
              />
              <div className="absolute bottom-2 left-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="p-1.5 rounded-full bg-amber-900/10 hover:bg-amber-900/20 text-amber-900 transition-colors"
                      aria-label="Inserir emoji"
                    >
                      <Smile className="w-4 h-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0 border-0 bg-transparent shadow-none w-auto"
                    side="top"
                    align="start"
                  >
                    <EmojiPicker
                      onEmojiClick={(e) => {
                        setComposeText((prev) => (prev + e.emoji).slice(0, 280));
                      }}
                      emojiStyle={EmojiStyle.APPLE}
                      theme={EmojiTheme.LIGHT}
                      width={320}
                      height={380}
                      searchPlaceholder="Buscar emoji..."
                      previewConfig={{ showPreview: false }}
                      skinTonesDisabled
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground text-right mt-1">
              {composeText.length}/280
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setComposeFor(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!composeText.trim()}
              onClick={() => {
                if (!composeFor) return;
                setPlacing({
                  zoneId: composeFor.zoneId,
                  recipientId: composeFor.recipientId,
                  body: composeText.trim(),
                });
                setCursor(null);
                setComposeFor(null);
                toast.info(`Clique na mesa de ${composeFor.recipientName} para deixar o presentinho 🎁`);
              }}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              Colocar na mesa dele(a)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Read note dialog */}
      <Dialog
        open={!!openingNote}
        onOpenChange={(o) => { if (!o) setOpeningNote(null); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">
              Recadinho de {openingNote ? profiles[openingNote.sender_id]?.display_name ?? "alguém" : ""} para você
            </DialogTitle>
          </DialogHeader>
          <div
            className="rounded-lg p-4 shadow-soft whitespace-pre-wrap text-sm"
            style={{
              background: "linear-gradient(180deg, #FFE680 0%, #FFD84D 100%)",
              color: "#3a2e00",
              minHeight: 140,
            }}
          >
            {openingNote?.body}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setOpeningNote(null)}
            >
              Fechar
            </Button>
            <Button
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
              onClick={async () => {
                if (!openingNote || !me) return;
                const note = openingNote;
                const senderName = profiles[note.sender_id]?.display_name ?? null;
                const { error: saveErr } = await supabase.from("saved_notes").insert({
                  user_id: me.id,
                  sender_id: note.sender_id,
                  sender_name: senderName,
                  body: note.body,
                  original_created_at: note.created_at,
                });
                if (saveErr) { toast.error("Não foi possível guardar."); return; }
                await supabase.from("desk_notes").update({ read_at: new Date().toISOString() }).eq("id", note.id);
                setNotes((prev) => prev.filter((n) => n.id !== note.id));
                setOpeningNote(null);
                toast.success("💛 Recadinho guardado no seu perfil (30 dias).");
              }}
            >
              Guardar recadinho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {me && (
        <SavedNotesDialog
          open={savedNotesOpen}
          onOpenChange={setSavedNotesOpen}
          userId={me.id}
        />
      )}

      {IS_RTC_V2 && rtc.v2?.privacy.promptVisible && (
        <OfficeNotice kind="action">
        <div
          role="alertdialog"
          translate="no"
          data-testid="privacy-guard-prompt"
          aria-label="Câmera pausada por privacidade"
          className="w-full rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg"
        >
          <p className="text-sm font-semibold">Câmera pausada por privacidade</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sua câmera foi desligada porque o Prestativa Office ficou em segundo plano.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => rtc.v2?.privacyKeepOff()}>
              Manter desligada
            </Button>
            <Button size="sm" onClick={() => void rtc.v2?.privacyRestore()}>
              Reativar câmera
            </Button>
          </div>
        </div>
        </OfficeNotice>
      )}

      {meetingIdle.warning && (
        <MeetingIdleWarning deadlineAt={meetingIdle.warning.deadlineAt} onContinue={meetingIdle.continueMeeting} />
      )}
      {IS_RTC_V2 && serverRecorder.completed && (
        <RecordingNameDialog
          meetingId={serverRecorder.completed.meetingId}
          defaultTitle={`Reunião — ${new Date().toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}`}
          onClose={serverRecorder.dismissCompleted}
        />
      )}




      {/* Extended scenery — road on the right */}
      <div
        className="flex-1 h-full"
        style={{
          backgroundImage: `url(${roadRight})`,
          backgroundSize: "auto 100%",
          backgroundPosition: "left center",
          backgroundRepeat: "repeat-x",
        }}
        aria-hidden
      />

      {/* Remote video/audio tiles */}
      {meetingStageActive ? (
        <>
          {/* Áudio continua pelos mesmos players; vídeo só no MeetingStage */}
          <HiddenAudioPlayers streams={audibleStreams} />
          <MeetingStage
            mode={meetingDisplayMode === "presentation" ? "presentation" : "meeting"}
            participants={stageParticipants}
            screens={stageScreens}
            raisedHands={raisedHands}
            onStopLocalShare={() => { rtc.toggleScreen().catch(() => {}); }}
            onViewOffice={() => setViewOfficeDuringMeeting(true)}
            controls={meetingControls}
          />
        </>
      ) : (
      <RemoteVideoTiles
        myId={me?.id ?? null}
        myProfile={me ? { id: me.id, display_name: me.display_name, avatar_color: me.avatar_color } : null}
        localStream={rtc.localVideoStream}
        localCamOn={rtc.camOn}
        localMicOn={rtc.micOn}
        selfSpeaking={rtc.selfSpeaking}
        streams={audibleStreams}
        profiles={profiles}
        speakingPeers={rtc.speakingPeers}
        connectedPeers={audibleConnectedPeers}
        raisedHands={raisedHands}
      />
      )}
      {MEETING_UI_V2 && viewOfficeDuringMeeting && meetingDisplayMode !== "office" && (
        <button
          type="button"
          onClick={() => setViewOfficeDuringMeeting(false)}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[115] px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium shadow-lg"
        >
          Voltar para reunião
        </button>
      )}

      {/* HUD de atalhos de reunião — aparece ao entrar numa call e ao usar um atalho */}
      {audibleConnectedPeers.length > 0 && (
        <div
          className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-[110] pointer-events-none transition-all duration-300 ${
            shortcutsHudVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
          }`}
        >
          <div
            className="flex items-center gap-3 px-3 py-1.5 rounded-full text-[11px] text-white/90 backdrop-blur-md shadow-lg"
            style={{
              background: "color-mix(in oklab, #0b0f1a 78%, transparent)",
              border: "1px solid color-mix(in oklab, #ffffff 14%, transparent)",
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-[10px]">Alt+M</kbd>
              mic
            </span>
            <span className="w-px h-3 bg-white/15" />
            <span className="inline-flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-[10px]">Alt+V</kbd>
              câmera
            </span>
            <span className="w-px h-3 bg-white/15" />
            <span className="inline-flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-[10px]">Alt+H</kbd>
              levantar a mão
            </span>
          </div>
        </div>
      )}





      {/* Topbar — slim, sticky, sophisticated */}
      <div data-office-topbar className="absolute top-0 left-0 right-0 pointer-events-none z-[100]">
        <div
          className="pointer-events-auto flex items-center justify-between h-11 pl-3 pr-2 backdrop-blur-xl"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in oklab, var(--card) 78%, transparent) 0%, color-mix(in oklab, var(--card) 60%, transparent) 100%)",
            borderBottom: "1px solid color-mix(in oklab, var(--border) 70%, transparent)",
            boxShadow: "0 1px 0 0 color-mix(in oklab, var(--foreground) 4%, transparent), 0 8px 24px -16px color-mix(in oklab, var(--foreground) 25%, transparent)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={prestativaIcon.url}
              alt="Virtual Office"
              className="h-8 w-auto object-contain"
              draggable={false}
            />
            <span className="hidden md:inline mx-2 h-4 w-px bg-[color-mix(in_oklab,#e50914_45%,transparent)]" aria-hidden />
            <span className="hidden md:inline text-[11px] text-muted-foreground truncate">
              {currentZone.label}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <OfficeChatButton />
            {(() => {
              const s = rtc.connectionStatus;
              const peers = audibleConnectedPeers.length;
              let dot = "bg-slate-400";
              let label = "Desconectado";
              let title = rtc.lastError ?? "";
              if (rtc.v2?.awaitingPeer) { dot = "bg-slate-400"; label = "Aguardando outro participante"; title = ""; }
              else if (rtc.v2?.lobbyIdle) { dot = "bg-slate-400"; label = "Disponível"; title = ""; }
              else if (s === "connecting") { dot = "bg-amber-400 animate-pulse"; label = "Conectando…"; }
              else if (s === "reconnecting") { dot = "bg-amber-400 animate-pulse"; label = "Reconectando…"; }
              else if (s === "error") { dot = "bg-red-500"; label = "Erro de conexão"; title = rtc.lastError ?? "Falha no LiveKit"; }
              else if (s === "connected") {
                dot = "bg-emerald-500 shadow-[0_0_8px_var(--color-emerald-500,#10b981)]";
                label = peers > 0 ? `Em chamada com ${peers}` : "Conectado · sozinho";
              }
              return (
                <div
                  className="text-[11px] text-muted-foreground px-2 hidden sm:flex items-center gap-1.5"
                  title={title}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                  {label}
                </div>
              );
            })()}
            <div className="flex items-center">
              <IconButton
                active={rtc.micOn}
                onClick={() => {
                  void unlockAudioPlayback();
                  rtc.toggleMic().catch((e) => toast.error(describeMediaError(e, "microfone")));
                }}
                title={rtc.micOn ? "Desligar microfone (Alt+M)" : "Ligar microfone (Alt+M)"}
              >
                {rtc.micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </IconButton>
              {rtc.v2 && <MicLevelMeter track={rtc.v2.localMicTrack} />}
              <DeviceMenu
                title="Configurações de áudio"
                sections={[
                  {
                    label: "Microfone",
                    devices: rtc.audioInputDevices,
                    selectedId: rtc.selectedAudioInputDeviceId,
                    onSelect: (id) =>
                      rtc.setAudioInputDevice(id).catch(() => toast.error("Falha ao trocar microfone")),
                    fallbackLabel: "Microfone do sistema",
                  },
                  {
                    label: "Caixas de som",
                    devices: rtc.audioOutputDevices,
                    selectedId: rtc.selectedAudioOutputDeviceId,
                    onSelect: (id) =>
                      rtc.setAudioOutputDevice(id).catch(() => toast.error("Falha ao trocar saída de áudio")),
                    fallbackLabel: "Saída padrão",
                  },
                ]}
              />
            </div>
            <div className="flex items-center">
              <IconButton
                active={rtc.camOn}
                onClick={() => {
                  void unlockAudioPlayback();
                  rtc.toggleCam().catch((e) => toast.error(describeMediaError(e, "câmera")));
                }}
                title={rtc.camOn ? "Desligar câmera (Alt+V)" : "Ligar câmera (Alt+V)"}
              >
                {rtc.camOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
              </IconButton>
              <DeviceMenu
                title="Configurações de câmera"
                sections={[
                  {
                    label: "Câmera",
                    devices: rtc.videoDevices,
                    selectedId: rtc.selectedVideoDeviceId,
                    onSelect: (id) =>
                      rtc.setVideoDevice(id).catch(() => toast.error("Falha ao trocar câmera")),
                    fallbackLabel: "Câmera do sistema",
                  },
                ]}
              />
            </div>
            <CamPreviewAndPicker
              stream={rtc.localVideoStream}
              devices={rtc.videoDevices}
              selectedId={rtc.selectedVideoDeviceId}
              onSelect={(id) => rtc.setVideoDevice(id).catch(() => toast.error("Falha ao trocar câmera"))}
              visible={rtc.camOn}
            />
            {currentZone.id !== "lobby" && (
              <IconButton
                active={rtc.screenOn}
                onClick={() => {
                  rtc.toggleScreen().catch(() => toast.error("Não foi possível compartilhar a tela"));
                }}
                title={rtc.screenOn ? "Parar compartilhamento" : "Compartilhar tela (janela, aba ou tela inteira)"}
              >
                <MonitorUp className="w-4 h-4" />
              </IconButton>
            )}
            <IconButton
              active={!!(me && raisedHands[me.id])}
              onClick={toggleRaiseHand}
              title={me && raisedHands[me.id] ? "Abaixar a mão (Alt+H)" : "Levantar a mão (Alt+H)"}
            >
              <Hand className="w-4 h-4" />
            </IconButton>

            {/* Botão de gravação — aparece em qualquer zona privada (não-lobby).
                Se não houver reunião ativa ainda, criamos sob demanda via meeting_join. */}
            {/* Quem não pode gravar (Membro Operacional) ainda vê o indicador. */}
            {isPrivateZone && tierCaps.canRecordMeetings && !canRecordMeeting && recorder.isRecording && (
              <span
                title="Esta reunião está sendo gravada"
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium bg-red-500/15 text-red-600 ring-1 ring-red-500/40"
              >
                <Circle className="w-2.5 h-2.5 fill-current" />
                Gravando
              </span>
            )}
            {isPrivateZone && tierCaps.canRecordMeetings && canRecordMeeting && (
              <button
                onClick={async () => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const _desktop = (window as any).prestativaDesktop;
                  console.log("[rec] click", {
                    isUploading: recorder.isUploading,
                    isRecording: recorder.isRecording,
                    isPrivateZone,
                    canRecord: tierCaps.canRecordMeetings,
                    activeMeetingId,
                    zone: currentZone.id,
                    hasDesktop: !!_desktop,
                    hasGetSourceId: !!_desktop?.getScreenSourceId,
                  });
                  toast.message("Preparando gravação…");
                  if (recorder.isUploading) {
                    toast.info("Aguarde, enviando gravação anterior…");
                    return;
                  }
                  if (recorder.isRecording) {
                    void recorder.stop();
                    return;
                  }
                  let meetingId = activeMeetingId;
                  if (!meetingId) {
                    try {
                      const _wsJoin = getCurrentWorkspaceId();
                      if (!_wsJoin) throw new Error("workspace não encontrado");
                      console.log("[rec] meeting_join", { ws: _wsJoin, zone: currentZone.id });
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const { data, error } = await (supabase as any).rpc("meeting_join", {
                        _workspace_id: _wsJoin,
                        _zone_id: currentZone.id,
                        _zone_label: currentZone.label,
                      });
                      if (error || !data) throw error ?? new Error("no meeting id");
                      meetingId = data as string;
                    } catch (err) {
                      console.error("[rec] failed to ensure meeting:", err);
                      toast.error("Não foi possível iniciar a gravação.");
                      return;
                    }
                  }
                  console.log("[rec] starting recorder", { meetingId });
                  void recorder.start(meetingId);
                }}
                disabled={recorder.isUploading}
                title={
                  recorder.isUploading
                    ? "Enviando gravação…"
                    : recorder.isRecording
                    ? `Parar gravação (${formatRecTime(recorder.elapsedSeconds)})`
                    : "Gravar reunião"
                }
                className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition ${
                  recorder.isRecording
                    ? "bg-red-500/15 text-red-600 hover:bg-red-500/25 ring-1 ring-red-500/40"
                    : "text-foreground/70 hover:text-foreground hover:bg-foreground/10"
                } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                {recorder.isUploading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="hidden md:inline">Enviando…</span>
                  </>
                ) : recorder.isRecording ? (
                  <>
                    <Square className="w-3 h-3 fill-current" />
                    <span className="font-mono tabular-nums">
                      {formatRecTime(recorder.elapsedSeconds)}
                    </span>
                  </>
                ) : (
                  <>
                    <Circle className="w-3 h-3 fill-red-500 text-red-500" />
                    <span className="hidden md:inline">Gravar</span>
                  </>
                )}
              </button>
            )}



            <IconButton active={showTeam} onClick={() => setShowTeam(!showTeam)} title="Equipe">
              <Users className="w-4 h-4" />
            </IconButton>
            {isMasterAdmin && (
              <Link
                to="/office/editor"
                title="Editor de mapa"
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-foreground/70 hover:text-foreground hover:bg-foreground/10 transition"
              >
                <Pencil className="w-4 h-4" />
              </Link>
            )}
            {me && (
              <ProfileMenu
                me={me}
                email={myEmail}
                hasClaim={Object.values(claims).includes(me.id)}
                onEditCharacter={() => setEditCharOpen(true)}
                canEditCharacter={tierCaps.canChangeSprite}
                onEditProfile={() => setEditProfOpen(true)}
                onGoToMyDesk={teleportToMyClaim}
                onRestartOnboarding={() => setForceOnboarding(true)}
                onStatusChanged={refreshMe}
                onOpenSavedNotes={() => setSavedNotesOpen(true)}
                onOpenMeetings={() => onPanelChange?.("meetings")}
                onLeaveDesk={releaseClaim}
              />
            )}
          </div>
        </div>
      </div>


      {/* Zone enter-toast (Gather style) */}
      <OfficeAreaNotice zoneId={focusedZone?.id} label={focusedZone?.label} />

      {/* Team panel side toggle — always visible on right edge */}
      <button
        type="button"
        onClick={() => setShowTeam((v) => !v)}
        title={showTeam ? "Ocultar equipe" : "Mostrar equipe"}
        className="absolute top-1/2 -translate-y-1/2 z-[85] w-7 h-14 rounded-l-lg bg-rose-500/90 hover:bg-rose-600 text-white flex items-center justify-center shadow-soft backdrop-blur-sm transition-all"
        style={{ right: showTeam ? "18rem" : "0" }}
      >
        {showTeam ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      {/* Team panel */}
      {showTeam && (
        <div data-office-team className="absolute right-4 top-24 bottom-4 w-72 pointer-events-auto z-[80]">
          <div className="glass-panel rounded-2xl shadow-soft h-full flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b">
              <div className="text-sm font-semibold">Equipe</div>
              <div className="text-xs text-muted-foreground">
                {onlineList.length} online · {offlineList.length} offline
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {onlineList.map(({ profile, pos: p }) => (
                <TeamRow
                  key={profile.id}
                  profile={profile}
                  zone={p.zone}
                  online
                  isMe={me?.id === profile.id}
                />
              ))}
              {offlineList.map((profile) => (
                <TeamRow key={profile.id} profile={profile} online={false} />
              ))}
              {onlineList.length === 0 && offlineList.length === 0 && (
                <div className="text-xs text-muted-foreground p-3 text-center">
                  Nenhuma colega cadastrada ainda. Peça à administração para criar contas.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Welcome hint — auto-hides after 5s */}
      {showHint && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none z-[100] animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="glass-panel rounded-full px-4 py-2 shadow-soft text-xs text-muted-foreground">
            Use <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">WASD</kbd> ou{" "}
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">setas</kbd> para se mover ·{" "}
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Ctrl+D</kbd> teleporta para seu espaço ✨
          </div>
        </div>
      )}

      {me && (
        <>
          <EditCharacterModal
            open={editCharOpen}
            onOpenChange={setEditCharOpen}
            userId={me.id}
            currentSpriteId={me.sprite_id ?? "marcio"}
            avatarColor={me.avatar_color}
            onSaved={refreshMe}
          />
          <EditProfileModal
            open={editProfOpen}
            onOpenChange={setEditProfOpen}
            userId={me.id}
            initial={{
              display_name: me.display_name,
              avatar_color: me.avatar_color,
              tagline: me.tagline ?? null,
              first_name: me.first_name ?? null,
              last_name: me.last_name ?? null,
              birth_date: me.birth_date ?? null,
              city: me.city ?? null,
              state: me.state ?? null,
              country_code: me.country_code ?? null,
            }}

            onSaved={refreshMe}
          />
        </>
      )}

      {me && (forceOnboarding || !me.onboarded_at) && (
        <OnboardingWizard
          userId={me.id}
          initialName={me.display_name || (myEmail.split("@")[0] ?? "")}
          onDone={() => { setForceOnboarding(false); refreshMe(); }}
          notificationService={notifServiceRef.current ?? undefined}
        />
      )}
      {me && me.onboarded_at && !forceOnboarding && showNotifPrompt && (
        <NotificationsPrompt
          userId={me.id}
          notificationService={notifServiceRef.current ?? undefined}
          onDone={() => setShowNotifPrompt(false)}
        />
      )}
      {followCenterRef.current && (
        <FollowRequestsOverlay
          center={followCenterRef.current}
          onFollow={(uid) => acceptLeadRef.current(uid)}
          onDecline={(uid) => declineLeadRef.current(uid)}
        />
      )}
    </div>
    </OfficeToastLayer>
  );
}

/** Magic teleport effect — pink sparkles + halo at the given normalized point. */
/**
 * Hover wrapper for a workspace zone. The zone outline stays inside the
 * scaled stage, but the popup card is rendered via portal at fixed
 * screen coordinates so it escapes the stage's overflow/stacking context.
 */
function WorkspaceZoneHover({
  rect,
  zoneId,
  path,
  isHovered,
  onEnter,
  onLeave,
  children,
}: {
  rect: { x1: number; y1: number; x2: number; y2: number };
  zoneId: string;
  path: string;
  isHovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
  children: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!isHovered) return;
    const inside = (rect: DOMRect, x: number, y: number) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    const onMove = (event: PointerEvent) => {
      const anchor = anchorRef.current;
      const popup = popupRef.current;
      if (anchor) {
        const bounds = anchor.getBoundingClientRect();
        if (bounds.width && bounds.height && inside(bounds, event.clientX, event.clientY) &&
          pointInMapZone(loadOverrides(), zoneId, {
            x: rect.x1 + (event.clientX - bounds.left) / bounds.width * (rect.x2 - rect.x1),
            y: rect.y1 + (event.clientY - bounds.top) / bounds.height * (rect.y2 - rect.y1),
          })) return;
      }
      if (popup && inside(popup.getBoundingClientRect(), event.clientX, event.clientY)) return;
      onLeave();
    };
    const onOut = (event: PointerEvent) => {
      if (!event.relatedTarget) onLeave();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerout", onOut);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onOut);
    };
  }, [isHovered, onLeave, zoneId, rect]);

  useEffect(() => {
    if (!isHovered) {
      setPos(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      const el = anchorRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const left = r.left + r.width / 2;
        const top = r.top + r.height / 2;
        // Só atualiza estado quando a posição realmente muda — setState com
        // objeto novo a cada frame re-renderiza a cena 60x/s e trava o React.
        setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
      }
      raf = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(raf);
  }, [isHovered]);

  return (
    <div
      ref={anchorRef}
      className="absolute"
      style={{
        left: `${rect.x1 * 100}%`,
        top: `${rect.y1 * 100}%`,
        width: `${(rect.x2 - rect.x1) * 100}%`,
        height: `${(rect.y2 - rect.y1) * 100}%`,
        zIndex: isHovered ? 55 : 15,
        pointerEvents: "none",
      }}
    >
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        <path data-workspace-hit={zoneId} d={path} fill="transparent" pointerEvents="all" onPointerEnter={onEnter} />
      </svg>
      <div
        className="absolute inset-0 rounded-md transition-all duration-150 pointer-events-none"
        style={{
          outline: isHovered
            ? `1.5px dashed color-mix(in oklab, var(--destructive) 80%, transparent)`
            : "none",
          outlineOffset: "-1px",
        }}
      />
      {isHovered && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popupRef}
            style={{
              position: "fixed",
              left: pos.left,
              // Centraliza dentro do retângulo do espaço — assim o mouse
              // que está sobre a mesa já está sobre o botão (sem "gap" que
              // faz o hover sumir antes de alcançar).
              top: pos.top,
              transform: "translate(-50%, -50%)",
              zIndex: 2147483647,
              pointerEvents: "auto",
            }}

          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

function TeleportFx({ point, phase, color }: { point: Point; phase: "out" | "in"; color?: string }) {

  const particles = useMemo(() => {
    return Array.from({ length: 18 }).map((_, i) => {
      const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 30 + Math.random() * 40;
      const delay = Math.random() * 180;
      const size = 4 + Math.random() * 6;
      return {
        i,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - 10,
        delay,
        size,
        duration: 600 + Math.random() * 300,
      };
    });
  }, [point.x, point.y, phase]);

  const c = color || "var(--primary)";
  const glow = color
    ? `color-mix(in oklab, ${color} 70%, white)`
    : "var(--primary-glow)";

  return (
    <div
      className="absolute pointer-events-none z-[80]"
      style={{
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        transform: "translate(-50%, -70%)",
      }}
    >
      <div
        className="absolute left-1/2 top-1/2 rounded-full"
        style={{
          width: 90,
          height: 90,
          transform: "translate(-50%, -50%)",
          background: `radial-gradient(circle, color-mix(in oklab, ${c} 70%, transparent) 0%, transparent 70%)`,
          animation: `tp-halo-${phase} 600ms ease-out forwards`,
          filter: "blur(2px)",
        }}
      />
      <div
        className="absolute left-1/2 top-1/2 rounded-full border-2"
        style={{
          width: 30,
          height: 30,
          transform: "translate(-50%, -50%)",
          borderColor: c,
          boxShadow: `0 0 24px ${glow}`,
          animation: `tp-ring 700ms ease-out forwards`,
        }}
      />
      {particles.map((p) => (
        <div
          key={p.i}
          className="absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: p.size,
            height: p.size,
            background: c,
            boxShadow: `0 0 8px ${c}, 0 0 14px ${glow}`,
            ["--tp-dx" as string]: `${p.dx}px`,
            ["--tp-dy" as string]: `${p.dy}px`,
            animation: `tp-particle-${phase} ${p.duration}ms ease-out ${p.delay}ms forwards`,
            opacity: 0,
          }}
        />
      ))}
    </div>
  );
}



/**
 * Hit-area + portal anchor para o sprite remoto. O menu é renderizado via
 * portal no body, posicionado dinamicamente sobre o sprite (clamp na viewport)
 * pra nunca ficar fora da tela e estar sempre acima do card da mesa.
 */
function AvatarHitArea({
  profileId,
  displayName,
  isOpen,
  onHoverIn,
  onHoverOut,
  onToggle,
  menu,
}: {
  profileId: string;
  displayName: string;
  isOpen: boolean;
  onHoverIn: () => void;
  onHoverOut: () => void;
  onToggle: () => void;
  menu: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let raf = 0;
    const tick = () => {
      const el = anchorRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const menuW = 240;
        const menuH = 180;
        const margin = 8;
        // âncora: direita do sprite, alinhado pelo topo
        let left = r.right + 12;
        let top = r.top - 8;
        if (left + menuW > window.innerWidth - margin) {
          // não cabe à direita → tenta à esquerda
          left = r.left - menuW - 12;
        }
        if (left < margin) left = margin;
        if (top + menuH > window.innerHeight - margin) {
          top = window.innerHeight - menuH - margin;
        }
        if (top < margin) top = margin;
        // Só atualiza quando muda — evita re-render 60x/s (trava o React).
        setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
      }
      raf = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(raf);
  }, [isOpen]);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest("[data-avatar-menu]")) return;
      onToggle();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isOpen, onToggle]);

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        data-avatar-menu
        className="absolute left-1/2 -translate-x-1/2 pointer-events-auto"
        style={{
          bottom: 0,
          width: 80,
          height: 130,
          cursor: "pointer",
          zIndex: 2_000_000_000,
          background: "transparent",
          border: 0,
          padding: 0,
        }}
        onMouseEnter={onHoverIn}
        onMouseLeave={onHoverOut}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={`Interagir com ${displayName}`}
        title={`Interagir com ${displayName}`}
      />
      {isOpen && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            data-avatar-menu
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              zIndex: 2147483647,
              pointerEvents: "auto",
            }}
          >
            {menu}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Menu derivado do personagem (portalado pelo AvatarHitArea). */
function AvatarInteractionMenu({
  profile,
  onClose,
  onFollow,
  onLead,
  onJoin,
  onMessage,
}: {
  profile: Profile;
  onClose: () => void;
  onFollow: () => void;
  onLead: () => void;
  onJoin: () => void;
  onMessage?: () => void;
}) {
  return (
    <div
      data-avatar-menu
      className="w-60 rounded-xl bg-popover text-popover-foreground shadow-2xl border"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
        <div className="text-sm font-semibold truncate" style={{ color: profile.avatar_color }}>
          {profile.display_name}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground"
          aria-label="Fechar"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-1">
        {onMessage && <button type="button" onClick={onMessage} className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-muted text-left"><MessageCircle className="w-4 h-4" /> Enviar mensagem</button>}
        <button
          type="button"
          onClick={() => {
            const bits = [profile.tagline, profile.status].filter(Boolean).join(" • ");
            toast(profile.display_name, { description: bits || "Perfil sem descrição." });
            onClose();
          }}
          className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-muted text-left"
        >
          <UserIcon className="w-4 h-4" /> Ver perfil
        </button>
        <button
          type="button"
          onClick={onFollow}
          className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-muted text-left"
        >
          <Footprints className="w-4 h-4" /> Seguir
        </button>
        <button
          type="button"
          onClick={onLead}
          className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-muted text-left"
        >
          <UserPlus className="w-4 h-4" /> Pedir para conduzir
        </button>
        <button
          type="button"
          onClick={onJoin}
          className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-muted text-left"
          title={`Convidar ${profile.display_name} a se juntar a você`}
        >
          <Users className="w-4 h-4" /> Convidar {profile.display_name} a se juntar
        </button>
      </div>
    </div>
  );
}

function SpriteAvatar({
  facing,
  frame,
  spriteId,
}: {
  facing: Facing;
  frame: number;
  glowColor?: string;
  spriteId?: string | null;
}) {
  return (
    <AlignedSprite
      spriteId={spriteId}
      facing={facing}
      frame={frame}
      mode="scene"
    />
  );
}


/** Speech-bubble reaction shown above an avatar. */
function ReactionBubble({ emoji }: { emoji: string | null }) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (emoji) {
      setCurrent(emoji);
      // small delay so the DOM mount happens before the CSS transition kicks in
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [emoji]);

  const onTransitionEnd = () => {
    if (!visible) setCurrent(null);
  };

  return (
    <div
      className={`select-none transition-all duration-300 ease-out ${
        visible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 -translate-y-2 scale-90"
      }`}
      onTransitionEnd={onTransitionEnd}
    >
      {current && (
        <div
          className="px-3 py-1.5 rounded-2xl bg-white shadow-soft border border-black/5 flex items-center justify-center whitespace-nowrap"
          style={{ lineHeight: 1 }}
        >
          {(() => {
            const url = appleEmojiUrl(current);
            const size = "clamp(28px, 4vh, 44px)";
            return url ? (
              <span
                style={{
                  width: size,
                  height: size,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: `calc(${size} * 0.9)`,
                  lineHeight: 1,
                  fontFamily:
                    '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif',
                }}
              >
                <img
                  src={url}
                  alt={current}
                  draggable={false}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    display: "block",
                  }}
                  onError={(e) => {
                    // Fallback: esconde o <img> quebrado mas mantém o emoji nativo no <span>
                    const img = e.currentTarget as HTMLImageElement;
                    img.style.display = "none";
                    const parent = img.parentElement;
                    if (parent && !parent.textContent) parent.textContent = current;
                  }}
                />
              </span>
            ) : (
              <span style={{ fontSize: size, lineHeight: 1 }}>{current}</span>
            );
          })()}
        </div>
      )}

    </div>
  );
}

function SpeechBubble() {
  return (
    <div
      className="relative mb-1 select-none pointer-events-none animate-in fade-in zoom-in-95 duration-200"
      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.25))" }}
      aria-label="Conversando"
    >
      <div
        className="flex flex-col justify-center gap-[3px] bg-[#efeae0] rounded-[10px] px-2"
        style={{ width: 32, height: 22 }}
      >
        <span className="block h-[2px] rounded-full bg-[#7a7165]" style={{ width: "85%", animation: "speech-line 1.1s ease-in-out infinite" }} />
        <span className="block h-[2px] rounded-full bg-[#7a7165]" style={{ width: "60%", animation: "speech-line 1.1s ease-in-out infinite 0.25s" }} />
      </div>
      <div
        className="absolute left-1/2 -bottom-[3px] w-0 h-0"
        style={{
          transform: "translateX(-60%)",
          borderLeft: "4px solid transparent",
          borderRight: "4px solid transparent",
          borderTop: "5px solid #efeae0",
        }}
      />
      <style>{`@keyframes speech-line { 0%,100% { opacity: 0.45; } 50% { opacity: 1; } }`}</style>
    </div>
  );
}








/** Darkens everything outside the given zone rect within the office stage. */
function ZoneSpotlight({ rect }: { rect: { x1: number; y1: number; x2: number; y2: number } }) {
  const overlay = "rgba(5, 6, 12, 0.20)";
  return (
    <>
      {/* top */}
      <div
        className="absolute left-0 right-0 top-0 pointer-events-none z-50"
        style={{ height: `${rect.y1 * 100}%`, background: overlay, transition: "all 200ms" }}
      />
      {/* bottom */}
      <div
        className="absolute left-0 right-0 bottom-0 pointer-events-none z-50"
        style={{ height: `${(1 - rect.y2) * 100}%`, background: overlay, transition: "all 200ms" }}
      />
      {/* left */}
      <div
        className="absolute left-0 pointer-events-none z-50"
        style={{
          top: `${rect.y1 * 100}%`,
          bottom: `${(1 - rect.y2) * 100}%`,
          width: `${rect.x1 * 100}%`,
          background: overlay,
          transition: "all 200ms",
        }}
      />
      {/* right */}
      <div
        className="absolute right-0 pointer-events-none z-50"
        style={{
          top: `${rect.y1 * 100}%`,
          bottom: `${(1 - rect.y2) * 100}%`,
          width: `${(1 - rect.x2) * 100}%`,
          background: overlay,
          transition: "all 200ms",
        }}
      />
    </>
  );
}

function IconButton({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-md flex items-center justify-center transition ${
        active
          ? "bg-primary text-primary-foreground shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_50%,transparent)]"
          : "text-foreground/75 hover:text-foreground hover:bg-foreground/10"
      }`}
    >
      {children}
    </button>
  );
}

function TeamRow({
  profile,
  zone,
  online,
  isMe,
}: {
  profile: Profile;
  zone?: string;
  online: boolean;
  isMe?: boolean;
}) {
  const zoneLabel = zone ? findZoneById(zone)?.label : undefined;
  return (
    <div
      className={`flex items-center gap-3 px-2.5 py-2 rounded-lg ${
        isMe ? "bg-primary/10" : "hover:bg-muted/60"
      } transition cursor-pointer`}
    >
      <div className="relative shrink-0">
        <ProfileSpriteAvatar spriteId={profile.sprite_id} size={32} offline={!online} />
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${
            online ? "bg-emerald-500" : "bg-muted-foreground/40"
          }`}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {profile.display_name} {isMe && <span className="text-xs text-muted-foreground">(você)</span>}
        </div>
        {online && zoneLabel && (
          <div className="text-[11px] text-muted-foreground truncate">{zoneLabel}</div>
        )}
      </div>
    </div>
  );
}

/** Gather-style hover card showing the occupant + 4 social action icons. */
function OccupantCard({
  profile,
  online,
  isMe,
  onLeaveNote,
  onLeaveDesk,
}: {
  profile: Profile | null;
  online: boolean;
  isMe?: boolean;
  onLeaveNote?: () => void;
  onLeaveDesk?: () => void;
}) {
  const initials = (profile?.display_name ?? "?").charAt(0).toUpperCase();
  return (
    <div
      className="rounded-lg shadow-soft px-2.5 py-2 text-white flex flex-col items-center gap-1.5 min-w-[150px]"
      style={{
        background: "rgba(20, 22, 38, 0.96)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="flex items-center gap-2 w-full">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0"
          style={{ background: profile?.avatar_color ?? "var(--primary)" }}
        >
          {initials}
        </div>
        <div className="leading-tight min-w-0 flex-1">
          <div className="text-xs font-semibold flex items-center gap-1 truncate">
            <span className="truncate">{profile?.display_name ?? "Reservado"}</span>
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${online ? "bg-emerald-400" : "bg-zinc-400"}`}
            />
          </div>
          <div className="text-[9px] opacity-70">
            {isMe ? "você" : online ? "Online" : "Offline"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!isMe && (
          <CardIconBtn
            title="Deixar recadinho"
            onClick={onLeaveNote}
            disabled={!onLeaveNote}
            active
          >
            <StickyNote className="w-3 h-3" />
          </CardIconBtn>
        )}
      </div>
      {isMe && onLeaveDesk && (
        <button
          type="button"
          onClick={onLeaveDesk}
          className="w-full rounded-md px-2 py-1 text-[10px] font-semibold bg-white/10 hover:bg-destructive/80 text-white transition flex items-center justify-center gap-1"
        >
          <LogOut className="w-2.5 h-2.5" />
          Deixar mesa
        </button>
      )}
    </div>
  );
}

function CardIconBtn({
  children,
  title,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`w-7 h-7 rounded-md flex items-center justify-center transition ${
        disabled
          ? "bg-white/5 text-white/30 cursor-not-allowed"
          : active
          ? "bg-primary text-primary-foreground hover:opacity-90"
          : "bg-white/10 text-white/80 hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}

/** Little pixel-art-ish gift box that sits on a desk. */
function GiftSprite({ color, bounce }: { color?: string; bounce?: boolean }) {
  const ribbon = color ?? "var(--primary)";
  return (
    <div
      className={bounce ? "animate-bounce" : ""}
      style={{
        width: "min(4.2vh, 44px)",
        height: "min(4.2vh, 44px)",
        animationDuration: "1.6s",
        filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.4))",
        imageRendering: "pixelated",
      }}
    >
      <svg viewBox="0 0 32 32" width="100%" height="100%" shapeRendering="crispEdges">
        {/* Lid */}
        <rect x="4" y="10" width="24" height="6" fill="#E94B8C" />
        <rect x="4" y="10" width="24" height="2" fill="#FF7AB0" />
        <rect x="4" y="15" width="24" height="1" fill="#A02560" />
        {/* Box body */}
        <rect x="6" y="16" width="20" height="12" fill="#F06AA0" />
        <rect x="6" y="27" width="20" height="1" fill="#A02560" />
        {/* Vertical ribbon */}
        <rect x="14" y="10" width="4" height="18" fill={ribbon} />
        <rect x="14" y="10" width="1" height="18" fill="#FFF" opacity="0.35" />
        {/* Bow */}
        <rect x="11" y="6" width="4" height="4" fill={ribbon} />
        <rect x="17" y="6" width="4" height="4" fill={ribbon} />
        <rect x="14" y="7" width="4" height="3" fill={ribbon} />
        <rect x="15" y="8" width="2" height="2" fill="#FFF" opacity="0.5" />
        {/* Small note sticking out the top */}
        <rect x="20" y="4" width="8" height="6" fill="#FFF7C2" />
        <rect x="20" y="4" width="8" height="1" fill="#E6D98A" />
        <rect x="21" y="6" width="6" height="1" fill="#C9B96A" />
        <rect x="21" y="8" width="4" height="1" fill="#C9B96A" />
      </svg>
    </div>
  );
}

/** Transparent overlay that captures mouse movement + click while placing a note. */
function PlacementLayer({
  placing,
  workspaceZones,
  onMove,
  onCancel,
  onConfirm,
}: {
  placing: { zoneId: string; recipientId: string; body: string };
  workspaceZones: { id: string; rect: { x1: number; y1: number; x2: number; y2: number } }[];
  onMove: (p: { x: number; y: number }) => void;
  onCancel: () => void;
  onConfirm: (p: { x: number; y: number }) => void;
}) {
  const targetRect = workspaceZones.find((wz) => wz.id === placing.zoneId)?.rect ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <>
      <div
        className="absolute inset-0"
        style={{ zIndex: 200000, cursor: "crosshair", background: "rgba(0,0,0,0.18)" }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          const y = (e.clientY - rect.top) / rect.height;
          onMove({ x, y });
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          const y = (e.clientY - rect.top) / rect.height;
          if (!targetRect) return;
          if (!pointInMapZone(loadOverrides(), placing.zoneId, { x, y })) {
            toast.error("Clique sobre a mesa do destinatário.");
            return;
          }
          onConfirm({ x, y });
        }}
      />
      {/* Highlight target zone */}
      {targetRect && (
        <div
          className="absolute pointer-events-none rounded-md"
          style={{
            left: `${targetRect.x1 * 100}%`,
            top: `${targetRect.y1 * 100}%`,
            width: `${(targetRect.x2 - targetRect.x1) * 100}%`,
            height: `${(targetRect.y2 - targetRect.y1) * 100}%`,
            zIndex: 200001,
            outline: "2px dashed color-mix(in oklab, var(--primary) 80%, transparent)",
            background: "color-mix(in oklab, var(--primary) 12%, transparent)",
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.001)",
          }}
        />
      )}
      {/* Cancel pill */}
      <button
        type="button"
        onClick={onCancel}
        className="absolute left-1/2 -translate-x-1/2 bottom-6 z-[200003] flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-white text-foreground shadow-soft hover:bg-white/90"
      >
        <XIcon className="w-4 h-4" /> Cancelar (Esc)
      </button>
    </>
  );
}

function formatRecTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
