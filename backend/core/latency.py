"""Comprehensive per-stage latency tracker.

Tracks every step of the voice pipeline using LiveKit's built-in event hooks:

Events from AgentSession (all emit timestamps):
- agent_state_changed   → turn start / turn end detection
- conversation_item_added (user)    → STT output ready
- conversation_item_added (agent)   → LLM + tools complete
- user_input_transcribed → Deepgram raw output (intermediate)
- function_tools_executed → tool calls within an LLM turn

Derived metrics:
- vad_detect_ms         user starts speaking → agent realizes user started
- stt_ms                user speech done → transcript ready
- llm_ms                STT done → agent response ready  
- tools_ms              within LLM turn, total tool execution time
- total_perceived_ms    user stops speaking → agent response text ready
"""

import json
import time
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("healthcare-agent")


@dataclass
class LatencyTracker:
    """Records pipeline stage timestamps and computes deltas."""

    turn_count: int = 0
    _marks: dict[str, float] = field(default_factory=dict)

    # ── Mark methods ─────────────────────────────────────────────
    def mark(self, stage: str) -> None:
        """Record timestamp for a stage. Valid stages:
        user_start, agent_listening_start, stt_partial, stt_final,
        llm_start, tool_start, tool_end, llm_end
        """
        self._marks[stage] = time.monotonic()

    def user_started_speaking(self) -> None:
        """User started talking (from agent_state_changed)."""
        self._marks = {"user_start": time.monotonic()}
        self.turn_count += 1

    def agent_listening_start(self) -> None:
        """Agent detected user stopped and started processing."""
        self._marks["agent_listening_start"] = time.monotonic()

    def stt_partial(self) -> None:
        """Intermediate Deepgram transcript."""
        self._marks["stt_partial"] = time.monotonic()

    def stt_final(self) -> None:
        """Final STT transcript for this utterance."""
        self._marks["stt_final"] = time.monotonic()

    def llm_response_ready(self) -> None:
        """Agent response text is ready (LLM + tools done)."""
        self._marks["llm_response"] = time.monotonic()
        self._log_and_send()

    # ── Report generation ────────────────────────────────────────

    def compute(self, from_stage: str, to_stage: str) -> float | None:
        """Return delta in ms between two stages."""
        a = self._marks.get(from_stage)
        b = self._marks.get(to_stage)
        if a is not None and b is not None:
            return round((b - a) * 1000, 1)
        return None

    def report(self) -> dict[str, Any]:
        """Build the structured latency report."""
        total = self.compute("user_start", "llm_response")

        breakdown: dict[str, Any] = {
            "vad_detect_ms": self.compute("user_start", "agent_listening_start"),
            "stt_ms": self.compute("agent_listening_start", "stt_final"),
            "stt_partial_ms": self.compute("agent_listening_start", "stt_partial"),
            "llm_ms": self.compute("stt_final", "llm_response"),
            "total_perceived_ms": total,
        }
        breakdown = {k: v for k, v in breakdown.items() if v is not None}

        return {
            "turn": self.turn_count,
            "total_ms": total,
            "breakdown": breakdown,
            "marks": {k: round(v - self._marks.get("user_start", 0), 1) for k, v in self._marks.items()},
        }

    def _log_and_send(self) -> None:
        """Log to file and return report for DataChannel."""
        r = self.report()
        if not r:
            return

        total = r.get("total_ms")
        logger.info(
            "LATENCY turn=%d total=%s ms %s",
            r["turn"], total if total is not None else "N/A", r.get("breakdown", {}),
        )

        try:
            with open("/tmp/mykare-latency.log", "a") as f:
                f.write(json.dumps(r) + "\n")
        except Exception:
            pass

        # Store last report for async send via DataChannel
        self._last_report = r

    _last_report: dict | None = None

    def pop_report(self) -> dict | None:
        """Get and clear the last generated report."""
        r = self._last_report
        self._last_report = None
        return r