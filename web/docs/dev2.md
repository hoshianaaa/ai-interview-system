以下が **開発手順2**としての「`web/` の全ファイル一式」です。
（`create-next-app` の初期生成をベースに、**Prisma v7 / LiveKit dispatch / Egress→R2 / Webhook**まで動く最小構成にしています）

> 注：`node_modules/` や `.next/` のような生成物は除外しています。
> そのままコピペでファイルを作ればOKです。

---

## web/ フォルダ構成

```text
web/
  .env
  .env.local
  .gitignore
  next.config.ts
  package.json
  prisma.config.ts
  tsconfig.json
  next-env.d.ts

  prisma/
    schema.prisma

  src/
    lib/
      livekit.ts
      prisma.ts
      recordings.ts

    app/
      globals.css
      layout.tsx
      page.tsx

      interview/
        [interviewId]/
          page.tsx

      api/
        interview/
          create/
            route.ts
          join/
            route.ts
          end/
            route.ts
        livekit/
          webhook/
            route.ts
```

---

# 1) ルート直下ファイル

## `web/package.json`

```json
{
  "name": "ai-interview-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build --webpack",
    "migrate:deploy": "prisma migrate deploy",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@livekit/components-react": "^2.9.7",
    "@livekit/components-styles": "^1.0.16",
    "@prisma/client": "^7.2.0",
    "livekit-client": "^2.5.8",
    "livekit-server-sdk": "^2.15.2",
    "next": "15.1.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "dotenv": "^16.4.5",
    "eslint": "^9",
    "eslint-config-next": "15.1.3",
    "prisma": "^7.2.0",
    "typescript": "^5"
  }
}
```

## `web/next.config.ts`

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true
};

export default nextConfig;
```

## `web/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

## `web/next-env.d.ts`

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
```

## `web/.gitignore`

```gitignore
# dependencies
node_modules

# next
.next
out

# misc
.DS_Store

# env
.env.local

# logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# prisma
prisma/dev.db
```

---

# 2) env ファイル

## `web/.env`（Prisma CLI 用：必須）

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require"
```

## `web/.env.local`（Next.js 用：秘密情報）

```env
NEXT_PUBLIC_BASE_URL=http://localhost:3000

LIVEKIT_URL="wss://YOUR_PROJECT.livekit.cloud"
LIVEKIT_API_KEY="YOUR_KEY"
LIVEKIT_API_SECRET="YOUR_SECRET"
LIVEKIT_AGENT_NAME="Sage-266e"

R2_ACCOUNT_ID="YOUR_ACCOUNT_ID"
R2_BUCKET="pm1-interview-recordings"
R2_ACCESS_KEY_ID="YOUR_R2_ACCESS_KEY"
R2_SECRET_ACCESS_KEY="YOUR_R2_SECRET"
R2_ENDPOINT="https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com"
```

---

# 3) Prisma v7

## `web/prisma.config.ts`

```ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  datasource: {
    url: env("DATABASE_URL")
  }
});
```

## `web/prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

enum InterviewStatus {
  created
  used
  recording
  ending
  completed
  failed
}

model Interview {
  interviewId       String          @id
  roomName          String          @unique
  status            InterviewStatus @default(created)
  durationSec       Int

  candidateIdentity String
  agentName         String

  dispatchId        String?
  egressId          String?

  r2Bucket          String
  r2ObjectKey       String?

  createdAt         DateTime        @default(now())
  usedAt            DateTime?
  candidateJoinedAt DateTime?
  endedAt           DateTime?
  error             String?
}
```

---

# 4) src/lib（共通処理）

## `web/src/lib/prisma.ts`

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"]
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

## `web/src/lib/recordings.ts`

```ts
export function utcTimestampCompact(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

export function makeR2ObjectKey(params: { interviewId: string; roomName: string; startedAt?: Date }) {
  const ts = utcTimestampCompact(params.startedAt ?? new Date());
  return `recordings/${params.interviewId}/${ts}_${params.roomName}.mp4`;
}
```

## `web/src/lib/livekit.ts`

```ts
import {
  AccessToken,
  AgentDispatchClient,
  EgressClient,
  EncodedFileOutput,
  EncodingOptionsPreset,
  RoomServiceClient,
  S3Upload,
  WebhookReceiver,
  type VideoGrant
} from "livekit-server-sdk";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const env = {
  baseUrl: mustEnv("NEXT_PUBLIC_BASE_URL"),

  livekitUrl: mustEnv("LIVEKIT_URL"),
  livekitApiKey: mustEnv("LIVEKIT_API_KEY"),
  livekitApiSecret: mustEnv("LIVEKIT_API_SECRET"),
  agentName: mustEnv("LIVEKIT_AGENT_NAME"),

  r2AccountId: mustEnv("R2_ACCOUNT_ID"),
  r2Bucket: mustEnv("R2_BUCKET"),
  r2AccessKeyId: mustEnv("R2_ACCESS_KEY_ID"),
  r2SecretAccessKey: mustEnv("R2_SECRET_ACCESS_KEY"),
  r2Endpoint: process.env.R2_ENDPOINT ?? `https://${mustEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`
};

export function makeRoomName(interviewId: string) {
  return `ivw_${interviewId}`;
}

export function makeCandidateIdentity(interviewId: string) {
  return `candidate_${interviewId}`;
}

export async function makeCandidateToken(params: {
  roomName: string;
  identity: string;
  ttlSeconds: number;
}) {
  const at = new AccessToken(env.livekitApiKey, env.livekitApiSecret, {
    identity: params.identity,
    ttl: params.ttlSeconds
  });

  const grant: VideoGrant = {
    room: params.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  };

  at.addGrant(grant);
  return await at.toJwt();
}

export function clients() {
  return {
    room: new RoomServiceClient(env.livekitUrl, env.livekitApiKey, env.livekitApiSecret),
    egress: new EgressClient(env.livekitUrl, env.livekitApiKey, env.livekitApiSecret),
    dispatch: new AgentDispatchClient(env.livekitUrl, env.livekitApiKey, env.livekitApiSecret),
    webhook: new WebhookReceiver(env.livekitApiKey, env.livekitApiSecret)
  };
}

// Cloudflare R2 (S3 compatible)
export function buildR2S3Upload(): S3Upload {
  return new S3Upload({
    accessKey: env.r2AccessKeyId,
    secret: env.r2SecretAccessKey,
    region: "auto",
    bucket: env.r2Bucket,
    endpoint: env.r2Endpoint,
    forcePathStyle: true
  });
}

export function buildRoomCompositeOutput(objectKey: string): EncodedFileOutput {
  return new EncodedFileOutput({
    filepath: objectKey,
    output: { case: "s3", value: buildR2S3Upload() }
  });
}

export const defaultCompositeOpts = {
  layout: "speaker",
  encodingOptions: EncodingOptionsPreset.H264_720P_30
};
```

---

# 5) src/app（UI）

## `web/src/app/globals.css`

```css
html, body {
  height: 100%;
  margin: 0;
  padding: 0;
}
```

## `web/src/app/layout.tsx`

```tsx
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Interview",
  description: "LiveKit + Agents minimal app"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
```

## `web/src/app/page.tsx`

```tsx
export default function HomePage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>AI Interview (Dev)</h1>
      <p>Use POST /api/interview/create to generate an interview URL.</p>
    </main>
  );
}
```

---

# 6) Interview ページ

## `web/src/app/interview/[interviewId]/page.tsx`

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";

type JoinResponse =
  | { livekitUrl: string; roomName: string; token: string; durationSec: number }
  | { error: string };

export default function InterviewPage({ params }: { params: { interviewId: string } }) {
  const interviewId = params.interviewId;

  const [join, setJoin] = useState<JoinResponse | null>(null);
  const [ending, setEnding] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

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
        onDisconnected={() => {
          void endInterview();
        }}
      >
        <VideoConference />
      </LiveKitRoom>
    </main>
  );
}
```

---

# 7) API Routes（Route Handlers）

## `web/src/app/api/interview/create/route.ts`

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env, makeCandidateIdentity, makeRoomName } from "@/lib/livekit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const durationSec = Number(body.durationSec ?? 600);

  const interviewId = crypto.randomUUID();
  const roomName = makeRoomName(interviewId);

  const interview = await prisma.interview.create({
    data: {
      interviewId,
      roomName,
      durationSec,
      candidateIdentity: makeCandidateIdentity(interviewId),
      agentName: body.agentName ?? env.agentName,
      r2Bucket: env.r2Bucket
    }
  });

  const url = `${env.baseUrl}/interview/${interview.interviewId}`;
  return NextResponse.json({ interviewId: interview.interviewId, roomName, url });
}
```

## `web/src/app/api/interview/join/route.ts`

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clients, env, makeCandidateToken } from "@/lib/livekit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { interviewId } = await req.json();

  if (!interviewId) {
    return NextResponse.json({ error: "interviewId is required" }, { status: 400 });
  }

  const { dispatch } = clients();

  const updated = await prisma
    .$transaction(async (tx) => {
      const current = await tx.interview.findUnique({ where: { interviewId } });
      if (!current) return null;

      if (current.status !== "created") {
        throw new Error("INTERVIEW_ALREADY_USED");
      }

      return tx.interview.update({
        where: { interviewId },
        data: { status: "used", usedAt: new Date() }
      });
    })
    .catch((e) => {
      if (String(e?.message) === "INTERVIEW_ALREADY_USED") return "ALREADY_USED" as const;
      throw e;
    });

  if (updated === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (updated === "ALREADY_USED")
    return NextResponse.json({ error: "INTERVIEW_ALREADY_USED" }, { status: 409 });

  // Explicit dispatch: agent must be running and registered with matching agent_name
  const dispatchInfo = await dispatch.createDispatch(updated.roomName, updated.agentName);

  await prisma.interview.update({
    where: { interviewId },
    data: { dispatchId: dispatchInfo.id }
  });

  const token = await makeCandidateToken({
    roomName: updated.roomName,
    identity: updated.candidateIdentity,
    ttlSeconds: Math.max(updated.durationSec + 600, 1800)
  });

  return NextResponse.json({
    livekitUrl: env.livekitUrl,
    roomName: updated.roomName,
    token,
    durationSec: updated.durationSec
  });
}
```

## `web/src/app/api/interview/end/route.ts`

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clients } from "@/lib/livekit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { interviewId } = await req.json();

  if (!interviewId) {
    return NextResponse.json({ error: "interviewId is required" }, { status: 400 });
  }

  const { egress, room } = clients();
  const interview = await prisma.interview.findUnique({ where: { interviewId } });
  if (!interview) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (interview.status === "completed") {
    return NextResponse.json({ ok: true, status: "completed", r2ObjectKey: interview.r2ObjectKey ?? null });
  }

  await prisma.interview.update({ where: { interviewId }, data: { status: "ending" } });

  if (interview.egressId) {
    try {
      await egress.stopEgress(interview.egressId);
    } catch {}
  }

  try {
    await room.deleteRoom(interview.roomName);
  } catch {}

  await prisma.interview.update({
    where: { interviewId },
    data: { status: "completed", endedAt: new Date() }
  });

  return NextResponse.json({ ok: true, r2ObjectKey: interview.r2ObjectKey ?? null });
}
```

## `web/src/app/api/livekit/webhook/route.ts`

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clients, buildRoomCompositeOutput, defaultCompositeOpts } from "@/lib/livekit";
import { makeR2ObjectKey } from "@/lib/recordings";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const authHeader = req.headers.get("authorization") ?? "";

  const { webhook, egress } = clients();

  let event: any;
  try {
    event = await webhook.receive(rawBody, authHeader);
  } catch {
    return NextResponse.json({ error: "invalid webhook signature" }, { status: 401 });
  }

  const roomName = event?.room?.name;
  if (!roomName) return NextResponse.json({ ok: true });

  const interview = await prisma.interview.findUnique({ where: { roomName } });
  if (!interview) return NextResponse.json({ ok: true });

  const ev = event?.event as string;
  const participantIdentity = event?.participant?.identity as string | undefined;

  // Start Egress when the candidate joins (simple + robust)
  if (ev === "participant_joined" || ev === "participant_connected") {
    if (participantIdentity === interview.candidateIdentity) {
      await prisma.interview.update({
        where: { interviewId: interview.interviewId },
        data: { candidateJoinedAt: interview.candidateJoinedAt ?? new Date() }
      });

      // Idempotency: if already started, do nothing
      const latest = await prisma.interview.findUnique({ where: { interviewId: interview.interviewId } });
      if (!latest || latest.egressId) return NextResponse.json({ ok: true });

      const objectKey = makeR2ObjectKey({
        interviewId: interview.interviewId,
        roomName: interview.roomName
      });

      const info = await egress.startRoomCompositeEgress(
        interview.roomName,
        buildRoomCompositeOutput(objectKey),
        defaultCompositeOpts
      );

      await prisma.interview.update({
        where: { interviewId: interview.interviewId },
        data: {
          status: "recording",
          egressId: info.egressId,
          r2ObjectKey: objectKey
        }
      });
    }
  }

  if (ev === "egress_ended") {
    await prisma.interview.update({
      where: { interviewId: interview.interviewId },
      data: { status: "completed", endedAt: new Date() }
    });
  }

  return NextResponse.json({ ok: true });
}
```

---

## 次にやること（動作確認コマンド）

`web/` で：

```bash
npm i
npx prisma migrate dev --name init
npm run dev
```

面接URL発行：

```bash
curl -X POST http://localhost:3000/api/interview/create \
  -H "content-type: application/json" \
  -d '{"durationSec": 120}'
```

---

必要なら次は **開発手順3**として「`agent/` の全ファイル（フォルダ構成ごと）」も同じ形式で出します。
