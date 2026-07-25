from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from logging import getLogger
from typing import ContextManager, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.app_settings import AppSettings
from app.models.daily_todo_notification import DailyTodoNotification
from app.models.user import User

logger = getLogger(__name__)

DailyTodoNotificationStatus = Literal[
    "pending",
    "processing",
    "sent",
    "skipped",
    "cancelled",
    "failed",
    "dead",
]

CLAIMABLE_RETRY_STATUSES = {"pending", "failed"}
PROCESSING_LEASE_TIMEOUT = timedelta(minutes=5)
MAX_ATTEMPTS = 6
MAX_RETRY_BACKOFF = timedelta(minutes=30)
INITIAL_RETRY_BACKOFF = timedelta(seconds=30)
DAILY_NOTIFICATION_CREATION_GRACE_PERIOD = timedelta(minutes=15)


@dataclass(frozen=True)
class ScannerResult:
    users_examined: int = 0
    records_created: int = 0
    duplicates_ignored: int = 0
    before_schedule: int = 0
    outside_grace_window: int = 0
    invalid_timezone: int = 0
    invalid_working_hours: int = 0

    def add(self, field: str) -> "ScannerResult":
        return ScannerResult(
            users_examined=self.users_examined + (1 if field == "users_examined" else 0),
            records_created=self.records_created + (1 if field == "records_created" else 0),
            duplicates_ignored=self.duplicates_ignored
            + (1 if field == "duplicates_ignored" else 0),
            before_schedule=self.before_schedule + (1 if field == "before_schedule" else 0),
            outside_grace_window=self.outside_grace_window
            + (1 if field == "outside_grace_window" else 0),
            invalid_timezone=self.invalid_timezone + (1 if field == "invalid_timezone" else 0),
            invalid_working_hours=self.invalid_working_hours
            + (1 if field == "invalid_working_hours" else 0),
        )


def enqueue_due_daily_todo_notifications(
    session_factory: Callable[[], ContextManager[Session]],
    *,
    now_utc: datetime | None = None,
    creation_grace_period: timedelta = DAILY_NOTIFICATION_CREATION_GRACE_PERIOD,
) -> ScannerResult:
    """Create due daily records for enabled users within the snapshot window."""
    now_utc = ensure_utc(now_utc or datetime.now(UTC))
    result = ScannerResult()

    with session_factory() as db:
        rows = db.execute(
            select(
                AppSettings.user_id,
                AppSettings.working_hours_start,
                User.timezone,
            )
            .join(User, User.id == AppSettings.user_id)
            .where(AppSettings.daily_todo_notification_enabled.is_(True))
            .order_by(AppSettings.user_id)
        ).all()

        for user_id, working_hours_start, timezone_name in rows:
            result = result.add("users_examined")
            user_timezone = get_effective_daily_notification_timezone(timezone_name)
            if user_timezone is None:
                result = result.add("invalid_timezone")
                logger.info("Skipping daily todo notification scan for invalid timezone")
                continue

            working_hours_time = parse_working_hours_start_strict(working_hours_start)
            if working_hours_time is None:
                result = result.add("invalid_working_hours")
                logger.info("Skipping daily todo notification scan for invalid working hours")
                continue

            now_local = now_utc.astimezone(user_timezone)
            local_date = now_local.date()
            scheduled_local = datetime.combine(
                local_date,
                working_hours_time,
                tzinfo=user_timezone,
            )
            scheduled_for = scheduled_local.astimezone(UTC)
            if now_utc < scheduled_for:
                result = result.add("before_schedule")
                continue
            if now_utc >= scheduled_for + creation_grace_period:
                result = result.add("outside_grace_window")
                continue

            existing = get_daily_notification_record(
                db,
                user_id=user_id,
                local_date=local_date,
            )
            if existing is not None:
                result = result.add("duplicates_ignored")
                continue

            create_daily_notification_record(
                db,
                user_id=user_id,
                local_date=local_date,
                timezone=user_timezone.key,
                scheduled_for=scheduled_for,
                available_at=scheduled_for,
            )
            result = result.add("records_created")

    return result


def normalize_timezone_name(value: str | None) -> ZoneInfo | None:
    timezone_name = value.strip() if value else ""
    if not timezone_name:
        return None

    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return None


def get_effective_daily_notification_timezone(value: str | None) -> ZoneInfo | None:
    timezone_name = value.strip() if value else ""
    if timezone_name:
        return normalize_timezone_name(timezone_name)
    return normalize_timezone_name(settings.app_timezone)


def parse_working_hours_start_strict(value: str | None) -> time | None:
    if value is None:
        return None

    try:
        hour_text, minute_text = value.split(":", 1)
        hour = int(hour_text)
        minute = int(minute_text)
    except ValueError:
        return None

    if len(hour_text) != 2 or len(minute_text) != 2:
        return None
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None

    return time(hour=hour, minute=minute)


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def create_daily_notification_record(
    db: Session,
    *,
    user_id: uuid.UUID,
    local_date: date,
    timezone: str,
    scheduled_for: datetime,
    available_at: datetime,
) -> DailyTodoNotification:
    """Create the user/day record, returning the existing row on duplicates.

    This helper commits its short transaction. It first checks for an existing
    row, then relies on the unique constraint as the final concurrency guard.
    """
    existing = get_daily_notification_record(
        db,
        user_id=user_id,
        local_date=local_date,
    )
    if existing is not None:
        return existing

    now = datetime.now(UTC)
    record = DailyTodoNotification(
        user_id=user_id,
        local_date=local_date,
        timezone=timezone,
        scheduled_for=scheduled_for,
        status="pending",
        attempts=0,
        available_at=available_at,
        created_at=now,
        updated_at=now,
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = get_daily_notification_record(
            db,
            user_id=user_id,
            local_date=local_date,
        )
        if existing is None:
            raise
        return existing

    db.refresh(record)
    return record


def get_daily_notification_record(
    db: Session,
    *,
    user_id: uuid.UUID,
    local_date: date,
) -> DailyTodoNotification | None:
    return db.scalar(
        select(DailyTodoNotification).where(
            DailyTodoNotification.user_id == user_id,
            DailyTodoNotification.local_date == local_date,
        )
    )


def claim_next_daily_notification(
    db: Session,
    *,
    worker_id: str,
    now: datetime | None = None,
    lease_timeout: timedelta = PROCESSING_LEASE_TIMEOUT,
) -> DailyTodoNotification | None:
    """Claim one available record and commit before returning.

    Attempts increment at claim time, so each processing lease counts as one
    delivery attempt. Future delivery code must do external I/O only after this
    transaction has committed.
    """
    now = now or datetime.now(UTC)
    stale_processing_before = now - lease_timeout
    statement = (
        select(DailyTodoNotification)
        .where(
            or_(
                (
                    DailyTodoNotification.status.in_(CLAIMABLE_RETRY_STATUSES)
                    & (DailyTodoNotification.available_at <= now)
                ),
                (
                    (DailyTodoNotification.status == "processing")
                    & (DailyTodoNotification.locked_at.is_not(None))
                    & (DailyTodoNotification.locked_at <= stale_processing_before)
                ),
            ),
        )
        .order_by(DailyTodoNotification.available_at, DailyTodoNotification.created_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    record = db.scalar(statement)
    if record is None:
        return None

    record.status = "processing"
    record.locked_at = now
    record.locked_by = worker_id
    record.attempts += 1
    record.updated_at = now
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def mark_daily_notification_sent(
    db: Session,
    *,
    record_id: uuid.UUID,
    worker_id: str,
    sent_at: datetime | None = None,
) -> DailyTodoNotification | None:
    sent_at = sent_at or datetime.now(UTC)
    return finalize_daily_notification(
        db,
        record_id=record_id,
        worker_id=worker_id,
        status="sent",
        timestamp_field="sent_at",
        timestamp_value=sent_at,
        last_error=None,
        status_reason=None,
    )


def mark_daily_notification_skipped(
    db: Session,
    *,
    record_id: uuid.UUID,
    worker_id: str,
    reason: str | None,
    skipped_at: datetime | None = None,
) -> DailyTodoNotification | None:
    skipped_at = skipped_at or datetime.now(UTC)
    return finalize_daily_notification(
        db,
        record_id=record_id,
        worker_id=worker_id,
        status="skipped",
        timestamp_field="skipped_at",
        timestamp_value=skipped_at,
        last_error=None,
        status_reason=reason,
    )


def mark_daily_notification_cancelled(
    db: Session,
    *,
    record_id: uuid.UUID,
    worker_id: str,
    reason: str | None,
    cancelled_at: datetime | None = None,
) -> DailyTodoNotification | None:
    cancelled_at = cancelled_at or datetime.now(UTC)
    return finalize_daily_notification(
        db,
        record_id=record_id,
        worker_id=worker_id,
        status="cancelled",
        timestamp_field="cancelled_at",
        timestamp_value=cancelled_at,
        last_error=None,
        status_reason=reason,
    )


def mark_daily_notification_failed(
    db: Session,
    *,
    record_id: uuid.UUID,
    worker_id: str,
    error_message: str,
    now: datetime | None = None,
) -> DailyTodoNotification | None:
    now = now or datetime.now(UTC)
    record = get_claimed_record_for_update(db, record_id=record_id, worker_id=worker_id)
    if record is None:
        return None

    record.last_error = error_message
    record.status_reason = None
    record.locked_at = None
    record.locked_by = None
    record.updated_at = now
    if record.attempts >= MAX_ATTEMPTS:
        record.status = "dead"
        record.status_reason = "Maximum retry attempts exhausted"
    else:
        record.status = "failed"
        record.available_at = now + get_retry_backoff(record.attempts)

    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def mark_daily_notification_dead(
    db: Session,
    *,
    record_id: uuid.UUID,
    worker_id: str,
    error_message: str,
    reason: str | None = None,
    now: datetime | None = None,
) -> DailyTodoNotification | None:
    now = now or datetime.now(UTC)
    return finalize_daily_notification(
        db,
        record_id=record_id,
        worker_id=worker_id,
        status="dead",
        timestamp_field=None,
        timestamp_value=None,
        last_error=error_message,
        status_reason=reason,
        updated_at=now,
    )


def finalize_daily_notification(
    db: Session,
    *,
    record_id: uuid.UUID,
    worker_id: str,
    status: DailyTodoNotificationStatus,
    timestamp_field: str | None,
    timestamp_value: datetime | None,
    last_error: str | None,
    status_reason: str | None,
    updated_at: datetime | None = None,
) -> DailyTodoNotification | None:
    record = get_claimed_record_for_update(db, record_id=record_id, worker_id=worker_id)
    if record is None:
        return None

    now = updated_at or timestamp_value or datetime.now(UTC)
    record.status = status
    record.locked_at = None
    record.locked_by = None
    record.last_error = last_error
    record.status_reason = status_reason
    if timestamp_field is not None and timestamp_value is not None:
        setattr(record, timestamp_field, timestamp_value)
    record.updated_at = now
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_claimed_record_for_update(
    db: Session,
    *,
    record_id: uuid.UUID,
    worker_id: str,
) -> DailyTodoNotification | None:
    return db.scalar(
        select(DailyTodoNotification)
        .where(
            DailyTodoNotification.id == record_id,
            DailyTodoNotification.status == "processing",
            DailyTodoNotification.locked_by == worker_id,
        )
        .with_for_update()
    )


def get_retry_backoff(attempts: int) -> timedelta:
    multiplier = 2 ** max(0, attempts - 1)
    return min(INITIAL_RETRY_BACKOFF * multiplier, MAX_RETRY_BACKOFF)
