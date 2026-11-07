from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models.registration import RegistrationSettings
from app.models.user import User


class RegistrationStatus(BaseModel):
    setup_required: bool
    registration_open: bool
    open_until: datetime | None


class RegistrationUpdate(BaseModel):
    duration_minutes: Literal[0, 5]


def lock_registration(db: Session) -> None:
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(746332101)"))


def get_registration_status(db: Session) -> RegistrationStatus:
    setup = db.scalar(select(func.count()).select_from(User)) == 0
    config = db.get(RegistrationSettings, 1)
    expiry = config.open_until if config else None
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=UTC)
    return RegistrationStatus(
        setup_required=setup,
        registration_open=setup or (expiry is not None and expiry > datetime.now(UTC)),
        open_until=expiry,
    )


def update_registration(db: Session, data: RegistrationUpdate) -> RegistrationStatus:
    lock_registration(db)
    config = db.get(RegistrationSettings, 1)
    if config is None:
        config = RegistrationSettings(id=1)
    config.open_until = (
        datetime.now(UTC) + timedelta(minutes=data.duration_minutes)
        if data.duration_minutes else None
    )
    db.add(config)
    db.commit()
    return get_registration_status(db)
