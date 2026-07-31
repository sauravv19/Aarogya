export const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "";
export const AGENT_NAME = "healthcare-agent";

export const TOOL_LABELS: Record<string, { label: string; icon: string }> = {
  identify_user: { label: "Identifying user", icon: "UserSearch" },
  create_user: { label: "Creating account", icon: "UserPlus" },
  fetch_slots: { label: "Fetching slots", icon: "Calendar" },
  book_appointment: { label: "Booking appointment", icon: "CalendarCheck" },
  retrieve_appointments: { label: "Loading appointments", icon: "List" },
  cancel_appointment: { label: "Cancelling appointment", icon: "CalendarX" },
  modify_appointment: { label: "Rescheduling", icon: "CalendarClock" },
  end_conversation: { label: "Generating summary", icon: "FileText" },
};