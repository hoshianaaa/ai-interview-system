"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { DEFAULT_INTERVIEW_PROMPT } from "@/lib/prompts";

type InterviewRow = {
  interviewId: string;
  url: string;
  status: string;
  candidateName: string | null;
  prompt: string | null;
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

type PromptTemplate = {
  templateId: string;
  name: string;
  body: string;
  isDefault: boolean;
  createdAt: string;
};

type CreateResponse =
  | {
      interviewId: string;
      roomName: string;
      url: string;
      candidateName: string | null;
      expiresAt: string | null;
    }
  | { error: string };

export default function AdminDashboard({
  interviews,
  promptTemplates
}: {
  interviews: InterviewRow[];
  promptTemplates: PromptTemplate[];
}) {
  const [rows, setRows] = useState(interviews);
  const [durationMinInput, setDurationMinInput] = useState("10");
  const [expiresWeeks, setExpiresWeeks] = useState("1");
  const [expiresDays, setExpiresDays] = useState("0");
  const [expiresHours, setExpiresHours] = useState("0");
  const [candidateName, setCandidateName] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_INTERVIEW_PROMPT);
  const [templates, setTemplates] = useState(
    promptTemplates.map((row) => ({ ...row, isDefault: Boolean(row.isDefault) }))
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [detailMode, setDetailMode] = useState<"interview" | "templates">("interview");
  const [templateEditorId, setTemplateEditorId] = useState("");
  const [templateEditName, setTemplateEditName] = useState("");
  const [templateEditBody, setTemplateEditBody] = useState(DEFAULT_INTERVIEW_PROMPT);
  const [templateEditDefault, setTemplateEditDefault] = useState(false);
  const [templateEditError, setTemplateEditError] = useState<string | null>(null);
  const [templateEditSaving, setTemplateEditSaving] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [createResult, setCreateResult] = useState<CreateResponse | null>(null);
  const [loadingVideoId, setLoadingVideoId] = useState<string | null>(null);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<ChatItem[]>([]);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [editCandidateName, setEditCandidateName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const hasResult = createResult && "url" in createResult;

  async function createInterview() {
    setCreateResult(null);
    const parsedMin = Number(durationMinInput);
    const fallbackMin = 10;
    const normalizedMin = Number.isFinite(parsedMin) ? parsedMin : fallbackMin;
    const clampedMin = Math.min(30, Math.max(1, normalizedMin));
    const durationSec = Math.round(clampedMin * 60);
    const res = await fetch("/api/interview/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        durationSec,
        candidateName: candidateName.trim() || undefined,
        prompt,
        expiresInWeeks: Number(expiresWeeks),
        expiresInDays: Number(expiresDays),
        expiresInHours: Number(expiresHours)
      })
    });
    const data = (await res.json()) as CreateResponse;
    setCreateResult(data);
  }

  async function reloadTemplates() {
    setTemplateLoading(true);
    setTemplateEditError(null);
    try {
      const res = await fetch("/api/admin/prompt-templates");
      const data = (await res.json()) as { templates?: PromptTemplate[]; error?: string };
      if (Array.isArray(data.templates)) {
        setTemplates(data.templates.map((row) => ({ ...row, isDefault: Boolean(row.isDefault) })));
        if (
          templateEditorId &&
          !data.templates.some((row) => row.templateId === templateEditorId)
        ) {
          setTemplateEditorId("");
          setTemplateEditName("");
          setTemplateEditBody(DEFAULT_INTERVIEW_PROMPT);
          setTemplateEditDefault(false);
        }
        if (
          selectedTemplateId &&
          !data.templates.some((row) => row.templateId === selectedTemplateId)
        ) {
          setSelectedTemplateId("");
          setPrompt(DEFAULT_INTERVIEW_PROMPT);
        }
      } else if (data.error) {
        setTemplateEditError("テンプレートの取得に失敗しました");
      }
    } finally {
      setTemplateLoading(false);
    }
  }

  async function saveTemplate() {
    const name = templateEditName.trim();
    const body = templateEditBody.trim();
    if (!name) {
      setTemplateEditError("テンプレート名を入力してください");
      return;
    }
    if (!body) {
      setTemplateEditError("本文が空です");
      return;
    }
    setTemplateEditSaving(true);
    setTemplateEditError(null);
    try {
      const isUpdate = Boolean(templateEditorId);
      const res = await fetch("/api/admin/prompt-templates", {
        method: isUpdate ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateId: templateEditorId || undefined,
          name,
          body,
          isDefault: templateEditDefault
        })
      });
      const data = (await res.json()) as { template?: PromptTemplate; error?: string };
      if (data.template) {
        const normalized = { ...data.template, isDefault: Boolean(data.template.isDefault) };
        setTemplates((prev) => {
          const filtered = prev.filter((row) => row.templateId !== normalized.templateId);
          return [normalized, ...filtered];
        });
        setTemplateEditorId(normalized.templateId);
        setTemplateEditName(normalized.name);
        setTemplateEditBody(normalized.body);
        setTemplateEditDefault(normalized.isDefault);
        return;
      }
      if (res.status === 409) {
        setTemplateEditError("同名のテンプレートが既にあります");
        return;
      }
      setTemplateEditError(isUpdate ? "保存に失敗しました" : "作成に失敗しました");
    } finally {
      setTemplateEditSaving(false);
    }
  }

  async function deleteTemplate() {
    if (!templateEditorId) return;
    const ok = window.confirm("このテンプレートを削除しますか？");
    if (!ok) return;
    setTemplateEditSaving(true);
    setTemplateEditError(null);
    try {
      const res = await fetch("/api/admin/prompt-templates", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: templateEditorId })
      });
      if (res.ok) {
        setTemplates((prev) => prev.filter((row) => row.templateId !== templateEditorId));
        if (selectedTemplateId === templateEditorId) {
          setSelectedTemplateId("");
          setPrompt(DEFAULT_INTERVIEW_PROMPT);
        }
        setTemplateEditorId("");
        setTemplateEditName("");
        setTemplateEditBody(DEFAULT_INTERVIEW_PROMPT);
        setTemplateEditDefault(false);
        return;
      }
      setTemplateEditError("削除に失敗しました");
    } finally {
      setTemplateEditSaving(false);
    }
  }

  function resetTemplateEditor() {
    setTemplateEditError(null);
    if (!templateEditorId) {
      setTemplateEditName("");
      setTemplateEditBody(DEFAULT_INTERVIEW_PROMPT);
      setTemplateEditDefault(false);
      return;
    }
    const template = templates.find((row) => row.templateId === templateEditorId);
    if (template) {
      setTemplateEditName(template.name);
      setTemplateEditBody(template.body);
      setTemplateEditDefault(Boolean(template.isDefault));
    }
  }

  function selectTemplateForEdit(templateId: string) {
    setTemplateEditorId(templateId);
    setTemplateEditError(null);
    if (!templateId) {
      setTemplateEditName("");
      setTemplateEditBody(DEFAULT_INTERVIEW_PROMPT);
      setTemplateEditDefault(false);
      return;
    }
    const template = templates.find((row) => row.templateId === templateId);
    if (template) {
      setTemplateEditName(template.name);
      setTemplateEditBody(template.body);
      setTemplateEditDefault(Boolean(template.isDefault));
    }
  }

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    if (!templateId) {
      setPrompt(DEFAULT_INTERVIEW_PROMPT);
      return;
    }
    const template = templates.find((row) => row.templateId === templateId);
    setPrompt(template ? template.body : DEFAULT_INTERVIEW_PROMPT);
  }

  async function loadVideo(row: InterviewRow) {
    const interviewId = row.interviewId;
    setDetailMode("interview");
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
          notes: editNotes
        })
      });
      const data = (await res.json()) as {
        interviewId?: string;
        candidateName?: string | null;
        notes?: string | null;
      };
      if (data.interviewId) {
        setRows((prev) =>
          prev.map((row) =>
            row.interviewId === data.interviewId
              ? {
                  ...row,
                  candidateName: data.candidateName ?? null,
                  notes: data.notes ?? null
                }
              : row
          )
        );
        setEditCandidateName(data.candidateName ?? "");
        setEditNotes(data.notes ?? "");
      }
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    if (!selectedRow) return;
    setEditCandidateName(selectedRow.candidateName ?? "");
    setEditNotes(selectedRow.notes ?? "");
  }

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [rows]
  );
  const selectedRow = useMemo(
    () => (selectedId ? sorted.find((row) => row.interviewId === selectedId) ?? null : null),
    [sorted, selectedId]
  );
  const selectedTemplate = useMemo(
    () =>
      templateEditorId
        ? templates.find((row) => row.templateId === templateEditorId) ?? null
        : null,
    [templates, templateEditorId]
  );
  const defaultTemplate = useMemo(
    () => templates.find((row) => row.isDefault) ?? null,
    [templates]
  );
  const isDirty =
    Boolean(selectedRow) &&
    (editCandidateName !== (selectedRow?.candidateName ?? "") ||
      editNotes !== (selectedRow?.notes ?? ""));
  const templateDirty = selectedTemplate
    ? templateEditName !== selectedTemplate.name ||
      templateEditBody !== selectedTemplate.body ||
      templateEditDefault !== selectedTemplate.isDefault
    : Boolean(
        templateEditName.trim() || templateEditBody.trim() || templateEditDefault
      );
  const canSaveTemplate =
    Boolean(templateEditName.trim() && templateEditBody.trim()) &&
    (selectedTemplate ? templateDirty : true);

  useEffect(() => {
    if (!selectedRow) {
      setEditCandidateName("");
      setEditNotes("");
      return;
    }
    setEditCandidateName(selectedRow.candidateName ?? "");
    setEditNotes(selectedRow.notes ?? "");
  }, [selectedRow?.interviewId]);

  useEffect(() => {
    if (selectedTemplateId || prompt.trim() !== DEFAULT_INTERVIEW_PROMPT.trim()) return;
    if (defaultTemplate) {
      setSelectedTemplateId(defaultTemplate.templateId);
      setPrompt(defaultTemplate.body);
    }
  }, [defaultTemplate, selectedTemplateId, prompt]);

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
              <label>面接時間（分）</label>
              <select
                value={durationMinInput}
                onChange={(e) => setDurationMinInput(e.target.value)}
              >
                {Array.from({ length: 30 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}分
                  </option>
                ))}
              </select>
              <p className="helper">1〜30分の範囲で指定できます。</p>
            </div>
            <div className="form-row">
              <label>URL有効期限</label>
              <div className="expiry-grid">
                <select
                  value={expiresWeeks}
                  onChange={(e) => setExpiresWeeks(e.target.value)}
                  aria-label="有効期限の週"
                >
                  {Array.from({ length: 5 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}週
                    </option>
                  ))}
                </select>
                <select
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(e.target.value)}
                  aria-label="有効期限の日"
                >
                  {Array.from({ length: 7 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}日
                    </option>
                  ))}
                </select>
                <select
                  value={expiresHours}
                  onChange={(e) => setExpiresHours(e.target.value)}
                  aria-label="有効期限の時間"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}時間
                    </option>
                  ))}
                </select>
              </div>
              <p className="helper">デフォルトは1週間です。</p>
            </div>
            <div className="form-row">
              <label>テンプレート</label>
              <div className="template-controls">
                <select
                  value={selectedTemplateId}
                  onChange={(e) => applyTemplate(e.target.value)}
                >
                  <option value="">デフォルト（標準プロンプト）</option>
                  {templates.map((template) => (
                    <option key={template.templateId} value={template.templateId}>
                      {template.name}
                      {template.isDefault ? "（デフォルト）" : ""}
                    </option>
                  ))}
                </select>
                <button
                  className="ghost"
                  onClick={() => void reloadTemplates()}
                  type="button"
                  disabled={templateLoading}
                >
                  {templateLoading ? "取得中..." : "再読み込み"}
                </button>
              </div>
              <p className="helper">
                選択するとプロンプトに反映されます。{defaultTemplate
                  ? `現在のデフォルト: ${defaultTemplate.name}`
                  : "デフォルト未設定"}
              </p>
            </div>
            <div className="form-row">
              <label>プロンプト</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="面接AIの指示文を入力してください"
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
                {createResult.expiresAt && (
                  <div className="result-row">
                    <span>有効期限</span>
                    <strong>{new Date(createResult.expiresAt).toLocaleString("ja-JP")}</strong>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card template-card">
            <h2>プロンプトテンプレート</h2>
            <p className="helper">面接で使うプロンプトのテンプレートを管理します。</p>
            <button
              className="ghost"
              type="button"
              onClick={() => setDetailMode("templates")}
            >
              プロンプトテンプレート編集
            </button>
          </div>

          <div className="card list-card">
            <h2>面接一覧</h2>
            {sorted.length === 0 ? (
              <div className="empty">面接データがありません</div>
            ) : (
              <div className="list">
                {sorted.map((row) => (
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
                        ステータス: {row.status} / 作成:{" "}
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
          <div className="detail-title">
            <h2>{detailMode === "templates" ? "プロンプトテンプレート編集" : "面接詳細"}</h2>
          </div>
          {detailMode === "templates" ? (
            <div className="template-editor">
              <div className="form-row">
                <label>テンプレート一覧</label>
                <div className="template-controls">
                <select
                  value={templateEditorId}
                  onChange={(e) => selectTemplateForEdit(e.target.value)}
                >
                  <option value="">新規テンプレート</option>
                  {templates.map((template) => (
                    <option key={template.templateId} value={template.templateId}>
                      {template.name}
                      {template.isDefault ? "（デフォルト）" : ""}
                    </option>
                  ))}
                </select>
                <button
                    className="ghost"
                    onClick={() => void reloadTemplates()}
                    type="button"
                    disabled={templateLoading}
                  >
                    {templateLoading ? "取得中..." : "再読み込み"}
                  </button>
                </div>
                <p className="helper">テンプレートの作成・編集・削除ができます。</p>
              </div>
              <div className="form-row">
                <label>テンプレート名</label>
                <input
                  value={templateEditName}
                  onChange={(e) => setTemplateEditName(e.target.value)}
                  placeholder="例）PM候補者向け"
                />
              </div>
              <div className="form-row">
                <label>本文</label>
                <textarea
                  value={templateEditBody}
                  onChange={(e) => setTemplateEditBody(e.target.value)}
                  placeholder="テンプレート本文を入力してください"
                />
              </div>
              <div className="form-row">
                <label>デフォルト設定</label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={templateEditDefault}
                    onChange={(e) => setTemplateEditDefault(e.target.checked)}
                  />
                  <span>このテンプレートをデフォルトにする</span>
                </label>
                <p className="helper">
                  新規面接の初期プロンプトに自動反映されます。
                </p>
              </div>
              {templateEditError && <p className="error">{templateEditError}</p>}
              <div className="edit-actions">
                <button className="ghost" onClick={resetTemplateEditor} disabled={templateEditSaving}>
                  リセット
                </button>
                <button
                  className="primary"
                  onClick={() => void saveTemplate()}
                  disabled={!canSaveTemplate || templateEditSaving}
                >
                  {templateEditSaving ? "保存中..." : "保存"}
                </button>
              </div>
              {templateEditorId && (
                <button
                  className="danger"
                  type="button"
                  onClick={() => void deleteTemplate()}
                  disabled={templateEditSaving}
                >
                  テンプレートを削除
                </button>
              )}
            </div>
          ) : !selectedRow ? (
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
              <details className="prompt">
                <summary>プロンプトを見る</summary>
                <textarea value={selectedRow.prompt ?? ""} readOnly />
              </details>
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
        select {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #c7d3e6;
          font-size: 14px;
          background: #f8fafc;
        }
        .form-row textarea {
          min-height: 140px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #c7d3e6;
          font-size: 13px;
          line-height: 1.4;
          background: #f8fafc;
          resize: vertical;
        }
        .template-controls {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .template-controls select {
          flex: 1;
        }
        .expiry-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .helper {
          margin: 6px 0 0;
          font-size: 12px;
          color: #6b7a90;
        }
        .detail-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }
        .detail-title h2 {
          margin: 0;
        }
        .template-card {
          display: grid;
          gap: 10px;
        }
        .template-card .ghost {
          width: 100%;
        }
        .template-editor {
          display: grid;
          gap: 14px;
        }
        .checkbox {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #1c2a3a;
        }
        .checkbox input {
          width: 16px;
          height: 16px;
        }
        .danger {
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid #f5b7b1;
          background: #fff;
          color: #b42318;
          font-weight: 600;
          cursor: pointer;
        }
        .danger:disabled {
          color: #8a97ab;
          border-color: #f0d5d1;
          cursor: default;
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
        .prompt {
          border-radius: 12px;
          border: 1px dashed #c7d3e6;
          background: #f8fafc;
          padding: 10px 12px;
          display: grid;
          gap: 10px;
          width: 100%;
        }
        .prompt summary {
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          color: #1f4fb2;
          list-style: none;
        }
        .prompt summary::-webkit-details-marker {
          display: none;
        }
        .prompt textarea {
          min-height: 140px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #c7d3e6;
          font-size: 13px;
          line-height: 1.4;
          background: #fff;
          resize: vertical;
          width: 100%;
          box-sizing: border-box;
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
