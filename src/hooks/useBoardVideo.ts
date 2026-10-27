import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** One remote board feed: who is sharing it and how healthy the peer connection is. */
export interface BoardFeed {
  userId: string;
  stream: MediaStream;
  state: "connecting" | "connected" | "failed";
}

type SignalKind = "offer" | "answer" | "ice" | "stop";
interface Signal {
  from: string;
  /** The recipient; every client ignores signals addressed to someone else. */
  to: string;
  /** The account that SHARES the video. Offers always come from the sharer, answers from the viewer. */
  sharer: string;
  kind: SignalKind;
  data?: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

/** STUN is enough for most home Wi-Fi setups; strict mobile/corporate NATs need a TURN relay.
 *  Set VITE_TURN_URL (+ VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL) to enable one — without it the
 *  panel says so after a failed connection and points to the video-call link instead. */
const buildIceConfig = (): RTCConfiguration => {
  const env = import.meta.env as Record<string, string | undefined>;
  const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  if (env.VITE_TURN_URL) {
    servers.push({ urls: env.VITE_TURN_URL.split(","), username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL });
  }
  return { iceServers: servers };
};

export const boardVideoSupported = () =>
  typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

interface Options {
  matchId: string | undefined;
  userId: string | undefined;
  enabled: boolean;
  /** An already-open camera stream to share instead of opening the camera a second time (the dart
   *  detection's own stream) — a phone can usually only run one camera capture at once. */
  getExternalStream?: () => MediaStream | null;
}

/** Live video of a player's dartboard for the other players of an online match: mesh WebRTC, one
 *  peer connection per (sharer, viewer) pair, signalled over a Supabase Realtime channel of its
 *  own (broadcast for offer/answer/ICE, presence to know who is in the room). Video only, no
 *  audio, low bitrate. Nothing is recorded or relayed through the server.
 *
 *  Safari/iOS: the camera is only ever opened from startSharing(), which the UI calls straight
 *  from a tap (iOS requires a user gesture), and the receiving <video> must be playsInline. */
export function useBoardVideo({ matchId, userId, enabled, getExternalStream }: Options) {
  const [sharing, setSharing] = useState(false);
  const [feeds, setFeeds] = useState<BoardFeed[]>([]);
  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const ownsLocalStreamRef = useRef(false);
  const sharingRef = useRef(false);
  const presentRef = useRef<Set<string>>(new Set());
  /** I share -> one connection per viewer. */
  const senderPcs = useRef(new Map<string, RTCPeerConnection>());
  /** Someone else shares -> one connection per sharer. */
  const viewerPcs = useRef(new Map<string, RTCPeerConnection>());
  const pendingIce = useRef(new Map<string, RTCIceCandidateInit[]>());

  const upsertFeed = useCallback((feed: BoardFeed) => {
    setFeeds((prev) => [...prev.filter((f) => f.userId !== feed.userId), feed]);
  }, []);
  const dropFeed = useCallback((id: string) => setFeeds((prev) => prev.filter((f) => f.userId !== id)), []);

  const send = useCallback((signal: Signal) => {
    void channelRef.current?.send({ type: "broadcast", event: "signal", payload: signal });
  }, []);

  const closeSender = useCallback((viewerId: string) => {
    senderPcs.current.get(viewerId)?.close();
    senderPcs.current.delete(viewerId);
  }, []);
  const closeViewer = useCallback((sharerId: string) => {
    viewerPcs.current.get(sharerId)?.close();
    viewerPcs.current.delete(sharerId);
    dropFeed(sharerId);
  }, [dropFeed]);

  /** I am sharing: open a connection towards one viewer and send the offer. */
  const connectViewer = useCallback(async (viewerId: string) => {
    const stream = localStreamRef.current;
    if (!stream || !userId || senderPcs.current.has(viewerId)) return;
    const pc = new RTCPeerConnection(buildIceConfig());
    senderPcs.current.set(viewerId, pc);
    stream.getVideoTracks().forEach((track) => pc.addTrack(track, stream));
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ from: userId, to: viewerId, sharer: userId, kind: "ice", data: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") closeSender(viewerId);
    };
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Keep the picture light: the board only needs to be recognisable, not HD.
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender?.getParameters) {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
        params.encodings[0].maxBitrate = 600_000;
        await sender.setParameters(params).catch(() => undefined);
      }
      send({ from: userId, to: viewerId, sharer: userId, kind: "offer", data: pc.localDescription?.toJSON() });
    } catch {
      closeSender(viewerId);
    }
  }, [userId, send, closeSender]);

  const flushIce = useCallback(async (key: string, pc: RTCPeerConnection) => {
    const queued = pendingIce.current.get(key) ?? [];
    pendingIce.current.delete(key);
    for (const c of queued) await pc.addIceCandidate(c).catch(() => undefined);
  }, []);

  const handleSignal = useCallback(async (s: Signal) => {
    if (!userId || s.to !== userId) return;
    if (s.kind === "offer" && s.data) {
      // Someone shares with me: answer.
      closeViewer(s.sharer);
      const pc = new RTCPeerConnection(buildIceConfig());
      viewerPcs.current.set(s.sharer, pc);
      const placeholder = new MediaStream();
      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? placeholder;
        if (!e.streams[0]) placeholder.addTrack(e.track);
        upsertFeed({ userId: s.sharer, stream, state: pc.connectionState === "connected" ? "connected" : "connecting" });
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) send({ from: userId, to: s.sharer, sharer: s.sharer, kind: "ice", data: e.candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        setFeeds((prev) => prev.map((f) => (f.userId === s.sharer
          ? { ...f, state: pc.connectionState === "connected" ? "connected" : pc.connectionState === "failed" ? "failed" : "connecting" }
          : f)));
      };
      try {
        await pc.setRemoteDescription(s.data as RTCSessionDescriptionInit);
        await flushIce(`${s.sharer}:${s.from}`, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ from: userId, to: s.from, sharer: s.sharer, kind: "answer", data: pc.localDescription?.toJSON() });
      } catch {
        closeViewer(s.sharer);
      }
    } else if (s.kind === "answer" && s.data) {
      const pc = senderPcs.current.get(s.from);
      if (pc && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(s.data as RTCSessionDescriptionInit).catch(() => undefined);
        await flushIce(`${userId}:${s.from}`, pc);
      }
    } else if (s.kind === "ice" && s.data) {
      const pc = s.sharer === userId ? senderPcs.current.get(s.from) : viewerPcs.current.get(s.sharer);
      if (pc && pc.remoteDescription) await pc.addIceCandidate(s.data as RTCIceCandidateInit).catch(() => undefined);
      else {
        // Candidate arrived before the description it belongs to — hold it until then.
        const key = `${s.sharer}:${s.from}`;
        pendingIce.current.set(key, [...(pendingIce.current.get(key) ?? []), s.data as RTCIceCandidateInit]);
      }
    } else if (s.kind === "stop") {
      closeViewer(s.sharer);
    }
  }, [userId, send, closeViewer, upsertFeed, flushIce]);

  // The room: join the channel while enabled, react to who comes and goes.
  useEffect(() => {
    if (!enabled || !matchId || !userId || !boardVideoSupported()) return;
    // The Maps never get replaced, only mutated — held in locals so the cleanup below reads the same objects.
    const senders = senderPcs.current;
    const viewers = viewerPcs.current;
    const pending = pendingIce.current;
    const channel = supabase.channel(`board-video-${matchId}`, { config: { presence: { key: userId } } });
    channelRef.current = channel;
    channel
      .on("broadcast", { event: "signal" }, (msg) => { void handleSignal(msg.payload as Signal); })
      .on("presence", { event: "sync" }, () => {
        const present = new Set(Object.keys(channel.presenceState()));
        present.delete(userId);
        presentRef.current = present;
        // Anyone who left: drop their connections/feeds.
        [...senderPcs.current.keys()].filter((id) => !present.has(id)).forEach(closeSender);
        [...viewerPcs.current.keys()].filter((id) => !present.has(id)).forEach(closeViewer);
        // If I am sharing, make sure every present viewer has a connection.
        if (sharingRef.current) present.forEach((id) => { void connectViewer(id); });
      })
      .subscribe((status) => { if (status === "SUBSCRIBED") void channel.track({ at: Date.now() }); });

    return () => {
      senders.forEach((pc) => pc.close());
      viewers.forEach((pc) => pc.close());
      senders.clear();
      viewers.clear();
      pending.clear();
      setFeeds([]);
      if (ownsLocalStreamRef.current) localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      sharingRef.current = false;
      setSharing(false);
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [enabled, matchId, userId, handleSignal, connectViewer, closeSender, closeViewer]);

  /** Start sharing the board camera. MUST be called from a tap handler (iOS Safari). */
  const startSharing = useCallback(async () => {
    if (sharingRef.current || !userId) return;
    setError(null);
    try {
      let stream = getExternalStream?.() ?? null;
      ownsLocalStreamRef.current = false;
      if (!stream || stream.getVideoTracks().length === 0 || stream.getVideoTracks()[0].readyState !== "live") {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
          audio: false,
        });
        ownsLocalStreamRef.current = true;
      }
      localStreamRef.current = stream;
      sharingRef.current = true;
      setSharing(true);
      presentRef.current.forEach((id) => { void connectViewer(id); });
    } catch (e) {
      setError(e instanceof Error ? e.name : "camera");
    }
  }, [userId, getExternalStream, connectViewer]);

  const stopSharing = useCallback(() => {
    if (!sharingRef.current || !userId) return;
    presentRef.current.forEach((id) => send({ from: userId, to: id, sharer: userId, kind: "stop" }));
    [...senderPcs.current.keys()].forEach(closeSender);
    if (ownsLocalStreamRef.current) localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    sharingRef.current = false;
    setSharing(false);
  }, [userId, send, closeSender]);

  return { supported: boardVideoSupported(), sharing, feeds, error, startSharing, stopSharing };
}
