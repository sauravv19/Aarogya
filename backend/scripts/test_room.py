"""Quick room test — send text_input as if from browser."""
import asyncio
import json
import os

from livekit import api
from livekit.rtc import Room

ROOM = "mykare"
LIVEKIT_URL = os.environ["LIVEKIT_URL"]
API_KEY = os.environ["LIVEKIT_API_KEY"]
API_SECRET = os.environ["LIVEKIT_API_SECRET"]


async def main():
    token = api.AccessToken(API_KEY, API_SECRET)
    token.with_identity("test-1").with_name("Tester")
    token.with_grants(api.VideoGrants(room_join=True, room=ROOM, can_publish_data=True))
    jwt = token.to_jwt()

    room = Room()

    @room.on("data_received")
    def _on_data(payload: bytes, participant, kind):
        try:
            msg = json.loads(payload.decode("utf-8"))
            c = msg.get("channel", "")
            if c in ("transcript", "tool_call", "call_summary", "latency"):
                print("[DATA]", c, msg.get("role", ""), msg.get("text", "")[:120])
                if c == "tool_call":
                    print("  -> tool:", msg.get("tool"), "status:", msg.get("status"))
        except Exception:
            pass

    print("Connecting to room...")
    await room.connect(LIVEKIT_URL, jwt)
    print("Connected. Sending text_input in 3s...")
    await asyncio.sleep(3)

    await room.local_participant.publish_data(
        json.dumps({"channel": "text_input", "text": "Hi, I want to book an appointment for tomorrow"}).encode("utf-8"),
        reliable=True,
    )
    print("Sent test message. Listening 15s...")
    await asyncio.sleep(15)


if __name__ == "__main__":
    asyncio.run(main())
