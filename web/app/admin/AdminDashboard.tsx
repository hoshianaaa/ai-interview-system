"use client";

import { useMemo, useState } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

type InterviewRow = {
  interviewId: string;
  url: string;
  status: string;
  candidateName: string | null;
  createdAt: string;
  hasRecording: boolean;
};

type CreateResponse =
  | { interviewId: string; roomName: string; url: string; candidateName: string | null }
  | { error: string };

export default function AdminDashboard({ interviews }: { interviews: InterviewRow[] }) {
  const [durationSec, setDurationSec] = useState(600);
  const [candidateName, setCandidateName] = useState("");
  const [createResult, setCreateResult] = useState<CreateResponse | null>(null);
  const [loadingVideoId, setLoadingVideoId] = useState<string | null>(null);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  async function loadVideo(interviewId: string) {
    setLoadingVideoId(interviewId);
    setSelectedId(interviewId);
    setSelectedVideoUrl(null);
    try {
      const res = await fetch(`/api/admin/interview/video?interviewId=${interviewId}`);
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        setSelectedVideoUrl(data.url);
      }
    } finally {
      setLoadingVideoId(null);
    }
  }

  const sorted = useMemo(
    () =>
      [...interviews].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [interviews]
  );

  return (
    <main className="page">
      <section className="header">
        <div>
          <p className="eyebrow">AI Interview Admin</p>
          <h1>面接管理ダッシュボード</h1>
          <p className="subtle">面接URLの発行、履歴確認、録画再生をまとめて管理します。</p>
        </div>
        <div className="user">
          <OrganizationSwitcher />
          <UserButton />
        </div>
      </section>

      <section className="grid">
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

        <div className="card wide">
          <h2>面接一覧</h2>
          {sorted.length === 0 ? (
            <div className="empty">面接データがありません</div>
          ) : (
            <div className="list">
              {sorted.map((row) => (
                <div key={row.interviewId} className="row">
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
                      ステータス: {row.status} / 作成:{" "}
                      {new Date(row.createdAt).toLocaleString("ja-JP")}
                    </div>
                  </div>
                  <div className="actions">
                    <button
                      className="ghost"
                      onClick={() => void loadVideo(row.interviewId)}
                      disabled={!row.hasRecording || loadingVideoId === row.interviewId}
                    >
                      {loadingVideoId === row.interviewId
                        ? "読み込み中..."
                        : row.hasRecording
                          ? "動画を再生"
                          : "録画なし"}
                    </button>
                  </div>
                  {selectedId === row.interviewId && selectedVideoUrl && (
                    <div className="video">
                      <video controls src={selectedVideoUrl} />
                    </div>
                  )}
                </div>
              ))}
            </div>
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
          align-items: flex-end;
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
          margin: 4px 0 8px;
          font-size: 28px;
        }
        .eyebrow {
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #3a5a86;
          margin: 0;
        }
        .subtle {
          color: #546178;
          margin: 0;
        }
        .grid {
          display: grid;
          grid-template-columns: minmax(280px, 360px) 1fr;
          gap: 20px;
          align-items: start;
        }
        .card {
          background: #fff;
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 16px 40px rgba(19, 41, 72, 0.12);
          border: 1px solid rgba(28, 48, 74, 0.08);
        }
        .card.wide {
          min-height: 420px;
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
        .actions {
          display: flex;
          justify-content: flex-end;
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
        }
      `}</style>
    </main>
  );
}
