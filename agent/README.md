# LiveKit AI Agent (Python) - minimal

## What this does
- Runs a LiveKit AgentServer as a long-running process.
- Waits for Agent Dispatch from the server (Next.js backend).
- When dispatched, joins the target room as a participant and starts an agent session.

## Setup (Ubuntu 22.04)
```bash
cd agent
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
```

## Env
`.env.local` を用意します（`agent/.env.local.example` を参照）。

```bash
cp .env.local.example .env.local
```

日本語読み上げの品質を上げる場合は、`agent/app.py` の以下を変更してください。

- `ELEVENLABS_MODEL`
- `ELEVENLABS_VOICE`
- `ELEVENLABS_LANGUAGE`

## Run
```bash
python app.py start
```

## Deploy (Fly.io)
`agent/DEPLOY_FLY.md` を参照してください。
