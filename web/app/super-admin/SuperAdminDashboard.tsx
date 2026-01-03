"use client";

import { useMemo, useState, type FormEvent } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

type OrgQuotaRow = {
  orgId: string;
  orgName: string;
  availableSec: number;
  updatedAt: string | null;
  hasQuota: boolean;
};

type ActionScope = "add" | "set" | "reduce";

type OrgQuotaResponse =
  | { orgQuota: { orgId: string; availableSec: number; updatedAt: string } }
  | { error: string };

const formatSeconds = (valueSec: number) => {
  const safe = Math.max(0, Math.floor(valueSec));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds} sec`;
};

const formatUpdatedAt = (value: string | null) => {
  if (!value) return "未設定";
  return new Date(value).toLocaleString("ja-JP");
};

const normalizeMinutesInput = (value: string) => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
};

const makeKey = (scope: ActionScope, orgId: string) => `${scope}:${orgId}`;

export default function SuperAdminDashboard({
  initialRows,
  orgsLoadError
}: {
  initialRows: OrgQuotaRow[];
  orgsLoadError?: string | null;
}) {
  const [rows, setRows] = useState<OrgQuotaRow[]>(initialRows);
  const [query, setQuery] = useState("");
  const [addByOrg, setAddByOrg] = useState<Record<string, string>>({});
  const [setByOrg, setSetByOrg] = useState<Record<string, string>>({});
  const [reduceByOrg, setReduceByOrg] = useState<Record<string, string>>({});
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    orgId: string;
    scope: ActionScope;
    message: string;
  } | null>(null);

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

  const applyQuotaUpdate = (
    orgId: string,
    next: { availableSec: number; updatedAt: string }
  ) => {
    setRows((prev) => {
      const idx = prev.findIndex((row) => row.orgId === orgId);
      if (idx === -1) {
        return [
          ...prev,
          {
            orgId,
            orgName: orgId,
            availableSec: next.availableSec,
            updatedAt: next.updatedAt,
            hasQuota: true
          }
        ];
      }
      const updated = [...prev];
      updated[idx] = {
        ...prev[idx],
        availableSec: next.availableSec,
        updatedAt: next.updatedAt,
        hasQuota: true
      };
      return updated;
    });
  };

  const requestUpdate = async (
    orgId: string,
    payload: Record<string, unknown>,
    scope: ActionScope
  ) => {
    setRowError(null);
    const key = makeKey(scope, orgId);
    setSavingKey(key);
    try {
      const res = await fetch("/api/super-admin/org-quotas", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...payload })
      });
      const data = (await res.json()) as OrgQuotaResponse;
      if (!res.ok || !("orgQuota" in data)) {
        setRowError({
          orgId,
          scope,
          message: "error" in data ? data.error : "REQUEST_FAILED"
        });
        return false;
      }
      applyQuotaUpdate(orgId, {
        availableSec: data.orgQuota.availableSec,
        updatedAt: data.orgQuota.updatedAt
      });
      return true;
    } catch {
      setRowError({ orgId, scope, message: "REQUEST_FAILED" });
      return false;
    } finally {
      setSavingKey(null);
    }
  };

  async function handleAddMinutes(orgId: string, e: FormEvent) {
    e.preventDefault();
    const input = addByOrg[orgId] ?? "";
    const minutes = normalizeMinutesInput(input);
    if (minutes === null || minutes <= 0) {
      setRowError({
        orgId,
        scope: "add",
        message: "追加する分数を入力してください。"
      });
      return;
    }
    const ok = await requestUpdate(
      orgId,
      { deltaMinutes: minutes },
      "add"
    );
    if (ok) {
      setAddByOrg((prev) => ({ ...prev, [orgId]: "" }));
    }
  }

  async function handleSetMinutes(orgId: string, e: FormEvent) {
    e.preventDefault();
    const input = setByOrg[orgId] ?? "";
    const minutes = normalizeMinutesInput(input);
    if (minutes === null || minutes < 0) {
      setRowError({
        orgId,
        scope: "set",
        message: "0以上の分数を入力してください。"
      });
      return;
    }
    const ok = await requestUpdate(
      orgId,
      { availableMinutes: minutes },
      "set"
    );
    if (ok) {
      setSetByOrg((prev) => ({ ...prev, [orgId]: "" }));
    }
  }

  async function handleReduceMinutes(orgId: string, e: FormEvent) {
    e.preventDefault();
    const input = reduceByOrg[orgId] ?? "";
    const minutes = normalizeMinutesInput(input);
    if (minutes === null || minutes <= 0) {
      setRowError({
        orgId,
        scope: "reduce",
        message: "削減する分数を入力してください。"
      });
      return;
    }
    const ok = await requestUpdate(
      orgId,
      { deltaMinutes: -minutes },
      "reduce"
    );
    if (ok) {
      setReduceByOrg((prev) => ({ ...prev, [orgId]: "" }));
    }
  }

  const getRowError = (orgId: string, scope: ActionScope) =>
    rowError?.orgId === orgId && rowError.scope === scope
      ? rowError.message
      : null;

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Super Admin</p>
          <h1>Org time quotas</h1>
        </div>
        <div className="topbar-actions">
          <OrganizationSwitcher />
          <UserButton />
        </div>
      </header>

      <section className="card">
        <div className="card-header">
          <div>
            <h2>全組織の利用可能時間</h2>
            <p className="subtle">
              組織を検索して追加。詳細から編集と削減ができます。
            </p>
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
            組織一覧を取得できませんでした。クォータ登録済みの組織のみ表示しています。
          </p>
        )}

        {filteredRows.length === 0 ? (
          <p className="empty">該当する組織がありません。</p>
        ) : (
          <div className="table">
            <div className="row header">
              <div>組織</div>
              <div>利用可能</div>
              <div>最終更新</div>
              <div>追加（分）</div>
              <div>詳細</div>
            </div>
            {filteredRows.map((row) => {
              const addError = getRowError(row.orgId, "add");
              const setError = getRowError(row.orgId, "set");
              const reduceError = getRowError(row.orgId, "reduce");
              const isExpanded = expandedOrgId === row.orgId;
              return (
                <div className="row-group" key={row.orgId}>
                  <div className="row">
                    <div className="org-cell">
                      <div className="org-name">{row.orgName}</div>
                      <div className="mono">{row.orgId}</div>
                    </div>
                    <div className="available">
                      <div>{formatSeconds(row.availableSec)}</div>
                      {!row.hasQuota && <span className="badge">未設定</span>}
                    </div>
                    <div>{formatUpdatedAt(row.updatedAt)}</div>
                    <div className="adjust">
                      <form
                        className="inline-form"
                        onSubmit={(e) => void handleAddMinutes(row.orgId, e)}
                      >
                        <input
                          value={addByOrg[row.orgId] ?? ""}
                          onChange={(e) =>
                            setAddByOrg((prev) => ({
                              ...prev,
                              [row.orgId]: e.target.value
                            }))
                          }
                          placeholder="30"
                          inputMode="numeric"
                        />
                        <button
                          type="submit"
                          disabled={savingKey === makeKey("add", row.orgId)}
                        >
                          {savingKey === makeKey("add", row.orgId)
                            ? "追加中..."
                            : "追加"}
                        </button>
                      </form>
                      {addError && <p className="error">{addError}</p>}
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
                      <div className="detail-meta">
                        <div>
                          <p className="label">現在の利用可能時間</p>
                          <p className="value">{formatSeconds(row.availableSec)}</p>
                        </div>
                        <div>
                          <p className="label">最終更新</p>
                          <p className="value">{formatUpdatedAt(row.updatedAt)}</p>
                        </div>
                      </div>
                      <div className="detail-actions">
                        <form
                          className="detail-form"
                          onSubmit={(e) => void handleSetMinutes(row.orgId, e)}
                        >
                          <label>
                            利用可能時間を設定（分）
                            <input
                              value={setByOrg[row.orgId] ?? ""}
                              onChange={(e) =>
                                setSetByOrg((prev) => ({
                                  ...prev,
                                  [row.orgId]: e.target.value
                                }))
                              }
                              placeholder="120"
                              inputMode="numeric"
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={savingKey === makeKey("set", row.orgId)}
                          >
                            {savingKey === makeKey("set", row.orgId)
                              ? "保存中..."
                              : "保存"}
                          </button>
                          {setError && <p className="error">{setError}</p>}
                        </form>
                        <form
                          className="detail-form"
                          onSubmit={(e) => void handleReduceMinutes(row.orgId, e)}
                        >
                          <label>
                            利用可能時間を削減（分）
                            <input
                              value={reduceByOrg[row.orgId] ?? ""}
                              onChange={(e) =>
                                setReduceByOrg((prev) => ({
                                  ...prev,
                                  [row.orgId]: e.target.value
                                }))
                              }
                              placeholder="30"
                              inputMode="numeric"
                            />
                          </label>
                          <button
                            type="submit"
                            className="danger"
                            disabled={
                              savingKey === makeKey("reduce", row.orgId)
                            }
                          >
                            {savingKey === makeKey("reduce", row.orgId)
                              ? "削減中..."
                              : "削減"}
                          </button>
                          {reduceError && <p className="error">{reduceError}</p>}
                        </form>
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
        label {
          display: grid;
          gap: 6px;
          font-size: 13px;
          color: #30405b;
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
        .danger {
          background: #b42318;
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
          grid-template-columns: minmax(220px, 1.4fr) minmax(120px, 0.6fr) minmax(
              160px,
              0.8fr
            ) minmax(220px, 1fr) minmax(90px, 0.4fr);
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
        .available {
          display: grid;
          gap: 4px;
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
        .adjust {
          display: grid;
          gap: 6px;
        }
        .inline-form {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .inline-form input {
          flex: 1;
        }
        .detail {
          background: #ffffff;
          border-radius: 12px;
          border: 1px solid rgba(28, 48, 74, 0.12);
          padding: 16px;
          display: grid;
          gap: 16px;
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
        .detail-actions {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 16px;
          align-items: start;
        }
        .detail-form {
          display: grid;
          gap: 10px;
        }
        .error {
          margin: 0;
          color: #b42318;
          font-size: 13px;
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
        @media (max-width: 900px) {
          .row {
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .inline-form {
            flex-direction: column;
            align-items: stretch;
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
