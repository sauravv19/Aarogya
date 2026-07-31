from datetime import datetime
from sqlalchemy.orm import Session
from db.database import SessionLocal, UserORM, AppointmentORM, ConversationORM


def get_session() -> Session:
    return SessionLocal()


# ── User operations ──────────────────────────────────────────────


def get_user_by_phone(phone: str) -> dict | None:
    with get_session() as session:
        user = session.query(UserORM).filter(UserORM.phone == phone).first()
        if not user:
            return None
        return {"id": user.id, "name": user.name, "phone": user.phone}


def create_user(name: str, phone: str) -> dict:
    with get_session() as session:
        user = UserORM(name=name, phone=phone)
        session.add(user)
        session.commit()
        session.refresh(user)
        return {"id": user.id, "name": user.name, "phone": user.phone}


def get_or_create_user(name: str, phone: str) -> dict:
    existing = get_user_by_phone(phone)
    if existing:
        return existing
    return create_user(name, phone)


# ── Appointment operations ──────────────────────────────────────


def get_booked_slots(date: str) -> list[str]:
    """Return list of booked time slots for a given date."""
    with get_session() as session:
        appts = (
            session.query(AppointmentORM)
            .filter(
                AppointmentORM.date == date,
                AppointmentORM.status == "booked",
            )
            .all()
        )
        return [a.time for a in appts]


def is_slot_booked(date: str, time: str) -> bool:
    """Check if a specific slot is already booked."""
    with get_session() as session:
        return (
            session.query(AppointmentORM)
            .filter(
                AppointmentORM.date == date,
                AppointmentORM.time == time,
                AppointmentORM.status == "booked",
            )
            .first()
            is not None
        )


def create_appointment(
    user_id: int,
    date: str,
    time: str,
    reason: str = "General consultation",
    doctor_name: str = "Dr. Sharma",
    department: str = "General",
) -> dict:
    with get_session() as session:
        appt = AppointmentORM(
            user_id=user_id,
            date=date,
            time=time,
            reason=reason,
            doctor_name=doctor_name,
            department=department,
        )
        session.add(appt)
        session.commit()
        session.refresh(appt)
        return {
            "id": appt.id,
            "user_id": appt.user_id,
            "date": appt.date,
            "time": appt.time,
            "duration_minutes": appt.duration_minutes,
            "status": appt.status,
            "doctor_name": appt.doctor_name,
            "department": appt.department,
            "reason": appt.reason,
        }


def get_user_appointments(user_id: int, status: str | None = None) -> list[dict]:
    """Get all appointments for a user, optionally filtered by status."""
    with get_session() as session:
        query = session.query(AppointmentORM).filter(AppointmentORM.user_id == user_id)
        if status:
            query = query.filter(AppointmentORM.status == status)
        else:
            query = query.filter(AppointmentORM.status != "cancelled")
        appts = query.order_by(AppointmentORM.date, AppointmentORM.time).all()
        return [
            {
                "id": a.id,
                "date": a.date,
                "time": a.time,
                "status": a.status,
                "doctor_name": a.doctor_name,
                "department": a.department,
                "reason": a.reason,
            }
            for a in appts
        ]


def cancel_appointment(appointment_id: int) -> dict | None:
    with get_session() as session:
        appt = session.query(AppointmentORM).filter(AppointmentORM.id == appointment_id).first()
        if not appt:
            return None
        appt.status = "cancelled"
        appt.updated_at = datetime.now().isoformat()
        session.commit()
        return {
            "id": appt.id,
            "date": appt.date,
            "time": appt.time,
            "status": appt.status,
        }


def modify_appointment(
    appointment_id: int,
    new_date: str,
    new_time: str,
    new_reason: str | None = None,
    new_doctor: str | None = None,
) -> dict | None:
    with get_session() as session:
        appt = session.query(AppointmentORM).filter(AppointmentORM.id == appointment_id).first()
        if not appt:
            return None
        appt.date = new_date
        appt.time = new_time
        if new_reason:
            appt.reason = new_reason
        if new_doctor:
            appt.doctor_name = new_doctor
        appt.updated_at = datetime.now().isoformat()
        session.commit()
        return {
            "id": appt.id,
            "date": appt.date,
            "time": appt.time,
            "status": appt.status,
            "doctor_name": appt.doctor_name,
            "reason": appt.reason,
        }


def get_appointment_by_id(appointment_id: int) -> dict | None:
    with get_session() as session:
        appt = session.query(AppointmentORM).filter(AppointmentORM.id == appointment_id).first()
        if not appt:
            return None
        return {
            "id": appt.id,
            "user_id": appt.user_id,
            "date": appt.date,
            "time": appt.time,
            "status": appt.status,
            "doctor_name": appt.doctor_name,
        }


# ── Conversation operations ──────────────────────────────────────


def create_conversation(user_id: int | None, room_name: str) -> dict:
    with get_session() as session:
        conv = ConversationORM(
            user_id=user_id,
            room_name=room_name,
            started_at=datetime.now().isoformat(),
        )
        session.add(conv)
        session.commit()
        session.refresh(conv)
        return {"id": conv.id, "room_name": conv.room_name}


def update_conversation_summary(
    conv_id: int,
    summary: str,
    appointments_booked: str,
    cost_usd: str | None = None,
    cost_breakdown: str | None = None,
) -> None:
    with get_session() as session:
        conv = session.query(ConversationORM).filter(ConversationORM.id == conv_id).first()
        if conv:
            conv.summary = summary
            conv.appointments_booked = appointments_booked
            conv.ended_at = datetime.now().isoformat()
            if cost_usd is not None:
                conv.cost_usd = cost_usd
            if cost_breakdown is not None:
                conv.cost_breakdown = cost_breakdown
            session.commit()


def update_conversation_user(conv_id: int, user_id: int) -> None:
    with get_session() as session:
        conv = session.query(ConversationORM).filter(ConversationORM.id == conv_id).first()
        if conv:
            conv.user_id = user_id
            session.commit()