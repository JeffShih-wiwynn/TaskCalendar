from __future__ import annotations

import secrets
import uuid
import hashlib
import json
import logging
from datetime import UTC, datetime, timedelta
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.timezone import ensure_aware_datetime, get_app_timezone_name, now_in_app_timezone, to_app_timezone
from app.google_calendar.client import (
    MIRROR_CALENDAR_SUMMARY,
    GoogleBatchEventRequest,
    GoogleBatchEventResponse,
    GoogleCalendarClient,
    GoogleCalendarResource,
    GoogleEventResource,
    GoogleProviderError,
    build_event_path,
    build_events_path,
)
from app.google_calendar.crypto import decrypt_refresh_token, encrypt_refresh_token
from app.google_calendar.outbox import (
    count_pending_jobs,
    enqueue_task_delete,
    enqueue_task_upsert,
    enqueue_user_reconciliation,
)
from app.models.google_calendar import (
    GoogleCalendarConnection,
    GoogleEventMirror,
    GoogleOAuthState,
)
from app.models.scheduled_task import ScheduledTask

OAUTH_STATE_TTL_MINUTES = 10
SAFE_LAST_ERROR = "Google Calendar connection needs attention."
RECONNECT_REQUIRED_GOOGLE_ERROR_CODES = {"invalid_grant"}
SYNCABLE_CONNECTION_STATUSES = {"connected", "error"}
SOURCE_NOTICE = (
    "Source: TaskCalendar\n"
    "This event is mirrored automatically.\n"
    "Changes made here may be overwritten by TaskCalendar."
)
logger = logging.getLogger(__name__)
BATCH_SIZE = 50


@dataclass(frozen=True)
class ReconcileBatchResult:
    complete: bool
    progress_state: str | None = None


@dataclass(frozen=True)
class BatchOperation:
    content_id: str
    operation: str
    task: ScheduledTask | None = None
    mirror: GoogleEventMirror | None = None
    payload: dict | None = None
    payload_hash: str | None = None
    event_id: str | None = None


class GoogleSyncError(Exception):
    def __init__(self, detail: str, *, connection_status: str = "error") -> None:
        super().__init__(detail)
        self.detail = detail
        self.connection_status = connection_status


class GoogleReconnectRequiredError(GoogleSyncError):
    def __init__(self) -> None:
        super().__init__(
            "Google Calendar reconnect is required",
            connection_status="needs_reauth",
        )


class GoogleMirrorCalendarMissingError(GoogleSyncError):
    def __init__(self) -> None:
        super().__init__(
            "Google mirror calendar is missing. Reconnect Google Calendar to rebuild it.",
            connection_status="error",
        )


def get_status(db: Session, *, user_id: uuid.UUID) -> dict:
    connection = get_connection(db, user_id=user_id)
    if connection is None:
        return {
            "connected": False,
            "status": "disabled",
            "mirror_calendar_summary": None,
            "last_successful_sync_at": None,
            "last_error_when_safe_to_show": None,
            "pending_sync_items": 0,
        }

    connected = connection.status == "connected" and bool(connection.encrypted_refresh_token)
    return {
        "connected": connected,
        "status": connection.status,
        "mirror_calendar_summary": connection.google_calendar_summary,
        "last_successful_sync_at": connection.last_successful_sync_at,
        "last_error_when_safe_to_show": SAFE_LAST_ERROR if connection.last_error else None,
        "pending_sync_items": count_pending_jobs(db, user_id=user_id),
    }


def create_connect_url(
    db: Session,
    *,
    user_id: uuid.UUID,
    client: GoogleCalendarClient | None = None,
) -> str:
    client = client or GoogleCalendarClient()
    oauth_state = GoogleOAuthState(
        state=secrets.token_urlsafe(48),
        user_id=user_id,
        expires_at=datetime.now(UTC) + timedelta(minutes=OAUTH_STATE_TTL_MINUTES),
    )
    db.add(oauth_state)
    db.commit()
    return client.build_authorization_url(state=oauth_state.state)


def handle_oauth_callback(
    db: Session,
    *,
    state_value: str | None,
    code: str | None,
    error_value: str | None = None,
    client: GoogleCalendarClient | None = None,
) -> bool:
    if not state_value:
        return False

    user_id = consume_oauth_state(db, state_value)
    if user_id is None:
        return False

    if error_value or not code:
        return False

    client = client or GoogleCalendarClient()
    try:
        token_response = client.exchange_code(code)
        refresh_token = token_response.refresh_token
        existing_connection = get_connection(db, user_id=user_id)
        if not refresh_token and (
            existing_connection is None or not existing_connection.encrypted_refresh_token
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google did not provide offline access",
            )

        mirror_calendar = get_or_create_mirror_calendar(
            client=client,
            access_token=token_response.access_token,
            existing_connection=existing_connection,
        )
        upsert_connection(
            db,
            user_id=user_id,
            refresh_token=refresh_token,
            mirror_calendar=mirror_calendar,
        )
        try:
            enqueue_user_reconciliation(db, user_id=user_id)
            db.commit()
        except Exception:
            db.rollback()
            logger.warning(
                "Google Calendar connected but initial reconciliation could not be queued",
                extra={"user_id": str(user_id)},
            )
        return True
    except Exception:
        mark_connection_error(db, user_id=user_id)
        return False


def consume_oauth_state(db: Session, state_value: str) -> uuid.UUID | None:
    now = datetime.now(UTC)
    result = db.execute(
        update(GoogleOAuthState)
        .where(
            GoogleOAuthState.state == state_value,
            GoogleOAuthState.used_at.is_(None),
            GoogleOAuthState.expires_at > now,
        )
        .values(used_at=now)
        .returning(GoogleOAuthState.user_id)
        .execution_options(synchronize_session=False)
    )
    user_id = result.scalar_one_or_none()
    db.commit()
    return user_id


def get_or_create_mirror_calendar(
    *,
    client: GoogleCalendarClient,
    access_token: str,
    existing_connection: GoogleCalendarConnection | None,
) -> GoogleCalendarResource:
    if existing_connection and existing_connection.google_calendar_id:
        if existing_connection.google_calendar_id == "primary":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google primary calendar cannot be used as the mirror calendar",
            )
        calendar = client.get_calendar(
            access_token=access_token,
            calendar_id=existing_connection.google_calendar_id,
        )
        if calendar is not None:
            if calendar.id == "primary":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Google primary calendar cannot be used as the mirror calendar",
                )
            return calendar

    calendar = client.create_mirror_calendar(access_token=access_token)
    if calendar.id == "primary":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google primary calendar cannot be used as the mirror calendar",
        )
    return calendar


def disconnect(db: Session, *, user_id: uuid.UUID) -> str:
    connection = get_connection(db, user_id=user_id)
    if connection is None:
        return "Google Calendar disconnected"

    connection.encrypted_refresh_token = None
    connection.status = "disabled"
    connection.revoked_at = datetime.now(UTC)
    connection.last_error = None
    connection.updated_at = datetime.now(UTC)
    db.add(connection)
    db.commit()
    return "Google Calendar disconnected"


def sync_now(
    db: Session,
    *,
    user_id: uuid.UUID,
    client: GoogleCalendarClient | None = None,
) -> dict:
    client = client or GoogleCalendarClient()
    connection = get_connection(db, user_id=user_id)
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google Calendar is not connected",
        )
    if connection.status == "needs_reauth":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google Calendar reconnect is required",
        )
    if connection.status not in SYNCABLE_CONNECTION_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google Calendar is not connected",
        )
    if not connection.encrypted_refresh_token or not connection.google_calendar_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google Calendar is not connected",
        )

    try:
        access_token = refresh_google_access_token(client=client, connection=connection)
        if client.get_calendar(
            access_token=access_token,
            calendar_id=connection.google_calendar_id,
        ) is None:
            raise GoogleMirrorCalendarMissingError()
        result = reconcile_user_mirror(
            db,
            user_id=user_id,
            connection=connection,
            access_token=access_token,
            client=client,
        )
    except GoogleSyncError as exc:
        db.rollback()
        set_connection_error_from_sync_error(db, connection, exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=exc.detail,
        ) from exc
    except GoogleProviderError as exc:
        db.rollback()
        set_connection_error_from_provider(db, connection, exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google Calendar sync failed. Try again later.",
        ) from exc

    now = datetime.now(UTC)
    connection.status = "connected"
    connection.last_successful_sync_at = now
    connection.last_error = None
    connection.updated_at = now
    db.add(connection)
    db.commit()
    result["last_successful_sync_at"] = now
    return result


def sync_reconcile_batch(
    db: Session,
    *,
    user_id: uuid.UUID,
    progress_state: str | None,
    client: GoogleCalendarClient | None = None,
    batch_size: int = BATCH_SIZE,
) -> ReconcileBatchResult:
    client = client or GoogleCalendarClient()
    connection, access_token = get_ready_connection(
        db,
        user_id=user_id,
        client=client,
    )
    calendar_id = connection.google_calendar_id
    if calendar_id is None:
        raise GoogleMirrorCalendarMissingError()

    state = decode_reconcile_progress(progress_state)
    result = process_reconcile_delete_batch(
        db,
        user_id=user_id,
        calendar_id=calendar_id,
        access_token=access_token,
        client=client,
        state=state,
        batch_size=batch_size,
    )
    if result is not None:
        next_state = decode_reconcile_progress(result.progress_state)
        if result.complete:
            update_connection_sync_success(db, connection)
            return result
        if next_state.get("phase") != "upsert":
            return result
        state = next_state

    result = process_reconcile_upsert_batch(
        db,
        user_id=user_id,
        calendar_id=calendar_id,
        access_token=access_token,
        client=client,
        state=state,
        batch_size=batch_size,
    )
    if result.complete:
        update_connection_sync_success(db, connection)
    return result


def start_sync_now(db: Session, *, user_id: uuid.UUID) -> dict:
    connection = get_connection(db, user_id=user_id)
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google Calendar is not connected",
        )
    if connection.status == "needs_reauth":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google Calendar reconnect is required",
        )
    if connection.status not in SYNCABLE_CONNECTION_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google Calendar is not connected",
        )
    if not connection.encrypted_refresh_token or not connection.google_calendar_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google Calendar is not connected",
        )

    enqueue_user_reconciliation(db, user_id=user_id)
    db.commit()
    return {
        "started": True,
        "pending_sync_items": count_pending_jobs(db, user_id=user_id),
        "message": "Google Calendar sync started.",
    }


def sync_task_now(
    db: Session,
    *,
    user_id: uuid.UUID,
    task_id: uuid.UUID,
    client: GoogleCalendarClient | None = None,
) -> dict:
    client = client or GoogleCalendarClient()
    connection, access_token = get_ready_connection(
        db,
        user_id=user_id,
        client=client,
    )
    result = sync_one_task(
        db,
        user_id=user_id,
        task_id=task_id,
        connection=connection,
        access_token=access_token,
        client=client,
    )
    update_connection_sync_success(db, connection)
    return result


def delete_task_mirror_now(
    db: Session,
    *,
    user_id: uuid.UUID,
    task_id: uuid.UUID | None,
    client: GoogleCalendarClient | None = None,
) -> dict:
    client = client or GoogleCalendarClient()
    connection, access_token = get_ready_connection(
        db,
        user_id=user_id,
        client=client,
    )
    deleted_count = delete_task_mirrors(
        db,
        user_id=user_id,
        task_id=task_id,
        access_token=access_token,
        client=client,
    )
    db.commit()
    update_connection_sync_success(db, connection)
    return {
        "created_count": 0,
        "updated_count": 0,
        "deleted_count": deleted_count,
        "skipped_count": 0,
    }


def get_ready_connection(
    db: Session,
    *,
    user_id: uuid.UUID,
    client: GoogleCalendarClient,
) -> tuple[GoogleCalendarConnection, str]:
    connection = get_connection(db, user_id=user_id)
    if connection is None:
        raise GoogleSyncError("Google Calendar is not connected")
    if connection.status == "needs_reauth":
        raise GoogleReconnectRequiredError()
    if connection.status not in SYNCABLE_CONNECTION_STATUSES:
        raise GoogleSyncError("Google Calendar is not connected")
    if not connection.encrypted_refresh_token or not connection.google_calendar_id:
        raise GoogleSyncError("Google Calendar is not connected")

    access_token = refresh_google_access_token(client=client, connection=connection)
    if client.get_calendar(
        access_token=access_token,
        calendar_id=connection.google_calendar_id,
    ) is None:
        raise GoogleMirrorCalendarMissingError()
    return connection, access_token


def refresh_google_access_token(
    *,
    client: GoogleCalendarClient,
    connection: GoogleCalendarConnection,
) -> str:
    if not connection.encrypted_refresh_token:
        raise GoogleReconnectRequiredError()
    try:
        token_response = client.refresh_access_token(
            decrypt_refresh_token(connection.encrypted_refresh_token),
        )
    except GoogleProviderError as exc:
        if provider_error_requires_reconnect(exc):
            raise GoogleReconnectRequiredError() from exc
        raise
    return token_response.access_token


def reconcile_user_mirror(
    db: Session,
    *,
    user_id: uuid.UUID,
    connection: GoogleCalendarConnection,
    access_token: str,
    client: GoogleCalendarClient,
) -> dict:
    created_count = 0
    updated_count = 0
    deleted_count = 0
    skipped_count = 0
    now = datetime.now(UTC)
    calendar_id = connection.google_calendar_id
    if calendar_id is None:
        raise GoogleMirrorCalendarMissingError()

    eligible_tasks = list_eligible_tasks(db, user_id=user_id)
    eligible_by_id = {task.id: task for task in eligible_tasks}
    mirrors = list_google_event_mirrors(db, user_id=user_id)
    mirrors_by_task_id = {
        mirror.task_id: mirror for mirror in mirrors if mirror.task_id is not None
    }

    for mirror in mirrors:
        task = eligible_by_id.get(mirror.task_id) if mirror.task_id is not None else None
        if task is not None:
            continue
        delete_mirror_event(
            db,
            mirror=mirror,
            access_token=access_token,
            client=client,
        )
        db.commit()
        deleted_count += 1

    for task in eligible_tasks:
        payload = build_event_payload(task)
        payload_hash = hash_event_payload(payload)
        mirror = mirrors_by_task_id.get(task.id)
        if mirror is None:
            event, created = upsert_deterministic_task_event(
                client=client,
                access_token=access_token,
                calendar_id=calendar_id,
                task=task,
                payload=payload,
            )
            add_event_mirror(
                db,
                user_id=user_id,
                task=task,
                calendar_id=calendar_id,
                event=event,
                payload_hash=payload_hash,
                synced_at=now,
            )
            db.commit()
            if created:
                created_count += 1
            else:
                updated_count += 1
            continue

        if mirror.google_calendar_id != calendar_id:
            event, created = upsert_deterministic_task_event(
                client=client,
                access_token=access_token,
                calendar_id=calendar_id,
                task=task,
                payload=payload,
            )
            update_event_mirror(
                db,
                mirror=mirror,
                task=task,
                calendar_id=calendar_id,
                event=event,
                payload_hash=payload_hash,
                synced_at=now,
            )
            db.commit()
            if created:
                created_count += 1
            else:
                updated_count += 1
            continue

        existing_event = client.get_event(
            access_token=access_token,
            calendar_id=calendar_id,
            event_id=mirror.google_event_id,
        )
        if existing_event is None:
            event, created = upsert_deterministic_task_event(
                client=client,
                access_token=access_token,
                calendar_id=calendar_id,
                task=task,
                payload=payload,
            )
            update_event_mirror(
                db,
                mirror=mirror,
                task=task,
                calendar_id=calendar_id,
                event=event,
                payload_hash=payload_hash,
                synced_at=now,
            )
            db.commit()
            if created:
                created_count += 1
            else:
                updated_count += 1
            continue

        updated_event = client.update_event(
            access_token=access_token,
            calendar_id=calendar_id,
            event_id=mirror.google_event_id,
            payload=payload,
        )
        update_event_mirror(
            db,
            mirror=mirror,
            task=task,
            calendar_id=calendar_id,
            event=updated_event,
            payload_hash=payload_hash,
            synced_at=now,
        )
        db.commit()
        updated_count += 1

    return {
        "created_count": created_count,
        "updated_count": updated_count,
        "deleted_count": deleted_count,
        "skipped_count": skipped_count,
    }


def sync_one_task(
    db: Session,
    *,
    user_id: uuid.UUID,
    task_id: uuid.UUID,
    connection: GoogleCalendarConnection,
    access_token: str,
    client: GoogleCalendarClient,
) -> dict:
    task = db.scalar(
        select(ScheduledTask).where(
            ScheduledTask.id == task_id,
            ScheduledTask.user_id == user_id,
        )
    )
    if task is None or not is_task_eligible_for_mirror(task):
        deleted_count = delete_task_mirrors(
            db,
            user_id=user_id,
            task_id=task_id,
            access_token=access_token,
            client=client,
        )
        db.commit()
        return {
            "created_count": 0,
            "updated_count": 0,
            "deleted_count": deleted_count,
            "skipped_count": 0,
        }

    calendar_id = connection.google_calendar_id
    if calendar_id is None:
        raise GoogleMirrorCalendarMissingError()

    payload = build_event_payload(task)
    payload_hash = hash_event_payload(payload)
    mirror = db.scalar(
        select(GoogleEventMirror).where(
            GoogleEventMirror.user_id == user_id,
            GoogleEventMirror.task_id == task_id,
        )
    )
    now = datetime.now(UTC)
    if mirror is None:
        event, created = upsert_deterministic_task_event(
            client=client,
            access_token=access_token,
            calendar_id=calendar_id,
            task=task,
            payload=payload,
        )
        add_event_mirror(
            db,
            user_id=user_id,
            task=task,
            calendar_id=calendar_id,
            event=event,
            payload_hash=payload_hash,
            synced_at=now,
        )
        db.commit()
        return {
            "created_count": 1 if created else 0,
            "updated_count": 0 if created else 1,
            "deleted_count": 0,
            "skipped_count": 0,
        }

    if mirror.google_calendar_id != calendar_id:
        event, created = upsert_deterministic_task_event(
            client=client,
            access_token=access_token,
            calendar_id=calendar_id,
            task=task,
            payload=payload,
        )
        update_event_mirror(
            db,
            mirror=mirror,
            task=task,
            calendar_id=calendar_id,
            event=event,
            payload_hash=payload_hash,
            synced_at=now,
        )
        db.commit()
        return {
            "created_count": 1 if created else 0,
            "updated_count": 0 if created else 1,
            "deleted_count": 0,
            "skipped_count": 0,
        }

    existing_event = client.get_event(
        access_token=access_token,
        calendar_id=calendar_id,
        event_id=mirror.google_event_id,
    )
    if existing_event is None:
        event, created = upsert_deterministic_task_event(
            client=client,
            access_token=access_token,
            calendar_id=calendar_id,
            task=task,
            payload=payload,
        )
        update_event_mirror(
            db,
            mirror=mirror,
            task=task,
            calendar_id=calendar_id,
            event=event,
            payload_hash=payload_hash,
            synced_at=now,
        )
        db.commit()
        return {
            "created_count": 1 if created else 0,
            "updated_count": 0 if created else 1,
            "deleted_count": 0,
            "skipped_count": 0,
        }

    updated_event = client.update_event(
        access_token=access_token,
        calendar_id=calendar_id,
        event_id=mirror.google_event_id,
        payload=payload,
    )
    update_event_mirror(
        db,
        mirror=mirror,
        task=task,
        calendar_id=calendar_id,
        event=updated_event,
        payload_hash=payload_hash,
        synced_at=now,
    )
    db.commit()
    return {
        "created_count": 0,
        "updated_count": 1,
        "deleted_count": 0,
        "skipped_count": 0,
    }


def list_eligible_tasks(db: Session, *, user_id: uuid.UUID) -> list[ScheduledTask]:
    cutoff = get_mirror_cutoff()
    tasks = db.scalars(
        select(ScheduledTask).where(
            ScheduledTask.user_id == user_id,
            ScheduledTask.completed.is_(False),
            ScheduledTask.scheduled_start.is_not(None),
        )
    ).all()
    return [
        task
        for task in tasks
        if is_task_eligible_for_mirror(task, cutoff=cutoff)
    ]


def process_reconcile_delete_batch(
    db: Session,
    *,
    user_id: uuid.UUID,
    calendar_id: str,
    access_token: str,
    client: GoogleCalendarClient,
    state: dict,
    batch_size: int,
) -> ReconcileBatchResult | None:
    phase = state.get("phase", "delete")
    if phase != "delete":
        return None

    eligible_task_ids = {task.id for task in list_eligible_tasks(db, user_id=user_id)}
    mirrors = sorted(
        (
            mirror
            for mirror in list_google_event_mirrors(db, user_id=user_id)
            if mirror.task_id is None or mirror.task_id not in eligible_task_ids
        ),
        key=lambda mirror: str(mirror.id),
    )
    last_mirror_id = state.get("last_mirror_id")
    if isinstance(last_mirror_id, str):
        mirrors = [mirror for mirror in mirrors if str(mirror.id) > last_mirror_id]

    if not mirrors:
        return ReconcileBatchResult(
            complete=False,
            progress_state=encode_reconcile_progress({"phase": "upsert"}),
        )

    operations: list[BatchOperation] = []
    requests: list[GoogleBatchEventRequest] = []
    for mirror in mirrors[:batch_size]:
        content_id = f"delete-{mirror.id}"
        operations.append(
            BatchOperation(
                content_id=content_id,
                operation="delete",
                mirror=mirror,
            )
        )
        requests.append(
            GoogleBatchEventRequest(
                content_id=content_id,
                method="DELETE",
                path=build_event_path(
                    calendar_id=mirror.google_calendar_id,
                    event_id=mirror.google_event_id,
                ),
            )
        )

    responses = client.batch_event_requests(access_token=access_token, requests=requests)
    response_by_id = {response.content_id: response for response in responses}
    for operation in operations:
        response = response_by_id.get(operation.content_id)
        if response is None:
            raise GoogleProviderError("Google Calendar returned an invalid batch response")
        handle_batch_delete_response(
            db,
            user_id=user_id,
            operation=operation,
            response=response,
        )

    db.commit()
    last_processed_id = str(operations[-1].mirror.id) if operations[-1].mirror else None
    remaining = len(mirrors) > len(operations)
    return ReconcileBatchResult(
        complete=False,
        progress_state=encode_reconcile_progress(
            {"phase": "delete", "last_mirror_id": last_processed_id}
            if remaining
            else {"phase": "upsert"}
        ),
    )


def process_reconcile_upsert_batch(
    db: Session,
    *,
    user_id: uuid.UUID,
    calendar_id: str,
    access_token: str,
    client: GoogleCalendarClient,
    state: dict,
    batch_size: int,
) -> ReconcileBatchResult:
    phase = state.get("phase", "delete")
    if phase == "delete":
        state = {"phase": "upsert"}

    eligible_tasks = sorted(
        list_eligible_tasks(db, user_id=user_id),
        key=lambda task: str(task.id),
    )
    last_task_id = state.get("last_task_id")
    if isinstance(last_task_id, str):
        eligible_tasks = [task for task in eligible_tasks if str(task.id) > last_task_id]

    if not eligible_tasks:
        return ReconcileBatchResult(complete=True, progress_state=None)

    mirrors_by_task_id = {
        mirror.task_id: mirror
        for mirror in list_google_event_mirrors(db, user_id=user_id)
        if mirror.task_id is not None
    }
    operations: list[BatchOperation] = []
    requests: list[GoogleBatchEventRequest] = []
    for task in eligible_tasks[:batch_size]:
        payload = build_event_payload(task)
        payload_hash = hash_event_payload(payload)
        mirror = mirrors_by_task_id.get(task.id)
        event_id = build_google_event_id(user_id=task.user_id, task_id=task.id)
        payload_with_id = dict(payload)
        payload_with_id["id"] = event_id
        if mirror is None or mirror.google_calendar_id != calendar_id:
            operation_name = "create"
            method = "POST"
            path = build_events_path(calendar_id=calendar_id)
        else:
            operation_name = "update"
            method = "PUT"
            event_id = mirror.google_event_id
            path = build_event_path(calendar_id=calendar_id, event_id=event_id)

        content_id = f"{operation_name}-{task.id}"
        operations.append(
            BatchOperation(
                content_id=content_id,
                operation=operation_name,
                task=task,
                mirror=mirror,
                payload=payload_with_id,
                payload_hash=payload_hash,
                event_id=event_id,
            )
        )
        requests.append(
            GoogleBatchEventRequest(
                content_id=content_id,
                method=method,
                path=path,
                payload=payload_with_id,
            )
        )

    responses = client.batch_event_requests(access_token=access_token, requests=requests)
    response_by_id = {response.content_id: response for response in responses}
    for operation in operations:
        response = response_by_id.get(operation.content_id)
        if response is None:
            raise GoogleProviderError("Google Calendar returned an invalid batch response")
        handle_batch_upsert_response(
            db,
            user_id=user_id,
            calendar_id=calendar_id,
            operation=operation,
            response=response,
        )

    db.commit()
    remaining = len(eligible_tasks) > len(operations)
    return ReconcileBatchResult(
        complete=not remaining,
        progress_state=encode_reconcile_progress(
            {"phase": "upsert", "last_task_id": str(operations[-1].task.id)}
        )
        if remaining and operations[-1].task is not None
        else None,
    )


def handle_batch_delete_response(
    db: Session,
    *,
    user_id: uuid.UUID,
    operation: BatchOperation,
    response: GoogleBatchEventResponse,
) -> None:
    mirror = operation.mirror
    if mirror is None:
        return
    if response.status_code in {status.HTTP_200_OK, status.HTTP_204_NO_CONTENT, status.HTTP_404_NOT_FOUND}:
        db.delete(mirror)
        return
    if is_auth_failure(response.status_code):
        raise GoogleReconnectRequiredError()
    if is_retryable_google_status(response.status_code):
        enqueue_task_delete(db, user_id=user_id, task_id=mirror.task_id)
        return
    raise GoogleProviderError("Google Calendar sync failed", status_code=response.status_code)


def handle_batch_upsert_response(
    db: Session,
    *,
    user_id: uuid.UUID,
    calendar_id: str,
    operation: BatchOperation,
    response: GoogleBatchEventResponse,
) -> None:
    task = operation.task
    if task is None:
        return
    if response.status_code in {status.HTTP_200_OK, status.HTTP_201_CREATED}:
        payload = response.payload or {}
        event = GoogleEventResource(id=payload.get("id") or operation.event_id or "")
        if not event.id:
            raise GoogleProviderError("Google Calendar returned an invalid event response")
        now = datetime.now(UTC)
        if operation.mirror is None:
            add_event_mirror(
                db,
                user_id=user_id,
                task=task,
                calendar_id=calendar_id,
                event=event,
                payload_hash=operation.payload_hash or "",
                synced_at=now,
            )
        else:
            update_event_mirror(
                db,
                mirror=operation.mirror,
                task=task,
                calendar_id=calendar_id,
                event=event,
                payload_hash=operation.payload_hash or "",
                synced_at=now,
            )
        return

    if is_auth_failure(response.status_code):
        raise GoogleReconnectRequiredError()
    if response.status_code in {status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT}:
        enqueue_task_upsert(db, user_id=user_id, task_id=task.id)
        return
    if is_retryable_google_status(response.status_code):
        enqueue_task_upsert(db, user_id=user_id, task_id=task.id)
        return
    raise GoogleProviderError("Google Calendar sync failed", status_code=response.status_code)


def decode_reconcile_progress(progress_state: str | None) -> dict:
    if not progress_state:
        return {"phase": "delete"}
    try:
        loaded = json.loads(progress_state)
    except json.JSONDecodeError:
        return {"phase": "delete"}
    return loaded if isinstance(loaded, dict) else {"phase": "delete"}


def encode_reconcile_progress(progress_state: dict) -> str:
    return json.dumps(progress_state, sort_keys=True, separators=(",", ":"))


def is_auth_failure(status_code: int) -> bool:
    return status_code in {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN}


def is_retryable_google_status(status_code: int) -> bool:
    return status_code == status.HTTP_429_TOO_MANY_REQUESTS or status_code >= 500


def is_task_eligible_for_mirror(task: ScheduledTask, *, cutoff: datetime | None = None) -> bool:
    if task.completed or task.scheduled_start is None:
        return False
    cutoff = cutoff or get_mirror_cutoff()
    return to_app_timezone(ensure_aware_datetime(task.scheduled_start)) < cutoff


def get_mirror_cutoff() -> datetime:
    tomorrow = (now_in_app_timezone() + timedelta(days=1)).date()
    return datetime.combine(
        tomorrow + timedelta(days=365),
        datetime.min.time(),
        tzinfo=now_in_app_timezone().tzinfo,
    )


def list_google_event_mirrors(db: Session, *, user_id: uuid.UUID) -> list[GoogleEventMirror]:
    return list(
        db.scalars(
            select(GoogleEventMirror).where(GoogleEventMirror.user_id == user_id)
        ).all()
    )


def delete_mirror_event(
    db: Session,
    *,
    mirror: GoogleEventMirror,
    access_token: str,
    client: GoogleCalendarClient,
) -> None:
    client.delete_event(
        access_token=access_token,
        calendar_id=mirror.google_calendar_id,
        event_id=mirror.google_event_id,
    )
    db.delete(mirror)


def delete_task_mirrors(
    db: Session,
    *,
    user_id: uuid.UUID,
    task_id: uuid.UUID | None,
    access_token: str,
    client: GoogleCalendarClient,
) -> int:
    statement = select(GoogleEventMirror).where(GoogleEventMirror.user_id == user_id)
    if task_id is None:
        statement = statement.where(GoogleEventMirror.task_id.is_(None))
    else:
        statement = statement.where(GoogleEventMirror.task_id == task_id)
    mirrors = db.scalars(statement).all()
    deleted_count = 0
    for mirror in mirrors:
        delete_mirror_event(
            db,
            mirror=mirror,
            access_token=access_token,
            client=client,
        )
        deleted_count += 1
    return deleted_count


def upsert_deterministic_task_event(
    *,
    client: GoogleCalendarClient,
    access_token: str,
    calendar_id: str,
    task: ScheduledTask,
    payload: dict,
) -> tuple[GoogleEventResource, bool]:
    event_id = build_google_event_id(user_id=task.user_id, task_id=task.id)
    payload_with_id = dict(payload)
    payload_with_id["id"] = event_id

    existing_event = client.get_event(
        access_token=access_token,
        calendar_id=calendar_id,
        event_id=event_id,
    )
    if existing_event is not None:
        updated_event = client.update_event(
            access_token=access_token,
            calendar_id=calendar_id,
            event_id=event_id,
            payload=payload_with_id,
        )
        return updated_event, False

    try:
        created_event = client.create_event(
            access_token=access_token,
            calendar_id=calendar_id,
            payload=payload_with_id,
        )
    except GoogleProviderError as exc:
        if exc.status_code != status.HTTP_409_CONFLICT:
            raise
        updated_event = client.update_event(
            access_token=access_token,
            calendar_id=calendar_id,
            event_id=event_id,
            payload=payload_with_id,
        )
        return updated_event, False

    return created_event, True


def build_google_event_id(*, user_id: uuid.UUID, task_id: uuid.UUID) -> str:
    stable_uuid = uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"taskcalendar-google-event:{user_id}:{task_id}",
    )
    return f"tc{stable_uuid.hex}"


def add_event_mirror(
    db: Session,
    *,
    user_id: uuid.UUID,
    task: ScheduledTask,
    calendar_id: str,
    event: GoogleEventResource,
    payload_hash: str,
    synced_at: datetime,
) -> GoogleEventMirror:
    mirror = GoogleEventMirror(
        user_id=user_id,
        task_id=task.id,
        google_calendar_id=calendar_id,
        google_event_id=event.id,
    )
    update_event_mirror(
        db,
        mirror=mirror,
        task=task,
        calendar_id=calendar_id,
        event=event,
        payload_hash=payload_hash,
        synced_at=synced_at,
    )
    return mirror


def update_event_mirror(
    db: Session,
    *,
    mirror: GoogleEventMirror,
    task: ScheduledTask,
    calendar_id: str,
    event: GoogleEventResource,
    payload_hash: str,
    synced_at: datetime,
) -> None:
    mirror.task_id = task.id
    mirror.google_calendar_id = calendar_id
    mirror.google_event_id = event.id
    mirror.last_task_updated_at = task.updated_at
    mirror.last_payload_hash = payload_hash
    mirror.last_synced_at = synced_at
    mirror.updated_at = synced_at
    db.add(mirror)


def build_event_payload(task: ScheduledTask) -> dict:
    payload = {
        "summary": task.title,
        "description": build_event_description(task.notes),
        "extendedProperties": {
            "private": {
                "taskcalendar_user_id": str(task.user_id),
                "taskcalendar_task_id": str(task.id),
            },
        },
    }
    if task.all_day:
        local_start = to_app_timezone(ensure_aware_datetime(task.scheduled_start))
        payload["start"] = {"date": local_start.date().isoformat()}
        payload["end"] = {"date": (local_start.date() + timedelta(days=1)).isoformat()}
        return payload

    local_start = to_app_timezone(ensure_aware_datetime(task.scheduled_start))
    local_end = (
        to_app_timezone(ensure_aware_datetime(task.scheduled_end))
        if task.scheduled_end is not None
        else local_start + timedelta(minutes=30)
    )
    payload["start"] = {
        "dateTime": local_start.isoformat(),
        "timeZone": get_app_timezone_name(),
    }
    payload["end"] = {
        "dateTime": local_end.isoformat(),
        "timeZone": get_app_timezone_name(),
    }
    if task.scheduled_end is None:
        payload["endTimeUnspecified"] = True
    return payload


def build_event_description(notes: str | None) -> str:
    cleaned_notes = (notes or "").replace(SOURCE_NOTICE, "").strip()
    if not cleaned_notes:
        return SOURCE_NOTICE
    return f"{cleaned_notes}\n\n{SOURCE_NOTICE}"


def hash_event_payload(payload: dict) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def set_connection_error_from_sync_error(
    db: Session,
    connection: GoogleCalendarConnection,
    exc: GoogleSyncError,
) -> None:
    connection.status = exc.connection_status
    connection.last_error = SAFE_LAST_ERROR
    connection.updated_at = datetime.now(UTC)
    db.add(connection)
    db.commit()


def set_connection_error_from_provider(
    db: Session,
    connection: GoogleCalendarConnection,
    exc: GoogleProviderError,
) -> None:
    if provider_error_requires_reconnect(exc):
        connection.status = "needs_reauth"
    else:
        connection.status = "error"
    connection.last_error = SAFE_LAST_ERROR
    connection.updated_at = datetime.now(UTC)
    db.add(connection)
    db.commit()


def provider_error_requires_reconnect(exc: GoogleProviderError) -> bool:
    return exc.error_code in RECONNECT_REQUIRED_GOOGLE_ERROR_CODES


def update_connection_sync_success(db: Session, connection: GoogleCalendarConnection) -> None:
    now = datetime.now(UTC)
    connection.status = "connected"
    connection.last_successful_sync_at = now
    connection.last_error = None
    connection.updated_at = now
    db.add(connection)
    db.commit()


def get_connection(db: Session, *, user_id: uuid.UUID) -> GoogleCalendarConnection | None:
    return db.scalar(
        select(GoogleCalendarConnection).where(GoogleCalendarConnection.user_id == user_id)
    )


def upsert_connection(
    db: Session,
    *,
    user_id: uuid.UUID,
    refresh_token: str | None,
    mirror_calendar: GoogleCalendarResource,
) -> GoogleCalendarConnection:
    connection = get_connection(db, user_id=user_id)
    now = datetime.now(UTC)
    if connection is None:
        connection = GoogleCalendarConnection(user_id=user_id, created_at=now)

    if mirror_calendar.id == "primary":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google primary calendar cannot be used as the mirror calendar",
        )

    connection.google_calendar_id = mirror_calendar.id
    connection.google_calendar_summary = mirror_calendar.summary or MIRROR_CALENDAR_SUMMARY
    if refresh_token is not None:
        connection.encrypted_refresh_token = encrypt_refresh_token(refresh_token)
    connection.status = "connected"
    connection.last_error = None
    connection.revoked_at = None
    connection.updated_at = now
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


def mark_connection_error(db: Session, *, user_id: uuid.UUID) -> None:
    connection = get_connection(db, user_id=user_id)
    if connection is None:
        connection = GoogleCalendarConnection(user_id=user_id)
    connection.status = "error"
    connection.last_error = SAFE_LAST_ERROR
    connection.updated_at = datetime.now(UTC)
    db.add(connection)
    db.commit()


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
