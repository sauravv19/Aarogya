import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase, Mapped, mapped_column
from sqlalchemy import Integer, String, DateTime, Text
from core.config import DB_PATH

engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


class UserORM(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    phone: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    created_at: Mapped[str] = mapped_column(
        String, default=lambda: datetime.now().isoformat()
    )


class AppointmentORM(Base):
    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    date: Mapped[str] = mapped_column(String, nullable=False)
    time: Mapped[str] = mapped_column(String, nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    status: Mapped[str] = mapped_column(String, default="booked")
    doctor_name: Mapped[str] = mapped_column(String, default="Dr. Sharma")
    department: Mapped[str] = mapped_column(String, default="General")
    reason: Mapped[str] = mapped_column(String, default="General consultation")
    created_at: Mapped[str] = mapped_column(
        String, default=lambda: datetime.now().isoformat()
    )
    updated_at: Mapped[str] = mapped_column(
        String, default=lambda: datetime.now().isoformat()
    )


class ConversationORM(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    room_name: Mapped[str | None] = mapped_column(String, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    appointments_booked: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[str | None] = mapped_column(String, nullable=True)
    ended_at: Mapped[str | None] = mapped_column(String, nullable=True)
    cost_usd: Mapped[str | None] = mapped_column(String, nullable=True)
    cost_breakdown: Mapped[str | None] = mapped_column(Text, nullable=True)


def init_db():
    """Create all tables and seed with sample data."""
    Base.metadata.create_all(engine)

    session = SessionLocal()
    try:
        # Seed sample users if empty
        if session.query(UserORM).count() == 0:
            sample_users = [
                UserORM(name="Rahul Sharma", phone="9876543210"),
                UserORM(name="Priya Patel", phone="9876543211"),
                UserORM(name="Amit Kumar", phone="9876543212"),
                UserORM(name="Sneha Gupta", phone="9876543213"),
                UserORM(name="Vikram Singh", phone="9876543214"),
            ]
            session.add_all(sample_users)
            session.commit()
    finally:
        session.close()


from datetime import datetime  # noqa: E402