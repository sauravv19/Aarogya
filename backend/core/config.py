import os
from dotenv import load_dotenv

load_dotenv()

# LiveKit
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")

# LLM (OpenAI-compatible — works with OpenAI, OpenRouter, Ollama, Groq, etc.)
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", os.getenv("OPENAI_API_KEY", ""))
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4.1-mini")

# STT
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")

# TTS
CARTESIA_API_KEY = os.getenv("CARTESIA_API_KEY", "")
CARTESIA_VOICE_ID = os.getenv("CARTESIA_VOICE_ID", "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc")

# Avatar (Beyond Presence — speech-to-video, synced with Cartesia audio)
BEY_API_KEY = os.getenv("BEY_API_KEY", "")
BEY_AVATAR_ID = os.getenv("BEY_AVATAR_ID", "694c83e2-8895-4a98-bd16-56332ca3f449")

# Database
DB_PATH = os.getenv("DB_PATH", "healthcare.db")

# Business hours
BUSINESS_HOUR_START = 9
BUSINESS_HOUR_END = 17
SLOT_DURATION_MINUTES = 30