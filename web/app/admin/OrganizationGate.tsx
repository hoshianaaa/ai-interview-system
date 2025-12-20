"use client";

import { useEffect, useMemo, useState } from "react";
import { OrganizationSwitcher, useAuth, useOrganizationList } from "@clerk/nextjs";

export default function OrganizationGate() {
  const { orgId, isLoaded: authLoaded } = useAuth();
  const { isLoaded: orgsLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { pageSize: 10 }
  });
  const [autoSelecting, setAutoSelecting] = useState(false);

  const memberships = useMemo(() => userMemberships.data ?? [], [userMemberships.data]);

  useEffect(() => {
    if (!authLoaded || !orgsLoaded || orgId || autoSelecting) return;
    if (memberships.length === 1 && setActive) {
      setAutoSelecting(true);
      void setActive({ organization: memberships[0].organization.id });
    }
  }, [authLoaded, orgsLoaded, orgId, autoSelecting, memberships, setActive]);

  return (
    <main className="gate">
      <div className="panel">
        <p className="eyebrow">AI Interview Admin</p>
        <h1>組織を選択してください</h1>
        <p className="subtle">
          {autoSelecting
            ? "所属組織が1件のため自動選択中です..."
            : "複数の組織に所属している場合は、管理対象の組織を選択してください。"}
        </p>
        <div className="switcher">
          <OrganizationSwitcher />
        </div>
      </div>

      <style jsx>{`
        .gate {
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: radial-gradient(circle at top, #eaf1fb 0%, #d9e4f4 45%, #cfdced 100%);
          padding: 24px;
          color: #0d1b2a;
          font-family: "IBM Plex Sans", "Noto Sans JP", "Hiragino Sans", sans-serif;
        }
        .panel {
          width: min(520px, 100%);
          background: #ffffff;
          border-radius: 18px;
          padding: 28px;
          box-shadow: 0 18px 45px rgba(19, 41, 72, 0.18);
          border: 1px solid rgba(28, 48, 74, 0.1);
          display: grid;
          gap: 12px;
        }
        h1 {
          margin: 0;
          font-size: 24px;
        }
        .eyebrow {
          margin: 0;
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #3a5a86;
        }
        .subtle {
          margin: 0;
          color: #546178;
          line-height: 1.6;
        }
        .switcher {
          display: flex;
          justify-content: flex-start;
          margin-top: 8px;
        }
      `}</style>
    </main>
  );
}
