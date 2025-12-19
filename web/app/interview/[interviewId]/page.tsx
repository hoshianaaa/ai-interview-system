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
          background: #0b1220;
        }
        .stage {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          font-family: "IBM Plex Sans", "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif;
          color: #e6edf5;
          --panel-bg: rgba(15, 22, 36, 0.78);
          --panel-border: rgba(255, 255, 255, 0.12);
          --accent: #5aa2ff;
          --accent-strong: #2f6fe0;
          --shadow: 0 18px 45px rgba(5, 12, 26, 0.45);
          --text-muted: rgba(230, 237, 245, 0.7);
        }
        .stage::before {
          content: "";
          position: absolute;
          inset: 0;
          background-image: radial-gradient(
              circle at 15% 15%,
              rgba(90, 162, 255, 0.16),
              transparent 45%
            ),
            radial-gradient(circle at 85% 20%, rgba(42, 98, 214, 0.12), transparent 40%),
            linear-gradient(145deg, rgba(9, 16, 28, 0.95), rgba(13, 22, 40, 0.7));
          z-index: 0;
        }
        .hero {
          position: absolute;
          inset: 0;
          background-image: linear-gradient(
              120deg,
              rgba(7, 14, 26, 0.75),
              rgba(9, 19, 36, 0.25)
            ),
            url("/interviewer.png"),
            repeating-linear-gradient(
              90deg,
              rgba(255, 255, 255, 0.035),
              rgba(255, 255, 255, 0.035) 1px,
              transparent 1px,
              transparent 38px
            ),
            repeating-linear-gradient(
              0deg,
              rgba(255, 255, 255, 0.03),
              rgba(255, 255, 255, 0.03) 1px,
              transparent 1px,
              transparent 34px
            );
          background-size: cover, cover, auto, auto;
          background-position: center, center, top left, top left;
          opacity: 0.68;
        }
        .overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
              180deg,
              rgba(6, 12, 22, 0.25),
              rgba(6, 12, 22, 0.7) 65%,
              rgba(6, 12, 22, 0.95)
            ),
            radial-gradient(circle at 70% 10%, rgba(90, 162, 255, 0.2), transparent 40%);
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
          background: ${ending ? "#4b566b" : "#224aa7"};
          border: 1px solid ${ending ? "rgba(255,255,255,0.08)" : "rgba(90, 162, 255, 0.45)"};
          color: #fff;
          font-weight: 700;
          cursor: ${ending ? "default" : "pointer"};
          box-shadow: var(--shadow);
          transition: transform 0.2s ease, background 0.2s ease;
        }
        .end:hover {
          transform: ${ending ? "none" : "translateY(-1px)"};
          background: ${ending ? "#4b566b" : "#2f6fe0"};
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

function InterviewCanvas() {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const localTrack =
    tracks.find((t) => t.participant.isLocal) ?? tracks.find((t) => t.publication?.isLocal) ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatListRef = useRef<HTMLDivElement | null>(null);

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
          background: rgba(15, 22, 36, 0.92);
          border: 1px solid rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(6px);
          animation: rise 0.3s ease-out;
        }
        .chat-row.candidate .bubble {
          background: rgba(90, 162, 255, 0.16);
          border-color: rgba(90, 162, 255, 0.4);
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
          border: 1px solid rgba(255, 255, 255, 0.16);
          box-shadow: var(--shadow);
          background: rgba(7, 12, 20, 0.8);
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
