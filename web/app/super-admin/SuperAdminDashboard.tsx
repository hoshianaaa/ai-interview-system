"use client";

import { useMemo, useState } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import {
  calcOverageYen,
  getPlanConfig,
  PLAN_CONFIG,
  toRoundedMinutes,
  type OrgPlan
} from "@/lib/billing";
import { formatDateJst } from "@/lib/datetime";
import { DEFAULT_INTERVIEW_PROMPT } from "@/lib/prompts";

type OrgSubscriptionRow = {
  orgId: string;
  orgName: string;
  planId: OrgPlan | null;
  billingAnchorAt: string | null;
  cycleStartedAt: string | null;
  cycleEndsAt: string | null;
  usedSec: number;
  reservedSec: number;
  activeInterviewCount: number;
  overageApproved: boolean;
  renewOnCycleEnd: boolean;
  updatedAt: string | null;
  hasSubscription: boolean;
};

type SystemSettings = {
  maxConcurrentInterviews: number;
};

type PromptTemplate = {
  templateId: string;
  name: string;
  body: string;
  isDefault: boolean;
  createdAt: string;
};

type OrgSubscriptionResponse =
  | {
      orgSubscription: {
        orgId: string;
        plan: OrgPlan;
        billingAnchorAt: string;
        cycleStartedAt: string;
        cycleEndsAt: string;
        usedSec: number;
        reservedSec: number;
        overageApproved: boolean;
        renewOnCycleEnd: boolean;
        updatedAt: string;
      };
    }
  | { orgSubscription: null }
  | { error: string };

type OrgSubscriptionSnapshot = {
  orgId: string;
  plan: OrgPlan;
  billingAnchorAt: string;
  cycleStartedAt: string;
  cycleEndsAt: string;
  usedSec: number;
  reservedSec: number;
  overageApproved: boolean;
  renewOnCycleEnd: boolean;
  updatedAt: string;
};

type EndInterviewsResponse =
  | {
      endedCount: number;
      activeInterviewCount: number;
      orgSubscription: OrgSubscriptionSnapshot | null;
    }
  | { error: string };

const formatDate = (value: string | null) => {
  if (!value) return "未加入";
  return formatDateJst(value);
};

const formatMinutes = (sec: number, mode: "floor" | "ceil" = "floor") =>
  `${toRoundedMinutes(sec, mode)}分`;

const planLabel = (planId: OrgPlan | null) => {
  if (!planId) return "未加入";
  if (planId === "starter") return "スターター";
  return planId;
};

const formatTemplateLabel = (template: PromptTemplate) =>
  `${template.name}${template.isDefault ? "（デフォルト）" : ""}`;

const getTemplateSeedBody = (templates: PromptTemplate[]) =>
  templates.find((row) => row.isDefault)?.body ?? DEFAULT_INTERVIEW_PROMPT;

const NONE_PLAN_VALUE = "none" as const;
type PlanSelectValue = OrgPlan | typeof NONE_PLAN_VALUE;

export default function SuperAdminDashboard({
  initialRows,
  orgsLoadError,
  systemSettings,
  promptTemplates
}: {
  initialRows: OrgSubscriptionRow[];
  orgsLoadError?: string | null;
  systemSettings: SystemSettings;
  promptTemplates: PromptTemplate[];
}) {
  const [rows, setRows] = useState<OrgSubscriptionRow[]>(initialRows);
  const [currentSystemSettings, setCurrentSystemSettings] = useState(systemSettings);
  const [systemLimitInput, setSystemLimitInput] = useState(
    String(systemSettings.maxConcurrentInterviews)
  );
  const [systemSaving, setSystemSaving] = useState(false);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [planByOrg, setPlanByOrg] = useState<Record<string, PlanSelectValue>>(() => {
    const next: Record<string, PlanSelectValue> = {};
    for (const row of initialRows) {
      next[row.orgId] = row.planId ?? NONE_PLAN_VALUE;
    }
    return next;
  });
  const [query, setQuery] = useState("");
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [savingOverageByOrg, setSavingOverageByOrg] = useState<
    Record<string, boolean>
  >({});
  const [savingRenewalByOrg, setSavingRenewalByOrg] = useState<
    Record<string, boolean>
  >({});
  const [savingPlanByOrg, setSavingPlanByOrg] = useState<Record<string, boolean>>(
    {}
  );
  const [endingInterviewsByOrg, setEndingInterviewsByOrg] = useState<
    Record<string, boolean>
  >({});
  const [endingErrorByOrg, setEndingErrorByOrg] = useState<
    Record<string, string | null>
  >({});
  const [rowError, setRowError] = useState<{ orgId: string; message: string } | null>(
    null
  );
  const [templates, setTemplates] = useState(
    promptTemplates.map((row) => ({ ...row, isDefault: Boolean(row.isDefault) }))
  );
  const [templateEditorId, setTemplateEditorId] = useState("");
  const [templateEditName, setTemplateEditName] = useState("");
  const [templateEditBody, setTemplateEditBody] = useState(() =>
    getTemplateSeedBody(promptTemplates)
  );
  const [templateEditDefault, setTemplateEditDefault] = useState(false);
  const [templateEditError, setTemplateEditError] = useState<string | null>(null);
  const [templateEditSaving, setTemplateEditSaving] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) =>
        a.orgName === b.orgName
          ? a.orgId.localeCompare(b.orgId)
          : a.orgName.localeCompare(b.orgName)
      ),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return sortedRows;
    return sortedRows.filter(
      (row) =>
        row.orgName.toLowerCase().includes(trimmed) ||
        row.orgId.toLowerCase().includes(trimmed)
    );
  }, [sortedRows, query]);
  const selectedTemplate = useMemo(
    () =>
      templateEditorId
        ? templates.find((row) => row.templateId === templateEditorId) ?? null
        : null,
    [templates, templateEditorId]
  );
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

  const applySubscriptionUpdate = (next: OrgSubscriptionResponse) => {
    if (!("orgSubscription" in next) || !next.orgSubscription) return;
    const updated = next.orgSubscription;
    setRows((prev) =>
      prev.map((row) =>
        row.orgId === updated.orgId
          ? {
              ...row,
              planId: updated.plan,
              billingAnchorAt: updated.billingAnchorAt,
              cycleStartedAt: updated.cycleStartedAt,
              cycleEndsAt: updated.cycleEndsAt,
              usedSec: updated.usedSec,
              reservedSec: updated.reservedSec,
              overageApproved: updated.overageApproved,
              renewOnCycleEnd: updated.renewOnCycleEnd,
              updatedAt: updated.updatedAt,
              hasSubscription: true
            }
          : row
      )
    );
    setPlanByOrg((prev) => ({ ...prev, [updated.orgId]: updated.plan }));
  };

  const applySubscriptionRemoval = (orgId: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.orgId === orgId
          ? {
              ...row,
              planId: null,
              billingAnchorAt: null,
              cycleStartedAt: null,
              cycleEndsAt: null,
              usedSec: 0,
              reservedSec: 0,
              overageApproved: false,
              renewOnCycleEnd: false,
              updatedAt: null,
              hasSubscription: false
            }
          : row
      )
    );
    setPlanByOrg((prev) => ({ ...prev, [orgId]: NONE_PLAN_VALUE }));
  };

  const applyActiveInterviewCount = (orgId: string, activeInterviewCount: number) => {
    setRows((prev) =>
      prev.map((row) =>
        row.orgId === orgId ? { ...row, activeInterviewCount } : row
      )
    );
  };

  const endActiveInterviews = async (orgId: string, activeCount: number) => {
    if (activeCount <= 0) return;
    if (endingInterviewsByOrg[orgId]) return;
    const confirmed = window.confirm("進行中の面接をすべて終了しますか？");
    if (!confirmed) return;

    setEndingErrorByOrg((prev) => ({ ...prev, [orgId]: null }));
    setEndingInterviewsByOrg((prev) => ({ ...prev, [orgId]: true }));
    try {
      const res = await fetch("/api/super-admin/org-interviews/end", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId })
      });
      const data = (await res.json()) as EndInterviewsResponse;
      if (!res.ok || "error" in data) {
        setEndingErrorByOrg((prev) => ({
          ...prev,
          [orgId]: "進行中面接の終了に失敗しました。"
        }));
        return;
      }
      applyActiveInterviewCount(orgId, data.activeInterviewCount);
      if (data.orgSubscription) {
        applySubscriptionUpdate({ orgSubscription: data.orgSubscription });
      } else {
        applySubscriptionRemoval(orgId);
      }
    } catch {
      setEndingErrorByOrg((prev) => ({
        ...prev,
        [orgId]: "進行中面接の終了に失敗しました。"
      }));
    } finally {
      setEndingInterviewsByOrg((prev) => ({ ...prev, [orgId]: false }));
    }
  };

  const toggleRenewal = async (orgId: string, nextValue: boolean) => {
    setRowError(null);
    setSavingRenewalByOrg((prev) => ({ ...prev, [orgId]: true }));
    try {
      const res = await fetch("/api/super-admin/org-quotas", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, renewOnCycleEnd: nextValue })
      });
      const data = (await res.json()) as OrgSubscriptionResponse;
      if (!res.ok || !("orgSubscription" in data)) {
        setRowError({
          orgId,
          message: "error" in data ? data.error : "REQUEST_FAILED"
        });
        return;
      }
      if (!data.orgSubscription) {
        setRowError({ orgId, message: "SUBSCRIPTION_NOT_FOUND" });
        return;
      }
      applySubscriptionUpdate(data);
    } catch {
      setRowError({ orgId, message: "REQUEST_FAILED" });
    } finally {
      setSavingRenewalByOrg((prev) => ({ ...prev, [orgId]: false }));
    }
  };

  const toggleOverageApproval = async (orgId: string, nextValue: boolean) => {
    setRowError(null);
    setSavingOverageByOrg((prev) => ({ ...prev, [orgId]: true }));
    try {
      const res = await fetch("/api/super-admin/org-quotas", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, overageApproved: nextValue })
      });
      const data = (await res.json()) as OrgSubscriptionResponse;
      if (!res.ok || !("orgSubscription" in data)) {
        setRowError({
          orgId,
          message: "error" in data ? data.error : "REQUEST_FAILED"
        });
        return;
      }
      if (!data.orgSubscription) {
        setRowError({ orgId, message: "SUBSCRIPTION_NOT_FOUND" });
        return;
      }
      applySubscriptionUpdate(data);
    } catch {
      setRowError({ orgId, message: "REQUEST_FAILED" });
    } finally {
      setSavingOverageByOrg((prev) => ({ ...prev, [orgId]: false }));
    }
  };

  const updatePlan = async (orgId: string) => {
    const selectedPlanId = planByOrg[orgId] ?? NONE_PLAN_VALUE;
    const planId = selectedPlanId === NONE_PLAN_VALUE ? null : selectedPlanId;
    setRowError(null);
    setSavingPlanByOrg((prev) => ({ ...prev, [orgId]: true }));
    try {
      const res = await fetch("/api/super-admin/org-quotas", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, planId })
      });
      const data = (await res.json()) as OrgSubscriptionResponse;
      if (!res.ok || !("orgSubscription" in data)) {
        setRowError({
          orgId,
          message: "error" in data ? data.error : "REQUEST_FAILED"
        });
        return;
      }
      if (data.orgSubscription) {
        applySubscriptionUpdate(data);
      } else {
        applySubscriptionRemoval(orgId);
      }
    } catch {
      setRowError({ orgId, message: "REQUEST_FAILED" });
    } finally {
      setSavingPlanByOrg((prev) => ({ ...prev, [orgId]: false }));
    }
  };

  const reloadTemplates = async () => {
    setTemplateLoading(true);
    setTemplateEditError(null);
    try {
      const res = await fetch("/api/super-admin/prompt-templates");
      const data = (await res.json()) as { templates?: PromptTemplate[]; error?: string };
      if (Array.isArray(data.templates)) {
        const nextTemplates = data.templates.map((row) => ({
          ...row,
          isDefault: Boolean(row.isDefault)
        }));
        const seedBody = getTemplateSeedBody(nextTemplates);
        setTemplates(nextTemplates);
        if (
          templateEditorId &&
          !data.templates.some((row) => row.templateId === templateEditorId)
        ) {
          setTemplateEditorId("");
          setTemplateEditName("");
          setTemplateEditBody(seedBody);
          setTemplateEditDefault(false);
        }
      } else if (data.error) {
        setTemplateEditError("テンプレートの取得に失敗しました");
      }
    } finally {
      setTemplateLoading(false);
    }
  };

  const saveTemplate = async () => {
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
      const res = await fetch("/api/super-admin/prompt-templates", {
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
        const normalized = {
          ...data.template,
          isDefault: Boolean(data.template.isDefault)
        };
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
  };

  const deleteTemplate = async () => {
    if (!templateEditorId) return;
    const ok = window.confirm("このテンプレートを削除しますか？");
    if (!ok) return;
    setTemplateEditSaving(true);
    setTemplateEditError(null);
    try {
      const res = await fetch("/api/super-admin/prompt-templates", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: templateEditorId })
      });
      if (res.ok) {
        const nextTemplates = templates.filter(
          (row) => row.templateId !== templateEditorId
        );
        setTemplates(nextTemplates);
        setTemplateEditorId("");
        setTemplateEditName("");
        setTemplateEditBody(getTemplateSeedBody(nextTemplates));
        setTemplateEditDefault(false);
        return;
      }
      setTemplateEditError("削除に失敗しました");
    } finally {
      setTemplateEditSaving(false);
    }
  };

  const resetTemplateEditor = () => {
    setTemplateEditError(null);
    if (!templateEditorId) {
      setTemplateEditName("");
      setTemplateEditBody(getTemplateSeedBody(templates));
      setTemplateEditDefault(false);
      return;
    }
    const template = templates.find((row) => row.templateId === templateEditorId);
    if (template) {
      setTemplateEditName(template.name);
      setTemplateEditBody(template.body);
      setTemplateEditDefault(Boolean(template.isDefault));
    }
  };

  const selectTemplateForEdit = (templateId: string) => {
    setTemplateEditorId(templateId);
    setTemplateEditError(null);
    if (!templateId) {
      setTemplateEditName("");
      setTemplateEditBody(getTemplateSeedBody(templates));
      setTemplateEditDefault(false);
      return;
    }
    const template = templates.find((row) => row.templateId === templateId);
    if (template) {
      setTemplateEditName(template.name);
      setTemplateEditBody(template.body);
      setTemplateEditDefault(Boolean(template.isDefault));
    }
  };

  const systemDirty =
    systemLimitInput.trim() !==
    String(currentSystemSettings.maxConcurrentInterviews);

  const saveSystemSettings = async () => {
    if (systemSaving) return;
    setSystemError(null);
    const trimmed = systemLimitInput.trim();
    const parsed = Number(trimmed);
    if (!trimmed || !Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      setSystemError("同時面接上限は整数で入力してください。");
      return;
    }
    if (parsed < 1 || parsed > 100) {
      setSystemError("同時面接上限は1〜100で入力してください。");
      return;
    }
    setSystemSaving(true);
    try {
      const res = await fetch("/api/super-admin/system-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxConcurrentInterviews: parsed })
      });
      const data = (await res.json()) as
        | { maxConcurrentInterviews: number }
        | { error: string };
      if (!res.ok || "error" in data) {
        setSystemError("設定の更新に失敗しました。");
        return;
      }
      setCurrentSystemSettings(data);
      setSystemLimitInput(String(data.maxConcurrentInterviews));
    } catch {
      setSystemError("設定の更新に失敗しました。");
    } finally {
      setSystemSaving(false);
    }
  };

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Super Admin</p>
          <h1>Org subscriptions</h1>
        </div>
        <div className="topbar-actions">
          <OrganizationSwitcher />
          <UserButton />
        </div>
      </header>

      <section className="card">
        <div className="card-header">
          <div>
            <h2>システム設定</h2>
            <p className="subtle">
              全組織の同時面接上限を設定します。
            </p>
          </div>
        </div>
        <div className="system-settings">
          <div className="system-row">
            <label htmlFor="system-max-concurrent" className="label">
              同時面接上限
            </label>
            <div className="system-control">
              <input
                id="system-max-concurrent"
                type="number"
                min={1}
                max={100}
                value={systemLimitInput}
                onChange={(e) => setSystemLimitInput(e.target.value)}
                inputMode="numeric"
              />
              <button
                type="button"
                className="primary"
                disabled={!systemDirty || systemSaving}
                onClick={() => void saveSystemSettings()}
              >
                {systemSaving ? "更新中..." : "保存"}
              </button>
            </div>
          </div>
          {systemError && <p className="error">{systemError}</p>}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h2>共通プロンプトテンプレート</h2>
            <p className="subtle">
              ここで作成したテンプレートは全組織で利用できます。
            </p>
          </div>
        </div>
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
                    {formatTemplateLabel(template)}
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
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h2>組織ごとのプランと超過承認</h2>
            <p className="subtle">超過上限の承認状況と利用状況を確認できます。</p>
          </div>
          <div className="search">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="組織名 / Org ID で検索"
            />
            <span className="count">
              {filteredRows.length}/{rows.length}
            </span>
          </div>
        </div>

        {orgsLoadError && (
          <p className="warning">
            組織一覧を取得できませんでした。登録済みの組織のみ表示しています。
          </p>
        )}

        {filteredRows.length === 0 ? (
          <p className="empty">該当する組織がありません。</p>
        ) : (
          <div className="table">
            <div className="row header">
              <div>組織</div>
              <div>プラン</div>
              <div>次回更新</div>
              <div>進行中面接数</div>
              <div>残り/超過</div>
              <div>超過承認</div>
              <div>継続</div>
              <div>詳細</div>
            </div>
            {filteredRows.map((row) => {
              const plan = row.planId ? getPlanConfig(row.planId) : null;
              const selectedPlanId =
                planByOrg[row.orgId] ?? row.planId ?? NONE_PLAN_VALUE;
              const currentPlanId = row.planId ?? NONE_PLAN_VALUE;
              const planDirty = currentPlanId !== selectedPlanId;
              const includedSec = plan ? plan.includedMinutes * 60 : 0;
              const committedSec = row.usedSec + row.reservedSec;
              const remainingIncludedSec = Math.max(0, includedSec - committedSec);
              const overageCommittedSec = Math.max(0, committedSec - includedSec);
              const overageRemainingSec = plan
                ? row.overageApproved
                  ? null
                  : Math.max(0, plan.overageLimitMinutes * 60 - overageCommittedSec)
                : null;
              const overageLocked =
                plan && !row.overageApproved && overageRemainingSec === 0;
              const isExpanded = expandedOrgId === row.orgId;
              const error = rowError?.orgId === row.orgId ? rowError.message : null;
              const isOverageSaving = savingOverageByOrg[row.orgId] ?? false;
              const isRenewalSaving = savingRenewalByOrg[row.orgId] ?? false;
              const isPlanSaving = savingPlanByOrg[row.orgId] ?? false;
              const isEnding = endingInterviewsByOrg[row.orgId] ?? false;
              const endingError = endingErrorByOrg[row.orgId] ?? null;

              return (
                <div className="row-group" key={row.orgId}>
                  <div className="row">
                    <div className="org-cell">
                      <div className="org-name">{row.orgName}</div>
                      <div className="mono">{row.orgId}</div>
                    </div>
                    <div className="plan">
                      <div>{planLabel(row.planId)}</div>
                      {!row.hasSubscription && <span className="badge">未加入</span>}
                    </div>
                    <div>{formatDate(row.cycleEndsAt)}</div>
                    <div className="count">{row.activeInterviewCount}件</div>
                    <div className="usage">
                      <div>
                        {plan
                          ? `${formatMinutes(remainingIncludedSec)} / ${plan.includedMinutes}分`
                          : "-"}
                      </div>
                      {overageLocked && <span className="badge warn">承認待ち</span>}
                    </div>
                    <div>
                      <button
                        type="button"
                        className={row.overageApproved ? "ghost" : "primary"}
                        disabled={!row.hasSubscription || isOverageSaving}
                        onClick={() =>
                          void toggleOverageApproval(
                            row.orgId,
                            !row.overageApproved
                          )
                        }
                      >
                        {isOverageSaving
                          ? "更新中..."
                          : row.overageApproved
                            ? "承認解除"
                            : "承認"}
                      </button>
                      {error && <p className="error">{error}</p>}
                    </div>
                    <div>
                      <button
                        type="button"
                        className={`switch ${row.renewOnCycleEnd ? "on" : "off"}`}
                        role="switch"
                        aria-checked={row.renewOnCycleEnd}
                        disabled={!row.hasSubscription || isRenewalSaving}
                        onClick={() =>
                          void toggleRenewal(row.orgId, !row.renewOnCycleEnd)
                        }
                      >
                        <span className="switch-track">
                          <span className="switch-thumb" />
                        </span>
                        <span className="switch-label">
                          {row.renewOnCycleEnd ? "ON" : "OFF"}
                        </span>
                      </button>
                    </div>
                    <div>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() =>
                          setExpandedOrgId((prev) =>
                            prev === row.orgId ? null : row.orgId
                          )
                        }
                      >
                        {isExpanded ? "閉じる" : "詳細"}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="detail">
                      <div className="detail-actions">
                        <div>
                          <p className="label">プラン設定</p>
                          <div className="plan-editor">
                            <select
                              value={selectedPlanId}
                              onChange={(e) =>
                                setPlanByOrg((prev) => ({
                                  ...prev,
                                  [row.orgId]: e.target.value as PlanSelectValue
                                }))
                              }
                            >
                              <option value={NONE_PLAN_VALUE}>未加入</option>
                              {Object.values(PLAN_CONFIG).map((planOption) => (
                                <option key={planOption.id} value={planOption.id}>
                                  {planLabel(planOption.id)}（月額
                                  {planOption.monthlyPriceYen.toLocaleString("ja-JP")}円 /{" "}
                                  {planOption.includedMinutes}分）
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={isPlanSaving || !planDirty}
                              onClick={() => void updatePlan(row.orgId)}
                            >
                              {isPlanSaving ? "更新中..." : "プラン更新"}
                            </button>
                          </div>
                          <p className="subtle">
                            プラン変更で加入日とサイクルが更新されます。
                          </p>
                        </div>
                      </div>
                      <div className="detail-actions">
                        <div>
                          <p className="label">進行中面接</p>
                          <div className="plan-editor">
                            <span className="count">{row.activeInterviewCount}件</span>
                            <button
                              type="button"
                              className="danger"
                              disabled={row.activeInterviewCount === 0 || isEnding}
                              onClick={() =>
                                void endActiveInterviews(
                                  row.orgId,
                                  row.activeInterviewCount
                                )
                              }
                            >
                              {isEnding ? "終了中..." : "進行中面接を終了"}
                            </button>
                          </div>
                          <p className="subtle">
                            進行中の面接を強制終了します。
                          </p>
                          {endingError && <p className="error">{endingError}</p>}
                        </div>
                      </div>
                      <div className="detail-meta">
                        <div>
                          <p className="label">加入日</p>
                          <p className="value">{formatDate(row.billingAnchorAt)}</p>
                        </div>
                        <div>
                          <p className="label">サイクル開始</p>
                          <p className="value">{formatDate(row.cycleStartedAt)}</p>
                        </div>
                        <div>
                          <p className="label">サイクル終了</p>
                          <p className="value">{formatDate(row.cycleEndsAt)}</p>
                        </div>
                      </div>
                      <div className="detail-meta">
                        <div>
                          <p className="label">使用済み</p>
                          <p className="value">{formatMinutes(row.usedSec)}</p>
                        </div>
                        <div>
                          <p className="label">予約中</p>
                          <p className="value">{formatMinutes(row.reservedSec)}</p>
                        </div>
                        <div>
                          <p className="label">超過料金(見込み)</p>
                          <p className="value">
                            {plan
                              ? `${calcOverageYen(
                                  Math.max(0, row.usedSec - includedSec),
                                  plan.overageRateYenPerMin
                                ).toLocaleString("ja-JP")}円`
                              : "-"}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <style jsx>{`
        :global(body) {
          background: #f5f7fb;
        }
        .page {
          min-height: 100vh;
          padding: 32px 24px 64px;
          display: grid;
          gap: 24px;
          color: #0d1b2a;
          font-family: "IBM Plex Sans", "Noto Sans JP", "Hiragino Sans", sans-serif;
        }
        .topbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
        }
        .topbar-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .eyebrow {
          margin: 0;
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #3a5a86;
        }
        h1 {
          margin: 6px 0 0;
          font-size: 28px;
        }
        h2 {
          margin: 0 0 8px;
          font-size: 20px;
        }
        .subtle {
          margin: 0;
          color: #556175;
          font-size: 13px;
        }
        .card {
          background: #ffffff;
          border-radius: 16px;
          padding: 20px;
          border: 1px solid rgba(28, 48, 74, 0.08);
          box-shadow: 0 12px 30px rgba(16, 32, 56, 0.08);
          display: grid;
          gap: 16px;
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: center;
        }
        .search {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: min(320px, 100%);
        }
        .search input {
          flex: 1;
        }
        .count {
          font-size: 12px;
          color: #5e6d84;
        }
        input {
          border-radius: 10px;
          border: 1px solid #c9d2e2;
          padding: 10px 12px;
          font-size: 14px;
          font-family: inherit;
          color: #0d1b2a;
          background: #f9fbff;
        }
        textarea {
          border-radius: 10px;
          border: 1px solid #c9d2e2;
          padding: 10px 12px;
          font-size: 14px;
          font-family: inherit;
          color: #0d1b2a;
          background: #f9fbff;
          min-height: 180px;
          resize: vertical;
        }
        select {
          border-radius: 10px;
          border: 1px solid #c9d2e2;
          padding: 10px 12px;
          font-size: 14px;
          font-family: inherit;
          color: #0d1b2a;
          background: #f9fbff;
        }
        button {
          border-radius: 10px;
          border: none;
          padding: 10px 16px;
          background: #2a5b99;
          color: #ffffff;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }
        button:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .ghost {
          background: #e6edf7;
          color: #2a5b99;
          border: 1px solid #c9d6eb;
        }
        .switch {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 0;
          background: transparent;
          border: none;
          color: #2a5b99;
          font-weight: 600;
        }
        .switch-track {
          position: relative;
          width: 42px;
          height: 22px;
          border-radius: 999px;
          background: #d5dde9;
          transition: background 0.2s ease;
        }
        .switch-thumb {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: #ffffff;
          box-shadow: 0 2px 6px rgba(15, 23, 42, 0.2);
          transition: transform 0.2s ease;
        }
        .switch.on .switch-track {
          background: #2a5b99;
        }
        .switch.on .switch-thumb {
          transform: translateX(20px);
        }
        .switch-label {
          font-size: 12px;
          color: #5e6d84;
        }
        .primary {
          background: #2a5b99;
        }
        .danger {
          background: #d92d20;
        }
        .table {
          display: grid;
          gap: 12px;
        }
        .row-group {
          display: grid;
          gap: 8px;
        }
        .row {
          display: grid;
          grid-template-columns: minmax(220px, 1.4fr) minmax(140px, 0.7fr) minmax(
              160px,
              0.8fr
            ) minmax(120px, 0.5fr) minmax(200px, 1fr) minmax(140px, 0.6fr)
            minmax(120px, 0.5fr) minmax(90px, 0.4fr);
          align-items: center;
          gap: 16px;
          padding: 12px 10px;
          border-radius: 12px;
          background: #f7f9fc;
          font-size: 14px;
        }
        .row.header {
          background: #eef2f8;
          font-weight: 600;
        }
        .org-cell {
          display: grid;
          gap: 4px;
        }
        .org-name {
          font-weight: 600;
        }
        .mono {
          font-family: "IBM Plex Mono", "Menlo", "Consolas", monospace;
          font-size: 12px;
        }
        .plan,
        .usage {
          display: grid;
          gap: 4px;
        }
        .count {
          font-weight: 600;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 11px;
          background: #eef2f8;
          color: #5f6d84;
          width: fit-content;
        }
        .badge.warn {
          background: #fff2e5;
          color: #b54708;
        }
        .detail {
          background: #ffffff;
          border-radius: 12px;
          border: 1px solid rgba(28, 48, 74, 0.12);
          padding: 16px;
          display: grid;
          gap: 16px;
        }
        .detail-actions {
          display: grid;
          gap: 8px;
        }
        .plan-editor {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .system-settings {
          display: grid;
          gap: 12px;
        }
        .system-row {
          display: grid;
          gap: 8px;
        }
        .system-control {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .system-control input {
          width: 120px;
        }
        .template-editor {
          display: grid;
          gap: 16px;
        }
        .form-row {
          display: grid;
          gap: 8px;
        }
        .template-controls {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .template-controls select {
          min-width: min(320px, 100%);
        }
        .checkbox {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #3a4a5e;
        }
        .edit-actions {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .helper {
          margin: 0;
          font-size: 12px;
          color: #6b7a90;
        }
        .detail-meta {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 12px;
        }
        .label {
          margin: 0;
          font-size: 12px;
          color: #6b7a90;
        }
        .value {
          margin: 4px 0 0;
          font-size: 16px;
          font-weight: 600;
          color: #14213d;
        }
        .error {
          margin: 6px 0 0;
          color: #b42318;
          font-size: 12px;
        }
        .warning {
          margin: 0;
          color: #b54708;
          font-size: 13px;
        }
        .empty {
          margin: 0;
          color: #607089;
        }
        @media (max-width: 1000px) {
          .row {
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .topbar {
            flex-direction: column;
            align-items: flex-start;
          }
          .card-header {
            flex-direction: column;
            align-items: flex-start;
          }
          .search {
            width: 100%;
          }
        }
      `}</style>
    </main>
  );
}
