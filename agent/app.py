import asyncio
import json
import logging
import os
from collections.abc import AsyncIterable

from dotenv import load_dotenv

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    ModelSettings,
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
ELEVENLABS_MODEL = "elevenlabs/eleven_multilingual_v2"
ELEVENLABS_VOICE = "XrExE9yKIg1WjnnlVkGX"
ELEVENLABS_LANGUAGE = "ja"


DEFAULT_INTERVIEW_PROMPT = (
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


async def strip_asterisks(text: AsyncIterable[str]) -> AsyncIterable[str]:
    async for chunk in text:
        if "*" in chunk:
            chunk = chunk.replace("*", "")
        yield chunk


class DefaultInterviewAgent(Agent):
    """
    Minimal interview agent instructions.
    Replace/extend this prompt freely.
    """

    def __init__(self, prompt: str = DEFAULT_INTERVIEW_PROMPT) -> None:
        super().__init__(instructions=prompt)

    def tts_node(self, text: AsyncIterable[str], model_settings: ModelSettings):
        filtered_text = strip_asterisks(text)
        return Agent.default.tts_node(self, filtered_text, model_settings)


def resolve_prompt(ctx: JobContext) -> str:
    metadata = getattr(ctx.job, "metadata", "") or ""
    if not isinstance(metadata, str):
        metadata = str(metadata)
    if metadata:
        try:
            parsed = json.loads(metadata)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            prompt = parsed.get("prompt")
            if isinstance(prompt, str) and prompt.strip():
                return prompt.strip()
        if metadata.strip():
            return metadata.strip()
    return DEFAULT_INTERVIEW_PROMPT


def resolve_opening_message(ctx: JobContext) -> str | None:
    metadata = getattr(ctx.job, "metadata", "") or ""
    if not isinstance(metadata, str):
        metadata = str(metadata)
    if not metadata:
        return None
    try:
        parsed = json.loads(metadata)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict):
        opening_message = parsed.get("openingMessage")
        if isinstance(opening_message, str) and opening_message.strip():
            return opening_message.strip()
    return None


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
    #   TTS: elevenlabs/eleven_multilingual_v2
    #
    # If you want to start without external providers, you can still keep the
    # structure and later fill these in. However, a voice agent typically needs all.

    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-2", language="ja"),
        llm=inference.LLM(model="openai/gpt-4o"),
        tts=inference.TTS(
            model=ELEVENLABS_MODEL,
            # Set a default voice ID; change to your preferred voice
            voice=ELEVENLABS_VOICE,
            language=ELEVENLABS_LANGUAGE,
        ),
        # Optional: turn detection
        # turn_detection=MultilingualModel(),
        # Optional: VAD
        # vad=ctx.proc.userdata.get("vad"),
        preemptive_generation=True,
    )

    def extract_text(message: object) -> str:
        if isinstance(message, str):
            return message
        for key in ("text", "content", "message"):
            value = getattr(message, key, None)
            if isinstance(value, str):
                return value
        return str(message)

    def publish_chat(role: str, message: object) -> None:
        text = extract_text(message).strip()
        if not text:
            return
        payload = json.dumps({"role": role, "text": text}, ensure_ascii=False).encode("utf-8")

        async def _send() -> None:
            try:
                await ctx.room.local_participant.publish_data(payload, reliable=True)
            except Exception as exc:
                logger.warning("publish_data failed: %s", exc)

        asyncio.create_task(_send())

    if hasattr(session, "on"):
        try:
            def on_user_transcribed(ev) -> None:
                if getattr(ev, "is_final", False):
                    publish_chat("candidate", getattr(ev, "transcript", ""))

            def on_conversation_item_added(ev) -> None:
                item = getattr(ev, "item", None)
                role = getattr(item, "role", None)
                if role == "assistant":
                    text = getattr(item, "text_content", None)
                    publish_chat("interviewer", text or "")

            session.on("user_input_transcribed", on_user_transcribed)
            session.on("conversation_item_added", on_conversation_item_added)
        except Exception as exc:
            logger.warning("Failed to register transcript handlers: %s", exc)

    prompt = resolve_prompt(ctx)
    opening_message = resolve_opening_message(ctx)
    await session.start(
        agent=DefaultInterviewAgent(prompt=prompt),
        room=ctx.room,
    )

    if opening_message:
        try:
            await session.say(opening_message)
        except Exception as exc:
            logger.warning("Failed to send opening message: %s", exc)

    logger.info("Agent session started for room=%s", ctx.room.name)


if __name__ == "__main__":
    # Starts the agent server CLI app (connects to LiveKit)
    cli.run_app(server)
