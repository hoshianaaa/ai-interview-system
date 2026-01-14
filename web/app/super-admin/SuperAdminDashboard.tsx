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

const NONE_PLAN_VALUE = "none" as const;
type PlanSelectValue = OrgPlan | typeof NONE_PLAN_VALUE;

export default function SuperAdminDashboard({
  initialRows,
  orgsLoadError,
  systemSettings
}: {
  initialRows: OrgSubscriptionRow[];
  orgsLoadError?: string | null;
  systemSettings: SystemSettings;
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
  const [rowError, setRowError] = useState<{ orgId: string; message: string } | null>(
    null
  );

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
