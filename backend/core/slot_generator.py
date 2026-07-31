"""Generate available appointment slots for a given date."""

from datetime import datetime, timedelta
from core.config import BUSINESS_HOUR_START, BUSINESS_HOUR_END, SLOT_DURATION_MINUTES


def generate_slots(date_str: str, doctor_name: str = "Dr. Sharma") -> list[dict]:
    """Generate all possible time slots for a given date.

    Args:
        date_str: Date in YYYY-MM-DD format.
        doctor_name: Doctor associated with the slots.

    Returns:
        List of slot dicts with id, date, time, and duration_minutes.
    """
    try:
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return []

    # No weekend slots
    if date_obj.weekday() >= 5:
        return []

    # No past dates
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    if date_obj < today:
        return []

    slots = []
    start_time = BUSINESS_HOUR_START * 60  # minutes from midnight
    end_time = BUSINESS_HOUR_END * 60
    current = start_time

    # If the date is today, skip past times
    if date_obj.date() == today.date():
        now_minutes = datetime.now().hour * 60 + datetime.now().minute + 30  # 30 min buffer
        current = max(current, now_minutes)

    while current + SLOT_DURATION_MINUTES <= end_time:
        hours = current // 60
        minutes = current % 60
        time_str = f"{hours:02d}:{minutes:02d}"
        slot_id = f"{date_str}_{time_str}"

        # Human-readable label
        if hours < 12:
            period = "AM"
            display_hour = hours if hours != 0 else 12
        else:
            period = "PM"
            display_hour = hours - 12 if hours != 12 else 12

        slots.append({
            "id": slot_id,
            "date": date_str,
            "time": time_str,
            "duration_minutes": SLOT_DURATION_MINUTES,
            "display": f"{display_hour}:{minutes:02d} {period}",
            "doctor": doctor_name,
        })

        current += SLOT_DURATION_MINUTES

    return slots


def format_slots_for_voice(slots: list[dict]) -> str:
    """Format available slots as a natural voice-friendly string."""
    if not slots:
        return "I'm sorry, there are no available slots for that date."

    # Show relative date description
    date_str = slots[0]["date"]
    try:
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        diff = (date_obj - today).days
        if diff == 0:
            date_label = "today"
        elif diff == 1:
            date_label = "tomorrow"
        elif diff < 7:
            date_label = f"this {date_obj.strftime('%A')}"
        else:
            date_label = date_obj.strftime("%A, %B %d")
    except ValueError:
        date_label = date_str

    slot_times = ", ".join(s["display"] for s in slots[:6])  # Show max 6 at a time
    result = f"Available slots for {date_label}: {slot_times}"

    if len(slots) > 6:
        result += f", and {len(slots) - 6} more."

    return result


def format_date(date_str: str) -> str:
    """Format a date string for natural voice output."""
    try:
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        diff = (date_obj - today).days
        if diff == 0:
            return "today"
        elif diff == 1:
            return "tomorrow"
        return date_obj.strftime("%A, %B %d")
    except ValueError:
        return date_str


def format_appointments_for_voice(appointments: list[dict]) -> str:
    """Format a list of appointments for natural voice output."""
    if not appointments:
        return "You have no upcoming appointments."

    lines = []
    for i, appt in enumerate(appointments, 1):
        date_display = format_date(appt["date"])
        lines.append(
            f"Appointment {i}: {date_display} at {appt['time']} with {appt['doctor_name']} for {appt['reason']}."
        )

    return " ".join(lines)