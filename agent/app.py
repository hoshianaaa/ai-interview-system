import logging
import os

from dotenv import load_dotenv

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    inference,
)

# Optional plugins (enable if you install them)
# from livekit.plugins import silero
# from livekit.plugins.turn_detector.multilingual import MultilingualModel

logger = logging.getLogger("agent")
logging.basicConfig(level=logging.INFO)

# Load env
load_dotenv(".env.local")

AGENT_NAME = os.getenv("AGENT_NAME", "Sage-266e")


class DefaultInterviewAgent(Agent):
    """
    Minimal interview agent instructions.
    Replace/extend this prompt freely.
    """

    def __init__(self) -> None:
        super().__init__(
            instructions=(
                "あなたは日本語で話す面接官の人工知能です。"
                "目的は候補者の経験と考え方を短時間で把握することです。"
                "質問は大きく三つだけにします。"
                "各質問では候補者の回答をよく聞き、重要度が高い点を1つ選び、2〜3回だけ深掘りします。"
                "口調は丁寧で落ち着いていて、短く分かりやすく話します。"
                "分からない点は推測せず確認してください。"
                "最後に要点を短くまとめて終了してください。\n\n"
                "本質問1: 最近の仕事やプロジェクトで、主担当として成果を出した取り組みを一つ教えてください。\n"
                "本質問2: 難しい状況やトラブルに直面したとき、どうやって立て直しましたか。具体例で教えてください。\n"
                "本質問3: 次の職場や役割で実現したいことは何ですか。"
            )
        )


_http_port_raw = os.getenv("AGENT_HTTP_PORT", "").strip()
_http_port = int(_http_port_raw) if _http_port_raw else 8081
server = AgentServer(port=_http_port)


def prewarm(proc: JobProcess):
    """
    Optional: preload VAD models etc.
    Keep minimal to reduce setup complexity.
    """
    # If you use silero VAD:
    # proc.userdata["vad"] = silero.VAD.load()
    pass


server.setup_fnc = prewarm


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext):
    """
    This is called when the agent is dispatched into a room.
    The agent will join ctx.room automatically via the AgentSession.start call.
    """
    logger.info("Agent dispatched. Joining room=%s", ctx.room.name)

    # --- Choose providers (minimal defaults) ---
    # NOTE:
    # - STT/LLM/TTS providers require corresponding API keys in env.
    # - You can swap these models later.
    #
    # Example choices:
    #   STT: deepgram/nova-2
    #   LLM: openai/gpt-4o
    #   TTS: elevenlabs/eleven_turbo_v2_5
    #
    # If you want to start without external providers, you can still keep the
    # structure and later fill these in. However, a voice agent typically needs all.

    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-2", language="ja"),
        llm=inference.LLM(model="openai/gpt-4o"),
        tts=inference.TTS(
            model="elevenlabs/eleven_turbo_v2_5",
            # Set a default voice ID; change to your preferred voice
            voice=os.getenv("ELEVENLABS_VOICE", "JBFqnCBsd6RMkjVDRZzb"),
            language="ja",
        ),
        # Optional: turn detection
        # turn_detection=MultilingualModel(),
        # Optional: VAD
        # vad=ctx.proc.userdata.get("vad"),
        preemptive_generation=True,
    )

    await session.start(
        agent=DefaultInterviewAgent(),
        room=ctx.room,
    )

    logger.info("Agent session started for room=%s", ctx.room.name)


if __name__ == "__main__":
    # Starts the agent server CLI app (connects to LiveKit)
    cli.run_app(server)
