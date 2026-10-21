import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getIceServers, type IceServer } from "@/lib/rtc/ice.functions";
import { getCurrentWorkspaceId } from "@/lib/workspace/current";

type SignalType = "offer" | "answer" | "ice" | "bye" | "hello" | "renegotiate";
type SignalMsg = {
  from: string;
  to: string;
  sessionId?: string;
  targetSessionId?: string;
  type: SignalType;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
};

type PeerEntry = {
  pc: RTCPeerConnection;
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  screenTransceiver: RTCRtpTransceiver | null;
  screenSender: RTCRtpSender | null;
  makingOffer: boolean;
  isOfferer: boolean;
  pendingIce: RTCIceCandidateInit[];
  remoteStream: MediaStream;
  remoteScreenStream: MediaStream;
};

const DEFAULT_ICE_SERVERS: IceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

const SIGNAL_CHANNEL = "rtc-mesh-v1";

export type RtcMeshState = {
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  remoteStreams: Record<string, MediaStream>;
  remoteScreenStreams: Record<string, MediaStream>;
  connectedPeers: string[];
  speakingPeers: Record<string, boolean>;
  selfSpeaking: boolean;
  localVideoStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  videoDevices: MediaDeviceInfo[];
  selectedVideoDeviceId: string | null;
  setVideoDevice: (deviceId: string) => Promise<void>;
  audioInputDevices: MediaDeviceInfo[];
  selectedAudioInputDeviceId: string | null;
  setAudioInputDevice: (deviceId: string) => Promise<void>;
  audioOutputDevices: MediaDeviceInfo[];
  selectedAudioOutputDeviceId: string | null;
  setAudioOutputDevice: (deviceId: string) => Promise<void>;
  prewarmMic: () => Promise<void>;
  getLocalAudioTrack: () => MediaStreamTrack | null;
};

// Apply codec preferences so the SDP offers Opus first (with DTX/FEC) for
// audio and VP8 first for video — best cross-browser stability for a mesh.
function preferCodecs(tx: RTCRtpTransceiver, kind: "audio" | "video") {
  try {
    type Caps = { codecs: { mimeType: string }[] } | null;
    type GetCapabilities = (k: string) => Caps;
    const getCaps = (RTCRtpSender as unknown as { getCapabilities?: GetCapabilities })
      .getCapabilities;
    if (!getCaps) return;
    const caps = getCaps(kind);
    if (!caps?.codecs?.length) return;
    const want = kind === "audio" ? "audio/opus" : "video/VP8";
    const preferred = caps.codecs.filter((c) => c.mimeType.toLowerCase() === want.toLowerCase());
    const others = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== want.toLowerCase());
    if (!preferred.length) return;
    type Codec = { mimeType: string };
    const setPrefs = (tx as unknown as { setCodecPreferences?: (cs: Codec[]) => void })
      .setCodecPreferences;
    setPrefs?.([...preferred, ...others] as Codec[]);
  } catch {
    /* noop */
  }
}

export function useRtcMesh(myId: string | null, desiredPeers: string[]): RtcMeshState {
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Record<string, MediaStream>>({});
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [speakingPeers, setSpeakingPeers] = useState<Record<string, boolean>>({});
  const [selfSpeaking, setSelfSpeaking] = useState(false);

  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string | null>(null);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState<string | null>(null);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceId] = useState<string | null>(
    null,
  );

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const channelReadyRef = useRef(false);
  const pendingSignalsRef = useRef<Omit<SignalMsg, "from" | "sessionId" | "targetSessionId">[]>([]);
  const localSessionIdRef = useRef(`${Date.now()}:${Math.random().toString(36).slice(2)}`);
  const remoteSessionsRef = useRef<Map<string, string>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const desiredRef = useRef<Set<string>>(new Set());
  const disconnectTimersRef = useRef<Map<string, number>>(new Map());
  const iceServersRef = useRef<IceServer[]>(DEFAULT_ICE_SERVERS);

  // Load TURN credentials once on mount (from server fn).
  useEffect(() => {
    let cancelled = false;
    const workspaceId = getCurrentWorkspaceId();
    if (!workspaceId) return;
    void getIceServers({ data: { workspaceId } })
      .then((servers) => {
        if (!cancelled && Array.isArray(servers) && servers.length) {
          iceServersRef.current = servers;
        }
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sendSignal = useCallback(
    (msg: Omit<SignalMsg, "from" | "sessionId" | "targetSessionId">) => {
      const ch = channelRef.current;
      if (!ch || !myId) {
        pendingSignalsRef.current.push(msg);
        return;
      }
      if (!channelReadyRef.current) {
        pendingSignalsRef.current.push(msg);
        return;
      }
      void ch.send({
        type: "broadcast",
        event: "rtc",
        payload: {
          ...msg,
          from: myId,
          sessionId: localSessionIdRef.current,
          targetSessionId: remoteSessionsRef.current.get(msg.to),
        },
      });
    },
    [myId],
  );

  const flushSignals = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !myId || !channelReadyRef.current) return;
    const pending = pendingSignalsRef.current.splice(0);
    for (const msg of pending) {
      void ch.send({
        type: "broadcast",
        event: "rtc",
        payload: {
          ...msg,
          from: myId,
          sessionId: localSessionIdRef.current,
          targetSessionId: remoteSessionsRef.current.get(msg.to),
        },
      });
    }
  }, [myId]);

  // Create a PC for a peer
  const createPeer = useCallback(
    (peerId: string, initiator: boolean) => {
      if (!myId) return null;
      if (peersRef.current.has(peerId)) return peersRef.current.get(peerId)!;

      const pc = new RTCPeerConnection({
        iceServers: iceServersRef.current as RTCIceServer[],
        iceTransportPolicy: "all",
      });
      const remoteStream = new MediaStream();
      const remoteScreenStream = new MediaStream();

      // Always add transceivers so we can both send/recv without renegotiation later
      const audioTx = pc.addTransceiver("audio", { direction: "sendrecv" });
      const videoTx = pc.addTransceiver("video", { direction: "sendrecv" });
      const screenTx = pc.addTransceiver("video", { direction: "sendrecv" });

      // Prefer Opus / VP8 for cross-browser stability.
      preferCodecs(audioTx, "audio");
      preferCodecs(videoTx, "video");
      preferCodecs(screenTx, "video");

      // Reduce playout latency where supported (Chromium).
      // playoutDelayHint baixa = menos buffer no receptor → menos delay.
      // jitterBufferTarget=0 pede ao buffer pra ficar o mais raso possível.
      try {
        const ar = audioTx.receiver as unknown as {
          playoutDelayHint?: number;
          jitterBufferTarget?: number;
        };
        ar.playoutDelayHint = 0;
        ar.jitterBufferTarget = 0;
      } catch {
        /* noop */
      }
      try {
        const vr = videoTx.receiver as unknown as {
          playoutDelayHint?: number;
          jitterBufferTarget?: number;
        };
        vr.playoutDelayHint = 0;
        vr.jitterBufferTarget = 0;
      } catch {
        /* noop */
      }
      // Screen share pode tolerar um pouco mais de buffer (qualidade > latência),
      // então deixamos o default do navegador.

      // Hint de prioridade de rede pra que mídia tenha precedência no socket.
      const bumpPriority = (sender: RTCRtpSender, isVideo: boolean) => {
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
          for (const enc of params.encodings) {
            (
              enc as RTCRtpEncodingParameters & { priority?: string; networkPriority?: string }
            ).priority = "high";
            (
              enc as RTCRtpEncodingParameters & { priority?: string; networkPriority?: string }
            ).networkPriority = "high";
            if (isVideo) {
              enc.maxBitrate = 800_000; // 800 kbps — suficiente pra 320x240 fluido
              enc.maxFramerate = 30;
            } else {
              enc.maxBitrate = 64_000; // Opus voice
            }
          }
          void sender.setParameters(params);
        } catch {
          /* noop */
        }
      };
      bumpPriority(audioTx.sender, false);
      bumpPriority(videoTx.sender, true);

      // If we already have local tracks, attach now
      if (audioTrackRef.current) void audioTx.sender.replaceTrack(audioTrackRef.current);
      if (videoTrackRef.current) void videoTx.sender.replaceTrack(videoTrackRef.current);
      if (screenTrackRef.current) void screenTx.sender.replaceTrack(screenTrackRef.current);

      const entry: PeerEntry = {
        pc,
        audioSender: audioTx.sender,
        videoSender: videoTx.sender,
        screenTransceiver: screenTx,
        screenSender: screenTx.sender,
        makingOffer: false,
        isOfferer: initiator,
        pendingIce: [],
        remoteStream,
        remoteScreenStream,
      };

      pc.onicecandidate = (e) => {
        sendSignal({
          to: peerId,
          type: "ice",
          candidate: e.candidate ? e.candidate.toJSON() : null,
        });
      };

      // Identifica se um transceiver é o de SCREEN (2ª trilha de vídeo do PC).
      // Por convenção fixa, criamos sempre na ordem: audio, cam-video, screen-video.
      // Identificar por POSIÇÃO entre os transceivers de vídeo do PC funciona
      // simetricamente no offerer (refs locais) e no answerer (refs criados pelo
      // setRemoteDescription a partir das m-lines remotas), enquanto a comparação
      // por referência (`e.transceiver === entry.screenTransceiver`) falha no
      // answerer porque os transceivers efetivos podem não ser os pré-criados.
      const isScreenTransceiver = (tx: RTCRtpTransceiver) => {
        const videoTxs = pc
          .getTransceivers()
          .filter((t) => t.receiver.track?.kind === "video" || t.sender.track?.kind === "video");
        // Fallback: se nem 2 transceivers de vídeo existem ainda, considera cam.
        if (videoTxs.length < 2) return false;
        return tx === videoTxs[1];
      };

      pc.ontrack = (e) => {
        const isScreen = e.track.kind === "video" && isScreenTransceiver(e.transceiver);
        const target = isScreen ? remoteScreenStream : remoteStream;
        if (!target.getTracks().find((rt) => rt.id === e.track.id)) target.addTrack(e.track);
        if (isScreen) {
          setRemoteScreenStreams((prev) => ({ ...prev, [peerId]: remoteScreenStream }));
          e.track.onunmute = () => {
            setRemoteScreenStreams((prev) => ({ ...prev, [peerId]: remoteScreenStream }));
          };
          e.track.onmute = () => {
            /* viewer filtra por readyState */
          };
          e.track.onended = () => {
            try {
              target.removeTrack(e.track);
            } catch {
              /* noop */
            }
            setRemoteScreenStreams((prev) => {
              if (target.getVideoTracks().length === 0) {
                const next = { ...prev };
                delete next[peerId];
                return next;
              }
              return { ...prev, [peerId]: target };
            });
          };
        } else {
          setRemoteStreams((prev) => ({ ...prev, [peerId]: remoteStream }));
          // Forçamos re-render trocando a referência do MediaStream nos eventos
          // muted/unmuted pra que <video>/<audio> reavaliem hasLiveVideo.
          const bump = () => {
            setRemoteStreams((prev) => ({
              ...prev,
              [peerId]: new MediaStream(remoteStream.getTracks()),
            }));
          };
          e.track.onunmute = bump;
          e.track.onmute = bump;
          e.track.onended = () => {
            try {
              remoteStream.removeTrack(e.track);
            } catch {
              /* noop */
            }
            bump();
          };
        }
      };

      // ICE restart watchdog: keep media alive across transient network blips.
      // We DO NOT destroy the PC — restartIce() renegotiates without touching the
      // attached local tracks, so the user's camera/mic LED stays on.
      let iceRestartTimer: number | null = null;
      const scheduleIceRestart = (delay: number) => {
        if (iceRestartTimer != null) return;
        iceRestartTimer = window.setTimeout(() => {
          iceRestartTimer = null;
          if (pc.connectionState === "closed") return;
          if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed")
            return;
          if (!entry.isOfferer) return; // the offerer drives the restart
          try {
            pc.restartIce();
          } catch {
            /* noop */
          }
        }, delay);
      };
      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        if (st === "failed") scheduleIceRestart(0);
        else if (st === "disconnected") scheduleIceRestart(5000);
        else if (st === "connected" || st === "completed") {
          if (iceRestartTimer != null) {
            window.clearTimeout(iceRestartTimer);
            iceRestartTimer = null;
          }
        }
      };

      let zombieTimer: number | null = null;
      const scheduleZombieKill = (delay: number) => {
        if (zombieTimer != null) return;
        zombieTimer = window.setTimeout(() => {
          zombieTimer = null;
          const st = pc.connectionState;
          if (st === "failed" || st === "disconnected" || st === "closed") {
            // Só mata se ainda for desejado — o reconcile vai recriar limpo.
            if (desiredRef.current.has(peerId)) {
              destroyPeer(peerId);
            }
          }
        }, delay);
      };
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === "connected") {
          if (zombieTimer != null) {
            window.clearTimeout(zombieTimer);
            zombieTimer = null;
          }
          setConnectedPeers((prev) => (prev.includes(peerId) ? prev : [...prev, peerId]));
        } else if (st === "failed") {
          setConnectedPeers((prev) => prev.filter((p) => p !== peerId));
          scheduleZombieKill(0);
        } else if (st === "disconnected") {
          setConnectedPeers((prev) => prev.filter((p) => p !== peerId));
          scheduleZombieKill(8000);
        } else if (st === "closed") {
          setConnectedPeers((prev) => prev.filter((p) => p !== peerId));
        }
      };

      pc.onnegotiationneeded = async () => {
        if (!entry.isOfferer || pc.signalingState !== "stable") return;
        try {
          entry.makingOffer = true;
          const offer = await pc.createOffer();
          if (pc.signalingState !== "stable") return;
          await pc.setLocalDescription(offer);
          sendSignal({ to: peerId, type: "offer", sdp: pc.localDescription! });
        } catch (err) {
          console.error("negotiationneeded failed", err);
        } finally {
          entry.makingOffer = false;
        }
      };

      peersRef.current.set(peerId, entry);

      // If we're the initiator, kick off offer immediately
      if (initiator) {
        // negotiationneeded will fire from the transceivers; nothing more to do
      }
      return entry;
    },
    [myId, sendSignal],
  );

  const destroyPeer = useCallback((peerId: string) => {
    const pending = disconnectTimersRef.current.get(peerId);
    if (pending) {
      window.clearTimeout(pending);
      disconnectTimersRef.current.delete(peerId);
    }
    const entry = peersRef.current.get(peerId);
    if (!entry) return;
    try {
      entry.pc.close();
    } catch {
      /* noop */
    }
    peersRef.current.delete(peerId);
    remoteSessionsRef.current.delete(peerId);
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setRemoteScreenStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setConnectedPeers((prev) => prev.filter((p) => p !== peerId));
    setSpeakingPeers((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  // Handle incoming signaling
  const handleSignal = useCallback(
    async (msg: SignalMsg) => {
      if (!myId || msg.to !== myId || msg.from === myId) return;
      if (msg.targetSessionId && msg.targetSessionId !== localSessionIdRef.current) return;
      const peerId = msg.from;
      const knownSessionId = remoteSessionsRef.current.get(peerId);
      const sessionChanged =
        !!msg.sessionId && !!knownSessionId && msg.sessionId !== knownSessionId;
      if (sessionChanged) destroyPeer(peerId);
      if (msg.sessionId) remoteSessionsRef.current.set(peerId, msg.sessionId);

      if (msg.type === "bye") {
        destroyPeer(peerId);
        return;
      }

      if (msg.type === "hello") {
        // Other side announces presence; if we should connect and our id wins, create offer
        if (desiredRef.current.has(peerId) && myId > peerId) {
          createPeer(peerId, true);
        }
        return;
      }

      // NÃO rejeitamos sinalização de quem ainda não está em `desired`. O roster
      // de presença é eventualmente consistente; recusar aqui criava PCs zumbis
      // num lado e nenhum no outro (bug do "Tracy entra mas não conecta").
      // Se o peer realmente não pertence à sala, o loop de reconcile vai fechar
      // a PC abaixo com um `bye` programado — sem corrida.

      if (msg.type === "renegotiate") {
        // The other side asked us to renegotiate (because they changed a track
        // and they are not the offerer). Only act if we are the offerer.
        const e = peersRef.current.get(peerId);
        if (!e || !e.isOfferer) return;
        if (e.pc.signalingState !== "stable") return;
        try {
          e.makingOffer = true;
          const offer = await e.pc.createOffer();
          if (e.pc.signalingState !== "stable") return;
          await e.pc.setLocalDescription(offer);
          sendSignal({ to: peerId, type: "offer", sdp: e.pc.localDescription! });
        } catch (err) {
          console.error("renegotiate failed", err);
        } finally {
          e.makingOffer = false;
        }
        return;
      }

      // Make sure peer exists for incoming offer/answer/ice
      let entry = peersRef.current.get(peerId);
      if (!entry) {
        if (msg.type === "offer") {
          entry = createPeer(peerId, false) ?? undefined;
        } else {
          return; // ignore stray ice/answer
        }
      }
      if (!entry) return;
      const pc = entry.pc;

      try {
        if (msg.type === "offer" && msg.sdp) {
          if (entry.isOfferer || pc.signalingState !== "stable") {
            destroyPeer(peerId);
            const fresh = createPeer(peerId, false);
            if (!fresh) return;
            entry = fresh;
          }
          await entry.pc.setRemoteDescription(msg.sdp);
          for (const candidate of entry.pendingIce.splice(0)) {
            try {
              await entry.pc.addIceCandidate(candidate);
            } catch {
              /* noop */
            }
          }
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          sendSignal({ to: peerId, type: "answer", sdp: entry.pc.localDescription! });
        } else if (msg.type === "answer" && msg.sdp) {
          if (entry.isOfferer && pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(msg.sdp);
            for (const candidate of entry.pendingIce.splice(0)) {
              try {
                await pc.addIceCandidate(candidate);
              } catch {
                /* noop */
              }
            }
          }
        } else if (msg.type === "ice") {
          try {
            if (msg.candidate) {
              if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate);
              else entry.pendingIce.push(msg.candidate);
            }
          } catch (err) {
            console.warn("addIceCandidate failed", err);
          }
        }
      } catch (err) {
        console.error("signal handle error", err);
      }
    },
    [myId, createPeer, destroyPeer, sendSignal],
  );

  // Subscribe to signaling channel
  useEffect(() => {
    if (!myId) return;
    const ch = supabase.channel(SIGNAL_CHANNEL, { config: { broadcast: { self: false } } });
    channelRef.current = ch;
    ch.on("broadcast", { event: "rtc" }, (payload) => {
      const msg = payload.payload as SignalMsg;
      void handleSignal(msg);
    });
    void ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channelReadyRef.current = true;
        flushSignals();
        // announce ourselves to currently desired peers
        for (const p of desiredRef.current) {
          sendSignal({ to: p, type: "hello" });
        }
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        channelReadyRef.current = false;
      }
    });
    return () => {
      // bye to all peers
      for (const peerId of Array.from(peersRef.current.keys())) {
        sendSignal({ to: peerId, type: "bye" });
        destroyPeer(peerId);
      }
      channelReadyRef.current = false;
      pendingSignalsRef.current = [];
      for (const timer of disconnectTimersRef.current.values()) window.clearTimeout(timer);
      disconnectTimersRef.current.clear();
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, flushSignals, sendSignal]);

  // Reconcile desired peers
  useEffect(() => {
    desiredRef.current = new Set(desiredPeers);
    if (!myId) return;

    // Connect to new peers
    for (const peerId of desiredPeers) {
      if (peerId === myId) continue;
      const pending = disconnectTimersRef.current.get(peerId);
      if (pending) {
        window.clearTimeout(pending);
        disconnectTimersRef.current.delete(peerId);
      }
      const existing = peersRef.current.get(peerId);
      if (existing) {
        const st = existing.pc.connectionState;
        if (st === "failed" || st === "closed") {
          destroyPeer(peerId);
        } else {
          continue;
        }
      }
      // Send hello — and if our id wins, create offer immediately
      sendSignal({ to: peerId, type: "hello" });
      if (myId > peerId) createPeer(peerId, true);
    }

    // Disconnect from peers no longer desired
    for (const peerId of Array.from(peersRef.current.keys())) {
      if (!desiredPeers.includes(peerId)) {
        if (disconnectTimersRef.current.has(peerId)) continue;
        const timer = window.setTimeout(() => {
          disconnectTimersRef.current.delete(peerId);
          if (!desiredRef.current.has(peerId)) {
            sendSignal({ to: peerId, type: "bye" });
            destroyPeer(peerId);
          }
        }, 1200);
        disconnectTimersRef.current.set(peerId, timer);
      }
    }
  }, [desiredPeers, myId, createPeer, destroyPeer, sendSignal]);

  // Keep announcing presence while a nearby/in-room peer is desired. This
  // recovers from missed first offers when either browser joins a few seconds late.
  useEffect(() => {
    if (!myId) return;
    const timer = window.setInterval(() => {
      for (const peerId of desiredRef.current) {
        if (peerId === myId) continue;
        sendSignal({ to: peerId, type: "hello" });
        const entry = peersRef.current.get(peerId);
        // Entry "zumbi" (failed/closed/disconnected) → destrói pra liberar
        // a recriação abaixo. Sem isso, o offerer ficava preso a uma PC morta
        // e nunca tentava de novo (causa do "Tracy não conecta após sair/voltar").
        if (entry) {
          const st = entry.pc.connectionState;
          if (st === "failed" || st === "closed") {
            destroyPeer(peerId);
          } else {
            continue;
          }
        }
        if (myId > peerId) createPeer(peerId, true);
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [myId, createPeer, destroyPeer, sendSignal]);

  // Speaking detection (analyse remote audio levels — RMS time-domain + EMA).
  // Time-domain RMS é mais estável que frequência média (que oscila bastante
  // com sons consonantais), e o EMA elimina o piscar entre "fala/silêncio".
  useEffect(() => {
    const ctxRef: { ctx?: AudioContext } = {};
    const analysers: { peerId: string; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> }[] =
      [];
    try {
      ctxRef.ctx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )();
    } catch {
      /* noop */
    }

    Object.entries(remoteStreams).forEach(([peerId, stream]) => {
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length || !ctxRef.ctx) return;
      try {
        const src = ctxRef.ctx.createMediaStreamSource(new MediaStream([audioTracks[0]]));
        const analyser = ctxRef.ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.2;
        src.connect(analyser);
        analysers.push({
          peerId,
          analyser,
          data: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
        });
      } catch {
        /* noop */
      }
    });

    if (!analysers.length) return;
    let raf = 0;
    // Thresholds em RMS normalizado [0..1]:
    //  - SPEAK_ON ~0.03 (~-30dBFS) cobre voz baixa sem disparar com ruído
    //  - SPEAK_OFF ~0.012 (~-38dBFS) — janela de histerese ampla
    //  - ON/OFF_HOLD evitam pisca-pisca; OFF maior pra suavizar pausas naturais
    const SPEAK_ON = 0.03;
    const SPEAK_OFF = 0.012;
    const ON_HOLD_MS = 120;
    const OFF_HOLD_MS = 700;
    const EMA = 0.35; // peso do sample novo vs histórico
    const state: Record<
      string,
      { speaking: boolean; aboveSince: number; belowSince: number; ema: number }
    > = {};
    const tick = () => {
      const now = performance.now();
      const next: Record<string, boolean> = {};
      for (const a of analysers) {
        a.analyser.getByteTimeDomainData(a.data);
        // RMS normalizado: cada byte é amplitude em [0..255] com 128 = silêncio.
        let sumSq = 0;
        for (let i = 0; i < a.data.length; i++) {
          const v = (a.data[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / a.data.length);
        const s =
          state[a.peerId] ??
          (state[a.peerId] = { speaking: false, aboveSince: 0, belowSince: now, ema: 0 });
        s.ema = s.ema * (1 - EMA) + rms * EMA;
        const level = s.ema;
        if (level >= SPEAK_ON) {
          if (!s.aboveSince) s.aboveSince = now;
          s.belowSince = 0;
          if (!s.speaking && now - s.aboveSince >= ON_HOLD_MS) s.speaking = true;
        } else if (level <= SPEAK_OFF) {
          if (!s.belowSince) s.belowSince = now;
          s.aboveSince = 0;
          if (s.speaking && now - s.belowSince >= OFF_HOLD_MS) s.speaking = false;
        }
        // Zona morta: NÃO zera os timers — só pausa a transição. Isso evita
        // que uma queda momentânea entre sílabas reinicie o ON_HOLD.
        next[a.peerId] = s.speaking;
      }
      setSpeakingPeers((prev) => {
        const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
        for (const k of keys) if (prev[k] !== next[k]) return next;
        return prev;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      try {
        void ctxRef.ctx?.close();
      } catch {
        /* noop */
      }
    };
  }, [remoteStreams]);

  // Self speaking detection — RMS + EMA + histerese (mesmo algoritmo do remoto).
  useEffect(() => {
    if (!micOn) {
      setSelfSpeaking(false);
      return;
    }
    const track = audioTrackRef.current;
    if (!track) return;
    let ctx: AudioContext | null = null;
    let raf = 0;
    try {
      ctx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )();
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      src.connect(analyser);
      const data = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      const SPEAK_ON = 0.03,
        SPEAK_OFF = 0.012,
        ON_HOLD_MS = 120,
        OFF_HOLD_MS = 700,
        EMA = 0.35;
      let ema = 0,
        aboveSince = 0,
        belowSince = performance.now(),
        speaking = false;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / data.length);
        ema = ema * (1 - EMA) + rms * EMA;
        const now = performance.now();
        if (ema >= SPEAK_ON) {
          if (!aboveSince) aboveSince = now;
          belowSince = 0;
          if (!speaking && now - aboveSince >= ON_HOLD_MS) {
            speaking = true;
            setSelfSpeaking(true);
          }
        } else if (ema <= SPEAK_OFF) {
          if (!belowSince) belowSince = now;
          aboveSince = 0;
          if (speaking && now - belowSince >= OFF_HOLD_MS) {
            speaking = false;
            setSelfSpeaking(false);
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      /* noop */
    }
    return () => {
      cancelAnimationFrame(raf);
      try {
        void ctx?.close();
      } catch {
        /* noop */
      }
      setSelfSpeaking(false);
    };
  }, [micOn]);

  const acquireMic = useCallback(async (deviceId?: string): Promise<MediaStreamTrack | null> => {
    const audioConstraints: MediaTrackConstraints & { latency?: number } = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      latency: 0.01, // 10ms — pede ao SO o menor buffer possível (Chromium)
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    const track = stream.getAudioTracks()[0];
    if (!track) return null;
    // contentHint="speech" → encoder Opus prioriza latência sobre qualidade musical.
    try {
      (track as MediaStreamTrack & { contentHint?: string }).contentHint = "speech";
    } catch {
      /* noop */
    }
    if (audioTrackRef.current) {
      try {
        audioTrackRef.current.stop();
      } catch {
        /* noop */
      }
      if (localStreamRef.current) {
        localStreamRef.current
          .getAudioTracks()
          .forEach((t) => localStreamRef.current!.removeTrack(t));
      }
    }
    audioTrackRef.current = track;
    if (!localStreamRef.current) localStreamRef.current = new MediaStream();
    localStreamRef.current.addTrack(track);
    setSelectedAudioInputDeviceId(track.getSettings().deviceId ?? deviceId ?? null);
    for (const entry of peersRef.current.values()) {
      if (entry.audioSender) await entry.audioSender.replaceTrack(track);
    }
    return track;
  }, []);

  // Pre-acquire the mic with enabled=false so toggleMic is instant later.
  const prewarmMic = useCallback(async () => {
    if (audioTrackRef.current) return;
    try {
      const track = await acquireMic(selectedAudioInputDeviceId ?? undefined);
      if (track) track.enabled = false; // muted until user toggles
    } catch (err) {
      console.warn("mic prewarm failed (will retry on toggle)", err);
    }
  }, [acquireMic, selectedAudioInputDeviceId]);

  const enableMic = useCallback(async () => {
    if (audioTrackRef.current) {
      audioTrackRef.current.enabled = true;
      setMicOn(true);
      return;
    }
    try {
      const track = await acquireMic(selectedAudioInputDeviceId ?? undefined);
      if (track) track.enabled = true;
      setMicOn(true);
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        setAudioInputDevices(all.filter((d) => d.kind === "audioinput"));
        setAudioOutputDevices(all.filter((d) => d.kind === "audiooutput"));
      } catch {
        /* noop */
      }
    } catch (err) {
      console.error("mic access denied", err);
      throw err;
    }
  }, [acquireMic, selectedAudioInputDeviceId]);

  const disableMic = useCallback(() => {
    if (audioTrackRef.current) {
      audioTrackRef.current.enabled = false;
    }
    setMicOn(false);
  }, []);

  const setAudioInputDevice = useCallback(
    async (deviceId: string) => {
      setSelectedAudioInputDeviceId(deviceId);
      if (audioTrackRef.current) {
        const wasEnabled = audioTrackRef.current.enabled;
        try {
          const track = await acquireMic(deviceId);
          if (track) track.enabled = wasEnabled;
        } catch (err) {
          console.error("change mic failed", err);
        }
      }
    },
    [acquireMic],
  );

  const setAudioOutputDevice = useCallback(async (deviceId: string) => {
    setSelectedAudioOutputDeviceId(deviceId);
    // Apply to every <audio>/<video> element in the page that supports setSinkId.
    type Sinkable = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
    const els = document.querySelectorAll<HTMLMediaElement>("audio, video");
    for (const el of Array.from(els)) {
      const s = el as Sinkable;
      if (typeof s.setSinkId === "function") {
        try {
          await s.setSinkId(deviceId);
        } catch {
          /* noop */
        }
      }
    }
  }, []);

  const toggleMic = useCallback(async () => {
    if (micOn) disableMic();
    else await enableMic();
  }, [micOn, enableMic, disableMic]);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(all.filter((d) => d.kind === "videoinput"));
      setAudioInputDevices(all.filter((d) => d.kind === "audioinput"));
      setAudioOutputDevices(all.filter((d) => d.kind === "audiooutput"));
    } catch {
      /* noop */
    }
  }, []);

  const acquireCam = useCallback(
    async (deviceId?: string) => {
      // frameRate alto + resolução baixa = encoder não acumula frames pra comprimir.
      const videoBase: MediaTrackConstraints = {
        width: { ideal: 320 },
        height: { ideal: 240 },
        frameRate: { ideal: 30, max: 30 },
      };
      const constraints: MediaStreamConstraints = {
        video: deviceId ? { ...videoBase, deviceId: { exact: deviceId } } : videoBase,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getVideoTracks()[0];
      // contentHint="motion" → encoder VP8 reduz B-frames/buffer pra latência.
      try {
        (track as MediaStreamTrack & { contentHint?: string }).contentHint = "motion";
      } catch {
        /* noop */
      }

      // Tear down any previous video track
      if (videoTrackRef.current) {
        try {
          videoTrackRef.current.stop();
        } catch {
          /* noop */
        }
        if (localStreamRef.current) {
          localStreamRef.current
            .getVideoTracks()
            .forEach((t) => localStreamRef.current!.removeTrack(t));
        }
      }
      videoTrackRef.current = track;
      if (!localStreamRef.current) localStreamRef.current = new MediaStream();
      localStreamRef.current.addTrack(track);
      setLocalVideoStream(new MediaStream([track]));
      setSelectedVideoDeviceId(track.getSettings().deviceId ?? deviceId ?? null);
      for (const entry of peersRef.current.values()) {
        if (entry.videoSender) await entry.videoSender.replaceTrack(track);
      }
      // Now labels are available
      void refreshDevices();
    },
    [refreshDevices],
  );

  // Force every existing peer to renegotiate so that newly-added/removed
  // tracks (in particular screen share) propagate correctly. replaceTrack
  // alone does not always cause the remote side to start rendering the
  // new stream — we need a fresh offer/answer exchange.
  const renegotiateAll = useCallback(async () => {
    for (const [peerId, entry] of peersRef.current.entries()) {
      try {
        if (entry.isOfferer) {
          if (entry.pc.signalingState !== "stable") continue;
          entry.makingOffer = true;
          const offer = await entry.pc.createOffer();
          if (entry.pc.signalingState !== "stable") {
            entry.makingOffer = false;
            continue;
          }
          await entry.pc.setLocalDescription(offer);
          sendSignal({ to: peerId, type: "offer", sdp: entry.pc.localDescription! });
          entry.makingOffer = false;
        } else {
          // Ask the offerer to drive the renegotiation.
          sendSignal({ to: peerId, type: "renegotiate" });
        }
      } catch (err) {
        console.error("renegotiate peer failed", err);
        entry.makingOffer = false;
      }
    }
  }, [sendSignal]);

  const enableCam = useCallback(async () => {
    if (videoTrackRef.current) {
      videoTrackRef.current.enabled = true;
      setCamOn(true);
      void renegotiateAll();
      return;
    }
    try {
      await acquireCam(selectedVideoDeviceId ?? undefined);
      setCamOn(true);
      // Força offer/answer novo para que peers remotos comecem a renderizar
      // o track. replaceTrack sozinho não dispara 'unmute' de forma confiável
      // em transceivers sendrecv que nasceram sem track.
      void renegotiateAll();
    } catch (err) {
      console.error("camera access denied", err);
      throw err;
    }
  }, [acquireCam, selectedVideoDeviceId, renegotiateAll]);

  const disableCam = useCallback(() => {
    if (videoTrackRef.current) {
      videoTrackRef.current.stop();
      videoTrackRef.current = null;
      for (const entry of peersRef.current.values()) {
        if (entry.videoSender) void entry.videoSender.replaceTrack(null);
      }
    }
    setLocalVideoStream(null);
    setCamOn(false);
    void renegotiateAll();
  }, [renegotiateAll]);

  const toggleCam = useCallback(async () => {
    if (camOn) disableCam();
    else await enableCam();
  }, [camOn, enableCam, disableCam]);

  const setVideoDevice = useCallback(
    async (deviceId: string) => {
      setSelectedVideoDeviceId(deviceId);
      if (camOn) {
        try {
          await acquireCam(deviceId);
          void renegotiateAll();
        } catch (err) {
          console.error(err);
        }
      }
    },
    [camOn, acquireCam, renegotiateAll],
  );

  // ---------- Screen share ----------
  const stopScreenInternal = useCallback(() => {
    const track = screenTrackRef.current;
    if (track) {
      try {
        track.stop();
      } catch {
        /* noop */
      }
    }
    if (localScreenStream) {
      localScreenStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* noop */
        }
      });
    }
    screenTrackRef.current = null;
    for (const entry of peersRef.current.values()) {
      if (entry.screenSender) void entry.screenSender.replaceTrack(null);
    }
    setLocalScreenStream(null);
    setScreenOn(false);
    void renegotiateAll();
  }, [localScreenStream, renegotiateAll]);

  const enableScreen = useCallback(async () => {
    try {
      const md = navigator.mediaDevices as MediaDevices & {
        getDisplayMedia?: (c?: DisplayMediaStreamOptions) => Promise<MediaStream>;
      };
      if (!md.getDisplayMedia) throw new Error("getDisplayMedia not supported");
      const stream = await md.getDisplayMedia({ video: true, audio: true });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("no screen track");
      screenTrackRef.current = track;
      setLocalScreenStream(stream);
      for (const entry of peersRef.current.values()) {
        if (entry.screenSender) await entry.screenSender.replaceTrack(track);
      }
      track.onended = () => {
        stopScreenInternal();
      };
      setScreenOn(true);
      void renegotiateAll();
    } catch (err) {
      console.error("screen share failed", err);
      throw err;
    }
  }, [stopScreenInternal, renegotiateAll]);

  const toggleScreen = useCallback(async () => {
    if (screenOn) stopScreenInternal();
    else await enableScreen();
  }, [screenOn, enableScreen, stopScreenInternal]);

  // Initial device list (labels are blank until permission granted)
  useEffect(() => {
    void refreshDevices();
    const handler = () => {
      void refreshDevices();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
  }, [refreshDevices]);

  return {
    micOn,
    camOn,
    screenOn,
    toggleMic,
    toggleCam,
    toggleScreen,
    remoteStreams,
    remoteScreenStreams,
    connectedPeers,
    speakingPeers,
    selfSpeaking,

    localVideoStream,
    localScreenStream,
    videoDevices,
    selectedVideoDeviceId,
    setVideoDevice,
    audioInputDevices,
    selectedAudioInputDeviceId,
    setAudioInputDevice,
    audioOutputDevices,
    selectedAudioOutputDeviceId,
    setAudioOutputDevice,
    prewarmMic,
    // Para gravação client-side: acessa o track local de áudio em uso.
    getLocalAudioTrack: () => audioTrackRef.current,
  };
}
