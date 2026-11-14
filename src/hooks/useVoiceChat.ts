import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type VoiceChatStatus = "off" | "connecting" | "waiting" | "connected" | "error";

export interface VoiceChatPeer {
  userId: string;
  name: string;
  connected: boolean;
}

interface SignalMessage {
  from: string;
  to: string;
  kind: "offer" | "answer" | "ice";
  data: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

// Free public STUN servers only (no TURN): works for the usual home and mobile networks; a few strict
// corporate/carrier NATs can still block a direct connection, which then shows as "error".
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

/**
 * Peer-to-peer voice chat for an online match: audio goes directly between the players' devices
 * (WebRTC), Supabase Realtime only carries the connection setup (offer/answer/ICE) on a broadcast
 * channel per match, and presence tells who is in the chat. Nothing is recorded or stored.
 * Works for 1-gegen-1 and 2-gegen-2 (every player connects to every other, at most 3 links).
 * Joining is a user gesture on purpose: browsers (Safari above all) only grant the microphone and
 * start audio playback from one.
 */
export function useVoiceChat(matchId: string | undefined, userId: string | undefined, displayName: string) {
  const [status, setStatus] = useState<VoiceChatStatus>("off");
  const [muted, setMuted] = useState(false);
  const [peers, setPeers] = useState<VoiceChatPeer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const connectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const audioRef = useRef(new Map<string, HTMLAudioElement>());
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const peerNamesRef = useRef(new Map<string, string>());

  const refreshPeers = useCallback(() => {
    const list: VoiceChatPeer[] = [...peerNamesRef.current.entries()].map(([id, name]) => {
      const pc = connectionsRef.current.get(id);
      return { userId: id, name, connected: pc?.connectionState === "connected" };
    });
    setPeers(list);
    if (!channelRef.current) return;
    setStatus(list.some((p) => p.connected) ? "connected" : list.length > 0 ? "connecting" : "waiting");
  }, []);

  const send = useCallback((msg: SignalMessage) => {
    void channelRef.current?.send({ type: "broadcast", event: "signal", payload: msg });
  }, []);

  const closePeer = useCallback((peerId: string) => {
    connectionsRef.current.get(peerId)?.close();
    connectionsRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    const audio = audioRef.current.get(peerId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      audioRef.current.delete(peerId);
    }
  }, []);

  const createPeer = useCallback((peerId: string, initiator: boolean) => {
    if (!userId || connectionsRef.current.has(peerId)) return connectionsRef.current.get(peerId)!;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    connectionsRef.current.set(peerId, pc);
    streamRef.current?.getTracks().forEach((track) => pc.addTrack(track, streamRef.current!));
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ from: userId, to: peerId, kind: "ice", data: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      let audio = audioRef.current.get(peerId);
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.setAttribute("playsinline", "");
        audio.style.display = "none";
        document.body.appendChild(audio);
        audioRef.current.set(peerId, audio);
      }
      audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void audio.play().catch(() => undefined);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        // One retry from the initiating side; the other side waits for the new offer.
        closePeer(peerId);
        if (initiator && peerNamesRef.current.has(peerId)) {
          window.setTimeout(() => { if (channelRef.current && peerNamesRef.current.has(peerId)) void startOffer(peerId); }, 1500);
        }
      }
      refreshPeers();
    };
    return pc;
    // startOffer is defined below and only used inside the async callback above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, send, closePeer, refreshPeers]);

  const startOffer = useCallback(async (peerId: string) => {
    if (!userId) return;
    const pc = createPeer(peerId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ from: userId, to: peerId, kind: "offer", data: offer });
  }, [userId, createPeer, send]);

  const flushIce = async (peerId: string, pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current.get(peerId) ?? [];
    pendingIceRef.current.delete(peerId);
    for (const c of queued) await pc.addIceCandidate(c).catch(() => undefined);
  };

  const handleSignal = useCallback(async (msg: SignalMessage) => {
    if (!userId || msg.to !== userId || msg.from === userId) return;
    try {
      if (msg.kind === "offer") {
        closePeer(msg.from); // a fresh offer replaces any half-open link
        const pc = createPeer(msg.from, false);
        await pc.setRemoteDescription(msg.data as RTCSessionDescriptionInit);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ from: userId, to: msg.from, kind: "answer", data: answer });
        await flushIce(msg.from, pc);
      } else if (msg.kind === "answer") {
        const pc = connectionsRef.current.get(msg.from);
        if (pc && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(msg.data as RTCSessionDescriptionInit);
          await flushIce(msg.from, pc);
        }
      } else {
        const pc = connectionsRef.current.get(msg.from);
        if (pc?.remoteDescription) await pc.addIceCandidate(msg.data as RTCIceCandidateInit).catch(() => undefined);
        else pendingIceRef.current.set(msg.from, [...(pendingIceRef.current.get(msg.from) ?? []), msg.data as RTCIceCandidateInit]);
      }
    } catch (e) {
      console.warn("useVoiceChat: signal failed", e);
    }
    refreshPeers();
  }, [userId, closePeer, createPeer, send, refreshPeers]);

  const leave = useCallback(() => {
    for (const id of [...connectionsRef.current.keys()]) closePeer(id);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (channelRef.current) void supabase.removeChannel(channelRef.current);
    channelRef.current = null;
    peerNamesRef.current.clear();
    setPeers([]);
    setMuted(false);
    setStatus("off");
  }, [closePeer]);

  const join = useCallback(async () => {
    if (!matchId || !userId || channelRef.current) return;
    setError(null);
    setStatus("connecting");
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setStatus("error");
      setError("mic");
      return;
    }
    const channel = supabase.channel(`voice:${matchId}`, { config: { presence: { key: userId }, broadcast: { self: false } } });
    channelRef.current = channel;
    channel
      .on("broadcast", { event: "signal" }, ({ payload }) => { void handleSignal(payload as SignalMessage); })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name?: string }>();
        const present = new Map<string, string>();
        for (const [key, metas] of Object.entries(state)) {
          if (key !== userId) present.set(key, metas[0]?.name ?? "?");
        }
        for (const id of [...peerNamesRef.current.keys()]) {
          if (!present.has(id)) { closePeer(id); peerNamesRef.current.delete(id); }
        }
        for (const [id, name] of present) {
          const isNew = !peerNamesRef.current.has(id);
          peerNamesRef.current.set(id, name);
          // The lower user id always makes the offer, so two devices never offer to each other at once.
          if (isNew && userId < id) void startOffer(id);
        }
        refreshPeers();
      })
      .subscribe(async (state) => {
        if (state === "SUBSCRIBED") {
          await channel.track({ name: displayName });
          refreshPeers();
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
          setStatus("error");
          setError("connection");
        }
      });
  }, [matchId, userId, displayName, handleSignal, closePeer, startOffer, refreshPeers]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
  }, [muted]);

  // Leave when the match screen goes away or the match changes.
  useEffect(() => () => leave(), [matchId, leave]);

  return { status, muted, peers, error, join, leave, toggleMute };
}
