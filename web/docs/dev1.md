以下は **あなたの前提（ローカルで Next.js / Python を動かす + DB/R2/LiveKit はクラウド + 後で Vercel/Fly へ移行）**、そして **Prisma v7（prisma.config.ts + datasource.url）**に完全対応した **システム構築手順の全文**です。
（日本語本文、キーワードは English のまま）

> 注：現行実装では R2/egress を廃止し、面接画面から Cloudflare Stream へ直接アップロードします。本書の R2/egress 記述は参考情報として扱ってください。

---

# LiveKit × AI面接システム

## Next.js（API/Frontend）+ Python Agents + Prisma v7 + Neon Postgres + Cloudflare R2

### ローカル開発 →（確認後）Vercel / Fly 移行までのシステム構築方法（全文）

---

## 0. はじめに（LiveKitの背景）

LiveKit は WebRTC を基盤にしたリアルタイム音声・映像プラットフォームで、Room/Participant/Track を中心にした設計が特徴です。
近年では **LiveKit Agents** や **Agent dispatch** により、AI 音声エージェント（会話AI）を「Roomに参加する participant」として扱い、**AI音声エージェントを比較的簡単に構築・運用できる**サービスとしても広まっています。

本手順は、次の要件を最小構成で満たしつつ、商用運用に移行しやすい形を狙っています。

---

## 1. 要件（確定事項）

* 固有の面接URL発行（`/interview/[interviewId]`）
* URLアクセスで面接開始（候補者がブラウザで入室）
* **Agent は必須（音声が録画に入ることが必須）**
* 終了条件：設定した時間 or 終了ボタン
* 面接終了後、**候補者映像 + 候補者音声 + Agent音声**を含む録画ファイルを作成し **Cloudflare R2** に保存
* 1 URL = 1 回のみ（再入室不可）
* 開発：Ubuntu 22.04 ローカル
* 本番：Next.js を Vercel、Agent を Fly.io（予定）

---

## 2. 全体構成（実務的おすすめ）

### Components

* **Next.js（local → Vercel）**

  * Frontend：候補者UI（カメラ/マイク、終了ボタン、タイマー）
  * Backend（Route Handlers）：token発行、dispatch、egress start/stop、webhook受信、DB更新
* **Python Agents（local → Fly）**

  * 常駐プロセスとして起動（dispatch待ち）
  * dispatch されると対象 Room に join して会話開始
* **LiveKit（Cloud推奨）**

  * Room
  * Agent dispatch
  * Egress
  * Webhook events
* **Neon Postgres（クラウドDB）**

  * 面接状態（created/used/recording/ending/completed/failed）
  * dispatchId/egressId/r2ObjectKeyなど
* **Cloudflare R2（保存先）**

  * Egress の出力先（S3 compatible）

---

## 3. データモデル（Prisma）

### 状態（enum）

* `created`：URL発行直後（未使用）
* `used`：join API 成功（再入室禁止のため使用済みロック）
* `recording`：Egress 開始済み
* `ending`：終了処理中（stop/delete中）
* `completed`：終了完了
* `failed`：失敗

### テーブル（Interview）

* `interviewId`（主キー）
* `roomName`（unique）
* `candidateIdentity`（candidate_<id> 等）
* `agentName`
* `dispatchId?`
* `egressId?`
* `r2Bucket`
* `r2ObjectKey?`
* `createdAt/usedAt/candidateJoinedAt/endedAt`
* `error?`

---

## 4. 事前準備（クラウド側）

### 4.1 Neon（Postgres）

* Neon で project/db 作成
* connection string を取得（poolerでもOK）
* `DATABASE_URL` として使用（sslmode=require 推奨）

### 4.2 Cloudflare R2

* bucket 作成（例：`pm1-interview-recordings`）
* S3 credentials（Access Key / Secret Key）作成
* endpoint（例）：`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
* 以降、Egress の s3 output に設定

### 4.3 LiveKit Cloud

* project 作成
* `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` を取得
* Webhook URL は **ローカルの tunnel URL が確定してから設定**

---

## 5. ローカル開発環境（Ubuntu 22.04）

### 5.1 Node.js 20

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg build-essential git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

※ npm が不安定なら：

```bash
echo 'export NODE_OPTIONS="--dns-result-order=ipv4first"' >> ~/.bashrc
source ~/.bashrc
npm config set fetch-timeout 300000
npm config set fetch-retries 5
```

### 5.2 Python

```bash
sudo apt install -y python3 python3-venv python3-pip
python3 --version
```

---

## 6. リポジトリ構成（monorepo）

```text
ai-interview-system/
  web/
  agent/
```

---

# Part A：web（Next.js + Prisma v7 + LiveKit + R2）

## 7. web 作成

```bash
cd ~/projects
mkdir -p ai-interview-system
cd ai-interview-system
git init

npx create-next-app@latest web
cd web
```

推奨：

* TypeScript: Yes
* src/: Yes
* App Router: Yes

## 8. web dependencies

```bash
npm i livekit-server-sdk livekit-client @livekit/components-react @livekit/components-styles
npm i @prisma/client
npm i -D prisma dotenv
```

---

## 9. Prisma v7 セットアップ（重要）

### 9.1 `.env`（Prisma CLI 用）

`web/.env` を作成し、**DATABASE_URL だけ**入れる：

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require"
```

### 9.2 `.env.local`（Next.js 用）

`web/.env.local`：

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

## 10. Prisma init

```bash
npx prisma init
```

### 10.1 `prisma/schema.prisma`（urlを書かない）

`web/prisma/schema.prisma`：

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

### 10.2 `prisma.config.ts`（v7の要点）

`web/prisma.config.ts`（web直下）：

```ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

### 10.3 validate / migrate

```bash
npx prisma validate
npx prisma migrate dev --name init
```

---

## 11. Prisma Client（Next.js用）

`web/src/lib/prisma.ts`

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

---

## 12. LiveKit/R2 helpers（要点）

### 12.1 録画命名（UTC推奨）

* timezone：**UTC**
* format：`YYYYMMDDTHHMMSSZ`（例：`20251219T003010Z`）
* objectKey：`recordings/<interviewId>/<timestamp>_<roomName>.mp4`

理由：

* 運用で人間も機械も扱いやすい
* timezone事故が起きにくい

### 12.2 Egress 出力先：R2（S3 compatible）

* endpoint：`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
* region：`auto`
* forcePathStyle：`true`

---

## 13. API / Frontend（最小）

### 13.1 create（URL発行）

* DB に Interview を `created` で作る
* URL を返す（`/interview/[id]`）

### 13.2 join（再入室不可 + dispatch）

* `created` のときだけ `used` に更新（transaction）
* token を返す
* dispatch を作成して `dispatchId` 保存

### 13.3 webhook（candidate join → egress start）

* candidateIdentity が join したら Egress start
* `egressId` と `r2ObjectKey` を保存し `recording`

### 13.4 end（stop + delete）

* `egress stop`（あれば）
* `room delete`
* status `completed` / `endedAt`

### 13.5 Frontend

* `/interview/[id]` で join API を叩く
* LiveKitRoom connect
* timer / End ボタンで `/api/interview/end`

> ※ ここは前に提示した Route Handlers と page.tsx をそのまま使用すればOKです
> （必要ならこの回答の次で、web 配下の全ファイルを「フォルダ＋ファイル名付き」で再掲します）

---

# Part B：ローカルで Webhook を受ける（必須）

## 14. tunnel（cloudflared 推奨）

### 14.1 install

```bash
sudo apt update
sudo apt install -y cloudflared
cloudflared --version
```

### 14.2 web 起動

```bash
npm run dev
```

### 14.3 tunnel 起動（別ターミナル）

```bash
cloudflared tunnel --url http://localhost:3000
```

`https://xxxxx.trycloudflare.com` が出るので控える。

### 14.4 LiveKit Webhook の送信先

LiveKit の Webhook URL を以下に設定：

```
https://xxxxx.trycloudflare.com/api/livekit/webhook
```

---

# Part C：agent（Python Agents）

## 15. agent ローカル起動

### 15.1 venv

```bash
cd ~/projects/ai-interview-system/agent
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
```

### 15.2 dependencies

あなたのコードに合わせて（最低限）：

```bash
pip install python-dotenv livekit livekit-agents
```

Deepgram / OpenAI / ElevenLabs 等を使うなら、それぞれの SDK / env を追加。

### 15.3 `.env.local`

`agent/.env.local`

```env
LIVEKIT_URL="wss://YOUR_PROJECT.livekit.cloud"
LIVEKIT_API_KEY="YOUR_KEY"
LIVEKIT_API_SECRET="YOUR_SECRET"

OPENAI_API_KEY="..."
DEEPGRAM_API_KEY="..."
ELEVENLABS_API_KEY="..."
```

### 15.4 起動

```bash
python app.py
```

**重要**：`agent_name="Sage-266e"` が web の `LIVEKIT_AGENT_NAME` と一致していること。

---

# Part D：ローカル動作確認（チェックリスト）

## 16. 動作確認フロー

1. `POST /api/interview/create`

   * DB：`created` で行が作られる

2. 候補者URLを開く

   * `join` が走る
   * DB：`created → used`
   * `dispatchId` が入る

3. candidate が room join

   * LiveKit → webhook が tunnel 経由でローカルへ届く
   * webhook が **Egress start**
   * DB：`recording` / `egressId` / `r2ObjectKey`

4. R2 bucket に MP4 が作られる（objectKey で確認）

5. End ボタン or タイマー

   * `/api/interview/end`
   * `egress stop` + `room delete`
   * DB：`completed` / `endedAt`

---

# Part E：本番移行（動作確認後）

## 17. web → Vercel

1. GitHub push
2. Vercel import（Root Directory：`web`）
3. Env Vars を追加

   * `.env` の `DATABASE_URL`
   * `.env.local` の LiveKit/R2 も全て
4. build と migration を分離（推奨）

`web/package.json`：

```json
{
  "scripts": {
    "build": "prisma generate && next build --webpack",
    "migrate:deploy": "prisma migrate deploy"
  }
}
```

* 本番デプロイ時は `npm run migrate:deploy` を別ステップで実行

## 18. agent → Fly.io

* `agent/` を Fly に deploy
* secrets に `.env.local` 相当を登録
* 常駐起動

## 19. LiveKit Webhook を本番へ変更

```
https://<vercel-domain>/api/livekit/webhook
```

---

# 付録：よくある詰まりポイント

* Webhook が来ない：tunnel URL / LiveKit Webhook 設定ミス
* Egress は動くが R2 に保存されない：endpoint / credentials / bucket / forcePathStyle
* Agent が入らない：agent が起動してない、agent_name 不一致、dispatch 失敗
* 再入室禁止：join で `created` 以外は 409 を返す

---

## 次に必要なら（おすすめ）

「全文」はここまでで手順として完成ですが、実装を確実に進めるには

* `web/` の **全ファイルをフォルダ構成ごと**（コピペで作れる形）
* `agent/` の **最小起動テンプレ**（dispatch待ち + join + 会話）
* LiveKit webhook のイベント名差分に備えた **冪等処理テンプレ**

をセットで出すと最短です。

必要なら次の返信で、**web のファイル一式（パス付き）を完全に貼ります**。
