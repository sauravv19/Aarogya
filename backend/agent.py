"""Mykare Healthcare Voice Agent — Entry Point.

Uses server-side Deepgram STT (nova-2) for voice input.
Browser can also send text_input via DataChannel for manual fallback.
"""

import json
import logging
import asyncio
import multiprocessing
import time

if __name__ == "__main__":
    multiprocessing.set_start_method("fork", force=True)

from dotenv import load_dotenv
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    WorkerType,
    AgentSession,
    ChatMessage,
    ConversationItemAddedEvent,
    cli,
)
from livekit.agents.voice.room_io.types import RoomOptions
from livekit.plugins import deepgram, silero, cartesia, bey
from livekit.plugins import openai as lk_openai

from core.config import (
    LLM_BASE_URL, LLM_API_KEY, LLM_MODEL,
    CARTESIA_VOICE_ID, DEEPGRAM_API_KEY,
    BEY_API_KEY, BEY_AVATAR_ID,
)
from db.database import init_db
from db import crud
from core.healthcare_agent import HealthcareAgent, UserData
from core.latency import LatencyTracker
from core.cost_tracker import CostTracker

load_dotenv()

logger = logging.getLogger("healthcare-agent")
logger.setLevel(logging.INFO)


def _extract_text(item):
    if not isinstance(item, ChatMessage):
        return None
    parts = []
    for c in (item.content or []):
        if isinstance(c, str):
            parts.append(c)
        elif hasattr(c, "text"):
            parts.append(c.text)
    return " ".join(parts).strip() or None


async def entrypoint(ctx: JobContext) -> None:
    fh = logging.FileHandler("/tmp/mykare-entrypoint.log")
    fh.setLevel(logging.INFO)
    logging.getLogger().addHandler(fh)

    logger.info("=== ENTRYPOINT STARTED === room=%s", ctx.room.name)

    # Subscribe to user microphone audio so Deepgram STT can process it
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("Connected to room %s", ctx.room.name)

    init_db()

    llm = lk_openai.LLM(
        model=LLM_MODEL,
        base_url=LLM_BASE_URL,
        api_key=LLM_API_KEY,
    )

    userdata = UserData()
    tracker = LatencyTracker()
    cost_tracker = CostTracker()
    userdata.cost_tracker = cost_tracker

    try:
        conv = crud.create_conversation(user_id=None, room_name=ctx.room.name)
        userdata.conversation_id = conv["id"]
    except Exception as e:
        logger.warning("Failed to create conversation record: %s", e)

    # Server-side STT + VAD — primary voice input path
    session = AgentSession(
        llm=llm,
        stt=deepgram.STT(
            model="nova-2",
            api_key=DEEPGRAM_API_KEY,
        ),
        vad=silero.VAD.load(),
        tts=cartesia.TTS(model="sonic-3", voice=CARTESIA_VOICE_ID),
        userdata=userdata,
    )

    def on_conversation_item_added(ev: ConversationItemAddedEvent):
        text = _extract_text(ev.item)
        if not text:
            return
        role = getattr(ev.item, "role", "assistant")
        role_label = "user" if role == "user" else "agent"

        if role == "user":
            tracker.stt_final()
            cost_tracker.add_turn()
        else:
            tracker.llm_response_ready()
            cost_tracker.add_tts_chars(len(text))

        report = tracker.pop_report()
        if report:
            asyncio.create_task(
                ctx.room.local_participant.publish_data(
                    payload=json.dumps({"channel": "latency", **report}).encode(),
                    reliable=True,
                )
            )

        asyncio.create_task(
            ctx.room.local_participant.publish_data(
                payload=json.dumps({"channel": "transcript", "role": role_label, "text": text}).encode(),
                reliable=True,
            )
        )
        userdata.conversation.append({"role": role_label, "text": text})

    session.on("conversation_item_added", on_conversation_item_added)

    # ── Text input handler (manual fallback via DataChannel) ────────
    def on_data_received(packet):
        try:
            payload = getattr(packet, "data", None) or packet
            participant = getattr(packet, "participant", None)
            data = json.loads(payload.decode("utf-8"))
            if data.get("channel") == "text_input":
                text = data.get("text", "").strip()
                if not text:
                    return
                logger.info("TEXT_INPUT from %s: %s", getattr(participant, "_identity", "?"), text)
                tracker.user_started_speaking()
                tracker.stt_final()
                asyncio.create_task(session.generate_reply(user_input=text))
        except Exception as exc:
            logger.warning("Failed to handle text_input: %s", exc)

    ctx.room.on("data_received", on_data_received)

    avatar_session = bey.AvatarSession(avatar_id=BEY_AVATAR_ID, api_key=BEY_API_KEY)
    try:
        await avatar_session.start(session, room=ctx.room)
        logger.info("Beyond Presence avatar session started")
        cost_tracker.start()
    except Exception as exc:
        logger.exception("BEY ERROR: %s", exc)
        cost_tracker.start()  # start tracking even if avatar fails

    agent = HealthcareAgent()
    await session.start(
        agent=agent,
        room=ctx.room,
        room_options=RoomOptions(close_on_disconnect=False),
    )
    logger.info("Voice agent started in room %s", ctx.room.name)

    await session.generate_reply(
        instructions="Greet the patient warmly and introduce yourself as Aarogya from Mykare Health Clinic. Ask how you can help them today."
    )


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            worker_type=WorkerType.ROOM,
            agent_name="healthcare-agent",
        )
    )
