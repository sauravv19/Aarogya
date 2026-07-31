"""Healthcare front-desk voice agent with appointment booking tools."""

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from livekit.agents import (
    Agent,
    RunContext,
    function_tool,
    get_job_context,
    ToolError,
    StopResponse,
)

from db import crud
from core.slot_generator import generate_slots, format_slots_for_voice, format_date, format_appointments_for_voice
from core.cost_tracker import CostTracker

logger = logging.getLogger("healthcare-agent")

INSTRUCTIONS = """You are Aarogya, a friendly and professional healthcare front-desk assistant for Mykare Health Clinic.

## Your Role
You help patients book, modify, cancel, and check appointments. You communicate through voice, so keep your responses:
- Short and natural (1-2 sentences usually)
- Free of special characters, bullet points, or numbered lists
- Conversational and warm
- Clear with confirmations before taking actions

## Conversation Flow
1. Greet the patient warmly
2. Ask for their phone number to identify them (use the identify_user tool)
3. Understand what they need (book, check, modify, or cancel an appointment)
4. Use the appropriate tool to help them
5. Always confirm details before booking or modifying
6. At the end, summarize the conversation

## Important Rules
- ALWAYS use the identify_user tool when someone mentions their phone number or when you need to know who they are
- ALWAYS confirm date, time, and doctor before booking an appointment
- When showing available slots, mention them naturally like "I have openings at 10 AM, 11 AM, and 2 PM tomorrow"
- If a user wants to book but hasn't been identified yet, ask for their phone number first
- If no slots are available for a requested date, suggest the next available date
- Use the end_conversation tool when the patient is done to generate a summary
- Never reveal other patients' information
- Handle mistakes gracefully - if someone says the wrong date, help them correct it
- If someone provides an invalid phone number, politely ask for a valid 10-digit number

## Date Handling
- When someone says "tomorrow" or "next Monday", calculate the actual date
- Today's date is {today}
- The clinic is open Monday through Friday, 9 AM to 5 PM
- Each appointment is 30 minutes

## Tool Usage
- identify_user: Call this when you have a phone number to look up or create a patient
- fetch_slots: Call this to get available time slots for a specific date. You can optionally specify a doctor.
- book_appointment: Call this to book an appointment. Pass the date and time directly. Do NOT ask the user for a slot_id — you already know the date and time from the conversation.
- retrieve_appointments: Call this to list a patient's appointments. Default shows booked ones.
- cancel_appointment: Call this to cancel an appointment by ID, or by date + time if the patient doesn't know the ID.
- modify_appointment: Call this to reschedule an appointment by ID, or by old_date + old_time. You can also change reason or doctor.
- end_conversation: Call this when the conversation is ending to generate a summary
"""


@dataclass
class UserData:
    """Per-session user data stored in the agent's context."""
    user: dict | None = None
    slots: dict = field(default_factory=dict)
    conversation: list = field(default_factory=list)
    appointment_actions: list = field(default_factory=list)
    preferences: list = field(default_factory=list)
    conversation_id: int | None = None
    cost_tracker: CostTracker | None = None


class HealthcareAgent(Agent):
    def __init__(self) -> None:
        today = datetime.now().strftime("%Y-%m-%d")
        instructions = INSTRUCTIONS.format(today=today)
        super().__init__(instructions=instructions)

    # ── User Identification ──────────────────────────────────────

    @function_tool
    async def identify_user(self, context: RunContext, phone: str) -> tuple:
        """Look up or create a user by their phone number. Call this whenever a patient provides their phone number.

        Args:
            phone: The patient's phone number (10 digits, e.g. '9876543210')
        """
        phone = re.sub(r"[^\d]", "", phone)
        if phone.startswith("91") and len(phone) == 12:
            phone = phone[2:]
        if len(phone) != 10 or not phone.isdigit():
            raise ToolError("That doesn't seem like a valid phone number. Could you provide a 10-digit number?")

        user = crud.get_user_by_phone(phone)

        if user:
            context.userdata.user = user
            if context.userdata.conversation_id:
                try:
                    crud.update_conversation_user(context.userdata.conversation_id, user["id"])
                except Exception:
                    pass
            await self._notify_frontend(context, "tool_call", {
                "tool": "identify_user",
                "status": "completed",
                "data": {"name": user["name"], "phone": user["phone"]},
            })
            return None, f"Welcome back, {user['name']}! How can I help you today?"

        context.userdata.user = {"id": None, "name": "", "phone": phone}
        await self._notify_frontend(context, "tool_call", {
            "tool": "identify_user",
            "status": "pending_name",
            "data": {"phone": phone, "new_user": True},
        })
        return None, f"I don't see an account for {phone}. Could you please tell me your name so I can create one for you?"

    @function_tool
    async def create_user(self, context: RunContext, name: str) -> tuple:
        """Create a new user account with their name and phone number. Call this after collecting the patient's name if they are a new user.

        Args:
            name: The patient's full name
        """
        if context.userdata.user and context.userdata.user.get("phone"):
            phone = context.userdata.user["phone"]
            user = crud.create_user(name=name, phone=phone)
            context.userdata.user = user
            if context.userdata.conversation_id:
                try:
                    crud.update_conversation_user(context.userdata.conversation_id, user["id"])
                except Exception:
                    pass
            await self._notify_frontend(context, "tool_call", {
                "tool": "create_user",
                "status": "completed",
                "data": {"name": user["name"], "phone": user["phone"]},
            })
            return None, f"Great, {name}! Your account has been created. How can I help you today?"
        return None, "I don't have your phone number yet. Could you please share it first?"

    # ── Appointment Slots ────────────────────────────────────────

    @function_tool
    async def fetch_slots(self, context: RunContext, date: str, doctor: str = "Dr. Sharma") -> tuple:
        """Fetch available appointment slots for a given date. Call this when a patient wants to see available times.

        Args:
            date: The date in YYYY-MM-DD format
            doctor: Optional doctor name (defaults to Dr. Sharma)
        """
        await self._notify_frontend(context, "tool_call", {
            "tool": "fetch_slots",
            "status": "started",
            "data": {"date": date, "doctor": doctor},
        })

        slots = generate_slots(date, doctor_name=doctor)
        if not slots:
            await self._notify_frontend(context, "tool_call", {
                "tool": "fetch_slots",
                "status": "completed",
                "data": {"date": date, "count": 0},
            })
            return None, f"I'm sorry, there are no available slots for {format_date(date)}. Would you like to try another date?"

        # Filter out already-booked slots
        booked_times = crud.get_booked_slots(date)
        available = [s for s in slots if s["time"] not in booked_times]

        if not available:
            await self._notify_frontend(context, "tool_call", {
                "tool": "fetch_slots",
                "status": "completed",
                "data": {"date": date, "count": 0},
            })
            return None, f"All slots for {format_date(date)} are taken. Would you like to check another date?"

        context.userdata.slots = {s["id"]: s for s in available}
        await self._notify_frontend(context, "tool_call", {
            "tool": "fetch_slots",
            "status": "completed",
            "data": {"date": date, "count": len(available), "slots": [
                {"id": s["id"], "time": s["time"], "display": s["display"], "doctor": s["doctor"]} for s in available
            ]},
        })
        return None, format_slots_for_voice(available)

    # ── Appointment Booking ───────────────────────────────────────

    @function_tool
    async def book_appointment(
        self,
        context: RunContext,
        slot_id: str = "",
        date: str = "",
        time: str = "",
        reason: str = "General consultation",
    ) -> tuple:
        """Book an appointment for the patient. You must confirm the details with the patient before calling this.

        Args:
            slot_id: (internal, rarely needed) Only use if you already have the exact slot_id from recent fetch_slots.
            date: The date in YYYY-MM-DD format. Use this + time instead of asking the user for a slot_id.
            time: The time in HH:MM format. Use this + date instead of asking the user for a slot_id.
            reason: The reason for the visit, e.g. 'General consultation', 'Follow-up', 'Check-up'
        """
        user = context.userdata.user
        if not user or not user.get("id"):
            return None, "I need to identify you first. Could you please share your phone number?"

        # Resolve slot from slot_id, or date+time, or fail
        slot = None
        if slot_id:
            slot = context.userdata.slots.get(slot_id)
        if not slot and date and time:
            slot = {"id": f"{date}_{time}", "date": date, "time": time, "display": time}
            # Ensure slot is in context.userdata.slots for future reference
            context.userdata.slots[slot["id"]] = slot
        if not slot:
            raise ToolError(
                "I couldn't find that time slot. Please tell me the date and time you'd like to book."
            )

        if crud.is_slot_booked(slot["date"], slot["time"]):
            raise ToolError("Sorry, that slot just got taken. Let me find you another time.")

        await self._notify_frontend(context, "tool_call", {
            "tool": "book_appointment",
            "status": "started",
            "data": {"date": slot["date"], "time": slot["time"]},
        })

        appointment = crud.create_appointment(
            user_id=user["id"],
            date=slot["date"],
            time=slot["time"],
            reason=reason,
        )

        context.userdata.appointment_actions.append({
            "action": "booked",
            "appointment": appointment,
        })

        await self._notify_frontend(context, "tool_call", {
            "tool": "book_appointment",
            "status": "completed",
            "data": appointment,
        })

        return None, (
            f"Your appointment is confirmed for {format_date(slot['date'])} "
            f"at {slot.get('display', slot['time'])} with Dr. Sharma for {reason}. "
            f"Is there anything else I can help you with?"
        )

    # ── Appointment Retrieval ─────────────────────────────────────

    @function_tool
    async def retrieve_appointments(self, context: RunContext, status: str = "booked") -> tuple:
        """Retrieve appointments for the current patient. Call this when a patient wants to check their appointments.

        Args:
            status: Filter by status — 'booked' (default), 'cancelled', or 'all'
        """
        user = context.userdata.user
        if not user or not user.get("id"):
            return None, "I need to identify you first. Could you please share your phone number?"

        await self._notify_frontend(context, "tool_call", {
            "tool": "retrieve_appointments",
            "status": "started",
        })

        appointments = crud.get_user_appointments(user["id"], status=status if status != "all" else None)

        await self._notify_frontend(context, "tool_call", {
            "tool": "retrieve_appointments",
            "status": "completed",
            "data": {"appointments": appointments, "count": len(appointments)},
        })

        if not appointments:
            return None, "You don't have any upcoming appointments. Would you like to book one?"

        return None, format_appointments_for_voice(appointments)

    # ── Appointment Cancellation ───────────────────────────────────

    @function_tool
    async def cancel_appointment(
        self,
        context: RunContext,
        appointment_id: str = "",
        date: str = "",
        time: str = "",
    ) -> tuple:
        """Cancel an existing appointment. You should confirm with the patient before cancelling.

        Args:
            appointment_id: The ID of the appointment to cancel. Preferred if available.
            date: If appointment_id is not available, the date of the appointment to cancel (YYYY-MM-DD).
            time: If appointment_id is not available, the time of the appointment to cancel (HH:MM).
        """
        user = context.userdata.user
        if not user or not user.get("id"):
            return None, "I need to identify you first. Could you please share your phone number?"

        # Resolve appointment ID
        resolved_id: int | None = None
        if appointment_id:
            try:
                resolved_id = int(appointment_id)
            except ValueError:
                raise ToolError("That appointment ID doesn't look right. Could you try again?")
        elif date and time:
            # Find appointment by date+time for this user
            appts = crud.get_user_appointments(user["id"], status="booked")
            for a in appts:
                if a["date"] == date and a["time"] == time:
                    resolved_id = a["id"]
                    break
            if not resolved_id:
                raise ToolError(
                    f"I don't see a booked appointment on {format_date(date)} at {time}. "
                    "Could you double-check the date and time?"
                )
        else:
            raise ToolError(
                "I need either the appointment ID or the date and time to cancel. "
                "Which appointment would you like to cancel?"
            )

        await self._notify_frontend(context, "tool_call", {
            "tool": "cancel_appointment",
            "status": "started",
            "data": {"appointment_id": resolved_id},
        })

        result = crud.cancel_appointment(resolved_id)
        if not result:
            raise ToolError("I couldn't find that appointment. Could you check the details?")

        context.userdata.appointment_actions.append({
            "action": "cancelled",
            "appointment_id": str(resolved_id),
        })

        await self._notify_frontend(context, "tool_call", {
            "tool": "cancel_appointment",
            "status": "completed",
            "data": result,
        })

        return None, (
            f"Your appointment on {format_date(result['date'])} at {result['time']} "
            f"has been cancelled. Is there anything else I can help with?"
        )

    # ── Appointment Modification ─────────────────────────────────

    @function_tool
    async def modify_appointment(
        self,
        context: RunContext,
        appointment_id: str = "",
        old_date: str = "",
        old_time: str = "",
        new_date: str = "",
        new_time: str = "",
        new_reason: str = "",
        new_doctor: str = "",
    ) -> tuple:
        """Reschedule or update an existing appointment. Confirm the new details with the patient before rescheduling.

        Args:
            appointment_id: The ID of the appointment to modify. Preferred if available.
            old_date: If appointment_id is not available, the current date of the appointment (YYYY-MM-DD).
            old_time: If appointment_id is not available, the current time of the appointment (HH:MM).
            new_date: The new date in YYYY-MM-DD format. Required for reschedule.
            new_time: The new time in HH:MM format. Required for reschedule.
            new_reason: Optional new reason for the visit.
            new_doctor: Optional new doctor name.
        """
        user = context.userdata.user
        if not user or not user.get("id"):
            return None, "I need to identify you first. Could you please share your phone number?"

        # Resolve appointment ID
        resolved_id: int | None = None
        if appointment_id:
            try:
                resolved_id = int(appointment_id)
            except ValueError:
                raise ToolError("That appointment ID doesn't look right. Could you try again?")
        elif old_date and old_time:
            appts = crud.get_user_appointments(user["id"], status="booked")
            for a in appts:
                if a["date"] == old_date and a["time"] == old_time:
                    resolved_id = a["id"]
                    break
            if not resolved_id:
                raise ToolError(
                    f"I don't see a booked appointment on {format_date(old_date)} at {old_time}. "
                    "Could you double-check the date and time?"
                )
        else:
            raise ToolError(
                "I need either the appointment ID or the current date and time to modify. "
                "Which appointment would you like to reschedule?"
            )

        # Validate the new slot is available (if changing date/time)
        if new_date and new_time:
            if crud.is_slot_booked(new_date, new_time):
                raise ToolError("That time slot is not available. Would you like to pick a different time?")
        elif not new_date and not new_time and not new_reason and not new_doctor:
            raise ToolError("Please tell me what you'd like to change about the appointment.")

        await self._notify_frontend(context, "tool_call", {
            "tool": "modify_appointment",
            "status": "started",
            "data": {
                "appointment_id": resolved_id,
                "new_date": new_date or old_date,
                "new_time": new_time or old_time,
            },
        })

        result = crud.modify_appointment(
            resolved_id,
            new_date or old_date,
            new_time or old_time,
            new_reason=new_reason or None,
            new_doctor=new_doctor or None,
        )
        if not result:
            raise ToolError("I couldn't find that appointment. Could you check the details?")

        context.userdata.appointment_actions.append({
            "action": "modified",
            "appointment_id": str(resolved_id),
            "new_date": new_date or old_date,
            "new_time": new_time or old_time,
        })

        await self._notify_frontend(context, "tool_call", {
            "tool": "modify_appointment",
            "status": "completed",
            "data": result,
        })

        return None, (
            f"Done! Your appointment has been updated to "
            f"{format_date(result['date'])} at {result['time']}"
            f"{(' with ' + result['doctor_name']) if result.get('doctor_name') else ''}. "
            f"Is there anything else you need?"
        )

    # ── End Conversation ──────────────────────────────────────────

    @function_tool
    async def end_conversation(self, context: RunContext) -> tuple:
        """End the conversation and generate a summary. Call this when the patient is done and there's nothing else they need."""
        user = context.userdata.user
        actions = context.userdata.appointment_actions
        conversation = context.userdata.conversation
        preferences = context.userdata.preferences

        summary_parts = []
        if user:
            summary_parts.append(f"Patient: {user.get('name', 'Unknown')}")

        for action in actions:
            if action["action"] == "booked":
                appt = action["appointment"]
                summary_parts.append(
                    f"Booked: {format_date(appt['date'])} at {appt['time']} with {appt['doctor_name']}"
                )
            elif action["action"] == "cancelled":
                summary_parts.append(f"Cancelled appointment {action['appointment_id']}")
            elif action["action"] == "modified":
                summary_parts.append(
                    f"Rescheduled appointment {action['appointment_id']} to {format_date(action['new_date'])} at {action['new_time']}"
                )

        summary = ". ".join(summary_parts) if summary_parts else "General inquiry, no appointment actions taken."

        # ── Cost breakdown ───────────────────────────────────────
        cost_report = None
        tracker = context.userdata.cost_tracker
        if tracker:
            tracker.stop()
            cost_report = tracker.report()
            logger.info("COST REPORT: $%s (%s turns, %s)", cost_report["total_usd"], cost_report["turn_count"], cost_report["duration_formatted"])

        booked = [a for a in actions if a["action"] == "booked"]
        preference_keywords = {
            "morning": "Prefers morning appointments",
            "afternoon": "Prefers afternoon appointments",
            "evening": "Prefers evening appointments",
            "dr.": None,
            "follow-up": "Needs follow-up",
            "check-up": "Routine check-up patient",
            "urgent": "Urgent care needed",
            "first time": "First-time patient",
        }
        all_text = " ".join(m.get("text", "") for m in conversation).lower()
        if not preferences:
            for keyword, pref_label in preference_keywords.items():
                if pref_label and keyword in all_text:
                    preferences.append(pref_label)

        await self._notify_frontend(context, "call_summary", {
            "summary": summary,
            "appointments": booked,
            "user": user,
            "user_preferences": preferences,
            "timestamp": datetime.now().isoformat(),
            "cost": cost_report,
        })

        if context.userdata.conversation_id:
            try:
                appointments_summary = json.dumps(booked) if booked else ""
                cost_usd_str = str(cost_report["total_usd"]) if cost_report else None
                cost_breakdown_str = json.dumps(cost_report["breakdown"]) if cost_report else None
                crud.update_conversation_summary(
                    context.userdata.conversation_id,
                    summary=summary,
                    appointments_booked=appointments_summary,
                    cost_usd=cost_usd_str,
                    cost_breakdown=cost_breakdown_str,
                )
            except Exception as e:
                logger.warning(f"Failed to persist conversation summary: {e}")

        raise StopResponse()

    # ── Helper ─────────────────────────────────────────────────────

    async def _notify_frontend(self, context: RunContext, channel: str, data: dict) -> None:
        """Send structured data to the frontend via LiveKit data channel."""
        try:
            room = get_job_context().room
            await room.local_participant.publish_data(
                payload=json.dumps({"channel": channel, **data}).encode(),
                reliable=True,
            )
        except Exception as e:
            logger.warning(f"Failed to notify frontend: {e}")