"""Per-call cost estimator for the voice pipeline.

Tracks usage during a call and estimates cost based on industry-standard
pricing for each service.  No billing API calls required.

Prices (USD, updated 2025):
  Deepgram Nova-2  : $0.0043 / minute
  Cartesia Sonic-3 : $0.298  / minute (~$0.005 / char for normal speech)
  OpenRouter Llama3.1-70B : ~$0.70 / 1M input tokens, $0.80 / 1M output tokens
  Beyond Presence  : ~$0.05 / minute (avatar video generation)
  LiveKit Cloud    : free tier (up to 10 K minutes / month)
"""

import time
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("healthcare-agent")

# ── Pricing constants (USD) ───────────────────────────────────────
PRICING = {
    "deepgram_stt": {
        "per_minute": 0.0043,
        "label": "Deepgram STT",
        "color": "purple",
    },
    "cartesia_tts": {
        "per_minute": 0.298,
        "label": "Cartesia TTS",
        "color": "orange",
    },
    "openrouter_llm": {
        "per_turn": 0.015,          # avg cost per turn (input+output tokens)
        "label": "LLM (OpenRouter)",
        "color": "blue",
    },
    "beyond_presence": {
        "per_minute": 0.05,
        "label": "Beyond Presence",
        "color": "pink",
    },
    "livekit": {
        "per_minute": 0.0,
        "label": "LiveKit Cloud",
        "color": "green",
    },
}


@dataclass
class CostTracker:
    """Accumulates usage metrics and produces a cost breakdown."""

    call_start_ts: float = 0.0
    call_end_ts: float = 0.0
    tts_chars: int = 0
    turn_count: int = 0
    _started: bool = False

    # ── Lifecycle ────────────────────────────────────────────────

    def start(self) -> None:
        """Call when the call begins."""
        self.call_start_ts = time.monotonic()
        self._started = True
        logger.info("COST tracking started")

    def stop(self) -> None:
        """Call when the call ends."""
        self.call_end_ts = time.monotonic()
        self._started = False
        logger.info("COST tracking stopped")

    # ── Metric increments ──────────────────────────────────────

    def add_tts_chars(self, chars: int) -> None:
        """Add characters synthesised by TTS."""
        self.tts_chars += chars

    def add_turn(self) -> None:
        """Count one conversational turn."""
        self.turn_count += 1

    # ── Report generation ───────────────────────────────────────

    def report(self) -> dict[str, Any]:
        """Build the cost-breakdown report."""
        duration_sec = max(0.0, self.call_end_ts - self.call_start_ts)
        duration_min = duration_sec / 60.0

        # STT cost
        stt_cost = duration_min * PRICING["deepgram_stt"]["per_minute"]

        # TTS cost (use char-based fallback when duration is tiny)
        tts_cost = duration_min * PRICING["cartesia_tts"]["per_minute"]
        if duration_min < 0.1 and self.tts_chars:
            tts_cost = (self.tts_chars / 60) * 0.30  # rough char rate

        # LLM cost
        llm_cost = self.turn_count * PRICING["openrouter_llm"]["per_turn"]

        # Avatar cost
        avatar_cost = duration_min * PRICING["beyond_presence"]["per_minute"]

        # LiveKit (free tier)
        livekit_cost = 0.0

        total = stt_cost + tts_cost + llm_cost + avatar_cost + livekit_cost

        breakdown = {
            "deepgram_stt": {
                "label": PRICING["deepgram_stt"]["label"],
                "cost_usd": round(stt_cost, 4),
                "unit": f"{duration_min:.1f} min",
                "rate": f"${PRICING['deepgram_stt']['per_minute']}/min",
                "color": PRICING["deepgram_stt"]["color"],
            },
            "cartesia_tts": {
                "label": PRICING["cartesia_tts"]["label"],
                "cost_usd": round(tts_cost, 4),
                "unit": f"{duration_min:.1f} min",
                "rate": f"${PRICING['cartesia_tts']['per_minute']}/min",
                "color": PRICING["cartesia_tts"]["color"],
            },
            "openrouter_llm": {
                "label": PRICING["openrouter_llm"]["label"],
                "cost_usd": round(llm_cost, 4),
                "unit": f"{self.turn_count} turns",
                "rate": f"${PRICING['openrouter_llm']['per_turn']}/turn",
                "color": PRICING["openrouter_llm"]["color"],
            },
            "beyond_presence": {
                "label": PRICING["beyond_presence"]["label"],
                "cost_usd": round(avatar_cost, 4),
                "unit": f"{duration_min:.1f} min",
                "rate": f"${PRICING['beyond_presence']['per_minute']}/min",
                "color": PRICING["beyond_presence"]["color"],
            },
            "livekit": {
                "label": PRICING["livekit"]["label"],
                "cost_usd": 0.0,
                "unit": f"{duration_min:.1f} min",
                "rate": "free tier",
                "color": PRICING["livekit"]["color"],
            },
        }

        return {
            "duration_seconds": round(duration_sec, 1),
            "duration_formatted": _fmt_duration(duration_sec),
            "turn_count": self.turn_count,
            "total_usd": round(total, 4),
            "total_inr": round(total * 83.5, 2),  # approx INR
            "breakdown": breakdown,
        }


def _fmt_duration(sec: float) -> str:
    m, s = divmod(int(sec), 60)
    return f"{m}:{s:02d}"
