"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

type Outcome = "pass" | "fail" | "hold";

type InterviewRow = {
  interviewId: string;
  url: string;
  status: string;
  outcome: Outcome;
  candidateName: string | null;
  notes: string | null;
  createdAt: string;
  hasRecording: boolean;
};

type ChatItem = {
  messageId: string;
  role: "interviewer" | "candidate";
  text: string;
  offsetMs: number;
  createdAt: string;
};

type CreateResponse =
  | { interviewId: string; roomName: string; url: string; candidateName: string | null }
  | { error: string };

export default function AdminDashboard({ interviews }: { interviews: InterviewRow[] }) {
  const [rows, setRows] = useState(interviews);
  const [durationSec, setDurationSec] = useState(600);
  const [candidateName, setCandidateName] = useState("");
  const [createResult, setCreateResult] = useState<CreateResponse | null>(null);
  const [loadingVideoId, setLoadingVideoId] = useState<string | null>(null);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<ChatItem[]>([]);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [editCandidateName, setEditCandidateName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editOutcome, setEditOutcome] = useState<Outcome>("hold");
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(true);
  const [showFail, setShowFail] = useState(true);
  const [showHold, setShowHold] = useState(true);

  const hasResult = createResult && "url" in createResult;

  async function createInterview() {
    setCreateResult(null);
    const res = await fetch("/api/interview/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        durationSec,
        candidateName: candidateName.trim() || undefined
      })
    });
    const data = (await res.json()) as CreateResponse;
    setCreateResult(data);
  }

  async function loadVideo(row: InterviewRow) {
    const interviewId = row.interviewId;
    setLoadingVideoId(interviewId);
    setSelectedId(interviewId);
    setSelectedVideoUrl(null);
    setSelectedChat([]);
    setCurrentTimeSec(0);
    try {
      const chatPromise = fetch(`/api/admin/interview/chat?interviewId=${interviewId}`);
      const videoPromise = row.hasRecording
        ? fetch(`/api/admin/interview/video?interviewId=${interviewId}`)
        : Promise.resolve(null);

      const [chatRes, videoRes] = await Promise.all([chatPromise, videoPromise]);

      const chatData = (await chatRes.json()) as { messages?: ChatItem[] };
      if (Array.isArray(chatData.messages)) {
        setSelectedChat(chatData.messages);
      }

      if (videoRes) {
        const videoData = (await videoRes.json()) as { url?: string; error?: string };
        if (videoData.url) setSelectedVideoUrl(videoData.url);
      }
    } finally {
      setLoadingVideoId(null);
    }
  }

  const activeMessageId = useMemo(() => {
    if (!selectedChat.length) return null;
    const currentMs = currentTimeSec * 1000;
    let active: string | null = null;
    for (const msg of selectedChat) {
      if (msg.offsetMs <= currentMs) active = msg.messageId;
      else break;
    }
    return active;
  }, [selectedChat, currentTimeSec]);

  const formatTime = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${mm}:${String(ss).padStart(2, "0")}`;
  };

  const seekTo = (offsetMs: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = offsetMs / 1000;
  };

  const outcomeLabel = (value: Outcome) => {
    if (value === "pass") return "合格";
    if (value === "fail") return "不合格";
    return "保留";
  };

  async function saveDetails() {
    if (!selectedRow) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/interview/update", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interviewId: selectedRow.interviewId,
          candidateName: editCandidateName.trim(),
          notes: editNotes,
          outcome: editOutcome
        })
      });
      const data = (await res.json()) as {
        interviewId?: string;
        candidateName?: string | null;
        notes?: string | null;
        outcome?: Outcome;
      };
      if (data.interviewId) {
        setRows((prev) =>
          prev.map((row) =>
            row.interviewId === data.interviewId
              ? {
                  ...row,
                  candidateName: data.candidateName ?? null,
                  notes: data.notes ?? null,
                  outcome: data.outcome ?? row.outcome
                }
              : row
          )
        );
        setEditCandidateName(data.candidateName ?? "");
        setEditNotes(data.notes ?? "");
        setEditOutcome(data.outcome ?? editOutcome);
      }
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    if (!selectedRow) return;
    setEditCandidateName(selectedRow.candidateName ?? "");
    setEditNotes(selectedRow.notes ?? "");
    setEditOutcome(selectedRow.outcome);
  }

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [rows]
  );
  const filtered = useMemo(() => {
    return sorted.filter((row) => {
      if (row.outcome === "pass") return showPass;
      if (row.outcome === "fail") return showFail;
      return showHold;
    });
  }, [sorted, showPass, showFail, showHold]);
  const selectedRow = useMemo(
    () => (selectedId ? sorted.find((row) => row.interviewId === selectedId) ?? null : null),
    [sorted, selectedId]
  );
  const isDirty =
    Boolean(selectedRow) &&
    (editCandidateName !== (selectedRow?.candidateName ?? "") ||
      editNotes !== (selectedRow?.notes ?? "") ||
      editOutcome !== (selectedRow?.outcome ?? "hold"));

  useEffect(() => {
    if (!selectedRow) {
      setEditCandidateName("");
      setEditNotes("");
      return;
    }
    setEditCandidateName(selectedRow.candidateName ?? "");
    setEditNotes(selectedRow.notes ?? "");
    setEditOutcome(selectedRow.outcome ?? "hold");
  }, [selectedRow?.interviewId]);

  return (
    <main className="page">
      <section className="header">
        <div>
          <h1 className="brand">
            PM1 <span>AI Interview</span>
          </h1>
        </div>
        <div className="user">
          <OrganizationSwitcher />
          <UserButton />
        </div>
      </section>

      <section className="grid">
        <div className="stack">
          <div className="card">
            <h2>新規面接URLの発行</h2>
            <div className="form-row">
              <label>候補者名（任意）</label>
              <input
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                placeholder="例）山田 太郎"
              />
            </div>
            <div className="form-row">
              <label>面接時間（秒）</label>
              <input
                type="number"
                min={60}
                step={30}
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value))}
              />
            </div>
            <button className="primary" onClick={() => void createInterview()}>
              URLを発行
            </button>
            {createResult && "error" in createResult && (
              <p className="error">作成に失敗しました: {createResult.error}</p>
            )}
            {hasResult && (
              <div className="result">
                <div className="result-row">
                  <span>面接URL</span>
                  <a href={createResult.url} target="_blank" rel="noreferrer">
                    {createResult.url}
                  </a>
                </div>
                <div className="result-row">
                  <span>候補者名</span>
                  <strong>{createResult.candidateName ?? "未設定"}</strong>
                </div>
              </div>
            )}
          </div>

          <div className="card list-card">
            <h2>面接一覧</h2>
            <div className="filters">
              <span>判定フィルター</span>
              <button
                type="button"
                className={`filter-chip ${showPass ? "active" : ""}`}
                onClick={() => setShowPass((v) => !v)}
              >
                合格
              </button>
              <button
                type="button"
                className={`filter-chip ${showFail ? "active" : ""}`}
                onClick={() => setShowFail((v) => !v)}
              >
                不合格
              </button>
              <button
                type="button"
                className={`filter-chip ${showHold ? "active" : ""}`}
                onClick={() => setShowHold((v) => !v)}
              >
                保留
              </button>
            </div>
            {filtered.length === 0 ? (
              <div className="empty">
                {rows.length === 0 ? "面接データがありません" : "条件に一致する面接がありません"}
              </div>
            ) : (
              <div className="list">
                {filtered.map((row) => (
                  <div
                    key={row.interviewId}
                    className={`row ${selectedId === row.interviewId ? "selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => void loadVideo(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void loadVideo(row);
                      }
                    }}
                  >
                    <div>
                      <div className="title">
                        {row.candidateName ? row.candidateName : "候補者名なし"}
                      </div>
                      <div className="meta">
                        <a href={row.url} target="_blank" rel="noreferrer">
                          {row.url}
                        </a>
                      </div>
                      <div className="meta">
                        判定: {outcomeLabel(row.outcome)} / ステータス: {row.status} / 作成:{" "}
                        {new Date(row.createdAt).toLocaleString("ja-JP")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card detail-card">
          <h2>面接詳細</h2>
          {!selectedRow ? (
            <div className="empty">左の一覧から面接を選択してください</div>
          ) : (
            <>
              <div className="detail-header">
                <div>
                  <div className="detail-row">
                    <label>候補者名</label>
                    <input
                      value={editCandidateName}
                      onChange={(e) => setEditCandidateName(e.target.value)}
                      placeholder="候補者名を入力"
                    />
                  </div>
                  <div className="detail-row">
                    <label>判定</label>
                    <div className="segmented">
                      {(["hold", "pass", "fail"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={`segment ${editOutcome === value ? "active" : ""}`}
                          onClick={() => setEditOutcome(value)}
                          disabled={saving}
                        >
                          {outcomeLabel(value)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="meta">
                    <a href={selectedRow.url} target="_blank" rel="noreferrer">
                      {selectedRow.url}
                    </a>
                  </div>
                  <div className="meta">
                    ステータス: {selectedRow.status} / 作成:{" "}
                    {new Date(selectedRow.createdAt).toLocaleString("ja-JP")}
                  </div>
                </div>
                <div className="badge">
                  {selectedRow.hasRecording ? "録画あり" : "録画なし"}
                </div>
              </div>

              <div className="media">
                <div className={`video ${selectedVideoUrl ? "" : "empty"}`}>
                  {selectedVideoUrl ? (
                    <video
                      ref={videoRef}
                      controls
                      src={selectedVideoUrl}
                      onTimeUpdate={(e) => setCurrentTimeSec(e.currentTarget.currentTime)}
                    />
                  ) : (
                    <div className="video-empty">
                      {loadingVideoId === selectedRow.interviewId
                        ? "動画を読み込み中..."
                        : selectedRow.hasRecording
                          ? "動画の取得に失敗しました"
                          : "録画がありません"}
                    </div>
                  )}
                </div>
                <div className="chat-panel">
                  <div className="chat-title">Chat Timeline</div>
                  <div className="chat-list">
                    {selectedChat.length === 0 ? (
                      <div className="chat-empty">チャットはまだありません</div>
                    ) : (
                      selectedChat.map((msg) => (
                        <button
                          key={msg.messageId}
                          className={`chat-item ${msg.role} ${msg.messageId === activeMessageId ? "active" : ""}`}
                          onClick={() => seekTo(msg.offsetMs)}
                          type="button"
                        >
                          <span className="time">{formatTime(msg.offsetMs)}</span>
                          <span className="speaker">
                            {msg.role === "interviewer" ? "面接官" : "候補者"}
                          </span>
                          <span className="text">{msg.text}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <div className="notes">
                <label>メモ</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="面接の気づきや評価メモを記録できます"
                />
              </div>
              {isDirty && (
                <div className="edit-actions">
                  <button className="ghost" onClick={cancelEdit} disabled={saving}>
                    キャンセル
                  </button>
                  <button className="primary" onClick={() => void saveDetails()} disabled={saving}>
                    {saving ? "保存中..." : "変更を保存"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: linear-gradient(160deg, #f4f7fb 0%, #e6edf6 45%, #dde6f2 100%);
          color: #0d1b2a;
          padding: 32px 32px 60px;
          font-family: "IBM Plex Sans", "Noto Sans JP", "Hiragino Sans", sans-serif;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 24px;
        }
        .user {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        h1 {
          margin: 0;
          font-size: 22px;
          line-height: 1.2;
        }
        .brand span {
          color: #1f4fb2;
        }
        .grid {
          display: grid;
          grid-template-columns: minmax(280px, 360px) minmax(520px, 1fr);
          gap: 20px;
          align-items: start;
        }
        .stack {
          display: grid;
          gap: 20px;
        }
        .card {
          background: #fff;
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 16px 40px rgba(19, 41, 72, 0.12);
          border: 1px solid rgba(28, 48, 74, 0.08);
        }
        .list-card {
          min-height: 420px;
        }
        .filters {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          font-size: 12px;
          color: #4b5c72;
          margin: -4px 0 12px;
        }
        .filter-chip {
          border: 1px solid #c9d3e3;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 12px;
          background: #f8fafc;
          color: #41526b;
          cursor: pointer;
        }
        .filter-chip.active {
          background: #e8f0ff;
          border-color: #1f4fb2;
          color: #1f4fb2;
          font-weight: 600;
        }
        .detail-card {
          min-height: 420px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .detail-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
        }
        .detail-row {
          display: grid;
          gap: 6px;
        }
        .detail-row label {
          font-size: 12px;
          color: #4b5c72;
        }
        .detail-row input {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #c7d3e6;
          font-size: 14px;
          background: #f8fafc;
          width: min(320px, 100%);
        }
        .segmented {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .segment {
          padding: 8px 14px;
          border-radius: 999px;
          border: 1px solid #c9d3e3;
          background: #f8fafc;
          font-size: 13px;
          cursor: pointer;
          color: #41526b;
        }
        .segment.active {
          background: #1f4fb2;
          border-color: #1f4fb2;
          color: #fff;
          font-weight: 600;
        }
        .segment:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .badge {
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          background: #eff3fb;
          color: #1f4fb2;
          border: 1px solid #d3dcf0;
          white-space: nowrap;
        }
        h2 {
          margin: 0 0 16px;
          font-size: 18px;
        }
        .form-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 12px;
        }
        label {
          font-size: 12px;
          color: #4b5c72;
        }
        input {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #c7d3e6;
          font-size: 14px;
          background: #f8fafc;
        }
        .primary {
          width: 100%;
          padding: 10px 12px;
          border-radius: 10px;
          border: none;
          background: #1f4fb2;
          color: #fff;
          font-weight: 600;
          cursor: pointer;
        }
        .primary:hover {
          background: #245bd1;
        }
        .result {
          margin-top: 14px;
          padding: 12px;
          border-radius: 12px;
          background: #f0f4fb;
          border: 1px solid #d4def0;
          display: grid;
          gap: 6px;
        }
        .result-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-size: 13px;
        }
        .result-row span {
          color: #5a6a82;
        }
        .error {
          color: #b42318;
          margin-top: 10px;
          font-size: 13px;
        }
        .list {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .row {
          padding: 14px;
          border-radius: 12px;
          background: #f6f8fc;
          border: 1px solid #d8e1f0;
          display: grid;
          gap: 10px;
          cursor: pointer;
        }
        .row.selected {
          border-color: #1f4fb2;
          background: #eef3ff;
          box-shadow: 0 10px 20px rgba(31, 79, 178, 0.12);
        }
        .row:hover {
          border-color: #9fb2d5;
          box-shadow: 0 8px 18px rgba(35, 63, 110, 0.12);
        }
        .row:focus-visible {
          outline: 2px solid #1f4fb2;
          outline-offset: 2px;
        }
        .title {
          font-weight: 600;
          margin-bottom: 4px;
        }
        .meta {
          font-size: 12px;
          color: #4b5c72;
          word-break: break-all;
        }
        .ghost {
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid #9fb2d5;
          background: #fff;
          color: #1f4fb2;
          font-weight: 600;
          cursor: pointer;
        }
        .ghost:disabled {
          color: #8a97ab;
          border-color: #c9d3e3;
          cursor: default;
        }
        .video video {
          width: 100%;
          border-radius: 12px;
          border: 1px solid #c9d3e3;
          background: #0b1220;
        }
        .video.empty {
          border-radius: 12px;
          border: 1px dashed #c2cde1;
          background: #f7f9fc;
          min-height: 240px;
          display: grid;
          place-items: center;
          color: #6b7a90;
          font-size: 14px;
        }
        .video-empty {
          padding: 24px;
          text-align: center;
        }
        .media {
          display: grid;
          grid-template-columns: minmax(320px, 1fr) minmax(220px, 320px);
          gap: 14px;
        }
        .chat-panel {
          border-radius: 12px;
          border: 1px solid #d8e1f0;
          background: #f5f8ff;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 360px;
          overflow: hidden;
        }
        .chat-title {
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #3a5a86;
        }
        .chat-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          overflow: auto;
          padding-right: 4px;
        }
        .chat-empty {
          font-size: 13px;
          color: #6b7a90;
        }
        .chat-item {
          border: 1px solid #d7e0f0;
          background: #fff;
          border-radius: 10px;
          padding: 8px 10px;
          display: grid;
          gap: 4px;
          text-align: left;
          cursor: pointer;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .chat-item:hover {
          border-color: #9fb2d5;
          box-shadow: 0 6px 14px rgba(35, 63, 110, 0.12);
        }
        .chat-item.active {
          border-color: #1f4fb2;
          box-shadow: 0 8px 18px rgba(31, 79, 178, 0.18);
          background: #eef3ff;
        }
        .chat-item.candidate {
          background: #f3f8ff;
        }
        .time {
          font-size: 11px;
          color: #3a4a63;
        }
        .speaker {
          font-size: 12px;
          font-weight: 600;
          color: #1f4fb2;
        }
        .text {
          font-size: 13px;
          color: #1c2a3a;
        }
        .notes {
          display: grid;
          gap: 6px;
        }
        .notes label {
          font-size: 12px;
          color: #4b5c72;
        }
        .notes textarea {
          min-height: 110px;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid #c7d3e6;
          font-size: 14px;
          background: #f8fafc;
          resize: vertical;
        }
        .edit-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        .edit-actions .primary,
        .edit-actions .ghost {
          width: auto;
        }
        .empty {
          color: #6b7a90;
          font-size: 14px;
          padding: 24px 0;
          text-align: center;
        }
        @media (max-width: 980px) {
          .grid {
            grid-template-columns: 1fr;
          }
          .detail-header {
            flex-direction: column;
          }
          .media {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}
