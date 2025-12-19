"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
  useTracks,
  VideoTrack
} from "@livekit/components-react";
import { RemoteParticipant, RoomEvent, Track } from "livekit-client";
import "@livekit/components-styles";

type JoinResponse =
  | { livekitUrl: string; roomName: string; token: string; durationSec: number }
  | { error: string };

type ChatMessage = {
  id: string;
  role: "interviewer" | "candidate";
  text: string;
  ts: number;
};

const MAX_MESSAGES = 12;

export default function InterviewPage({
  params
}: {
  params: Promise<{ interviewId: string }>;
}) {
  const { interviewId } = use(params);

  const [join, setJoin] = useState<JoinResponse | null>(null);
  const [ending, setEnding] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const endingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/interview/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interviewId })
      });

      const data = (await res.json()) as JoinResponse;
      if (!cancelled) setJoin(data);
      if (!cancelled && "durationSec" in data) setSecondsLeft(data.durationSec);
    })();

    return () => {
      cancelled = true;
    };
  }, [interviewId]);

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
      body: JSON.stringify({ interviewId }),
      keepalive: true
    }).catch(() => {});

    setJoin({ error: "Interview ended. You can close this tab." });
  }

  useEffect(() => {
    function sendEndBeacon() {
      if (endingRef.current) return;
      endingRef.current = true;

      const payload = JSON.stringify({ interviewId });
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
  }, [interviewId]);

  const header = useMemo(() => {
    if (secondsLeft === null) return "Loading...";
    const mm = Math.floor(secondsLeft / 60);
    const ss = secondsLeft % 60;
    return `Time left: ${mm}:${String(ss).padStart(2, "0")}`;
  }, [secondsLeft]);

  if (!join) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Connecting...</h1>
      </main>
    );
  }

  if ("error" in join) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Interview</h1>
        <p>{join.error}</p>
      </main>
    );
  }

  if (typeof join.token !== "string") {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Interview</h1>
        <p>Invalid token response. Please refresh the page.</p>
      </main>
    );
  }

  return (
    <main style={{ height: "100vh" }}>
      <LiveKitRoom
        serverUrl={join.livekitUrl}
        token={join.token}
        connect={true}
        video={true}
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

          <InterviewCanvas />
        </div>
        <RoomAudioRenderer />
      </LiveKitRoom>

      <style jsx>{`
        :global(body) {
          margin: 0;
          background: #0b0a0a;
        }
        .stage {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          font-family: "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif;
          color: #f2f2f2;
          --panel-bg: rgba(10, 12, 18, 0.7);
          --panel-border: rgba(255, 255, 255, 0.1);
          --accent: #f7b733;
          --shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
        }
        .hero {
          position: absolute;
          inset: 0;
          background-image: url("/interviewer.png");
          background-size: cover;
          background-position: center;
          transform: scale(1.02);
          filter: saturate(0.95) contrast(1.05);
        }
        .overlay {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 20% 20%, rgba(0, 0, 0, 0.2), transparent 45%),
            linear-gradient(120deg, rgba(4, 6, 10, 0.7), rgba(4, 6, 10, 0.2) 40%, rgba(4, 6, 10, 0.85));
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
        }
        .timer {
          padding: 10px 14px;
          border-radius: 12px;
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
          box-shadow: var(--shadow);
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .end {
          padding: 10px 16px;
          border-radius: 12px;
          background: ${ending ? "#5f5f5f" : "#d94141"};
          border: none;
          color: #fff;
          font-weight: 700;
          cursor: ${ending ? "default" : "pointer"};
          box-shadow: var(--shadow);
        }
      `}</style>
    </main>
  );
}

function InterviewCanvas() {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const localTrack =
    tracks.find((t) => t.participant.isLocal) ?? tracks.find((t) => t.publication?.isLocal) ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);

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
    };

    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  return (
    <>
      <div className="chat-panel">
        <div className="chat-title">Conversation</div>
        <div className="chat-list">
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
        {localTrack ? (
          <VideoTrack trackRef={localTrack} className="pip-video" />
        ) : (
          <div className="pip-placeholder">カメラ準備中...</div>
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
        }
        .chat-title {
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--accent);
          font-size: 12px;
        }
        .chat-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow: hidden;
        }
        .chat-empty {
          color: rgba(255, 255, 255, 0.6);
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
          background: rgba(20, 24, 34, 0.9);
          border: 1px solid rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(6px);
          animation: rise 0.3s ease-out;
        }
        .chat-row.candidate .bubble {
          background: rgba(247, 183, 51, 0.18);
          border-color: rgba(247, 183, 51, 0.4);
        }
        .label {
          font-size: 11px;
          opacity: 0.7;
          margin-bottom: 4px;
        }
        .text {
          font-size: 14px;
          line-height: 1.4;
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
          border: 1px solid rgba(255, 255, 255, 0.2);
          box-shadow: var(--shadow);
          background: rgba(0, 0, 0, 0.6);
          z-index: 4;
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
          color: rgba(255, 255, 255, 0.7);
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
