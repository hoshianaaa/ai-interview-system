"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type StreamUploadResponse =
  | { uploadUrl: string; uid: string; uploadFileName?: string }
  | { error: string };

type ChatMessage = {
  id: string;
  role: "interviewer" | "candidate";
  text: string;
  ts: number;
};

type BlockedState = {
  title: string;
  message: string;
  action: "close" | "reload";
};

const MAX_MESSAGES = 12;
const RECORDING_TIMESLICE_MS = 1000;
const RECORDING_VIDEO_CONSTRAINTS = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 15, max: 20 }
};
const RECORDING_VIDEO_BPS = 600_000;
const RECORDING_AUDIO_BPS = 48_000;
const UPLOAD_RETRY_COUNT = 3;
const UPLOAD_RETRY_DELAY_MS = 1500;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pickRecorderMimeType = () => {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
};

async function uploadToStream(
  uploadUrl: string,
  blob: Blob,
  fileName = "interview.webm",
  onProgress?: (progress: number) => void
) {
  await new Promise<void>((resolve, reject) => {
    const form = new FormData();
    form.append("file", blob, fileName);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      const detail = xhr.responseText ?? "";
      reject(
        new Error(`stream upload failed (${xhr.status})${detail ? `: ${detail}` : ""}`)
      );
    };
    xhr.onerror = () => reject(new Error("stream upload failed (network error)"));
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.max(
          0,
          Math.min(100, Math.round((event.loaded / event.total) * 100))
        );
        onProgress(percent);
      };
    }
    xhr.send(form);
  });
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
  const [blockedState, setBlockedState] = useState<BlockedState | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const endingRef = useRef(false);
  const unloadConfirmRef = useRef(false);
  const handleUploadState = useCallback(
    (next: { uploading: boolean; error: string | null; progress: number | null }) => {
      setUploading(next.uploading);
      setUploadError(next.error);
      setUploadProgress(next.progress);
    },
    []
  );

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
    setBlockedState(null);
    (async () => {
      try {
        const res = await fetch(`/api/interview/status?publicToken=${encodeURIComponent(publicToken)}`);
        if (cancelled) return;
        const data = (await res.json().catch(() => ({}))) as {
          status?: string;
          blockedReason?: string;
          error?: string;
        };
        if (res.status === 410 || data.error === "INTERVIEW_EXPIRED") {
          setBlockedState({
            title: "このURLは使用できません",
            message: "この面接URLは期限切れです。",
            action: "close"
          });
          return;
        }
        if (!res.ok) {
          setBlockedState({
            title: "このURLは使用できません",
            message: "この面接URLは無効です。",
            action: "close"
          });
          return;
        }
        if (data.blockedReason === "CONCURRENCY_LIMIT") {
          setBlockedState({
            title: "現在、面接が混み合っています",
            message:
              "現在システムが混み合っています。時間を置いてから同じURLを開き直してください。",
            action: "reload"
          });
          return;
        }
        if (data.status && data.status !== "created") {
          setBlockedState({
            title: "このURLは使用できません",
            message: "この面接URLはすでに使用されています。",
            action: "close"
          });
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
    if (statusLoading || blockedState) return;
    setStarting(true);
    setJoin(null);
    setBlockedState(null);
    try {
      const res = await fetch("/api/interview/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicToken })
      });

      const data = (await res.json()) as JoinResponse;
      if ("error" in data) {
        if (data.error === "INTERVIEW_ALREADY_USED") {
          setBlockedState({
            title: "このURLは使用できません",
            message: "この面接URLはすでに使用されています。",
            action: "close"
          });
          return;
        }
        if (data.error === "INTERVIEW_EXPIRED") {
          setBlockedState({
            title: "このURLは使用できません",
            message: "この面接URLは期限切れです。",
            action: "close"
          });
          return;
        }
        if (data.error === "not found") {
          setBlockedState({
            title: "このURLは使用できません",
            message: "この面接URLは無効です。",
            action: "close"
          });
          return;
        }
        if (data.error === "INTERVIEW_CONCURRENCY_LIMIT") {
          setBlockedState({
            title: "現在、面接が混み合っています",
            message:
              "現在システムが混み合っています。時間を置いてから同じURLを開き直してください。",
            action: "reload"
          });
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
    return () => {
      window.removeEventListener("pagehide", sendEndBeacon);
    };
  }, [publicToken, hasActiveJoin]);

  useEffect(() => {
    if (!hasActiveJoin || ending) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      unloadConfirmRef.current = true;
      event.preventDefault();
      event.returnValue = "面接結果が失われる可能性があります。";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasActiveJoin, ending]);

  useEffect(() => {
    if (!uploading) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [uploading]);

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
          {uploading && (
            <>
              <p className="upload-note">録画を保存中です。画面を閉じないでください。</p>
              <div className="upload-progress-row">
                <progress
                  className="upload-progress"
                  max={100}
                  value={uploadProgress ?? undefined}
                />
                {typeof uploadProgress === "number" && (
                  <span className="upload-percent">{uploadProgress}%</span>
                )}
              </div>
            </>
          )}
          {uploadError && !uploading && (
            <p className="error">
              録画の保存に失敗しました。通信環境を確認して再読み込みしてください。
            </p>
          )}
          {!uploading && (
            <div className="actions">
              <button className="start" type="button" onClick={() => window.close()}>
                閉じる
              </button>
            </div>
          )}
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
          .upload-note {
            margin: 0 0 16px;
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(31, 79, 178, 0.08);
            border: 1px solid rgba(31, 79, 178, 0.2);
            color: #1f4fb2;
            font-size: 13px;
            font-weight: 600;
          }
          .upload-progress-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 0 0 16px;
          }
          .upload-progress {
            flex: 1;
            height: 8px;
            border-radius: 999px;
            accent-color: #1f4fb2;
          }
          .upload-progress::-webkit-progress-bar {
            background: rgba(31, 79, 178, 0.12);
            border-radius: 999px;
          }
          .upload-progress::-webkit-progress-value {
            border-radius: 999px;
          }
          .upload-percent {
            font-size: 12px;
            font-weight: 600;
            color: #1f4fb2;
            min-width: 42px;
            text-align: right;
          }
          .error {
            margin: 0 0 16px;
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(180, 35, 24, 0.08);
            border: 1px solid rgba(180, 35, 24, 0.25);
            color: #b42318;
            font-size: 13px;
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

  if (blockedState) {
    return (
      <main className="intro">
        <div className="intro-card">
          <div className="eyebrow">AI Interview</div>
          <h1>{blockedState.title}</h1>
          <p className="lead">{blockedState.message}</p>
          <div className="actions">
            {blockedState.action === "reload" ? (
              <button
                className="start"
                type="button"
                onClick={() => window.location.reload()}
              >
                再読み込み
              </button>
            ) : (
              <button className="start" type="button" onClick={() => window.close()}>
                閉じる
              </button>
            )}
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
            if (unloadConfirmRef.current) {
              return;
            }
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
          {(uploading || uploadError) && (
            <div className={`upload-banner ${uploadError && !uploading ? "error" : ""}`}>
              <div className="upload-text">
                {uploading
                  ? "録画を保存中です。画面を閉じないでください。"
                  : "録画の保存に失敗しました。通信環境を確認して再読み込みしてください。"}
              </div>
              {uploading && (
                <div className="upload-progress-row">
                  <progress
                    className="upload-progress"
                    max={100}
                    value={uploadProgress ?? undefined}
                  />
                  {typeof uploadProgress === "number" && (
                    <span className="upload-percent">{uploadProgress}%</span>
                  )}
                </div>
              )}
            </div>
          )}

          <InterviewCanvas
            publicToken={publicToken}
            onUploadStateChange={handleUploadState}
          />
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
        .upload-banner {
          position: absolute;
          bottom: 20px;
          left: 24px;
          max-width: min(60vw, 520px);
          padding: 10px 14px;
          border-radius: 12px;
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
          box-shadow: var(--shadow);
          font-size: 12px;
          font-weight: 600;
          color: #1f2f44;
          z-index: 4;
        }
        .upload-text {
          margin-bottom: 8px;
        }
        .upload-progress-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .upload-progress {
          flex: 1;
          height: 8px;
          border-radius: 999px;
          accent-color: #1f4fb2;
        }
        .upload-progress::-webkit-progress-bar {
          background: rgba(31, 79, 178, 0.12);
          border-radius: 999px;
        }
        .upload-progress::-webkit-progress-value {
          border-radius: 999px;
        }
        .upload-percent {
          font-size: 11px;
          font-weight: 600;
          color: inherit;
          min-width: 42px;
          text-align: right;
        }
        .upload-banner.error {
          background: rgba(180, 35, 24, 0.08);
          border-color: rgba(180, 35, 24, 0.25);
          color: #b42318;
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

function InterviewCanvas({
  publicToken,
  onUploadStateChange
}: {
  publicToken: string;
  onUploadStateChange: (next: {
    uploading: boolean;
    error: string | null;
    progress: number | null;
  }) => void;
}) {
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
        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: RECORDING_VIDEO_CONSTRAINTS
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        if (stream) {
          if (!active) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          setLocalVideoStream(stream);
          setCameraStatus("ready");
        }
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
      options.videoBitsPerSecond = RECORDING_VIDEO_BPS;
      options.audioBitsPerSecond = RECORDING_AUDIO_BPS;

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
        onUploadStateChange({ uploading: true, error: null, progress: 0 });

        void (async () => {
          let errorMessage: string | null = null;
          try {
            let uploadUrl = "";
            let uploadFileName = "interview.webm";
            for (let attempt = 1; attempt <= UPLOAD_RETRY_COUNT; attempt++) {
              try {
                onUploadStateChange({ uploading: true, error: null, progress: 0 });
                if (!uploadUrl) {
                  const res = await fetch("/api/interview/stream/upload", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ publicToken })
                  });
                  const data = (await res.json()) as StreamUploadResponse;
                  if (!res.ok || "error" in data || !data.uploadUrl) {
                    throw new Error("UPLOAD_URL_FAILED");
                  }
                  uploadUrl = data.uploadUrl;
                  uploadFileName = data.uploadFileName ?? "interview.webm";
                }
                await uploadToStream(uploadUrl, blob, uploadFileName, (progress) =>
                  onUploadStateChange({ uploading: true, error: null, progress })
                );
                errorMessage = null;
                break;
              } catch (err) {
                if (attempt >= UPLOAD_RETRY_COUNT) throw err;
                await wait(UPLOAD_RETRY_DELAY_MS);
              }
            }
          } catch (err) {
            console.error("[stream] upload failed", err);
            errorMessage =
              "録画の保存に失敗しました。通信環境を確認して再読み込みしてください。";
          } finally {
            uploadingRef.current = false;
            onUploadStateChange({
              uploading: false,
              error: errorMessage,
              progress: errorMessage ? null : 100
            });
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
  }, [room, publicToken, localVideoStream, cameraStatus, onUploadStateChange]);

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
