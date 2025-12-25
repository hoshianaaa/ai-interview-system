# Fly.io デプロイ手順（agent）

初心者向けに「インストール〜稼働確認」まで一通りまとめています。

## 事前準備
- `agent/` 配下で作業する
- GitHub などにコードを置いておく（任意）

## 0) Fly CLI をインストール

### macOS (Homebrew)
```bash
brew install flyctl
```

### Linux
```bash
curl -L https://fly.io/install.sh | sh
```
インストール後、`flyctl` が `PATH` に入っていない場合は案内に従って `PATH` を追加します。

### Windows
WSL で Linux 手順を使うのが簡単です。

## 1) Fly にログイン
```bash
fly auth login
```

## 2) アプリ設定の確認
`agent/fly.toml` を開き、以下を必要に応じて変更します。
- `app`: Flyのアプリ名（世界で一意）
- `primary_region`: 例 `nrt`（東京）

既にアプリを作成済みの場合はこのままでOKです。

## 2.1) アプリを作成（まだ無い場合）
`fly secrets set` を使う前に、アプリを作成しておく必要があります。

```bash
fly apps create <app_name>
```

`agent/fly.toml` の `app` と同じ名前を指定してください。

## 3) 環境変数（Secrets）を登録
`agent/.env.local.example` を参考に、必要なキーを Fly に登録します。

```bash
fly secrets set \
  LIVEKIT_URL=... \
  LIVEKIT_API_KEY=... \
  LIVEKIT_API_SECRET=... \
  AGENT_NAME=... \
  OPENAI_API_KEY=... \
  DEEPGRAM_API_KEY=... \
  ELEVENLABS_API_KEY=... \
  ELEVENLABS_VOICE=...
```

※ `AGENT_NAME` は Web 側の `LIVEKIT_AGENT_NAME` と一致必須です。

## 4) デプロイ
```bash
fly deploy
```

ローカルに Docker が無い場合は、Fly のリモートビルダーが自動的に使われます。

## 5) 稼働確認
```bash
fly status
fly logs
```

## 実行コマンドについて
このエージェントは `python app.py start` で起動します。  
`python app.py` だけだと「Missing command」になるため注意してください。

## よくあるエラーと対処
- `app already exists`: `fly.toml` の `app` 名が既存。別名に変更。
- `Secrets not found`: `fly secrets set` が不足。必要なキーを再登録。
- `Agent not dispatched`: `AGENT_NAME` が Web 側と不一致。

## 注意点
- エージェントは外部からのHTTPアクセス不要です（基本はアウトバウンドのみ）。
- LiveKit の接続先は `wss/https` を使用してください。
- `.env.local` は Git に入れず、必ず Fly secrets を使ってください。
