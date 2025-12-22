"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { DEFAULT_INTERVIEW_PROMPT } from "@/lib/prompts";

type Decision = "undecided" | "pass" | "fail" | "hold";

type InterviewRow = {
  interviewId: string;
  applicationId: string;
  url: string;
  status: string;
  decision: Decision;
  round: number;
  applicationCandidateName: string | null;
  applicationNotes: string | null;
  applicationCreatedAt: string;
  applicationUpdatedAt: string;
  prompt: string | null;
  durationSec: number;
  expiresAt: string | null;
  createdAt: string;
  hasRecording: boolean;
};

type ApplicationData = {
  applicationId: string;
  candidateName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApplicationRow = {
  applicationId: string;
  candidateName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  interviewCount: number;
  latestRound: number;
  latestDecision: Decision;
  latestCreatedAt: string;
  interviews: InterviewRow[];
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

type OrgSettings = {
  defaultDurationMin: number;
  defaultExpiresWeeks: number;
  defaultExpiresDays: number;
  defaultExpiresHours: number;
};

type CreateResponse =
  | {
      interviewId: string;
      applicationId: string;
      round: number;
      roomName: string;
      url: string;
      candidateName: string | null;
      expiresAt: string | null;
      interviewCreatedAt?: string | null;
      applicationCreatedAt?: string | null;
      applicationUpdatedAt?: string | null;
      durationSec?: number | null;
      prompt?: string | null;
    }
  | { error: string };

const MAX_EXPIRES_WEEKS = 4;
const MAX_EXPIRES_DAYS = 6;
const MAX_EXPIRES_HOURS = 23;
const DEFAULT_EXPIRES_WEEKS = 1;

export default function AdminDashboard({
  interviews,
  applications: initialApplications,
  promptTemplates,
  settings
}: {
  interviews: InterviewRow[];
  applications: ApplicationData[];
  promptTemplates: PromptTemplate[];
  settings: OrgSettings;
}) {
  const [rows, setRows] = useState(interviews);
  const [applications, setApplications] = useState(initialApplications);
  const [orgSettings, setOrgSettings] = useState(settings);
  const [durationMinInput, setDurationMinInput] = useState(
    String(settings.defaultDurationMin)
  );
  const [expiresWeeks, setExpiresWeeks] = useState(
    String(settings.defaultExpiresWeeks)
  );
  const [expiresDays, setExpiresDays] = useState(
    String(settings.defaultExpiresDays)
  );
  const [expiresHours, setExpiresHours] = useState(
    String(settings.defaultExpiresHours)
  );
  const [newCandidateName, setNewCandidateName] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_INTERVIEW_PROMPT);
  const [templates, setTemplates] = useState(
    promptTemplates.map((row) => ({ ...row, isDefault: Boolean(row.isDefault) }))
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [detailMode, setDetailMode] = useState<"settings" | "application">(
    "application"
  );
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
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<ChatItem[]>([]);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [editApplicationCandidateName, setEditApplicationCandidateName] = useState("");
  const [editApplicationNotes, setEditApplicationNotes] = useState("");
  const [editDecision, setEditDecision] = useState<Decision>("undecided");
  const [savingInterview, setSavingInterview] = useState(false);
  const [savingApplication, setSavingApplication] = useState(false);
  const [reissueOpen, setReissueOpen] = useState(false);
  const [reissuePrompt, setReissuePrompt] = useState(DEFAULT_INTERVIEW_PROMPT);
  const [reissueWeeks, setReissueWeeks] = useState("1");
  const [reissueDays, setReissueDays] = useState("0");
  const [reissueHours, setReissueHours] = useState("0");
  const [reissueResult, setReissueResult] = useState<CreateResponse | null>(null);
  const [reissueSaving, setReissueSaving] = useState(false);
  const [applicationInterviewResult, setApplicationInterviewResult] =
    useState<CreateResponse | null>(null);
  const [deletingInterview, setDeletingInterview] = useState(false);
  const [deletingApplication, setDeletingApplication] = useState(false);
  const [settingsDurationMin, setSettingsDurationMin] = useState(
    String(settings.defaultDurationMin)
  );
  const [settingsExpiresWeeks, setSettingsExpiresWeeks] = useState(
    String(settings.defaultExpiresWeeks)
  );
  const [settingsExpiresDays, setSettingsExpiresDays] = useState(
    String(settings.defaultExpiresDays)
  );
  const [settingsExpiresHours, setSettingsExpiresHours] = useState(
    String(settings.defaultExpiresHours)
  );
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const hasResult = createResult && "url" in createResult;
  const hasReissueResult = reissueResult && "url" in reissueResult;
  const hasApplicationInterviewResult =
    applicationInterviewResult && "url" in applicationInterviewResult;

  const normalizeDurationMin = (value: string, fallback: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const normalized = Math.floor(parsed);
    return Math.min(30, Math.max(1, normalized));
  };

  const parseExpiryPart = (value: string, max: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    const normalized = Math.floor(parsed);
    return Math.min(max, Math.max(0, normalized));
  };

  const getDefaultDurationSec = () => {
    const clampedMin = normalizeDurationMin(
      durationMinInput,
      orgSettings.defaultDurationMin
    );
    return Math.round(clampedMin * 60);
  };

  async function requestInterview(payload: Record<string, unknown>) {
    const res = await fetch("/api/interview/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    return (await res.json()) as CreateResponse;
  }

  function buildApplicationFromResponse(
    data: CreateResponse & { url: string },
    fallback?: Partial<ApplicationData>
  ): ApplicationData {
    const createdAt =
      data.applicationCreatedAt ?? fallback?.createdAt ?? new Date().toISOString();
    const updatedAt =
      data.applicationUpdatedAt ?? fallback?.updatedAt ?? createdAt;
    return {
      applicationId: data.applicationId,
      candidateName: data.candidateName ?? fallback?.candidateName ?? null,
      notes: fallback?.notes ?? null,
      createdAt,
      updatedAt
    };
  }

  function buildInterviewFromResponse(
    data: CreateResponse & { url: string },
    app: ApplicationData
  ): InterviewRow {
    return {
      interviewId: data.interviewId,
      applicationId: data.applicationId,
      url: data.url,
      status: "実施待ち",
      decision: "undecided",
      round: data.round,
      applicationCandidateName: data.candidateName ?? app.candidateName,
      applicationNotes: app.notes,
      applicationCreatedAt: app.createdAt,
      applicationUpdatedAt: app.updatedAt,
      prompt: data.prompt ?? prompt,
      durationSec: data.durationSec ?? getDefaultDurationSec(),
      expiresAt: data.expiresAt ?? null,
      createdAt: data.interviewCreatedAt ?? new Date().toISOString(),
      hasRecording: false
    };
  }

  function upsertApplication(app: ApplicationData) {
    setApplications((prev) => {
      if (prev.some((row) => row.applicationId === app.applicationId)) {
        return prev;
      }
      return [app, ...prev];
    });
  }

  function insertInterview(row: InterviewRow) {
    setRows((prev) => {
      if (prev.some((existing) => existing.interviewId === row.interviewId)) {
        return prev;
      }
      return [row, ...prev];
    });
  }

  async function createInterview() {
    setCreateResult(null);
    const durationSec = getDefaultDurationSec();
    const payload: Record<string, unknown> = {
      durationSec,
      prompt,
      expiresInWeeks: Number(expiresWeeks),
      expiresInDays: Number(expiresDays),
      expiresInHours: Number(expiresHours)
    };
    const trimmedName = newCandidateName.trim();
    if (trimmedName) payload.candidateName = trimmedName;
    const data = await requestInterview(payload);
    setCreateResult(data);
    if ("url" in data) {
      const application = buildApplicationFromResponse(data, {
        candidateName: trimmedName || null,
        notes: null
      });
      upsertApplication(application);
      insertInterview(buildInterviewFromResponse(data, application));
      selectApplication(data.applicationId);
    }
  }

  async function createInterviewForApplication(
    applicationId: string,
    overrides?: {
      prompt?: string;
      expiresWeeks?: number;
      expiresDays?: number;
      expiresHours?: number;
      durationSec?: number;
      round?: number;
    },
    onResult?: (data: CreateResponse) => void
  ) {
    const payload: Record<string, unknown> = {
      applicationId,
      durationSec: overrides?.durationSec ?? getDefaultDurationSec(),
      prompt: overrides?.prompt ?? prompt,
      expiresInWeeks: overrides?.expiresWeeks ?? Number(expiresWeeks),
      expiresInDays: overrides?.expiresDays ?? Number(expiresDays),
      expiresInHours: overrides?.expiresHours ?? Number(expiresHours)
    };
    if (overrides?.round) {
      payload.round = overrides.round;
    }
    const data = await requestInterview(payload);
    if ("url" in data) {
      const existing = applications.find((row) => row.applicationId === applicationId);
      const application = buildApplicationFromResponse(data, existing ?? undefined);
      upsertApplication(application);
      insertInterview(buildInterviewFromResponse(data, application));
    }
    if (onResult) onResult(data);
    return data;
  }

  async function createNextInterview() {
    if (!selectedRow) return;
    setApplicationInterviewResult(null);
    await createInterviewForApplication(
      selectedRow.applicationId,
      undefined,
      setApplicationInterviewResult
    );
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

  async function saveSettings() {
    setSettingsSaving(true);
    setSettingsError(null);
    let defaultExpiresWeeks = parseExpiryPart(settingsExpiresWeeks, MAX_EXPIRES_WEEKS);
    let defaultExpiresDays = parseExpiryPart(settingsExpiresDays, MAX_EXPIRES_DAYS);
    let defaultExpiresHours = parseExpiryPart(settingsExpiresHours, MAX_EXPIRES_HOURS);
    if (defaultExpiresWeeks + defaultExpiresDays + defaultExpiresHours === 0) {
      defaultExpiresWeeks = DEFAULT_EXPIRES_WEEKS;
    }
    const payload = {
      defaultDurationMin: normalizeDurationMin(
        settingsDurationMin,
        orgSettings.defaultDurationMin
      ),
      defaultExpiresWeeks,
      defaultExpiresDays,
      defaultExpiresHours
    };
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = (await res.json()) as { settings?: OrgSettings; error?: string };
      if (!res.ok || !data.settings) {
        setSettingsError("保存に失敗しました");
        return;
      }
      setOrgSettings(data.settings);
      setSettingsDurationMin(String(data.settings.defaultDurationMin));
      setSettingsExpiresWeeks(String(data.settings.defaultExpiresWeeks));
      setSettingsExpiresDays(String(data.settings.defaultExpiresDays));
      setSettingsExpiresHours(String(data.settings.defaultExpiresHours));
      setDurationMinInput(String(data.settings.defaultDurationMin));
      setExpiresWeeks(String(data.settings.defaultExpiresWeeks));
      setExpiresDays(String(data.settings.defaultExpiresDays));
      setExpiresHours(String(data.settings.defaultExpiresHours));
    } finally {
      setSettingsSaving(false);
    }
  }

  function resetSettings() {
    setSettingsError(null);
    setSettingsDurationMin(String(orgSettings.defaultDurationMin));
    setSettingsExpiresWeeks(String(orgSettings.defaultExpiresWeeks));
    setSettingsExpiresDays(String(orgSettings.defaultExpiresDays));
    setSettingsExpiresHours(String(orgSettings.defaultExpiresHours));
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

  function selectApplication(applicationId: string) {
    setDetailMode("application");
    setSelectedApplicationId(applicationId);
  }

  async function loadVideo(row: InterviewRow) {
    const interviewId = row.interviewId;
    setDetailMode("application");
    setLoadingVideoId(interviewId);
    setSelectedId(interviewId);
    setSelectedApplicationId(row.applicationId);
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

  const decisionLabel = (value: Decision) => {
    if (value === "pass") return "通過";
    if (value === "fail") return "不合格";
    if (value === "hold") return "保留";
    return "未判定";
  };

  const getExpiryParts = (createdAt: string, expiresAt: string | null) => {
    if (!expiresAt) {
      return {
        weeks: String(DEFAULT_EXPIRES_WEEKS),
        days: "0",
        hours: "0"
      };
    }
    const createdMs = new Date(createdAt).getTime();
    const expiresMs = new Date(expiresAt).getTime();
    const totalHours = Math.max(0, Math.round((expiresMs - createdMs) / (60 * 60 * 1000)));
    let weeks = Math.min(MAX_EXPIRES_WEEKS, Math.floor(totalHours / 168));
    let remaining = totalHours - weeks * 168;
    let days = Math.min(MAX_EXPIRES_DAYS, Math.floor(remaining / 24));
    remaining -= days * 24;
    let hours = Math.min(MAX_EXPIRES_HOURS, remaining);
    if (weeks + days + hours === 0) {
      weeks = DEFAULT_EXPIRES_WEEKS;
    }
    return {
      weeks: String(weeks),
      days: String(days),
      hours: String(hours)
    };
  };

  const seekTo = (offsetMs: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = offsetMs / 1000;
  };

  async function saveInterviewDecision(nextDecision: Decision) {
    if (!selectedRow) return;
    setSavingInterview(true);
    try {
      const res = await fetch("/api/admin/interview/update", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interviewId: selectedRow.interviewId,
          decision: nextDecision
        })
      });
      const data = (await res.json()) as {
        interviewId?: string;
        decision?: Decision;
      };
      if (data.interviewId) {
        setRows((prev) =>
          prev.map((row) =>
            row.interviewId === data.interviewId
              ? {
                  ...row,
                  decision: data.decision ?? row.decision
                }
              : row
          )
        );
        setEditDecision(data.decision ?? nextDecision);
      }
    } finally {
      setSavingInterview(false);
    }
  }

  async function saveApplicationDetails() {
    if (!selectedApplication) return;
    setSavingApplication(true);
    const trimmedName = editApplicationCandidateName.trim();
    try {
      const res = await fetch("/api/admin/application/update", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicationId: selectedApplication.applicationId,
          candidateName: trimmedName,
          notes: editApplicationNotes
        })
      });
      const data = (await res.json()) as {
        applicationId?: string;
        candidateName?: string | null;
        notes?: string | null;
        updatedAt?: string;
      };
      if (data.applicationId) {
        setApplications((prev) =>
          prev.map((row) =>
            row.applicationId === data.applicationId
              ? {
                  ...row,
                  candidateName: data.candidateName ?? null,
                  notes: data.notes ?? null,
                  updatedAt: data.updatedAt ?? row.updatedAt
                }
              : row
          )
        );
        setEditApplicationCandidateName(data.candidateName ?? "");
        setEditApplicationNotes(data.notes ?? "");
      }
    } finally {
      setSavingApplication(false);
    }
  }

  const handleDecisionChange = (value: Decision) => {
    setEditDecision(value);
    if (!selectedRow) return;
    if (isDecisionLocked) return;
    if (value === selectedRow.decision) return;
    void saveInterviewDecision(value);
  };

  async function reissueInterview() {
    if (!selectedRow) return;
    setReissueSaving(true);
    setReissueResult(null);
    try {
      await createInterviewForApplication(
        selectedRow.applicationId,
        {
          prompt: reissuePrompt,
          expiresWeeks: Number(reissueWeeks),
          expiresDays: Number(reissueDays),
          expiresHours: Number(reissueHours),
          durationSec: selectedRow.durationSec,
          round: selectedRow.round
        },
        setReissueResult
      );
    } finally {
      setReissueSaving(false);
    }
  }

  async function deleteInterview() {
    if (!selectedRow) return;
    const ok = window.confirm("この面接を削除しますか？");
    if (!ok) return;
    setDeletingInterview(true);
    try {
      const res = await fetch("/api/admin/interview/delete", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interviewId: selectedRow.interviewId })
      });
      if (!res.ok) return;
      setRows((prev) => prev.filter((row) => row.interviewId !== selectedRow.interviewId));
      setSelectedId(null);
      setSelectedVideoUrl(null);
      setSelectedChat([]);
    } finally {
      setDeletingInterview(false);
    }
  }

  async function deleteApplication() {
    if (!selectedApplication) return;
    const ok = window.confirm("この応募を削除しますか？関連する面接も削除されます。");
    if (!ok) return;
    setDeletingApplication(true);
    try {
      const res = await fetch("/api/admin/application/delete", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ applicationId: selectedApplication.applicationId })
      });
      if (!res.ok) return;
      setApplications((prev) =>
        prev.filter((row) => row.applicationId !== selectedApplication.applicationId)
      );
      setRows((prev) =>
        prev.filter((row) => row.applicationId !== selectedApplication.applicationId)
      );
      setSelectedApplicationId(null);
      setSelectedId(null);
      setSelectedVideoUrl(null);
      setSelectedChat([]);
    } finally {
      setDeletingApplication(false);
    }
  }

  function cancelApplicationEdit() {
    if (!selectedApplication) return;
    setEditApplicationCandidateName(selectedApplication.candidateName ?? "");
    setEditApplicationNotes(selectedApplication.notes ?? "");
  }

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [rows]
  );
  const applicationRows = useMemo(() => {
    const grouped = new Map<string, ApplicationRow>();
    for (const app of applications) {
      grouped.set(app.applicationId, {
        applicationId: app.applicationId,
        candidateName: app.candidateName ?? null,
        notes: app.notes ?? null,
        createdAt: app.createdAt,
        updatedAt: app.updatedAt,
        interviewCount: 0,
        latestRound: 0,
        latestDecision: "undecided",
        latestCreatedAt: app.createdAt,
        interviews: []
      });
    }
    for (const row of rows) {
      let existing = grouped.get(row.applicationId);
      if (!existing) {
        existing = {
          applicationId: row.applicationId,
          candidateName: row.applicationCandidateName ?? null,
          notes: row.applicationNotes ?? null,
          createdAt: row.applicationCreatedAt,
          updatedAt: row.applicationUpdatedAt,
          interviewCount: 0,
          latestRound: 0,
          latestDecision: "undecided",
          latestCreatedAt: row.createdAt,
          interviews: []
        };
        grouped.set(row.applicationId, existing);
      }
      existing.interviews.push(row);
      existing.interviewCount += 1;
      if (!existing.candidateName && row.applicationCandidateName) {
        existing.candidateName = row.applicationCandidateName;
      }
      if (!existing.notes && row.applicationNotes) {
        existing.notes = row.applicationNotes;
      }
      if (row.round > existing.latestRound) {
        existing.latestRound = row.round;
        existing.latestDecision = row.decision;
        existing.latestCreatedAt = row.createdAt;
      } else if (row.round === existing.latestRound) {
        if (new Date(row.createdAt).getTime() > new Date(existing.latestCreatedAt).getTime()) {
          existing.latestDecision = row.decision;
          existing.latestCreatedAt = row.createdAt;
        }
      }
      if (new Date(row.applicationUpdatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
        existing.updatedAt = row.applicationUpdatedAt;
      }
    }
    return [...grouped.values()].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [applications, rows]);
  const selectedApplication = useMemo(
    () =>
      selectedApplicationId
        ? applicationRows.find((row) => row.applicationId === selectedApplicationId) ?? null
        : null,
    [applicationRows, selectedApplicationId]
  );
  const selectedRow = useMemo(() => {
    if (selectedApplication) {
      if (!selectedId) return null;
      return (
        selectedApplication.interviews.find((row) => row.interviewId === selectedId) ?? null
      );
    }
    return selectedId ? sorted.find((row) => row.interviewId === selectedId) ?? null : null;
  }, [selectedApplication, selectedId, sorted]);
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
  const isDecisionLocked = selectedRow?.status === "実施待ち";
  const normalizedApplicationName = editApplicationCandidateName.trim();
  const normalizedApplicationNotes = editApplicationNotes.trim();
  const applicationDirty =
    Boolean(selectedApplication) &&
    (normalizedApplicationName !== (selectedApplication?.candidateName ?? "") ||
      normalizedApplicationNotes !== (selectedApplication?.notes ?? ""));
  const canCreateAdditionalInterview = Boolean(
    selectedApplication &&
      (selectedApplication.interviewCount === 0 || selectedApplication.latestDecision === "pass")
  );
  const createInterviewLabel =
    selectedApplication?.interviewCount === 0 ? "面接を追加" : "次の面接URLを発行";
  const canReissueInterview =
    selectedRow?.status === "未参加" || selectedRow?.status === "失敗（エラー）";
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
  const settingsDirty =
    settingsDurationMin !== String(orgSettings.defaultDurationMin) ||
    settingsExpiresWeeks !== String(orgSettings.defaultExpiresWeeks) ||
    settingsExpiresDays !== String(orgSettings.defaultExpiresDays) ||
    settingsExpiresHours !== String(orgSettings.defaultExpiresHours);

  useEffect(() => {
    if (!selectedRow) {
      setEditDecision("undecided");
      setReissueOpen(false);
      setReissueResult(null);
      setReissuePrompt(DEFAULT_INTERVIEW_PROMPT);
      setReissueWeeks(String(DEFAULT_EXPIRES_WEEKS));
      setReissueDays("0");
      setReissueHours("0");
      return;
    }
    setEditDecision(selectedRow.decision ?? "undecided");
    setReissueOpen(false);
    setReissueResult(null);
    setReissuePrompt(selectedRow.prompt ?? DEFAULT_INTERVIEW_PROMPT);
    const expiry = getExpiryParts(selectedRow.createdAt, selectedRow.expiresAt);
    setReissueWeeks(expiry.weeks);
    setReissueDays(expiry.days);
    setReissueHours(expiry.hours);
  }, [selectedRow?.interviewId]);

  useEffect(() => {
    if (!selectedApplication) {
      setEditApplicationCandidateName("");
      setEditApplicationNotes("");
      setApplicationInterviewResult(null);
      return;
    }
    setEditApplicationCandidateName(selectedApplication.candidateName ?? "");
    setEditApplicationNotes(selectedApplication.notes ?? "");
    setApplicationInterviewResult(null);
  }, [selectedApplication?.applicationId]);

  useEffect(() => {
    if (!selectedApplication) {
      setSelectedId(null);
      return;
    }
    if (!selectedApplication.interviews.length) {
      setSelectedId(null);
      return;
    }
    const exists =
      selectedId &&
      selectedApplication.interviews.some((row) => row.interviewId === selectedId);
    if (exists) return;
    const next = [...selectedApplication.interviews].sort((a, b) => {
      if (a.round !== b.round) return b.round - a.round;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })[0];
    if (next) {
      void loadVideo(next);
    }
  }, [selectedApplication, selectedId]);

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
            <button
              type="button"
              className="brand-button"
              onClick={() => window.location.reload()}
            >
              PM1 <span>AI Interview</span>
            </button>
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
            <h2>新規応募の追加</h2>
            <p className="helper">候補者名は応募に保存され、面接設定は1次面接に使われます。</p>
            <div className="form-row">
              <label>候補者名（任意）</label>
              <input
                value={newCandidateName}
                onChange={(e) => setNewCandidateName(e.target.value)}
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
              <p className="helper">デフォルトは設定で変更できます。</p>
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
              応募を追加
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
                <div className="result-row">
                  <span>面接ラウンド</span>
                  <strong>第{createResult.round}次</strong>
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

          <div className="card list-card">
            <div className="list-header">
              <h2>応募一覧</h2>
            </div>
            {applicationRows.length === 0 ? (
              <div className="empty">応募データがありません</div>
            ) : (
              <div className="list">
                {applicationRows.map((app) => (
                  <div
                    key={app.applicationId}
                    className={`row ${selectedApplicationId === app.applicationId ? "selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectApplication(app.applicationId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectApplication(app.applicationId);
                      }
                    }}
                  >
                    <div>
                      <div className="title-row">
                        <div className="title">
                          {app.candidateName ? app.candidateName : "候補者名なし"}
                        </div>
                        <span className="round-tag">面接{app.interviewCount}件</span>
                        <span className={`decision-tag ${app.latestDecision}`}>
                          {decisionLabel(app.latestDecision)}
                        </span>
                      </div>
                      <div className="meta">
                        {app.interviewCount === 0
                          ? "面接未実施"
                          : `最新面接: 第${app.latestRound}次 / 作成: ${new Date(app.latestCreatedAt).toLocaleString("ja-JP")}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card settings-card">
            <h2>設定</h2>
            <p className="helper">面接のデフォルト設定とテンプレートを管理します。</p>
            <button
              className="ghost"
              type="button"
              onClick={() => setDetailMode("settings")}
            >
              設定を開く
            </button>
          </div>
        </div>

        <div className="card detail-card">
          <div className="detail-title">
            <h2>
              {detailMode === "settings" ? "設定" : "応募詳細"}
            </h2>
            {detailMode !== "settings" && selectedApplication && (
              <button
                className="danger"
                type="button"
                onClick={() => void deleteApplication()}
                disabled={deletingApplication}
              >
                {deletingApplication ? "削除中..." : "応募を削除"}
              </button>
            )}
          </div>
          {detailMode === "settings" ? (
            <div className="settings">
              <div className="settings-section">
                <h3>デフォルト面接設定</h3>
                <div className="form-row">
                  <label>面接時間（分）</label>
                  <select
                    value={settingsDurationMin}
                    onChange={(e) => setSettingsDurationMin(e.target.value)}
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
                      value={settingsExpiresWeeks}
                      onChange={(e) => setSettingsExpiresWeeks(e.target.value)}
                      aria-label="有効期限の週"
                    >
                      {Array.from({ length: MAX_EXPIRES_WEEKS + 1 }, (_, i) => (
                        <option key={i} value={i}>
                          {i}週
                        </option>
                      ))}
                    </select>
                    <select
                      value={settingsExpiresDays}
                      onChange={(e) => setSettingsExpiresDays(e.target.value)}
                      aria-label="有効期限の日"
                    >
                      {Array.from({ length: MAX_EXPIRES_DAYS + 1 }, (_, i) => (
                        <option key={i} value={i}>
                          {i}日
                        </option>
                      ))}
                    </select>
                    <select
                      value={settingsExpiresHours}
                      onChange={(e) => setSettingsExpiresHours(e.target.value)}
                      aria-label="有効期限の時間"
                    >
                      {Array.from({ length: MAX_EXPIRES_HOURS + 1 }, (_, i) => (
                        <option key={i} value={i}>
                          {i}時間
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="helper">新規応募/面接作成時の初期値に反映されます。</p>
                </div>
                {settingsError && <p className="error">{settingsError}</p>}
                <div className="edit-actions">
                  <button
                    className="ghost"
                    onClick={resetSettings}
                    disabled={!settingsDirty || settingsSaving}
                  >
                    リセット
                  </button>
                  <button
                    className="primary"
                    onClick={() => void saveSettings()}
                    disabled={!settingsDirty || settingsSaving}
                  >
                    {settingsSaving ? "保存中..." : "保存"}
                  </button>
                </div>
              </div>
              <div className="settings-section">
                <h3>プロンプトテンプレート</h3>
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
                    <button
                      className="ghost"
                      onClick={resetTemplateEditor}
                      disabled={templateEditSaving}
                    >
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
              </div>
            </div>
          ) : !selectedApplication ? (
            <div className="empty">左の一覧から応募を選択してください</div>
          ) : (
            <div className="application-detail">
              <div className="detail-row">
                <label>候補者名</label>
                <input
                  value={editApplicationCandidateName}
                  onChange={(e) => setEditApplicationCandidateName(e.target.value)}
                  placeholder="候補者名を入力"
                  disabled={savingApplication}
                />
              </div>
              <div className="detail-row">
                <label>応募作成</label>
                <div className="detail-value">
                  {new Date(selectedApplication.createdAt).toLocaleString("ja-JP")}
                </div>
              </div>
              <div className="notes">
                <label>メモ</label>
                <textarea
                  value={editApplicationNotes}
                  onChange={(e) => setEditApplicationNotes(e.target.value)}
                  placeholder="応募に関するメモを記録できます"
                  disabled={savingApplication}
                />
              </div>
              {applicationDirty && (
                <div className="detail-actions">
                  <button
                    className="ghost"
                    type="button"
                    onClick={cancelApplicationEdit}
                    disabled={savingApplication}
                  >
                    キャンセル
                  </button>
                  <button
                    className="primary"
                    type="button"
                    onClick={() => void saveApplicationDetails()}
                    disabled={savingApplication}
                  >
                    {savingApplication ? "保存中..." : "応募を保存"}
                  </button>
                </div>
              )}
              {canCreateAdditionalInterview && (
                <div className="detail-actions">
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => {
                      setApplicationInterviewResult(null);
                      void createInterviewForApplication(
                        selectedApplication.applicationId,
                        undefined,
                        setApplicationInterviewResult
                      );
                    }}
                  >
                    {createInterviewLabel}
                  </button>
                </div>
              )}
              {applicationInterviewResult && "error" in applicationInterviewResult && (
                <p className="error">作成に失敗しました: {applicationInterviewResult.error}</p>
              )}
              {hasApplicationInterviewResult && (
                <div className="result">
                  <div className="result-row">
                    <span>面接URL</span>
                    <a href={applicationInterviewResult.url} target="_blank" rel="noreferrer">
                      {applicationInterviewResult.url}
                    </a>
                  </div>
                  {applicationInterviewResult.expiresAt && (
                    <div className="result-row">
                      <span>有効期限</span>
                      <strong>
                        {new Date(applicationInterviewResult.expiresAt).toLocaleString("ja-JP")}
                      </strong>
                    </div>
                  )}
                </div>
              )}
              <div className="application-interviews">
                <div className="section-title">面接一覧</div>
                {selectedApplication.interviews.length === 0 ? (
                  <div className="empty">面接がありません</div>
                ) : (
                  <div className="form-row">
                    <label>面接を選択</label>
                    <select
                      value={selectedRow?.interviewId ?? ""}
                      onChange={(e) => {
                        const interviewId = e.target.value;
                        const next = selectedApplication.interviews.find(
                          (row) => row.interviewId === interviewId
                        );
                        if (next) void loadVideo(next);
                      }}
                    >
                      <option value="" disabled>
                        面接を選択してください
                      </option>
                      {selectedApplication.interviews
                        .slice()
                        .sort((a, b) => {
                          if (a.round !== b.round) return b.round - a.round;
                          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                        })
                        .map((row) => (
                          <option key={row.interviewId} value={row.interviewId}>
                            第{row.round}次（{decisionLabel(row.decision)}）{" "}
                            {new Date(row.createdAt).toLocaleString("ja-JP")}
                          </option>
                        ))}
                    </select>
                    <p className="helper">最新の面接が初期選択されます。</p>
                  </div>
                )}
              </div>
              <div className="section-title-row">
                <div className="section-title">面接詳細</div>
                {selectedRow && (
                  <button
                    className="danger"
                    type="button"
                    onClick={() => void deleteInterview()}
                    disabled={deletingInterview}
                  >
                    {deletingInterview ? "削除中..." : "面接を削除"}
                  </button>
                )}
              </div>
              {selectedRow ? (
                <div className="interview-detail">
                  <div className="detail-header">
                    <div>
                      <div className="detail-row">
                        <label>判定</label>
                        <select
                          value={editDecision}
                          onChange={(e) => handleDecisionChange(e.target.value as Decision)}
                          disabled={savingInterview || isDecisionLocked}
                        >
                          {(["undecided", "pass", "fail", "hold"] as const).map((value) => (
                            <option key={value} value={value}>
                              {decisionLabel(value)}
                            </option>
                          ))}
                        </select>
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
                      <div className="meta">面接ラウンド: 第{selectedRow.round}次</div>
                      {canCreateAdditionalInterview && (
                        <div className="detail-actions">
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => void createNextInterview()}
                          >
                            {createInterviewLabel}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="badge">
                      {selectedRow.hasRecording ? "録画あり" : "録画なし"}
                    </div>
                  </div>
                  {canReissueInterview && (
                    <div className="detail-actions">
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => {
                          setReissueResult(null);
                          setReissueOpen((prev) => !prev);
                        }}
                      >
                        {reissueOpen ? "再発行設定を閉じる" : "URLを再発行"}
                      </button>
                    </div>
                  )}
                  {reissueOpen && canReissueInterview && (
                    <div className="reissue-panel">
                      <div className="form-row">
                        <label>URL有効期限</label>
                        <div className="expiry-grid">
                          <select
                            value={reissueWeeks}
                            onChange={(e) => setReissueWeeks(e.target.value)}
                            aria-label="有効期限の週"
                          >
                            {Array.from({ length: MAX_EXPIRES_WEEKS + 1 }, (_, i) => (
                              <option key={i} value={i}>
                                {i}週
                              </option>
                            ))}
                          </select>
                          <select
                            value={reissueDays}
                            onChange={(e) => setReissueDays(e.target.value)}
                            aria-label="有効期限の日"
                          >
                            {Array.from({ length: MAX_EXPIRES_DAYS + 1 }, (_, i) => (
                              <option key={i} value={i}>
                                {i}日
                              </option>
                            ))}
                          </select>
                          <select
                            value={reissueHours}
                            onChange={(e) => setReissueHours(e.target.value)}
                            aria-label="有効期限の時間"
                          >
                            {Array.from({ length: MAX_EXPIRES_HOURS + 1 }, (_, i) => (
                              <option key={i} value={i}>
                                {i}時間
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="form-row">
                        <label>プロンプト</label>
                        <textarea
                          value={reissuePrompt}
                          onChange={(e) => setReissuePrompt(e.target.value)}
                          placeholder="面接AIの指示文を入力してください"
                        />
                      </div>
                      <div className="detail-actions">
                        <button
                          className="primary"
                          type="button"
                          onClick={() => void reissueInterview()}
                          disabled={reissueSaving}
                        >
                          {reissueSaving ? "再発行中..." : "再発行する"}
                        </button>
                      </div>
                      {reissueResult && "error" in reissueResult && (
                        <p className="error">再発行に失敗しました: {reissueResult.error}</p>
                      )}
                      {hasReissueResult && (
                        <div className="result">
                          <div className="result-row">
                            <span>面接URL</span>
                            <a href={reissueResult.url} target="_blank" rel="noreferrer">
                              {reissueResult.url}
                            </a>
                          </div>
                          {reissueResult.expiresAt && (
                            <div className="result-row">
                              <span>有効期限</span>
                              <strong>
                                {new Date(reissueResult.expiresAt).toLocaleString("ja-JP")}
                              </strong>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
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
                  <details className="prompt">
                    <summary>プロンプトを見る</summary>
                    <textarea value={selectedRow.prompt ?? ""} readOnly />
                  </details>
                </div>
              ) : (
                <div className="empty">面接を選択してください</div>
              )}
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
        .brand-button {
          border: none;
          background: transparent;
          padding: 0;
          font: inherit;
          color: inherit;
          cursor: pointer;
        }
        .brand-button:focus-visible {
          outline: 2px solid #1f4fb2;
          outline-offset: 4px;
          border-radius: 6px;
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
        .list-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 8px;
        }
        .detail-card {
          min-height: 420px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .application-detail {
          display: grid;
          gap: 16px;
        }
        .interview-detail {
          display: grid;
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
        .detail-value {
          padding: 10px 12px;
          border-radius: 10px;
          background: #f8fafc;
          border: 1px solid #d8e1f0;
        }
        .mono {
          font-family: "IBM Plex Mono", "Menlo", "Consolas", monospace;
          font-size: 12px;
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
        .settings-card {
          display: grid;
          gap: 10px;
        }
        .settings-card .ghost {
          width: 100%;
        }
        .settings {
          display: grid;
          gap: 20px;
        }
        .settings-section {
          padding: 16px;
          border-radius: 12px;
          border: 1px solid #d8e1f0;
          background: #f8fafc;
          display: grid;
          gap: 12px;
        }
        .settings-section h3 {
          margin: 0;
          font-size: 15px;
          color: #1f2f44;
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
        .title-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .round-tag {
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          background: #e0f2fe;
          border: 1px solid #38bdf8;
          color: #0c4a6e;
        }
        .decision-tag {
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          border: 1px solid transparent;
        }
        .decision-tag.undecided {
          background: #fef3c7;
          border-color: #f59e0b;
          color: #92400e;
        }
        .decision-tag.pass {
          background: #dcfce7;
          border-color: #22c55e;
          color: #166534;
        }
        .decision-tag.fail {
          background: #ffe4e6;
          border-color: #f43f5e;
          color: #9f1239;
        }
        .decision-tag.hold {
          background: #e2e8f0;
          border-color: #94a3b8;
          color: #334155;
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
        .detail-actions {
          margin-top: 10px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .detail-actions.align-right {
          justify-content: flex-end;
        }
        .application-interviews {
          margin-top: 12px;
          display: grid;
          gap: 12px;
        }
        .reissue-panel {
          margin-top: 12px;
          padding: 12px;
          border-radius: 12px;
          border: 1px solid #d8e1f0;
          background: #f8fafc;
          display: grid;
          gap: 12px;
        }
        .section-title {
          font-size: 13px;
          font-weight: 600;
          color: #1f2f44;
        }
        .section-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
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
