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

