"use client";

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

export default function SuperAdminGate({ message }: { message?: string }) {
  return (
    <main className="gate">
      <div className="panel">
        <header>
          <div>
            <p className="eyebrow">Super Admin</p>
            <h1>Access denied</h1>
          </div>
          <UserButton />
        </header>
        <p className="subtle">
          {message ?? "This page is only available to the super admin org."}
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
          width: min(640px, 100%);
          background: #ffffff;
          border-radius: 18px;
          padding: 28px;
          box-shadow: 0 18px 45px rgba(19, 41, 72, 0.18);
          border: 1px solid rgba(28, 48, 74, 0.1);
          display: grid;
          gap: 16px;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
        }
        h1 {
          margin: 4px 0 0;
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
        }
      `}</style>
    </main>
  );
}
