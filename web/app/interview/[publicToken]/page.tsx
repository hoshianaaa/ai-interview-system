"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext
} from "@livekit/components-react";
import { RemoteParticipant, Room, RoomEvent, Track } from "livekit-client";
import "@livekit/components-styles";

type JoinSuccessResponse = {
  livekitUrl: string;
  roomName: string;
  token: string;
  durationSec: number;
};

type JoinResponse = JoinSuccessResponse | { error: string };

const isJoinSuccess = (value: JoinResponse | null): value is JoinSuccessResponse =>
  Boolean(value && "token" in value && "livekitUrl" in value);

type StreamUploadResponse = { uploadUrl: string; uid: string } | { error: string };

type ChatMessage = {
  id: string;
  role: "interviewer" | "candidate";
  text: string;
  ts: number;
};

const MAX_MESSAGES = 12;
const RECORDING_TIMESLICE_MS = 1000;

const pickRecorderMimeType = () => {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
};

async function uploadToStream(uploadUrl: string, blob: Blob) {
  const form = new FormData();
  form.append("file", blob, "interview.webm");
  const res = await fetch(uploadUrl, { method: "POST", body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`stream upload failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
}

function createRecordingStream(room: Room, videoTrack: MediaStreamTrack | null) {
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  const sources = new Map<string, MediaStreamAudioSourceNode>();

  const attachAudio = (track: MediaStreamTrack, key: string) => {
    if (sources.has(key)) return;
    const source = audioContext.createMediaStreamSource(new MediaStream([track]));
    source.connect(destination);
    sources.set(key, source);
  };

  const detachAudio = (key: string) => {
    const source = sources.get(key);
    if (!source) return;
    source.disconnect();
    sources.delete(key);
  };

  const keyFor = (participantId: string, track: MediaStreamTrack) =>
    `${participantId}:${track.id}`;

  const localId = room.localParticipant.identity ?? "local";
  room.localParticipant.audioTrackPublications.forEach((pub) => {
    const media = pub.track?.mediaStreamTrack;
    if (media) attachAudio(media, keyFor(localId, media));
  });

  const onLocalTrackPublished = (publication: { track?: { mediaStreamTrack?: MediaStreamTrack } }) => {
    const media = publication.track?.mediaStreamTrack;
    if (media && media.kind === "audio") {
      attachAudio(media, keyFor(localId, media));
    }
  };
  const onLocalTrackUnpublished = (
    publication: { track?: { mediaStreamTrack?: MediaStreamTrack } }
  ) => {
    const media = publication.track?.mediaStreamTrack;
    if (media && media.kind === "audio") {
      detachAudio(keyFor(localId, media));
    }
  };

  room.remoteParticipants.forEach((participant) => {
    participant.audioTrackPublications.forEach((pub) => {
      const media = pub.track?.mediaStreamTrack;
      if (media) attachAudio(media, keyFor(participant.identity, media));
    });
  });

  const onTrackSubscribed = (track: Track, _pub: unknown, participant: RemoteParticipant) => {
    if (track.kind !== "audio") return;
    const media = track.mediaStreamTrack;
    if (media) attachAudio(media, keyFor(participant.identity, media));
  };
  const onTrackUnsubscribed = (track: Track, _pub: unknown, participant: RemoteParticipant) => {
    if (track.kind !== "audio") return;
    const media = track.mediaStreamTrack;
    if (media) detachAudio(keyFor(participant.identity, media));
  };

  room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
  room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
  room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
  room.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);

  const streamTracks = [...destination.stream.getAudioTracks()];
  if (videoTrack) streamTracks.push(videoTrack);
  const stream = new MediaStream(streamTracks);

  const cleanup = () => {
    room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
    room.off(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
    sources.forEach((source) => source.disconnect());
    sources.clear();
    audioContext.close().catch(() => {});
  };

  return { stream, audioContext, cleanup };
}

export default function InterviewPage({
  params
}: {
  params: Promise<{ publicToken: string }>;
}) {
  const { publicToken } = use(params);

  const [join, setJoin] = useState<JoinResponse | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endedMessage, setEndedMessage] = useState<string | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const endingRef = useRef(false);

  const hasActiveJoin = isJoinSuccess(join);

  const startError =
    join && "error" in join
      ? join.error
      : join && !hasActiveJoin
        ? "接続に失敗しました。もう一度お試しください。"
        : null;

  useEffect(() => {
    let cancelled = false;
    setStatusLoading(true);
    setBlockedMessage(null);
    (async () => {
      try {
        const res = await fetch(`/api/interview/status?publicToken=${encodeURIComponent(publicToken)}`);
        if (cancelled) return;
        if (res.status === 410) {
          setBlockedMessage("この面接URLは期限切れです。");
          return;
        }
        if (!res.ok) {
          setBlockedMessage("この面接URLは無効です。");
          return;
        }
        const data = (await res.json()) as { status?: string };
        if (data.status && data.status !== "created") {
          setBlockedMessage("この面接URLはすでに使用されています。");
        }
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicToken]);

  async function startInterview() {
    if (starting) return;
    if (hasActiveJoin) return;
    if (statusLoading || blockedMessage) return;
    setStarting(true);
    setJoin(null);
    setBlockedMessage(null);
    try {
      const res = await fetch("/api/interview/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicToken })
      });

      const data = (await res.json()) as JoinResponse;
      if ("error" in data) {
        if (data.error === "INTERVIEW_ALREADY_USED") {
          setBlockedMessage("この面接URLはすでに使用されています。");
          return;
        }
        if (data.error === "INTERVIEW_EXPIRED") {
          setBlockedMessage("この面接URLは期限切れです。");
          return;
        }
        if (data.error === "not found") {
          setBlockedMessage("この面接URLは無効です。");
          return;
        }
      }
      setJoin(data);
      if ("durationSec" in data) setSecondsLeft(data.durationSec);
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) {
      void endInterview();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  async function endInterview() {
    if (endingRef.current) return;
    endingRef.current = true;
    setEnding(true);

    await fetch("/api/interview/end", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicToken }),
      keepalive: true
    }).catch(() => {});

    setJoin(null);
    setEndedMessage("面接が終了しました。お疲れさまでした。");
  }

  useEffect(() => {
    if (!hasActiveJoin) return;
    function sendEndBeacon() {
      if (endingRef.current) return;
      endingRef.current = true;

      const payload = JSON.stringify({ publicToken });
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon("/api/interview/end", blob);
        return;
      }

      void fetch("/api/interview/end", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true
      });
    }

    window.addEventListener("pagehide", sendEndBeacon);
    window.addEventListener("beforeunload", sendEndBeacon);
    return () => {
      window.removeEventListener("pagehide", sendEndBeacon);
      window.removeEventListener("beforeunload", sendEndBeacon);
    };
  }, [publicToken, hasActiveJoin]);

  const header = useMemo(() => {
    if (secondsLeft === null) return "Loading...";
    const mm = Math.floor(secondsLeft / 60);
    const ss = secondsLeft % 60;
    return `Time left: ${mm}:${String(ss).padStart(2, "0")}`;
  }, [secondsLeft]);

  if (endedMessage) {
    return (
      <main className="intro">
        <div className="intro-card">
          <div className="eyebrow">AI Interview</div>
          <h1>面接が終了しました</h1>
          <p className="lead">{endedMessage}</p>
          <div className="actions">
            <button className="start" type="button" onClick={() => window.close()}>
              閉じる
            </button>
          </div>
        </div>

        <style jsx>{`
          :global(body) {
            margin: 0;
            background: linear-gradient(160deg, #f4f7fb 0%, #e6edf6 45%, #dde6f2 100%);
          }
          .intro {
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 24px;
            font-family: "IBM Plex Sans", "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif;
            color: #0d1b2a;
          }
          .intro-card {
            width: min(680px, 92vw);
            background: #fff;
            border: 1px solid rgba(28, 48, 74, 0.12);
            border-radius: 20px;
            padding: 28px;
            box-shadow: 0 22px 60px rgba(19, 41, 72, 0.18);
          }
          .eyebrow {
            font-size: 11px;
            letter-spacing: 0.2em;
            text-transform: uppercase;
            color: #5a6a82;
          }
          h1 {
            margin: 12px 0 8px;
            font-size: 26px;
          }
          .lead {
            margin: 0 0 20px;
            color: #4b5c72;
            line-height: 1.6;
          }
          .actions {
            display: flex;
            justify-content: flex-end;
          }
          .start {
            padding: 10px 16px;
            border-radius: 12px;
            border: 1px solid rgba(31, 79, 178, 0.35);
            background: #1f4fb2;
            color: #fff;
            font-weight: 700;
            cursor: pointer;
          }
        `}</style>
      </main>
    );
  }

  if (blockedMessage) {
    return (
      <main className="intro">
        <div className="intro-card">
          <div className="eyebrow">AI Interview</div>
          <h1>このURLは使用できません</h1>
          <p className="lead">{blockedMessage}</p>
          <div className="actions">
            <button className="start" type="button" onClick={() => window.close()}>
              閉じる
            </button>
          </div>
        </div>

        <style jsx>{`
          :global(body) {
            margin: 0;
            background: linear-gradient(160deg, #f4f7fb 0%, #e6edf6 45%, #dde6f2 100%);
          }
          .intro {
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 24px;
            font-family: "IBM Plex Sans", "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif;
            color: #0d1b2a;
          }
          .intro-card {
            width: min(680px, 92vw);
            background: #fff;
            border: 1px solid rgba(28, 48, 74, 0.12);
            border-radius: 20px;
            padding: 28px;
            box-shadow: 0 22px 60px rgba(19, 41, 72, 0.18);
          }
          .eyebrow {
            font-size: 11px;
            letter-spacing: 0.2em;
            text-transform: uppercase;
            color: #5a6a82;
          }
          h1 {
            margin: 12px 0 8px;
            font-size: 26px;
          }
          .lead {
            margin: 0 0 20px;
            color: #4b5c72;
            line-height: 1.6;
          }
          .actions {
            display: flex;
            justify-content: flex-end;
          }
          .start {
            padding: 10px 16px;
            border-radius: 12px;
            border: 1px solid rgba(31, 79, 178, 0.35);
            background: #1f4fb2;
            color: #fff;
            font-weight: 700;
            cursor: pointer;
          }
        `}</style>
      </main>
    );
  }

  if (statusLoading) {
    return (
      <main className="intro">
        <div className="intro-card">
          <div className="eyebrow">AI Interview</div>
          <h1>確認中...</h1>
          <p className="lead">面接URLの状態を確認しています。</p>
        </div>

        <style jsx>{`
          :global(body) {
            margin: 0;
            background: linear-gradient(160deg, #f4f7fb 0%, #e6edf6 45%, #dde6f2 100%);
          }
          .intro {
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 24px;
            font-family: "IBM Plex Sans", "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif;
            color: #0d1b2a;
          }
          .intro-card {
            width: min(680px, 92vw);
            background: #fff;
            border: 1px solid rgba(28, 48, 74, 0.12);
            border-radius: 20px;
            padding: 28px;
            box-shadow: 0 22px 60px rgba(19, 41, 72, 0.18);
          }
          .eyebrow {
            font-size: 11px;
            letter-spacing: 0.2em;
            text-transform: uppercase;
            color: #5a6a82;
          }
          h1 {
            margin: 12px 0 8px;
            font-size: 26px;
          }
          .lead {
            margin: 0;
            color: #4b5c72;
            line-height: 1.6;
          }
        `}</style>
      </main>
    );
  }

  if (!isJoinSuccess(join)) {
    return (
      <main className="intro">
        <div className="intro-card">
          <div className="eyebrow">AI Interview</div>
          <h1>面接を開始しますか？</h1>
          <p className="lead">
            面接を開始すると、このURLは使用済みになります。内容をご確認のうえ開始してください。
          </p>
          <div className="grid">
            <div>
              <h2>面接の流れ</h2>
              <ul>
                <li>開始ボタンを押すと、面接官AIが入室します。</li>
                <li>マイクとカメラの使用許可を求められます。</li>
                <li>質問は順に進み、終了時に要点がまとめられます。</li>
              </ul>
            </div>
            <div>
              <h2>注意点</h2>
              <ul>
                <li>このURLは1回のみ有効です（再入室不可）。</li>
                <li>途中で閉じると面接は終了扱いになります。</li>
                <li>静かな場所・安定したネット環境で開始してください。</li>
              </ul>
            </div>
          </div>
          {startError && <div className="error">{startError}</div>}
          <div className="actions">
            <button className="start" onClick={() => void startInterview()} disabled={starting}>
              {starting ? "接続中..." : "開始する"}
            </button>
          </div>
        </div>

        <style jsx>{`
          :global(body) {
            margin: 0;
            background: linear-gradient(160deg, #f4f7fb 0%, #e6edf6 45%, #dde6f2 100%);
          }
          .intro {
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 24px;
            font-family: "IBM Plex Sans", "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif;
            color: #0d1b2a;
          }
          .intro-card {
            width: min(860px, 92vw);
            background: #fff;
            border: 1px solid rgba(28, 48, 74, 0.12);
            border-radius: 20px;
            padding: 28px;
            box-shadow: 0 22px 60px rgba(19, 41, 72, 0.18);
          }
          .eyebrow {
            font-size: 11px;
            letter-spacing: 0.2em;
            text-transform: uppercase;
            color: #5a6a82;
          }
          h1 {
            margin: 12px 0 8px;
            font-size: 28px;
          }
          .lead {
            margin: 0 0 20px;
            color: #4b5c72;
            line-height: 1.6;
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 18px;
          }
          h2 {
            font-size: 14px;
            margin: 0 0 8px;
            color: #1f4fb2;
          }
          ul {
            margin: 0;
            padding-left: 18px;
            color: #3a4a63;
            line-height: 1.6;
          }
          .actions {
            margin-top: 20px;
            display: flex;
            justify-content: flex-end;
          }
          .start {
            padding: 12px 18px;
            border-radius: 12px;
            border: 1px solid rgba(31, 79, 178, 0.35);
            background: #1f4fb2;
            color: #fff;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 18px 40px rgba(31, 79, 178, 0.2);
          }
          .start:disabled {
            background: #8a97ab;
            border-color: rgba(28, 48, 74, 0.12);
            cursor: default;
          }
          .error {
            margin-top: 16px;
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(180, 35, 24, 0.08);
            border: 1px solid rgba(180, 35, 24, 0.25);
            color: #b42318;
            font-size: 13px;
          }
        `}</style>
      </main>
    );
  }

  return (
    <main style={{ height: "100vh" }}>
      <LiveKitRoom
        serverUrl={join.livekitUrl}
        token={join.token}
        connect={true}
        video={false}
        audio={true}
        style={{ height: "100%" }}
        onConnected={() => setConnected(true)}
        onDisconnected={() => {
          if (connected) {
            void endInterview();
          } else {
            setJoin({ error: "Connection failed. Please refresh the page." });
          }
        }}
      >
        <div className="stage">
          <div className="hero" />
          <div className="overlay" />

          <div className="hud">
            <div className="timer">{header}</div>
            <button className="end" onClick={() => void endInterview()} disabled={ending}>
              End
            </button>
          </div>

          <InterviewCanvas publicToken={publicToken} />
        </div>
        <RoomAudioRenderer />
      </LiveKitRoom>

      <style jsx>{`
        :global(body) {
          margin: 0;
          background: linear-gradient(160deg, #f4f7fb 0%, #e6edf6 45%, #dde6f2 100%);
        }
        .stage {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          font-family: "IBM Plex Sans", "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif;
          color: #0d1b2a;
          --panel-bg: rgba(255, 255, 255, 0.92);
          --panel-border: rgba(28, 48, 74, 0.12);
          --accent: #1f4fb2;
          --accent-strong: #245bd1;
          --shadow: 0 18px 45px rgba(19, 41, 72, 0.18);
          --text-muted: rgba(13, 27, 42, 0.65);
        }
        .stage::before {
          content: "";
          position: absolute;
          inset: 0;
          background-image: radial-gradient(
              circle at 15% 15%,
              rgba(31, 79, 178, 0.08),
              transparent 45%
            ),
            radial-gradient(circle at 85% 20%, rgba(90, 125, 200, 0.08), transparent 40%),
            linear-gradient(145deg, rgba(255, 255, 255, 0.9), rgba(230, 237, 246, 0.7));
          z-index: 0;
        }
        .hero {
          position: absolute;
          inset: 0;
          background-image: linear-gradient(
              120deg,
              rgba(255, 255, 255, 0.7),
              rgba(230, 237, 246, 0.4)
            ),
            url("/interviewer.png"),
            repeating-linear-gradient(
              90deg,
              rgba(31, 79, 178, 0.04),
              rgba(31, 79, 178, 0.04) 1px,
              transparent 1px,
              transparent 38px
            ),
            repeating-linear-gradient(
              0deg,
              rgba(31, 79, 178, 0.03),
              rgba(31, 79, 178, 0.03) 1px,
              transparent 1px,
              transparent 34px
            );
          background-size: cover, cover, auto, auto;
          background-position: center, center, top left, top left;
          opacity: 0.7;
        }
        .overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
              180deg,
              rgba(255, 255, 255, 0.15),
              rgba(230, 237, 246, 0.5) 65%,
              rgba(221, 230, 242, 0.75)
            ),
            radial-gradient(circle at 70% 10%, rgba(31, 79, 178, 0.12), transparent 40%);
        }
        .hud {
          position: absolute;
          top: 16px;
          left: 16px;
          right: 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          z-index: 5;
          animation: fadeDown 0.6s ease-out both;
        }
        .timer {
          padding: 10px 14px;
          border-radius: 12px;
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
          box-shadow: var(--shadow);
          font-weight: 600;
          letter-spacing: 0.02em;
          color: var(--text-muted);
        }
        .end {
          padding: 10px 16px;
          border-radius: 12px;
          background: ${ending ? "#8a97ab" : "#1f4fb2"};
          border: 1px solid ${ending ? "rgba(28, 48, 74, 0.12)" : "rgba(31, 79, 178, 0.4)"};
          color: #fff;
          font-weight: 700;
          cursor: ${ending ? "default" : "pointer"};
          box-shadow: var(--shadow);
          transition: transform 0.2s ease, background 0.2s ease;
        }
        .end:hover {
          transform: ${ending ? "none" : "translateY(-1px)"};
          background: ${ending ? "#8a97ab" : "#245bd1"};
        }
        @keyframes fadeDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </main>
  );
}

function InterviewCanvas({ publicToken }: { publicToken: string }) {
  const room = useRoomContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingCleanupRef = useRef<(() => void) | null>(null);
  const uploadingRef = useRef(false);
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<"pending" | "ready" | "failed">("pending");
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("failed");
      return;
    }
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        setLocalVideoStream(stream);
        setCameraStatus("ready");
      } catch {
        if (active) setCameraStatus("failed");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!localVideoStream) return;
    return () => {
      localVideoStream.getTracks().forEach((track) => track.stop());
    };
  }, [localVideoStream]);

  useEffect(() => {
    const video = pipVideoRef.current;
    if (!video) return;
    if (!localVideoStream) {
      video.srcObject = null;
      return;
    }
    video.srcObject = localVideoStream;
    video.play().catch(() => {});
  }, [localVideoStream]);

  useEffect(() => {
    if (!room) return;
    if (typeof MediaRecorder === "undefined") return;
    if (cameraStatus === "pending") return;
    if (recorderRef.current) return;

    const startRecording = async () => {
      await fetch("/api/interview/stream/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicToken })
      }).catch(() => {});

      const videoTrack = localVideoStream?.getVideoTracks()?.[0] ?? null;
      const { stream, audioContext, cleanup } = createRecordingStream(room, videoTrack);
      recordingCleanupRef.current = cleanup;

      if (audioContext.state === "suspended") {
        await audioContext.resume().catch(() => {});
      }

      if (!stream.getTracks().length) return;

      const options: MediaRecorderOptions = {};
      const mimeType = pickRecorderMimeType();
      if (mimeType) options.mimeType = mimeType;
      options.videoBitsPerSecond = 1_000_000;
      options.audioBitsPerSecond = 96_000;

      const recorder = new MediaRecorder(stream, options);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        recordingCleanupRef.current?.();
        recordingCleanupRef.current = null;
        recorderRef.current = null;
        if (!chunksRef.current.length || uploadingRef.current) return;
        const mime = recorder.mimeType || mimeType || "video/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        uploadingRef.current = true;

        void (async () => {
          try {
            const res = await fetch("/api/interview/stream/upload", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ publicToken })
            });
            const data = (await res.json()) as StreamUploadResponse;
            if (!res.ok || "error" in data || !data.uploadUrl) {
              throw new Error("UPLOAD_URL_FAILED");
            }
            await uploadToStream(data.uploadUrl, blob);
          } catch (err) {
            console.error("[stream] upload failed", err);
          } finally {
            uploadingRef.current = false;
          }
        })();
      };

      recorder.start(RECORDING_TIMESLICE_MS);
    };

    void startRecording();

    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      } else {
        recordingCleanupRef.current?.();
        recordingCleanupRef.current = null;
        recorderRef.current = null;
      }
    };
  }, [room, publicToken, localVideoStream, cameraStatus]);

  useEffect(() => {
    if (!room) return;
    const onData = (payload: Uint8Array, participant?: RemoteParticipant) => {
      const text = new TextDecoder().decode(payload);
      let role: ChatMessage["role"] =
        participant?.identity === room.localParticipant.identity ? "candidate" : "interviewer";
      let body = text;

      try {
        const parsed = JSON.parse(text) as { text?: string; role?: string; speaker?: string };
        if (typeof parsed.text === "string") body = parsed.text;
        const r = parsed.role ?? parsed.speaker;
        if (r === "candidate" || r === "interviewer") role = r;
      } catch {}

      if (!body.trim()) return;
      const msg: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        text: body.trim(),
        ts: Date.now()
      };
      setMessages((prev) => [...prev, msg].slice(-MAX_MESSAGES));
      void fetch("/api/interview/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publicToken,
          message: { messageId: msg.id, role: msg.role, text: msg.text }
        })
      }).catch(() => {});
    };

    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, publicToken]);

  useEffect(() => {
    if (!chatListRef.current) return;
    chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
  }, [messages]);

  return (
    <>
      <div className="chat-panel">
        <div className="chat-title">Conversation</div>
        <div className="chat-list" ref={chatListRef}>
          {messages.length === 0 ? (
            <div className="chat-empty">会話はここに表示されます</div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`chat-row ${msg.role}`}>
                <div className="bubble">
                  <div className="label">{msg.role === "interviewer" ? "面接官" : "候補者"}</div>
                  <div className="text">{msg.text}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="pip">
        {localVideoStream ? (
          <video ref={pipVideoRef} className="pip-video" muted playsInline autoPlay />
        ) : (
          <div className="pip-placeholder">
            {cameraStatus === "failed" ? "カメラが利用できません" : "カメラ準備中..."}
          </div>
        )}
      </div>

      <style jsx>{`
        .chat-panel {
          position: absolute;
          top: 90px;
          left: 24px;
          width: min(42vw, 520px);
          max-height: 70vh;
          padding: 16px;
          border-radius: 18px;
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
          box-shadow: var(--shadow);
          z-index: 4;
          display: flex;
          flex-direction: column;
          gap: 12px;
          animation: fadeUp 0.7s ease-out 0.1s both;
        }
        .chat-title {
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--accent);
          font-size: 11px;
        }
        .chat-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow: auto;
          padding-right: 6px;
        }
        .chat-empty {
          color: var(--text-muted);
          font-size: 14px;
        }
        .chat-row {
          display: flex;
        }
        .chat-row.interviewer {
          justify-content: flex-start;
        }
        .chat-row.candidate {
          justify-content: flex-end;
        }
        .bubble {
          max-width: 85%;
          padding: 10px 12px;
          border-radius: 14px;
          background: #f6f8fc;
          border: 1px solid #d8e1f0;
          animation: rise 0.3s ease-out;
        }
        .chat-row.candidate .bubble {
          background: #eef3ff;
          border-color: #c9d3e6;
        }
        .label {
          font-size: 11px;
          color: #5a6a82;
          margin-bottom: 4px;
        }
        .text {
          font-size: 14px;
          line-height: 1.4;
          color: #1c2a3a;
          word-break: break-word;
        }
        .pip {
          position: absolute;
          right: 20px;
          bottom: 20px;
          width: min(32vw, 320px);
          aspect-ratio: 16 / 9;
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid #c7d3e6;
          box-shadow: var(--shadow);
          background: #f8fafc;
          z-index: 4;
          animation: fadeUp 0.7s ease-out 0.2s both;
        }
        .pip-video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .pip-placeholder {
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          color: #5a6a82;
          font-size: 14px;
        }
        @keyframes rise {
          from {
            transform: translateY(8px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes fadeUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (max-width: 900px) {
          .chat-panel {
            width: calc(100vw - 40px);
            max-height: 45vh;
          }
          .pip {
            width: min(46vw, 260px);
          }
        }
      `}</style>
    </>
  );
}
