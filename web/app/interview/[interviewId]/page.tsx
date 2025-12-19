"use client";

import { use, useEffect, useMemo, useState } from "react";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";

type JoinResponse =
  | { livekitUrl: string; roomName: string; token: string; durationSec: number }
  | { error: string };

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
    if (ending) return;
    setEnding(true);

    await fetch("/api/interview/end", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interviewId })
    }).catch(() => {});

    setJoin({ error: "Interview ended. You can close this tab." });
  }

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
      <div
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          zIndex: 10,
          padding: "8px 12px",
          borderRadius: 8,
          background: "rgba(0,0,0,0.6)",
          color: "#fff",
          fontFamily: "system-ui"
        }}
      >
        {header}
      </div>

      <button
        onClick={() => void endInterview()}
        disabled={ending}
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          zIndex: 10,
          padding: "10px 14px",
          borderRadius: 8,
          background: ending ? "#666" : "#d00",
          color: "#fff",
          border: "none",
          cursor: ending ? "default" : "pointer",
          fontFamily: "system-ui"
        }}
      >
        End
      </button>

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
        <VideoConference />
      </LiveKitRoom>
    </main>
  );
}
