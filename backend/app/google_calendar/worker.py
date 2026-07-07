from __future__ import annotations

import logging
import signal
import socket
import time
import uuid
from dataclasses import dataclass
import json
from threading import Event

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.google_calendar import service
from app.google_calendar.client import GoogleCalendarClient, GoogleProviderError
from app.google_calendar.outbox import (
    MAX_ATTEMPTS,
    claim_next_job,
    enqueue_periodic_reconciliations,
    mark_job_done,
    mark_job_failed,
    mark_job_pending,
)
from app.models.google_calendar import GoogleSyncOutbox

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 5
PERIODIC_RECONCILE_INTERVAL_SECONDS = 15 * 60


@dataclass(frozen=True)
class JobFailure:
    retryable: bool
    message: str


def run_worker(
    *,
    worker_id: str | None = None,
    poll_interval_seconds: int = POLL_INTERVAL_SECONDS,
    stop_event: Event | None = None,
) -> None:
    worker_id = worker_id or build_worker_id()
    stop_event = stop_event or Event()
    last_periodic_enqueue = 0.0
    logger.info("Google Calendar sync worker started", extra={"worker_id": worker_id})

    while not stop_event.is_set():
        now = time.monotonic()
        if now - last_periodic_enqueue >= PERIODIC_RECONCILE_INTERVAL_SECONDS:
            with SessionLocal() as db:
                count = enqueue_periodic_reconciliations(db)
                if count:
                    logger.info("Enqueued periodic Google reconciliation jobs")
            last_periodic_enqueue = now

        processed_count = process_available_jobs(worker_id=worker_id)
        if processed_count == 0:
            stop_event.wait(poll_interval_seconds)

    logger.info("Google Calendar sync worker stopped", extra={"worker_id": worker_id})


def process_next_job(
    *,
    worker_id: str,
    client: GoogleCalendarClient | None = None,
) -> bool:
    with SessionLocal() as db:
        job = claim_next_job(db, worker_id=worker_id)
        if job is None:
            return False
        process_claimed_job(db, job, client=client or GoogleCalendarClient())
        return True


def process_available_jobs(
    *,
    worker_id: str,
    client: GoogleCalendarClient | None = None,
    max_jobs: int | None = None,
) -> int:
    active_client = client
    processed_count = 0
    with SessionLocal() as db:
        while max_jobs is None or processed_count < max_jobs:
            job = claim_next_job(db, worker_id=worker_id)
            if job is None:
                break
            if active_client is None:
                active_client = GoogleCalendarClient()
            process_claimed_job(db, job, client=active_client)
            processed_count += 1
    return processed_count


def process_claimed_job(
    db: Session,
    job: GoogleSyncOutbox,
    *,
    client: GoogleCalendarClient,
) -> None:
    try:
        complete = run_job_operation(db, job, client=client)
    except Exception as exc:
        db.rollback()
        update_connection_for_failure(db, job, exc)
        failure = classify_job_failure(exc)
        connection = service.get_connection(db, user_id=job.user_id)
        logger.warning(
            build_failure_log_message(
                job=job,
                failure=failure,
                exc=exc,
                resulting_connection_status=(
                    connection.status if connection is not None else None
                ),
            ),
            extra={
                "job_id": str(job.id),
                "operation": job.operation,
                "user_id": str(job.user_id),
                "exception_class": type(exc).__name__,
                "provider_status_code": getattr(exc, "status_code", None),
                "provider_error_code": getattr(exc, "error_code", None),
                "provider_error_reason": getattr(exc, "error_reason", None),
                "connection_status": connection.status if connection is not None else None,
                "attempts": job.attempts + 1,
                "retryable": failure.retryable,
                "reconcile_phase": getattr(exc, "phase", None),
                "reconcile_batch_size": getattr(exc, "batch_size", None),
                "reconcile_progress_state": getattr(exc, "progress_state", None),
                "timeout_source": getattr(exc, "timeout_source", None),
                "job_status_after_classification": classify_job_status_after_failure(
                    job,
                    failure=failure,
                ),
            },
        )
        mark_job_failed(
            db,
            job,
            error_message=failure.message,
            retryable=failure.retryable,
        )
        return

    if complete:
        mark_job_done(db, job)
    else:
        mark_job_pending(db, job, progress_state=job.progress_state)


def run_job_operation(
    db: Session,
    job: GoogleSyncOutbox,
    *,
    client: GoogleCalendarClient,
) -> bool:
    if job.operation in {"upsert_task", "reconcile_task"}:
        if job.task_id is None:
            return
        service.sync_task_now(
            db,
            user_id=job.user_id,
            task_id=job.task_id,
            client=client,
        )
        return True

    if job.operation == "delete_task":
        service.delete_task_mirror_now(
            db,
            user_id=job.user_id,
            task_id=job.task_id,
            client=client,
        )
        return True

    if job.operation in {"reconcile_user", "reconcile_series"}:
        result = service.sync_reconcile_batch(
            db,
            user_id=job.user_id,
            progress_state=job.progress_state,
            client=client,
        )
        job.progress_state = result.progress_state
        return result.complete

    raise RuntimeError("Unsupported Google sync operation")


def classify_job_failure(exc: Exception) -> JobFailure:
    if isinstance(exc, service.GoogleReconnectRequiredError):
        return JobFailure(retryable=False, message="Google Calendar reconnect is required")
    if isinstance(exc, service.GoogleMirrorCalendarMissingError):
        return JobFailure(retryable=False, message="Google mirror calendar is missing")
    if isinstance(exc, service.GoogleSyncError):
        return JobFailure(retryable=False, message=service.SAFE_LAST_ERROR)
    if isinstance(exc, GoogleProviderError):
        if service.provider_error_requires_reconnect(exc):
            return JobFailure(retryable=False, message="Google Calendar reconnect is required")
        if exc.status_code is None or exc.status_code == 429 or exc.status_code >= 500:
            return JobFailure(retryable=True, message="Google Calendar sync failed")
        if exc.status_code in {401, 403}:
            return JobFailure(retryable=True, message="Google Calendar sync failed")
        return JobFailure(retryable=False, message="Google Calendar sync failed")
    return JobFailure(retryable=True, message="Google Calendar sync failed")


def build_failure_log_message(
    *,
    job: GoogleSyncOutbox,
    failure: JobFailure,
    exc: Exception,
    resulting_connection_status: str | None,
) -> str:
    payload = {
        "event": "google_sync_job_failed",
        "job_id": str(job.id),
        "operation": job.operation,
        "attempts": job.attempts + 1,
        "retryable": failure.retryable,
        "exception_class": type(exc).__name__,
        "provider_status_code": safe_log_value(getattr(exc, "status_code", None)),
        "provider_error_code": safe_log_value(getattr(exc, "error_code", None)),
        "provider_error_reason": safe_log_value(getattr(exc, "error_reason", None)),
        "resulting_connection_status": resulting_connection_status,
        "reconcile_phase": safe_log_value(getattr(exc, "phase", None)),
        "reconcile_batch_size": safe_log_value(getattr(exc, "batch_size", None)),
        "reconcile_progress_state": safe_log_value(getattr(exc, "progress_state", None)),
        "timeout_source": safe_log_value(getattr(exc, "timeout_source", None)),
        "job_status": classify_job_status_after_failure(job, failure=failure),
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def classify_job_status_after_failure(
    job: GoogleSyncOutbox,
    *,
    failure: JobFailure,
) -> str:
    if not failure.retryable or job.attempts + 1 >= MAX_ATTEMPTS:
        return "dead"
    return "failed"


def safe_log_value(value: object) -> object:
    if not isinstance(value, str):
        return value
    lowered = value.lower()
    sensitive_markers = (
        "access_token",
        "access-token",
        "refresh_token",
        "refresh-token",
        "authorization",
        "bearer ",
        "client_secret",
        "client-secret",
        "encryption_key",
        "encryption-key",
    )
    if any(marker in lowered for marker in sensitive_markers):
        return "[redacted]"
    return value


def update_connection_for_failure(
    db: Session,
    job: GoogleSyncOutbox,
    exc: Exception,
) -> None:
    connection = service.get_connection(db, user_id=job.user_id)
    if connection is None:
        return
    if isinstance(exc, service.GoogleSyncError):
        service.set_connection_error_from_sync_error(db, connection, exc)
        return
    if isinstance(exc, GoogleProviderError):
        service.set_connection_error_from_provider(db, connection, exc)


def build_worker_id() -> str:
    return f"{socket.gethostname()}:{uuid.uuid4()}"


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    stop_event = Event()

    def request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    run_worker(stop_event=stop_event)


if __name__ == "__main__":
    main()
