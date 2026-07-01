from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.google_calendar import GoogleCalendarConnection, GoogleSyncOutbox

GoogleSyncOperation = Literal[
    "upsert_task",
    "delete_task",
    "reconcile_user",
    "reconcile_task",
    "reconcile_series",
]

RETRYABLE_STATUSES = {"pending", "failed"}
PROCESSING_LEASE_TIMEOUT = timedelta(minutes=5)
MAX_ATTEMPTS = 6
OPERATION_PRIORITIES: dict[GoogleSyncOperation, int] = {
    "delete_task": 100,
    "upsert_task": 90,
    "reconcile_task": 90,
    "reconcile_series": 50,
    "reconcile_user": 40,
}


def enqueue_sync_job(
    db: Session,
    *,
    user_id: uuid.UUID,
    operation: GoogleSyncOperation,
    task_id: uuid.UUID | None = None,
    idempotency_key: str | None = None,
    available_at: datetime | None = None,
    priority: int | None = None,
) -> GoogleSyncOutbox | None:
    if not has_google_connection(db, user_id=user_id):
        return None

    if idempotency_key is None:
        idempotency_key = build_idempotency_key(
            operation=operation,
            user_id=user_id,
            task_id=task_id,
        )

    if idempotency_key:
        existing = db.scalar(
            select(GoogleSyncOutbox).where(
                GoogleSyncOutbox.idempotency_key == idempotency_key,
                GoogleSyncOutbox.status.in_(["pending", "failed", "processing"]),
            )
        )
        if existing is not None:
            existing.available_at = min_datetime(
                existing.available_at,
                available_at or datetime.now(UTC),
            )
            existing.updated_at = datetime.now(UTC)
            existing.priority = priority or OPERATION_PRIORITIES[operation]
            db.add(existing)
            return existing

    job = GoogleSyncOutbox(
        user_id=user_id,
        task_id=task_id,
        operation=operation,
        priority=priority or OPERATION_PRIORITIES[operation],
        status="pending",
        attempts=0,
        available_at=available_at or datetime.now(UTC),
        idempotency_key=idempotency_key,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(job)
    return job


def enqueue_task_upsert(db: Session, *, user_id: uuid.UUID, task_id: uuid.UUID) -> None:
    enqueue_sync_job(
        db,
        user_id=user_id,
        task_id=task_id,
        operation="upsert_task",
    )


def enqueue_task_delete(db: Session, *, user_id: uuid.UUID, task_id: uuid.UUID | None) -> None:
    enqueue_sync_job(
        db,
        user_id=user_id,
        task_id=task_id,
        operation="delete_task",
        idempotency_key=f"delete_task:{user_id}:{task_id or 'orphans'}",
    )


def enqueue_user_reconciliation(
    db: Session,
    *,
    user_id: uuid.UUID,
    idempotency_key: str | None = None,
) -> None:
    enqueue_sync_job(
        db,
        user_id=user_id,
        operation="reconcile_user",
        idempotency_key=idempotency_key or f"reconcile_user:{user_id}",
    )


def count_pending_jobs(db: Session, *, user_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(GoogleSyncOutbox)
            .where(
                GoogleSyncOutbox.user_id == user_id,
                GoogleSyncOutbox.status.in_(["pending", "failed", "processing"]),
            )
        )
        or 0
    )


def claim_next_job(db: Session, *, worker_id: str) -> GoogleSyncOutbox | None:
    now = datetime.now(UTC)
    stale_processing_before = now - PROCESSING_LEASE_TIMEOUT
    statement = (
        select(GoogleSyncOutbox)
        .where(
            or_(
                (
                    GoogleSyncOutbox.status.in_(RETRYABLE_STATUSES)
                    & (GoogleSyncOutbox.available_at <= now)
                ),
                (
                    (GoogleSyncOutbox.status == "processing")
                    & (GoogleSyncOutbox.locked_at.is_not(None))
                    & (GoogleSyncOutbox.locked_at <= stale_processing_before)
                ),
            ),
        )
        .order_by(GoogleSyncOutbox.available_at, GoogleSyncOutbox.created_at)
        .order_by(None)
        .order_by(
            GoogleSyncOutbox.priority.desc(),
            GoogleSyncOutbox.available_at,
            GoogleSyncOutbox.created_at,
        )
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    job = db.scalar(statement)
    if job is None:
        return None

    job.status = "processing"
    job.locked_at = now
    job.locked_by = worker_id
    job.updated_at = now
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def mark_job_done(db: Session, job: GoogleSyncOutbox) -> None:
    now = datetime.now(UTC)
    job.status = "done"
    job.locked_at = None
    job.locked_by = None
    job.last_error = None
    job.progress_state = None
    job.processed_at = now
    job.updated_at = now
    db.add(job)
    db.commit()


def mark_job_pending(
    db: Session,
    job: GoogleSyncOutbox,
    *,
    progress_state: str | None,
) -> None:
    now = datetime.now(UTC)
    job.status = "pending"
    job.locked_at = None
    job.locked_by = None
    job.progress_state = progress_state
    job.available_at = now
    job.updated_at = now
    db.add(job)
    db.commit()


def mark_job_failed(
    db: Session,
    job: GoogleSyncOutbox,
    *,
    error_message: str,
    retryable: bool,
) -> None:
    now = datetime.now(UTC)
    job.attempts += 1
    job.last_error = error_message
    job.locked_at = None
    job.locked_by = None
    job.updated_at = now

    if not retryable or job.attempts >= MAX_ATTEMPTS:
        job.status = "dead"
        job.processed_at = now
    else:
        job.status = "failed"
        job.available_at = now + get_retry_backoff(job.attempts)

    db.add(job)
    db.commit()


def enqueue_periodic_reconciliations(db: Session) -> int:
    users = db.scalars(
        select(GoogleCalendarConnection.user_id).where(
            GoogleCalendarConnection.status == "connected",
            GoogleCalendarConnection.encrypted_refresh_token.is_not(None),
        )
    ).all()
    period = datetime.now(UTC).strftime("%Y%m%d%H%M")
    count = 0
    for user_id in users:
        enqueue_user_reconciliation(
            db,
            user_id=user_id,
            idempotency_key=f"reconcile_user:{user_id}:{period}",
        )
        count += 1
    db.commit()
    return count


def build_idempotency_key(
    *,
    operation: GoogleSyncOperation,
    user_id: uuid.UUID,
    task_id: uuid.UUID | None,
) -> str:
    if task_id is not None:
        return f"{operation}:{user_id}:{task_id}"
    return f"{operation}:{user_id}"


def get_retry_backoff(attempts: int) -> timedelta:
    seconds = min(60 * 30, 2 ** max(0, attempts - 1) * 30)
    return timedelta(seconds=seconds)


def has_google_connection(db: Session, *, user_id: uuid.UUID) -> bool:
    return (
        db.scalar(
            select(GoogleCalendarConnection.id).where(
                GoogleCalendarConnection.user_id == user_id,
                or_(
                    GoogleCalendarConnection.status == "connected",
                    GoogleCalendarConnection.status == "error",
                    GoogleCalendarConnection.status == "needs_reauth",
                ),
            )
        )
        is not None
    )


def min_datetime(left: datetime, right: datetime) -> datetime:
    return left if as_utc(left) <= as_utc(right) else right


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
