/**
 * RTC v2 — Etapa 12: hook React que monta o runtime V2 e o adapta ao
 * contrato público de useLiveKit (RtcMeshState). Só coordena; a lógica está
 * nos módulos RTC v2. Um runtime por (usuário, workspace, sessão, generation).
 */
import {
  loadCameraPreference,
  loadMicPreference,
  reconcileAcquiredMic,
  saveCameraPreference,
  saveMicPreference,
} from "./mic-preference";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RtcConnectionStatus, RtcMeshState } from "./useLiveKit-v1";
import { RtcV2Runtime, createV2RoomFactory, type RtcV2Snapshot } from "./rtc-v2-runtime";
import { mountDeferred } from "./rtc-v2-mount";
import { StreamCache, buildRemoteStreams } from "./rtc-v2-streams";
import {
  createV2CaptureAdapter,
  enumerateV2Devices,
  isV2LocalTrack,
  type DeviceSelection,
} from "./rtc-v2-devices";
import type { RemoteAvatarState } from "./movement-realtime";
import type { PresencePayload } from "./office-presence";
import type { MediaContext } from "./media-context";
import type { RoomManagerStatus } from "./livekit-room-manager";
import type { PrivacyGuardSnapshot } from "./privacy-guard";
import { getRtcOnDemand } from "./rtc-demand-controller";

export interface RtcV2HookConfig {
  workspaceId: string;
  sessionId: string;
  generation: number;
  /** false quando a sessão deixou de ser ACTIVE → runtime é desmontado. */
  active: boolean;
}

/** Canais extras do V2 consumidos pelo OfficeScene (movimento/presença). */
export interface RtcV2Controls {
  context: MediaContext;
  /** Estado mínimo da Room (LiveKitRoomManager) para o meeting tracker. */
  room: { status: RoomManagerStatus; connected: MediaContext | null };
  avatars: ReadonlyMap<string, RemoteAvatarState>;
  online: ReadonlyMap<string, PresencePayload>;
  reportMotion: (x: number, y: number, vx: number, vy: number) => void;
  /** Anuncia o modo de entrada (touch = celular, mouse = desktop) no Presence V2. */
  setSelfInputMode: (mode: "touch" | "mouse") => void;
  setSelfPosition: (x: number, y: number) => void;
  announceJump: (x: number, y: number) => void;
  retry: () => void;
  /** LocalAudioTrack (LiveKit) atual com mic ON, só para o medidor visual. */
  localMicTrack: unknown | null;
  /** Fase 3 — Privacy Guard. */
  privacy: PrivacyGuardSnapshot;
  privacyRestore: () => Promise<void>;
  privacyKeepOff: () => void;
  /** RTC On Demand: sozinho em sala privada, sem LiveKit. */
  awaitingPeer: boolean;
  /** Fase 2: corredor sem ninguém próximo, LiveKit desligado (neutro). */
  lobbyIdle: boolean;
  /** Participantes humanos remotos na Room atual (meeting tracker). */
  remoteCount: number;
  setRecordingActive: (active: boolean) => void;
  /** Sink de telemetria do runtime (camadas isoladas, ex.: Meeting Idle Guard). */
  telemetry: import("./rtc-telemetry-types").RtcTelemetrySink | null;
}

export function mapRoomStatus(
  status: RoomManagerStatus | null,
  context: MediaContext | null,
): RtcConnectionStatus {
  switch (status) {
    case null:
      return "idle";
    case "CONNECTING":
    case "DISCONNECTING":
      return "connecting";
    case "CONNECTED":
      return "connected";
    case "RECONNECTING":
      return "reconnecting";
    case "ERROR":
      return "error";
    case "DISCONNECTED":
      return !context || context.kind === "OFFLINE" ? "idle" : "connecting";
  }
}

const MEDIA_ERROR_NAME: Record<string, string> = {
  permission_denied: "NotAllowedError",
  device_not_found: "NotFoundError",
  device_busy: "NotReadableError",
};

function mediaError(code: string | null): Error {
  const e = new Error(code ?? "media_error");
  e.name = MEDIA_ERROR_NAME[code ?? ""] ?? "Error";
  return e;
}

/**
 * Identidade do runtime: muda (→ dispose + novo runtime) em troca de usuário,
 * workspace, sessão ou generation; null quando a sessão não está ACTIVE
 * (takeover/logout) → runtime desmontado.
 */
export function runtimeKey(
  myId: string | null,
  cfg: RtcV2HookConfig | null | undefined,
): string | null {
  return myId && cfg?.active && cfg.workspaceId && cfg.sessionId
    ? `${myId}|${cfg.workspaceId}|${cfg.sessionId}|${cfg.generation}`
    : null;
}

const noopSubscribe = () => () => {};
const nullSnapshot = () => null;
const makeStream = (tracks: MediaStreamTrack[]) => new MediaStream(tracks);

export function useLiveKitV2(
  myId: string | null,
  _legacyRoomKey: string | null,
  _legacyVisibleIds?: ReadonlySet<string> | null,
  v2Config?: RtcV2HookConfig | null,
): RtcMeshState & { v2: RtcV2Controls | null } {
  const [runtime, setRuntime] = useState<RtcV2Runtime | null>(null);
  const runtimeRef = useRef<RtcV2Runtime | null>(null);
  runtimeRef.current = runtime;

  // ---------- dispositivos (não pedem permissão) ----------
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selection, setSelection] = useState<DeviceSelection & { audioOutput: string | null }>({
    audioInput: null,
    videoInput: null,
    audioOutput: null,
  });
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Último mic escolhido neste navegador (só o deviceId; mic continua OFF no login).
  useEffect(() => {
    if (!myId) return;
    const mic = loadMicPreference(myId);
    const cam = loadCameraPreference(myId);
    const cur = selectionRef.current;
    const next = {
      ...cur,
      audioInput: cur.audioInput ?? mic,
      videoInput: cur.videoInput ?? cam,
    };
    if (next.audioInput === cur.audioInput && next.videoInput === cur.videoInput) return;
    selectionRef.current = next;
    setSelection((s) => ({ ...s, audioInput: s.audioInput ?? mic, videoInput: s.videoInput ?? cam }));
  }, [myId]);

  const refreshDevices = useCallback(async () => {
    const d = await enumerateV2Devices();
    setVideoDevices(d.video);
    setAudioInputDevices(d.audioInput);
    setAudioOutputDevices(d.audioOutput);
  }, []);

  useEffect(() => {
    void refreshDevices();
    const h = () => void refreshDevices();
    try {
      navigator.mediaDevices?.addEventListener?.("devicechange", h);
    } catch {
      /* noop */
    }
    return () => {
      try {
        navigator.mediaDevices?.removeEventListener?.("devicechange", h);
      } catch {
        /* noop */
      }
    };
  }, [refreshDevices]);

  // ---------- montagem do runtime ----------
  const key = runtimeKey(myId, v2Config);
  const cfgRef = useRef(v2Config);
  cfgRef.current = v2Config;

  useEffect(() => {
    if (!key || !myId || !cfgRef.current) {
      setRuntime(null);
      return;
    }
    const cfg = cfgRef.current;
    const cancel = mountDeferred(
      async () => {
        const [{ supabase }, tokenMod, movementMod, presenceMod, telemetryMod, mapMod, factory] =
          await Promise.all([
            import("@/integrations/supabase/client"),
            import("./livekit-token-v2.functions"),
            import("./movement-realtime"),
            import("./office-presence"),
            import("./rtc-telemetry"),
            import("@/lib/map-overrides"),
            createV2RoomFactory(),
          ]);
        const rt = new RtcV2Runtime(
          {
            userId: myId,
            workspaceId: cfg.workspaceId,
            sessionId: cfg.sessionId,
            generation: cfg.generation,
          },
          {
            fetchToken: (req) => tokenMod.getLiveKitTokenV2({ data: req }),
            roomFactory: factory,
            capture: withMicPreference(
              createV2CaptureAdapter(() => selectionRef.current),
              (acquired) => {
                const eff = reconcileAcquiredMic(myId, selectionRef.current.audioInput, acquired);
                if (eff && eff !== selectionRef.current.audioInput) {
                  selectionRef.current = { ...selectionRef.current, audioInput: eff };
                  setSelection((s) => ({ ...s, audioInput: eff }));
                }
              },
            ),
            movementTransport: movementMod.createSupabaseMovementTransport(
              supabase,
              cfg.workspaceId,
            ),
            presenceTransport: presenceMod.createSupabasePresenceTransport(
              supabase,
              cfg.workspaceId,
              myId,
            ),
            telemetryAdapter: telemetryMod.createSupabaseTelemetryAdapter(supabase),
            refreshMap: () => void mapMod.getMapSync().load(),
            onDemandMode: getRtcOnDemand(),
          },
        );
        const sync = mapMod.getMapSync();
        rt.setMap(sync.snapshot());
        if (sync.snapshot().state !== "READY") void sync.load();
        return rt;
      },
      (rt) => setRuntime(rt),
    );
    return () => {
      cancel();
      setRuntime(null);
    };
  }, [key, myId]);

  // Mapa canônico → runtime (mesmo MapSyncController do Office; sem canal extra).
  useEffect(() => {
    if (!runtime) return;
    let alive = true;
    const push = () => {
      void import("@/lib/map-overrides").then((m) => {
        if (alive) runtime.setMap(m.getMapSync().snapshot());
      });
    };
    push();
    window.addEventListener("map-overrides-changed", push);
    return () => {
      alive = false;
      window.removeEventListener("map-overrides-changed", push);
    };
  }, [runtime]);

  // Fase 3: visibilidade da página → Privacy Guard (sem window.blur).
  useEffect(() => {
    if (!runtime) return;
    const h = () => runtime.privacy.setVisibility(document.visibilityState === "hidden");
    h();
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, [runtime]);
  const privacySnap = useSyncExternalStore(
    runtime?.privacy.subscribe ?? noopSubscribe,
    runtime?.privacy.getSnapshot ?? nullSnapshot,
    nullSnapshot,
  );

  const snap: RtcV2Snapshot | null = useSyncExternalStore(
    runtime?.subscribe ?? noopSubscribe,
    runtime?.getSnapshot ?? nullSnapshot,
    nullSnapshot,
  );

  // ---------- streams ----------
  const avCache = useMemo(() => new StreamCache(makeStream), [runtime]);
  const screenCache = useMemo(() => new StreamCache(makeStream), [runtime]);
  const localCache = useMemo(() => new StreamCache(makeStream), [runtime]);

  const { remoteStreams, remoteScreenStreams } = useMemo(() => {
    if (!snap) return { remoteStreams: {}, remoteScreenStreams: {} };
    return buildRemoteStreams(snap.remote, new Set(snap.mediaPeers), avCache, screenCache);
  }, [snap?.remote, snap?.mediaPeers, avCache, screenCache]); // eslint-disable-line react-hooks/exhaustive-deps

  const connectedPeers = useMemo(() => snap?.mediaPeers ?? [], [snap?.mediaPeers]);

  const camTrack = snap?.local.camera.status === "on" ? runtime?.local.getTrack("camera") : null;
  const screenTrack =
    snap?.local.screenShare.status === "on" ? runtime?.local.getTrack("screen_share") : null;
  const localVideoStream = isV2LocalTrack(camTrack)
    ? localCache.get("cam", [camTrack.mediaStreamTrack])
    : null;
  const localScreenStream = isV2LocalTrack(screenTrack)
    ? localCache.get("screen", [screenTrack.mediaStreamTrack])
    : null;

  // ---------- ações ----------
  const toggleMic = useCallback(async () => {
    const rt = runtimeRef.current;
    if (!rt) return;
    await rt.toggleMic();
    const m = rt.local.getSnapshot().microphone;
    if (m.status === "error") throw mediaError(m.error);
  }, []);
  const toggleCam = useCallback(async () => {
    const rt = runtimeRef.current;
    if (!rt) return;
    await rt.toggleCam();
    const c = rt.local.getSnapshot().camera;
    if (c.status === "error") throw mediaError(c.error);
  }, []);
  const toggleScreen = useCallback(async () => {
    const rt = runtimeRef.current;
    if (!rt) return;
    await rt.toggleScreen();
    const s = rt.local.getSnapshot().screenShare;
    if (s.status === "error") throw mediaError(s.error);
  }, []);

  // Troca de dispositivo com captura ativa = recaptura explícita no novo device.
  const setVideoDevice = useCallback(async (deviceId: string) => {
    setSelection((s) => ({ ...s, videoInput: deviceId }));
    selectionRef.current = { ...selectionRef.current, videoInput: deviceId };
    if (myId) saveCameraPreference(myId, deviceId);
    const rt = runtimeRef.current;
    if (rt && rt.local.getSnapshot().camera.intent) {
      await rt.local.setCameraEnabled(false);
      await rt.local.setCameraEnabled(true);
    }
  }, [myId]);
  const setAudioInputDevice = useCallback(async (deviceId: string) => {
    runtimeRef.current?.audioDiag.noteDeviceChange(selectionRef.current.audioInput, deviceId);
    setSelection((s) => ({ ...s, audioInput: deviceId }));
    selectionRef.current = { ...selectionRef.current, audioInput: deviceId };
    const rt = runtimeRef.current;
    // Etapa 14B: troca a fonte na MESMA track/publicação (sem OFF/ON).
    if (rt) await rt.local.setMicrophoneDevice(deviceId);
    if (myId) saveMicPreference(myId, deviceId);
  }, [myId]);
  const setAudioOutputDevice = useCallback(async (deviceId: string) => {
    setSelection((s) => ({ ...s, audioOutput: deviceId }));
    try {
      await runtimeRef.current?.currentRoom()?.setAudioOutput?.(deviceId);
    } catch {
      /* noop */
    }
  }, []);

  // Igual ao v1: só roda quando a UI chama (gesto do usuário).
  const prewarmMic = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      void refreshDevices();
    } catch {
      /* noop */
    }
  }, [refreshDevices]);

  const getLocalAudioTrack = useCallback((): MediaStreamTrack | null => {
    const rt = runtimeRef.current;
    if (!rt || rt.local.getSnapshot().microphone.status !== "on") return null;
    const t = rt.local.getTrack("microphone");
    return isV2LocalTrack(t) ? t.mediaStreamTrack : null;
  }, []);

  const v2: RtcV2Controls | null = useMemo(() => {
    if (!runtime || !snap) return null;
    return {
      context: snap.context,
      room: snap.room,
      avatars: snap.avatars,
      online: snap.online,
      reportMotion: (x, y, vx, vy) => runtime.reportMotion(x, y, vx, vy),
      setSelfInputMode: (mode) => runtime.presence.setInputMode(mode),
      setSelfPosition: (x, y) => runtime.setSelfPosition(x, y),
      announceJump: (x, y) => runtime.announceJump(x, y),
      retry: () => runtime.retry(),
      localMicTrack:
        snap.local.microphone.status === "on"
          ? ((runtime.local.getTrack("microphone") as { lk?: unknown } | null)?.lk ?? null)
          : null,
      privacy: privacySnap ?? { suspended: false, promptVisible: false, saved: null },
      privacyRestore: () => runtime.privacy.restore(),
      privacyKeepOff: () => runtime.privacy.keepOff(),
      awaitingPeer: snap.awaitingPeer,
      lobbyIdle: snap.lobbyIdle,
      remoteCount: snap.remote.participants.length,
      setRecordingActive: (a) => runtime.setRecordingActive(a),
      telemetry: runtime.telemetry,
    };
  }, [runtime, snap, privacySnap]);

  const connectionStatus = mapRoomStatus(snap?.roomStatus ?? null, snap?.context ?? null);

  return useMemo(
    () => ({
      // Captura suspensa (On Demand) mantém a intenção visível ao usuário.
      micOn:
        snap?.local.microphone.status === "on" ||
        (!!snap?.local.captureSuspended && snap.local.microphone.intent),
      camOn:
        snap?.local.camera.status === "on" ||
        (!!snap?.local.captureSuspended && snap.local.camera.intent),
      screenOn: snap?.local.screenShare.status === "on",
      toggleMic,
      toggleCam,
      toggleScreen,
      remoteStreams,
      remoteScreenStreams,
      connectedPeers,
      speakingPeers: snap?.speaking ?? {},
      selfSpeaking: snap?.selfSpeaking ?? false,
      localVideoStream,
      localScreenStream,
      videoDevices,
      selectedVideoDeviceId: selection.videoInput,
      setVideoDevice,
      audioInputDevices,
      selectedAudioInputDeviceId: selection.audioInput,
      setAudioInputDevice,
      audioOutputDevices,
      selectedAudioOutputDeviceId: selection.audioOutput,
      setAudioOutputDevice,
      prewarmMic,
      getLocalAudioTrack,
      connectionStatus,
      lastError: snap?.error ?? null,
      roomKey: snap?.roomName ?? null,
      v2,
    }),
    [
      snap,
      toggleMic,
      toggleCam,
      toggleScreen,
      remoteStreams,
      remoteScreenStreams,
      connectedPeers,
      localVideoStream,
      localScreenStream,
      videoDevices,
      audioInputDevices,
      audioOutputDevices,
      selection,
      setVideoDevice,
      setAudioInputDevice,
      setAudioOutputDevice,
      prewarmMic,
      getLocalAudioTrack,
      connectionStatus,
      v2,
    ],
  );
}

/** Após cada captura de mic bem-sucedida, informa o deviceId que realmente funcionou. */
function withMicPreference(
  base: ReturnType<typeof createV2CaptureAdapter>,
  onAcquired: (deviceId: string | null) => void,
): ReturnType<typeof createV2CaptureAdapter> {
  return {
    ...base,
    async createMicrophoneTrack() {
      const t = await base.createMicrophoneTrack();
      try {
        const mst = (t as { mediaStreamTrack?: MediaStreamTrack }).mediaStreamTrack;
        onAcquired(mst?.getSettings?.().deviceId ?? null);
      } catch {
        /* preferência nunca quebra a captura */
      }
      return t;
    },
  };
}
