import asyncio
import json
import logging
from contextlib import nullcontext
from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi.routing import APIRoute
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

import app.models  # noqa: F401
from app.backup import service as backup_service
from app.auth.dependencies import get_current_user, oauth2_scheme
from app.core.config import settings
from app.core.database import Base
from app.google_calendar import service
from app.google_calendar import worker as worker_module
from app.google_calendar.client import (
    GoogleBatchEventRequest,
    GoogleBatchEventResponse,
    GoogleCalendarResource,
    GoogleProviderError,
    GoogleTokenResponse,
)
from app.google_calendar.crypto import decrypt_refresh_token
from app.google_calendar.outbox import (
    MAX_ATTEMPTS,
    PROCESSING_LEASE_TIMEOUT,
    claim_next_job,
    enqueue_task_delete,
    enqueue_task_upsert,
    enqueue_user_reconciliation,
)
from app.google_calendar.router import (
    disconnect_google_calendar,
    get_google_calendar_status,
    sync_google_calendar_now,
)
from app.google_calendar.worker import process_available_jobs, process_claimed_job
from app.main import create_app
from app.models.google_calendar import (
    GoogleCalendarConnection,
    GoogleEventMirror,
    GoogleOAuthState,
    GoogleSyncOutbox,
)
from app.models.scheduled_task import ScheduledTask
from app.models.user import User
from app.task_lists import service as task_list_service
from app.task_lists.schemas import TaskListCreate, TaskListUpdate
from app.tasks import service as task_service
from app.tasks.schemas import ScheduledTaskCreate, ScheduledTaskUpdate


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with TestingSessionLocal() as session:
        yield session

    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def google_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "app_timezone", "UTC")
    monkeypatch.setattr(settings, "google_oauth_client_id", "client-id")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "client-secret")
    monkeypatch.setattr(
        settings,
        "google_oauth_redirect_uri",
        "http://127.0.0.1:8000/api/google-calendar/oauth/callback",
    )
    monkeypatch.setattr(
        settings,
        "google_token_encryption_key",
        Fernet.generate_key().decode("utf-8"),
    )


def create_user(db_session: Session, username: str = "alice") -> User:
    user = User(username=username)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def create_task(
    db_session: Session,
    user: User,
    *,
    title: str = "Mirror task",
    scheduled_start: datetime | None = None,
    scheduled_end: datetime | None = None,
    all_day: bool = False,
    completed: bool = False,
    notes: str | None = None,
) -> ScheduledTask:
    task = ScheduledTask(
        user_id=user.id,
        title=title,
        completed=completed,
        scheduled_start=scheduled_start,
        scheduled_end=scheduled_end,
        all_day=all_day,
        notes=notes,
        timezone="UTC",
        notification_enabled=False,
        notification_offset_minutes=0,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)
    return task


def connect_google_calendar(
    db_session: Session,
    user: User,
    *,
    calendar_id: str = "mirror-calendar-id",
) -> GoogleCalendarConnection:
    return service.upsert_connection(
        db_session,
        user_id=user.id,
        refresh_token="refresh-token",
        mirror_calendar=GoogleCalendarResource(
            id=calendar_id,
            summary="TaskCalendar Mirror — Read Only",
        ),
    )


class FakeGoogleClient:
    def __init__(self) -> None:
        self.created_calendars = 0
        self.deleted_calendars = 0
        self.exchanged_codes: list[str] = []
        self.existing_calendar: GoogleCalendarResource | None = None
        self.created_calendar = GoogleCalendarResource(
            id="mirror-calendar-id",
            summary="TaskCalendar Mirror — Read Only",
        )
        self.exchange_error: Exception | None = None
        self.refresh_error: Exception | None = None
        self.get_calendar_error: Exception | None = None
        self.create_error: Exception | None = None
        self.event_error: Exception | None = None
        self.batch_error: Exception | None = None
        self.batch_error_after_side_effects = False
        self.events: dict[str, dict] = {}
        self.created_event_payloads: list[dict] = []
        self.updated_event_payloads: list[dict] = []
        self.deleted_event_ids: list[str] = []
        self.batch_requests: list[list[GoogleBatchEventRequest]] = []
        self.batch_status_overrides: dict[str, int] = {}
        self.refreshed_tokens: list[str] = []
        self.next_event_number = 1

    def build_authorization_url(self, *, state: str) -> str:
        return f"https://accounts.google.example/auth?state={state}"

    def exchange_code(self, code: str) -> GoogleTokenResponse:
        if self.exchange_error is not None:
            raise self.exchange_error
        self.exchanged_codes.append(code)
        return GoogleTokenResponse(
            access_token="access-token",
            refresh_token="refresh-token",
            expires_in=3600,
        )

    def refresh_access_token(self, refresh_token: str) -> GoogleTokenResponse:
        if self.refresh_error is not None:
            raise self.refresh_error
        self.refreshed_tokens.append(refresh_token)
        return GoogleTokenResponse(
            access_token="access-token",
            refresh_token=None,
            expires_in=3600,
        )

    def get_calendar(self, *, access_token: str, calendar_id: str) -> GoogleCalendarResource | None:
        if self.get_calendar_error is not None:
            if (
                isinstance(self.get_calendar_error, GoogleProviderError)
                and self.get_calendar_error.status_code == 404
            ):
                return None
            raise self.get_calendar_error
        assert access_token == "access-token"
        if self.existing_calendar is None:
            return None
        return self.existing_calendar

    def create_mirror_calendar(self, *, access_token: str) -> GoogleCalendarResource:
        if self.create_error is not None:
            raise self.create_error
        assert access_token == "access-token"
        self.created_calendars += 1
        return self.created_calendar

    def delete_calendar(self, *_args, **_kwargs) -> None:
        self.deleted_calendars += 1

    def get_event(
        self,
        *,
        access_token: str,
        calendar_id: str,
        event_id: str,
    ):
        if self.event_error is not None:
            raise self.event_error
        assert access_token == "access-token"
        assert calendar_id
        if event_id not in self.events:
            return None
        from app.google_calendar.client import GoogleEventResource

        return GoogleEventResource(id=event_id)

    def create_event(
        self,
        *,
        access_token: str,
        calendar_id: str,
        payload: dict,
    ):
        if self.event_error is not None:
            raise self.event_error
        assert access_token == "access-token"
        assert calendar_id
        requested_event_id = payload.get("id")
        if isinstance(requested_event_id, str) and requested_event_id:
            event_id = requested_event_id
        else:
            event_id = f"event-{self.next_event_number}"
            self.next_event_number += 1
        if event_id in self.events:
            raise GoogleProviderError("event exists", status_code=409)
        self.events[event_id] = dict(payload)
        self.created_event_payloads.append(dict(payload))
        from app.google_calendar.client import GoogleEventResource

        return GoogleEventResource(id=event_id)

    def update_event(
        self,
        *,
        access_token: str,
        calendar_id: str,
        event_id: str,
        payload: dict,
    ):
        if self.event_error is not None:
            raise self.event_error
        assert access_token == "access-token"
        assert calendar_id
        self.events[event_id] = dict(payload)
        self.updated_event_payloads.append(dict(payload))
        from app.google_calendar.client import GoogleEventResource

        return GoogleEventResource(id=event_id)

    def delete_event(self, *, access_token: str, calendar_id: str, event_id: str) -> bool:
        if self.event_error is not None:
            raise self.event_error
        assert access_token == "access-token"
        assert calendar_id
        self.deleted_event_ids.append(event_id)
        return self.events.pop(event_id, None) is not None

    def batch_event_requests(
        self,
        *,
        access_token: str,
        requests: list[GoogleBatchEventRequest],
    ) -> list[GoogleBatchEventResponse]:
        assert access_token == "access-token"
        self.batch_requests.append(list(requests))
        if self.batch_error is not None and not self.batch_error_after_side_effects:
            raise self.batch_error
        responses: list[GoogleBatchEventResponse] = []
        for batch_request in requests:
            override = self.batch_status_overrides.get(batch_request.content_id)
            if override is not None:
                responses.append(
                    GoogleBatchEventResponse(
                        content_id=batch_request.content_id,
                        status_code=override,
                        payload=None,
                    )
                )
                continue

            method, path, event_id = parse_batch_event_request(batch_request)
            if method == "POST":
                payload = dict(batch_request.payload or {})
                requested_event_id = payload.get("id")
                assert isinstance(requested_event_id, str)
                if requested_event_id in self.events:
                    responses.append(
                        GoogleBatchEventResponse(
                            content_id=batch_request.content_id,
                            status_code=409,
                            payload=None,
                        )
                    )
                    continue
                self.events[requested_event_id] = payload
                self.created_event_payloads.append(payload)
                responses.append(
                    GoogleBatchEventResponse(
                        content_id=batch_request.content_id,
                        status_code=201,
                        payload={"id": requested_event_id},
                    )
                )
                continue

            if method == "PUT":
                payload = dict(batch_request.payload or {})
                assert event_id is not None
                if event_id not in self.events:
                    responses.append(
                        GoogleBatchEventResponse(
                            content_id=batch_request.content_id,
                            status_code=404,
                            payload=None,
                        )
                    )
                    continue
                self.events[event_id] = payload
                self.updated_event_payloads.append(payload)
                responses.append(
                    GoogleBatchEventResponse(
                        content_id=batch_request.content_id,
                        status_code=200,
                        payload={"id": event_id},
                    )
                )
                continue

            if method == "GET":
                assert event_id is not None
                if event_id not in self.events:
                    responses.append(
                        GoogleBatchEventResponse(
                            content_id=batch_request.content_id,
                            status_code=404,
                            payload=None,
                        )
                    )
                    continue
                responses.append(
                    GoogleBatchEventResponse(
                        content_id=batch_request.content_id,
                        status_code=200,
                        payload={"id": event_id},
                    )
                )
                continue

            if method == "DELETE":
                assert event_id is not None
                self.deleted_event_ids.append(event_id)
                self.events.pop(event_id, None)
                responses.append(
                    GoogleBatchEventResponse(
                        content_id=batch_request.content_id,
                        status_code=204,
                        payload=None,
                    )
                )
                continue

            raise AssertionError(f"Unsupported batch method {method}")

        if self.batch_error is not None:
            raise self.batch_error
        return responses


def parse_batch_event_request(
    batch_request: GoogleBatchEventRequest,
) -> tuple[str, str, str | None]:
    path = batch_request.path
    event_id = path.rsplit("/", 1)[-1] if "/events/" in path else None
    return batch_request.method, path, event_id


def test_google_connect_route_requires_authentication() -> None:
    app = create_app(start_worker=False)
    route = next(
        route
        for route in app.routes
        if isinstance(route, APIRoute)
        and route.path == "/api/google-calendar/connect"
    )
    dependency_calls = {dependency.call for dependency in route.dependant.dependencies}
    assert get_current_user in dependency_calls

    async def run() -> None:
        request = Request({"type": "http", "headers": []})
        with pytest.raises(HTTPException) as exc_info:
            await oauth2_scheme(request)
        assert exc_info.value.status_code == 401

    asyncio.run(run())


def test_google_sync_now_route_requires_authentication() -> None:
    app = create_app(start_worker=False)
    route = next(
        route
        for route in app.routes
        if isinstance(route, APIRoute)
        and route.path == "/api/google-calendar/sync-now"
    )
    dependency_calls = {dependency.call for dependency in route.dependant.dependencies}
    assert get_current_user in dependency_calls


def test_oauth_state_is_generated_stored_expiring_and_single_use(db_session: Session) -> None:
    user = create_user(db_session)
    fake_client = FakeGoogleClient()

    authorization_url = service.create_connect_url(
        db_session,
        user_id=user.id,
        client=fake_client,
    )

    oauth_state = db_session.query(GoogleOAuthState).one()
    assert oauth_state.user_id == user.id
    assert len(oauth_state.state) >= 40
    assert service.ensure_utc(oauth_state.expires_at) > datetime.now(UTC)
    assert oauth_state.state in authorization_url

    assert service.handle_oauth_callback(
        db_session,
        state_value=oauth_state.state,
        code="first-code",
        client=fake_client,
    )
    assert not service.handle_oauth_callback(
        db_session,
        state_value=oauth_state.state,
        code="second-code",
        client=fake_client,
    )
    assert fake_client.exchanged_codes == ["first-code"]


def test_competing_oauth_state_consumes_allow_exactly_one_success(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    state = GoogleOAuthState(
        state="competing-state",
        user_id=user.id,
        expires_at=datetime.now(UTC) + timedelta(minutes=1),
    )
    db_session.add(state)
    db_session.commit()

    first_user_id = service.consume_oauth_state(db_session, "competing-state")
    second_user_id = service.consume_oauth_state(db_session, "competing-state")

    assert first_user_id == user.id
    assert second_user_id is None


def test_oauth_callback_rejects_missing_invalid_expired_and_used_state(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    expired_state = GoogleOAuthState(
        state="expired",
        user_id=user.id,
        expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    used_state = GoogleOAuthState(
        state="used",
        user_id=user.id,
        expires_at=datetime.now(UTC) + timedelta(minutes=1),
        used_at=datetime.now(UTC),
    )
    db_session.add_all([expired_state, used_state])
    db_session.commit()
    fake_client = FakeGoogleClient()

    assert not service.handle_oauth_callback(
        db_session,
        state_value=None,
        code="code",
        client=fake_client,
    )
    assert not service.handle_oauth_callback(
        db_session,
        state_value="missing",
        code="code",
        client=fake_client,
    )
    assert not service.handle_oauth_callback(
        db_session,
        state_value="expired",
        code="code",
        client=fake_client,
    )
    assert not service.handle_oauth_callback(
        db_session,
        state_value="used",
        code="code",
        client=fake_client,
    )
    assert fake_client.exchanged_codes == []


def test_successful_callback_creates_user_connection_and_mirror_calendar(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    fake_client = FakeGoogleClient()
    service.create_connect_url(db_session, user_id=user.id, client=fake_client)
    oauth_state = db_session.query(GoogleOAuthState).one()

    assert service.handle_oauth_callback(
        db_session,
        state_value=oauth_state.state,
        code="code",
        client=fake_client,
    )

    connection = db_session.query(GoogleCalendarConnection).one()
    assert connection.user_id == user.id
    assert connection.google_calendar_id == "mirror-calendar-id"
    assert connection.google_calendar_summary == "TaskCalendar Mirror — Read Only"
    assert connection.status == "connected"
    assert fake_client.created_calendars == 1
    job = db_session.query(GoogleSyncOutbox).one()
    assert job.operation == "reconcile_user"
    assert job.user_id == user.id


def test_successful_callback_does_not_run_initial_sync_inline(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    create_task(
        db_session,
        user,
        title="Existing eligible task",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    service.create_connect_url(db_session, user_id=user.id, client=fake_client)
    oauth_state = db_session.query(GoogleOAuthState).one()

    assert service.handle_oauth_callback(
        db_session,
        state_value=oauth_state.state,
        code="code",
        client=fake_client,
    )

    assert db_session.query(GoogleSyncOutbox).filter_by(operation="reconcile_user").count() == 1
    assert db_session.query(GoogleEventMirror).count() == 0
    assert fake_client.created_event_payloads == []


def test_reconnect_reuses_valid_stored_calendar_without_duplicate(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="existing-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    service.upsert_connection(
        db_session,
        user_id=user.id,
        refresh_token="old-refresh-token",
        mirror_calendar=fake_client.existing_calendar,
    )
    service.create_connect_url(db_session, user_id=user.id, client=fake_client)
    oauth_state = db_session.query(GoogleOAuthState).one()

    assert service.handle_oauth_callback(
        db_session,
        state_value=oauth_state.state,
        code="code",
        client=fake_client,
    )

    connection = db_session.query(GoogleCalendarConnection).one()
    assert connection.google_calendar_id == "existing-calendar-id"
    assert fake_client.created_calendars == 0


def test_reconnect_replaces_missing_stored_calendar_only_on_google_404(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    fake_client = FakeGoogleClient()
    service.upsert_connection(
        db_session,
        user_id=user.id,
        refresh_token="old-refresh-token",
        mirror_calendar=GoogleCalendarResource(
            id="missing-calendar-id",
            summary="TaskCalendar Mirror — Read Only",
        ),
    )
    fake_client.get_calendar_error = GoogleProviderError(
        "not found",
        status_code=404,
    )
    service.create_connect_url(db_session, user_id=user.id, client=fake_client)
    oauth_state = db_session.query(GoogleOAuthState).one()

    assert service.handle_oauth_callback(
        db_session,
        state_value=oauth_state.state,
        code="code",
        client=fake_client,
    )

    connection = db_session.query(GoogleCalendarConnection).one()
    assert connection.google_calendar_id == "mirror-calendar-id"
    assert fake_client.created_calendars == 1


@pytest.mark.parametrize("provider_status_code", [401, 403, 429, 500, 503])
def test_reconnect_provider_http_failures_do_not_create_duplicate_calendar(
    db_session: Session,
    provider_status_code: int,
) -> None:
    user = create_user(db_session)
    fake_client = FakeGoogleClient()
    service.upsert_connection(
        db_session,
        user_id=user.id,
        refresh_token="old-refresh-token",
        mirror_calendar=GoogleCalendarResource(
            id="existing-calendar-id",
            summary="TaskCalendar Mirror — Read Only",
        ),
    )
    fake_client.get_calendar_error = GoogleProviderError(
        "provider failure",
        status_code=provider_status_code,
    )
    service.create_connect_url(db_session, user_id=user.id, client=fake_client)
    oauth_state = db_session.query(GoogleOAuthState).one()

    assert not service.handle_oauth_callback(
        db_session,
        state_value=oauth_state.state,
        code="code",
        client=fake_client,
    )

    connection = db_session.query(GoogleCalendarConnection).one()
    assert connection.google_calendar_id == "existing-calendar-id"
    assert connection.status == "error"
    assert fake_client.created_calendars == 0


def test_reconnect_network_failure_does_not_create_duplicate_calendar(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    fake_client = FakeGoogleClient()
    service.upsert_connection(
        db_session,
        user_id=user.id,
        refresh_token="old-refresh-token",
        mirror_calendar=GoogleCalendarResource(
            id="existing-calendar-id",
            summary="TaskCalendar Mirror — Read Only",
        ),
    )
    fake_client.get_calendar_error = GoogleProviderError("network failure")
    service.create_connect_url(db_session, user_id=user.id, client=fake_client)
    oauth_state = db_session.query(GoogleOAuthState).one()

    assert not service.handle_oauth_callback(
        db_session,
        state_value=oauth_state.state,
        code="code",
        client=fake_client,
    )

    connection = db_session.query(GoogleCalendarConnection).one()
    assert connection.google_calendar_id == "existing-calendar-id"
    assert connection.status == "error"
    assert fake_client.created_calendars == 0


def test_sync_now_fails_safely_when_google_is_disconnected(db_session: Session) -> None:
    user = create_user(db_session)

    with pytest.raises(HTTPException) as exc_info:
        sync_google_calendar_now(db_session, current_user=user)

    assert exc_info.value.status_code == 400
    assert "not connected" in str(exc_info.value.detail)


def test_sync_now_enqueues_reconcile_user_and_returns_immediately(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)

    response = sync_google_calendar_now(db_session, current_user=user)

    assert response.started is True
    assert response.pending_sync_items == 1
    assert response.message == "Google Calendar sync started."
    job = db_session.query(GoogleSyncOutbox).one()
    assert job.operation == "reconcile_user"
    assert job.user_id == user.id


def test_sync_now_dedupes_reconcile_user_jobs(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)

    first_response = sync_google_calendar_now(db_session, current_user=user)
    second_response = sync_google_calendar_now(db_session, current_user=user)

    assert first_response.started is True
    assert second_response.started is True
    assert second_response.pending_sync_items == 1
    assert (
        db_session.query(GoogleSyncOutbox)
        .filter_by(user_id=user.id, operation="reconcile_user")
        .count()
        == 1
    )


def test_sync_now_enqueues_recovery_reconcile_for_error_connection(db_session: Session) -> None:
    user = create_user(db_session)
    connection = connect_google_calendar(db_session, user)
    connection.status = "error"
    connection.last_error = service.SAFE_LAST_ERROR
    db_session.add(connection)
    db_session.commit()

    response = sync_google_calendar_now(db_session, current_user=user)

    assert response.started is True
    assert response.pending_sync_items == 1
    job = db_session.query(GoogleSyncOutbox).one()
    assert job.operation == "reconcile_user"
    db_session.refresh(connection)
    assert connection.status == "error"


def test_sync_now_blocks_needs_reauth_without_queueing(db_session: Session) -> None:
    user = create_user(db_session)
    connection = connect_google_calendar(db_session, user)
    connection.status = "needs_reauth"
    connection.last_error = service.SAFE_LAST_ERROR
    db_session.add(connection)
    db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        sync_google_calendar_now(db_session, current_user=user)

    assert exc_info.value.status_code == 400
    assert "reconnect" in str(exc_info.value.detail).lower()
    assert db_session.query(GoogleSyncOutbox).count() == 0


def test_sync_now_reconciliation_runs_through_worker(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        title="Worker reconcile",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    response = sync_google_calendar_now(db_session, current_user=user)
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    monkeypatch.setattr(worker_module, "SessionLocal", lambda: nullcontext(db_session))

    assert response.started is True
    assert process_available_jobs(worker_id="worker", client=fake_client) == 1
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 1


def test_reconcile_user_batches_operations_in_chunks(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    for index in range(55):
        create_task(
            db_session,
            user,
            title=f"Batch {index}",
            scheduled_start=datetime.now(UTC) + timedelta(hours=index + 1),
            scheduled_end=datetime.now(UTC) + timedelta(hours=index + 2),
        )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    progress_state = None
    results = []
    while True:
        result = service.sync_reconcile_batch(
            db_session,
            user_id=user.id,
            progress_state=progress_state,
            client=fake_client,
        )
        results.append(result)
        if result.complete:
            break
        progress_state = result.progress_state

    assert results[0].complete is False
    assert results[-1].complete is True
    assert [len(batch) for batch in fake_client.batch_requests] == [10, 10, 10, 10, 10, 5]
    assert db_session.query(GoogleEventMirror).filter_by(user_id=user.id).count() == 55


def test_batch_success_updates_mappings_and_serializes_event_shapes(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    all_day_task = create_task(
        db_session,
        user,
        title="All day batch",
        scheduled_start=datetime(2026, 7, 1, 0, 0, tzinfo=UTC),
        all_day=True,
    )
    timed_task = create_task(
        db_session,
        user,
        title="Timed batch",
        scheduled_start=datetime(2026, 7, 1, 9, 0, tzinfo=UTC),
        scheduled_end=datetime(2026, 7, 1, 10, 0, tzinfo=UTC),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    result = service.sync_reconcile_batch(
        db_session,
        user_id=user.id,
        progress_state=None,
        client=fake_client,
    )

    assert result.complete is True
    assert db_session.query(GoogleEventMirror).filter_by(task_id=all_day_task.id).count() == 1
    assert db_session.query(GoogleEventMirror).filter_by(task_id=timed_task.id).count() == 1
    all_day_payload = next(
        payload for payload in fake_client.created_event_payloads if payload["summary"] == "All day batch"
    )
    timed_payload = next(
        payload for payload in fake_client.created_event_payloads if payload["summary"] == "Timed batch"
    )
    assert all_day_payload["start"] == {"date": "2026-07-01"}
    assert all_day_payload["end"] == {"date": "2026-07-02"}
    assert "dateTime" in timed_payload["start"]
    assert timed_payload["start"]["timeZone"] == "UTC"


def test_reconcile_unchanged_mirrored_tasks_do_not_send_put_requests(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    first_result = service.sync_reconcile_batch(
        db_session,
        user_id=user.id,
        progress_state=None,
        client=fake_client,
    )
    assert first_result.complete is True
    fake_client.batch_requests.clear()

    second_result = service.sync_reconcile_batch(
        db_session,
        user_id=user.id,
        progress_state=None,
        client=fake_client,
    )

    assert second_result.complete is True
    assert second_result.skipped_unchanged_count == 1
    methods = [
        request.method
        for batch in fake_client.batch_requests
        for request in batch
    ]
    assert "PUT" not in methods


def test_reconcile_changed_mirrored_tasks_still_send_put_requests(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        title="Original title",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    service.sync_reconcile_batch(
        db_session,
        user_id=user.id,
        progress_state=None,
        client=fake_client,
    )
    fake_client.batch_requests.clear()

    task.title = "Changed title"
    task.updated_at = datetime.now(UTC) + timedelta(seconds=1)
    db_session.add(task)
    db_session.commit()

    result = service.sync_reconcile_batch(
        db_session,
        user_id=user.id,
        progress_state=None,
        client=fake_client,
    )

    assert result.complete is True
    assert [
        request.method
        for batch in fake_client.batch_requests
        for request in batch
    ] == ["PUT"]


def test_reconcile_new_tasks_still_send_post_requests(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    result = service.sync_reconcile_batch(
        db_session,
        user_id=user.id,
        progress_state=None,
        client=fake_client,
    )

    assert result.complete is True
    assert [
        request.method
        for batch in fake_client.batch_requests
        for request in batch
    ] == ["POST"]


def test_failed_batch_subresponse_enqueues_follow_up_without_mapping(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    fake_client.batch_status_overrides[f"create-{task.id}"] = 500

    result = service.sync_reconcile_batch(
        db_session,
        user_id=user.id,
        progress_state=None,
        client=fake_client,
    )

    assert result.complete is True
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 0
    follow_up = db_session.query(GoogleSyncOutbox).one()
    assert follow_up.operation == "upsert_task"
    assert follow_up.task_id == task.id


def test_reconcile_timeout_is_retryable_without_reauth(
    db_session: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    user = create_user(db_session)
    connection = connect_google_calendar(db_session, user)
    create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    enqueue_user_reconciliation(db_session, user_id=user.id)
    db_session.commit()
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    fake_client.batch_error = TimeoutError("timed out")
    job = claim_next_job(db_session, worker_id="worker")
    assert job is not None

    with caplog.at_level(logging.WARNING, logger=worker_module.logger.name):
        process_claimed_job(db_session, job, client=fake_client)

    db_session.refresh(job)
    db_session.refresh(connection)
    payload = json.loads(
        next(
            record.message
            for record in caplog.records
            if "google_sync_job_failed" in record.message
        )
    )

    assert job.status == "failed"
    assert job.attempts == 1
    assert job.last_error == "Google Calendar sync failed"
    assert connection.status == "connected"
    assert payload["exception_class"] == "GoogleReconcileBatchTimeoutError"
    assert payload["reconcile_phase"] == "upsert"
    assert payload["reconcile_batch_size"] == 1
    assert payload["reconcile_progress_state"] == '{"phase":"upsert"}'
    assert payload["timeout_source"] == "google_calendar_reconcile_upsert_batch"
    assert payload["retryable"] is True


def test_reconcile_retry_after_timeout_side_effects_avoids_duplicate_mappings(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    for index in range(12):
        create_task(
            db_session,
            user,
            title=f"Timeout resume {index}",
            scheduled_start=datetime.now(UTC) + timedelta(hours=index + 1),
            scheduled_end=datetime.now(UTC) + timedelta(hours=index + 2),
        )
    enqueue_user_reconciliation(db_session, user_id=user.id)
    db_session.commit()
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    fake_client.batch_error = TimeoutError("timed out after remote writes")
    fake_client.batch_error_after_side_effects = True
    monkeypatch.setattr(worker_module, "SessionLocal", lambda: nullcontext(db_session))

    first_job = claim_next_job(db_session, worker_id="worker")
    assert first_job is not None
    process_claimed_job(db_session, first_job, client=fake_client)
    db_session.refresh(first_job)
    assert first_job.status == "failed"
    assert db_session.query(GoogleEventMirror).filter_by(user_id=user.id).count() == 0
    assert len(fake_client.events) == 10

    fake_client.batch_error = None
    first_job.available_at = datetime.now(UTC)
    db_session.add(first_job)
    db_session.commit()
    assert process_available_jobs(worker_id="worker", client=fake_client) > 0
    for _ in range(3):
        if db_session.query(GoogleEventMirror).filter_by(user_id=user.id).count() == 12:
            break
        active_jobs = (
            db_session.query(GoogleSyncOutbox)
            .filter(
                GoogleSyncOutbox.user_id == user.id,
                GoogleSyncOutbox.status.in_(["pending", "failed"]),
            )
            .all()
        )
        for active_job in active_jobs:
            active_job.available_at = datetime.now(UTC) - timedelta(seconds=1)
            db_session.add(active_job)
        db_session.commit()
        assert process_available_jobs(worker_id="worker", client=fake_client) > 0

    assert db_session.query(GoogleEventMirror).filter_by(user_id=user.id).count() == 12
    assert len(fake_client.events) == 12
    assert len(fake_client.created_event_payloads) == 12


def test_dead_retryable_reconcile_is_excluded_and_fresh_reconcile_can_enqueue(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    enqueue_user_reconciliation(db_session, user_id=user.id)
    db_session.commit()
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    fake_client.batch_error = TimeoutError("timed out")
    job = claim_next_job(db_session, worker_id="worker")
    assert job is not None
    job.attempts = MAX_ATTEMPTS - 1
    db_session.add(job)
    db_session.commit()

    process_claimed_job(db_session, job, client=fake_client)
    db_session.refresh(job)
    status = get_google_calendar_status(db_session, current_user=user)

    assert job.status == "dead"
    assert status.pending_sync_items == 0
    assert status.processing_sync_items == 0
    assert status.retrying_sync_items == 0

    enqueue_user_reconciliation(db_session, user_id=user.id)
    db_session.commit()
    fresh_job = (
        db_session.query(GoogleSyncOutbox)
        .filter(
            GoogleSyncOutbox.user_id == user.id,
            GoogleSyncOutbox.operation == "reconcile_user",
            GoogleSyncOutbox.status == "pending",
        )
        .one()
    )
    assert fresh_job.id != job.id


def test_batch_create_conflict_retries_without_duplicate_event(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    event_id = service.build_google_event_id(user_id=user.id, task_id=task.id)
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    fake_client.events[event_id] = {"id": event_id, "summary": "Existing"}

    service.sync_reconcile_batch(
        db_session,
        user_id=user.id,
        progress_state=None,
        client=fake_client,
    )
    follow_up = claim_next_job(db_session, worker_id="worker")
    assert follow_up is not None
    process_claimed_job(db_session, follow_up, client=fake_client)

    assert list(fake_client.events) == [event_id]
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 1


def test_batch_delete_removes_mapping_only_after_success(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    successful_task = create_task(
        db_session,
        user,
        title="Successful delete",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    failed_task = create_task(
        db_session,
        user,
        title="Failed delete",
        scheduled_start=datetime.now(UTC) + timedelta(hours=3),
        scheduled_end=datetime.now(UTC) + timedelta(hours=4),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    service.sync_now(db_session, user_id=user.id, client=fake_client)
    successful_mirror = db_session.query(GoogleEventMirror).filter_by(task_id=successful_task.id).one()
    failed_mirror = db_session.query(GoogleEventMirror).filter_by(task_id=failed_task.id).one()
    db_session.delete(successful_task)
    db_session.delete(failed_task)
    db_session.commit()
    fake_client.batch_status_overrides[f"delete-{failed_mirror.id}"] = 500

    service.sync_reconcile_batch(
        db_session,
        user_id=user.id,
        progress_state=None,
        client=fake_client,
    )

    assert db_session.query(GoogleEventMirror).filter_by(id=successful_mirror.id).count() == 0
    assert db_session.query(GoogleEventMirror).filter_by(id=failed_mirror.id).count() == 1
    follow_up = db_session.query(GoogleSyncOutbox).one()
    assert follow_up.operation == "delete_task"
    assert follow_up.task_id == failed_task.id


def test_sync_now_creates_event_for_incomplete_scheduled_task(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        title="Plain title",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
        notes="Bring laptop",
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    result = service.sync_now(db_session, user_id=user.id, client=fake_client)

    assert result["created_count"] == 1
    payload = fake_client.created_event_payloads[0]
    assert payload["summary"] == "Plain title"
    assert "☐" not in payload["summary"]
    assert "☑" not in payload["summary"]
    assert payload["description"] == (
        "Bring laptop\n\n"
        "Source: TaskCalendar\n"
        "This event is mirrored automatically.\n"
        "Changes made here may be overwritten by TaskCalendar."
    )
    assert payload["extendedProperties"]["private"]["taskcalendar_task_id"] == str(task.id)
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 1


def test_sync_now_excludes_completed_unscheduled_and_far_future_tasks(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    create_task(
        db_session,
        user,
        title="Completed",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
        completed=True,
    )
    create_task(db_session, user, title="Inbox")
    create_task(
        db_session,
        user,
        title="Far future",
        scheduled_start=datetime.now(UTC) + timedelta(days=367),
        scheduled_end=datetime.now(UTC) + timedelta(days=367, hours=1),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    result = service.sync_now(db_session, user_id=user.id, client=fake_client)

    assert result["created_count"] == 0
    assert fake_client.created_event_payloads == []


def test_sync_now_mirrors_overdue_incomplete_task(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    create_task(
        db_session,
        user,
        title="Overdue",
        scheduled_start=datetime.now(UTC) - timedelta(days=2),
        scheduled_end=datetime.now(UTC) - timedelta(days=2, hours=-1),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    result = service.sync_now(db_session, user_id=user.id, client=fake_client)

    assert result["created_count"] == 1
    assert fake_client.created_event_payloads[0]["summary"] == "Overdue"


def test_sync_now_maps_all_day_and_timed_event_fields(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    create_task(
        db_session,
        user,
        title="All day",
        scheduled_start=datetime(2026, 7, 1, 0, 0, tzinfo=UTC),
        all_day=True,
    )
    create_task(
        db_session,
        user,
        title="Timed",
        scheduled_start=datetime(2026, 7, 1, 9, 0, tzinfo=UTC),
        scheduled_end=datetime(2026, 7, 1, 10, 0, tzinfo=UTC),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    service.sync_now(db_session, user_id=user.id, client=fake_client)

    all_day_payload = next(
        payload for payload in fake_client.created_event_payloads if payload["summary"] == "All day"
    )
    timed_payload = next(
        payload for payload in fake_client.created_event_payloads if payload["summary"] == "Timed"
    )
    assert all_day_payload["start"] == {"date": "2026-07-01"}
    assert all_day_payload["end"] == {"date": "2026-07-02"}
    assert "dateTime" in timed_payload["start"]
    assert "dateTime" in timed_payload["end"]
    assert timed_payload["start"]["timeZone"] == "UTC"


def test_source_notice_is_not_duplicated(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    create_task(
        db_session,
        user,
        title="Notice",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
        notes=f"Original notes\n\n{service.SOURCE_NOTICE}",
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    service.sync_now(db_session, user_id=user.id, client=fake_client)

    description = fake_client.created_event_payloads[0]["description"]
    assert description.count("Source: TaskCalendar") == 1
    assert description.startswith("Original notes")


def test_sync_now_deletes_event_when_task_completed_and_recreates_when_undone(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        title="Toggle completion",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    service.sync_now(db_session, user_id=user.id, client=fake_client)
    first_event_id = db_session.query(GoogleEventMirror).filter_by(task_id=task.id).one().google_event_id

    task.completed = True
    task.updated_at = datetime.now(UTC)
    db_session.add(task)
    db_session.commit()
    delete_result = service.sync_now(db_session, user_id=user.id, client=fake_client)

    assert delete_result["deleted_count"] == 1
    assert first_event_id in fake_client.deleted_event_ids
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 0

    task.completed = False
    task.updated_at = datetime.now(UTC)
    db_session.add(task)
    db_session.commit()
    recreate_result = service.sync_now(db_session, user_id=user.id, client=fake_client)

    assert recreate_result["created_count"] == 1
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 1


def test_sync_now_overwrites_google_drift_and_recreates_deleted_mapped_event(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        title="Authoritative title",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
        notes="Authoritative notes",
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    service.sync_now(db_session, user_id=user.id, client=fake_client)
    mirror = db_session.query(GoogleEventMirror).filter_by(task_id=task.id).one()
    old_event_id = mirror.google_event_id
    fake_client.events[mirror.google_event_id]["summary"] = "Edited in Google"
    fake_client.events[mirror.google_event_id]["description"] = "Edited notes"

    service.sync_now(db_session, user_id=user.id, client=fake_client)

    assert fake_client.updated_event_payloads[-1]["summary"] == "Authoritative title"
    assert fake_client.updated_event_payloads[-1]["description"].startswith("Authoritative notes")

    fake_client.events.pop(old_event_id)
    recreate_result = service.sync_now(db_session, user_id=user.id, client=fake_client)

    assert recreate_result["created_count"] == 1
    refreshed_mirror = db_session.query(GoogleEventMirror).filter_by(task_id=task.id).one()
    assert refreshed_mirror.google_event_id == old_event_id


def test_sync_now_leaves_unmanaged_google_events_and_deletes_local_deleted_task_mapping(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        title="Delete locally",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    fake_client.events["unmanaged-event"] = {"summary": "Unmanaged"}
    service.sync_now(db_session, user_id=user.id, client=fake_client)
    mirror = db_session.query(GoogleEventMirror).filter_by(task_id=task.id).one()

    db_session.delete(task)
    db_session.commit()
    result = service.sync_now(db_session, user_id=user.id, client=fake_client)

    assert result["deleted_count"] == 1
    assert mirror.google_event_id in fake_client.deleted_event_ids
    assert "unmanaged-event" in fake_client.events


def test_sync_now_preserves_per_user_isolation(db_session: Session) -> None:
    alice = create_user(db_session, "alice")
    bob = create_user(db_session, "bob")
    connect_google_calendar(db_session, alice, calendar_id="alice-calendar")
    connect_google_calendar(db_session, bob, calendar_id="bob-calendar")
    create_task(
        db_session,
        alice,
        title="Alice task",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    create_task(
        db_session,
        bob,
        title="Bob task",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="alice-calendar",
        summary="TaskCalendar Mirror — Read Only",
    )

    service.sync_now(db_session, user_id=alice.id, client=fake_client)

    assert [payload["summary"] for payload in fake_client.created_event_payloads] == ["Alice task"]
    assert db_session.query(GoogleEventMirror).filter_by(user_id=bob.id).count() == 0


def test_sync_now_revoked_token_marks_reconnect_required(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    fake_client = FakeGoogleClient()
    fake_client.refresh_error = GoogleProviderError(
        "revoked",
        status_code=400,
        error_code="invalid_grant",
    )

    with pytest.raises(HTTPException) as exc_info:
        service.sync_now(db_session, user_id=user.id, client=fake_client)

    connection = service.get_connection(db_session, user_id=user.id)
    assert connection is not None
    assert connection.status == "needs_reauth"
    assert "reconnect" in str(exc_info.value.detail).lower()


def test_sync_now_transient_failure_returns_safe_error_without_mapping_corruption(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        title="Transient",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    fake_client.event_error = GoogleProviderError("rate limited", status_code=429)

    with pytest.raises(HTTPException) as exc_info:
        service.sync_now(db_session, user_id=user.id, client=fake_client)

    connection = service.get_connection(db_session, user_id=user.id)
    assert connection is not None
    assert connection.status == "error"
    assert "rate limited" not in str(exc_info.value.detail)
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 0


def test_sync_now_migrates_stale_mapping_to_current_calendar_without_duplicate(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user, calendar_id="new-calendar")
    task = create_task(
        db_session,
        user,
        title="Moved calendar",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    stale_mirror = GoogleEventMirror(
        user_id=user.id,
        task_id=task.id,
        google_calendar_id="old-calendar",
        google_event_id="old-event",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(stale_mirror)
    db_session.commit()
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="new-calendar",
        summary="TaskCalendar Mirror — Read Only",
    )

    first_result = service.sync_now(db_session, user_id=user.id, client=fake_client)
    db_session.refresh(stale_mirror)

    assert first_result["created_count"] == 1
    assert len(fake_client.created_event_payloads) == 1
    assert stale_mirror.google_calendar_id == "new-calendar"
    assert stale_mirror.google_event_id == service.build_google_event_id(
        user_id=user.id,
        task_id=task.id,
    )
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 1

    second_result = service.sync_now(db_session, user_id=user.id, client=fake_client)

    assert second_result["created_count"] == 0
    assert second_result["updated_count"] == 1
    assert len(fake_client.created_event_payloads) == 1


def test_sync_now_cleans_stale_mapping_for_ineligible_task(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user, calendar_id="new-calendar")
    task = create_task(
        db_session,
        user,
        title="Completed stale",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
        completed=True,
    )
    stale_mirror = GoogleEventMirror(
        user_id=user.id,
        task_id=task.id,
        google_calendar_id="old-calendar",
        google_event_id="old-event",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(stale_mirror)
    db_session.commit()
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="new-calendar",
        summary="TaskCalendar Mirror — Read Only",
    )

    result = service.sync_now(db_session, user_id=user.id, client=fake_client)

    assert result["deleted_count"] == 1
    assert fake_client.deleted_event_ids == ["old-event"]
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 0


def test_sync_now_missing_mirror_calendar_sets_error_not_reauth(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = None

    with pytest.raises(HTTPException) as exc_info:
        service.sync_now(db_session, user_id=user.id, client=fake_client)

    connection = service.get_connection(db_session, user_id=user.id)
    assert connection is not None
    assert connection.status == "error"
    assert connection.status != "needs_reauth"
    assert "raw provider" not in str(exc_info.value.detail)
    assert "token" not in str(exc_info.value.detail).lower()


@pytest.mark.parametrize("provider_status_code", [401, 403, 429, 500, 503, None])
def test_sync_now_provider_failures_set_error_not_reauth(
    db_session: Session,
    provider_status_code: int | None,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    fake_client = FakeGoogleClient()
    fake_client.get_calendar_error = GoogleProviderError(
        "raw provider failure with token",
        status_code=provider_status_code,
    )

    with pytest.raises(HTTPException) as exc_info:
        service.sync_now(db_session, user_id=user.id, client=fake_client)

    connection = service.get_connection(db_session, user_id=user.id)
    assert connection is not None
    assert connection.status == "error"
    assert "raw provider" not in str(exc_info.value.detail)
    assert "token" not in str(exc_info.value.detail).lower()


def test_sync_now_recovers_error_connection_on_success_without_duplicate_calendar(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connection = connect_google_calendar(db_session, user)
    connection.status = "error"
    connection.last_error = service.SAFE_LAST_ERROR
    db_session.add(connection)
    db_session.commit()
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    result = service.sync_now(db_session, user_id=user.id, client=fake_client)

    db_session.refresh(connection)
    assert result["created_count"] == 1
    assert connection.status == "connected"
    assert connection.last_error is None
    assert connection.last_successful_sync_at is not None
    assert connection.google_calendar_id == "mirror-calendar-id"
    assert connection.google_calendar_summary == "TaskCalendar Mirror — Read Only"
    assert fake_client.created_calendars == 0
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 1


def test_primary_calendar_is_never_stored(db_session: Session) -> None:
    user = create_user(db_session)

    with pytest.raises(HTTPException):
        service.upsert_connection(
            db_session,
            user_id=user.id,
            refresh_token="refresh-token",
            mirror_calendar=GoogleCalendarResource(id="primary", summary="Primary"),
        )


def test_refresh_token_is_encrypted(db_session: Session) -> None:
    user = create_user(db_session)
    service.upsert_connection(
        db_session,
        user_id=user.id,
        refresh_token="refresh-token",
        mirror_calendar=GoogleCalendarResource(
            id="mirror-calendar-id",
            summary="TaskCalendar Mirror — Read Only",
        ),
    )

    connection = db_session.query(GoogleCalendarConnection).one()
    assert connection.encrypted_refresh_token is not None
    assert connection.encrypted_refresh_token != "refresh-token"
    assert decrypt_refresh_token(connection.encrypted_refresh_token) == "refresh-token"


def test_status_endpoint_never_exposes_sensitive_values(db_session: Session) -> None:
    user = create_user(db_session)
    service.upsert_connection(
        db_session,
        user_id=user.id,
        refresh_token="refresh-token",
        mirror_calendar=GoogleCalendarResource(
            id="mirror-calendar-id",
            summary="TaskCalendar Mirror — Read Only",
        ),
    )

    status_response = get_google_calendar_status(db_session, current_user=user)
    payload = status_response.model_dump()

    assert payload["connected"] is True
    assert payload["mirror_calendar_summary"] == "TaskCalendar Mirror — Read Only"
    assert "refresh" not in str(payload)
    assert "client-secret" not in str(payload)
    assert "authorization" not in str(payload).lower()


def test_disconnect_clears_credentials_and_does_not_delete_calendar(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    service.upsert_connection(
        db_session,
        user_id=user.id,
        refresh_token="refresh-token",
        mirror_calendar=GoogleCalendarResource(
            id="mirror-calendar-id",
            summary="TaskCalendar Mirror — Read Only",
        ),
    )

    response = disconnect_google_calendar(db_session, current_user=user)
    connection = db_session.query(GoogleCalendarConnection).one()

    assert response.message == "Google Calendar disconnected"
    assert connection.encrypted_refresh_token is None
    assert connection.status == "disabled"
    assert connection.google_calendar_id == "mirror-calendar-id"


def test_user_scoping_for_status_and_disconnect(db_session: Session) -> None:
    alice = create_user(db_session, "alice")
    bob = create_user(db_session, "bob")
    service.upsert_connection(
        db_session,
        user_id=alice.id,
        refresh_token="refresh-token",
        mirror_calendar=GoogleCalendarResource(
            id="alice-calendar-id",
            summary="TaskCalendar Mirror — Read Only",
        ),
    )

    bob_status = get_google_calendar_status(db_session, current_user=bob)
    assert bob_status.connected is False
    disconnect_google_calendar(db_session, current_user=bob)

    alice_connection = db_session.query(GoogleCalendarConnection).filter_by(user_id=alice.id).one()
    assert alice_connection.status == "connected"
    assert alice_connection.encrypted_refresh_token is not None


def test_oauth_denial_and_provider_failures_are_safe(db_session: Session) -> None:
    user = create_user(db_session)
    fake_client = FakeGoogleClient()
    service.create_connect_url(db_session, user_id=user.id, client=fake_client)
    denied_state = db_session.query(GoogleOAuthState).one()

    assert not service.handle_oauth_callback(
        db_session,
        state_value=denied_state.state,
        code=None,
        error_value="access_denied",
        client=fake_client,
    )
    assert fake_client.exchanged_codes == []

    service.create_connect_url(db_session, user_id=user.id, client=fake_client)
    failed_state = (
        db_session.query(GoogleOAuthState)
        .filter(GoogleOAuthState.used_at.is_(None))
        .order_by(GoogleOAuthState.created_at.desc())
        .first()
    )
    assert failed_state is not None
    fake_client.exchange_error = RuntimeError("raw provider error with token")
    assert not service.handle_oauth_callback(
        db_session,
        state_value=failed_state.state,
        code="code",
        client=fake_client,
    )
    status_response = get_google_calendar_status(db_session, current_user=user)
    assert status_response.last_error_when_safe_to_show == service.SAFE_LAST_ERROR
    assert "raw provider" not in str(status_response.model_dump())


def test_scheduled_task_create_and_update_queue_upsert_jobs(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)

    task = task_service.create_task(
        db_session,
        ScheduledTaskCreate(
            title="Queued",
            scheduled_start=datetime.now(UTC) + timedelta(hours=1),
            scheduled_end=datetime.now(UTC) + timedelta(hours=2),
            notes="Original",
            all_day=False,
        ),
        user_id=user.id,
    )

    job = db_session.query(GoogleSyncOutbox).one()
    assert job.operation == "upsert_task"
    assert job.task_id == task.id

    job.status = "done"
    db_session.add(job)
    db_session.commit()
    task_service.update_task(
        db_session,
        task.id,
        ScheduledTaskUpdate(
            title="Updated",
            scheduled_start=datetime.now(UTC) + timedelta(hours=3),
            scheduled_end=datetime.now(UTC) + timedelta(hours=4),
            notes="Changed",
            all_day=True,
        ),
        user_id=user.id,
    )

    jobs = db_session.query(GoogleSyncOutbox).order_by(GoogleSyncOutbox.created_at).all()
    assert [queued_job.operation for queued_job in jobs] == ["upsert_task", "upsert_task"]
    assert jobs[-1].task_id == task.id


def test_unscheduled_task_create_does_not_queue_google_job(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)

    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Inbox"),
        user_id=user.id,
    )

    assert db_session.query(GoogleSyncOutbox).count() == 0


def test_completion_undo_and_delete_queue_google_jobs(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )

    task_service.complete_task(db_session, task.id, user_id=user.id)
    first_job = db_session.query(GoogleSyncOutbox).one()
    assert first_job.operation == "upsert_task"
    assert first_job.task_id == task.id

    first_job.status = "done"
    db_session.add(first_job)
    db_session.commit()
    task_service.uncomplete_task(db_session, task.id, user_id=user.id)
    second_job = (
        db_session.query(GoogleSyncOutbox)
        .order_by(GoogleSyncOutbox.created_at.desc())
        .first()
    )
    assert second_job is not None
    assert second_job.operation == "upsert_task"
    assert second_job.task_id == task.id

    second_job.status = "done"
    db_session.add(second_job)
    db_session.commit()
    task_service.delete_task(db_session, task.id, user_id=user.id)
    third_job = (
        db_session.query(GoogleSyncOutbox)
        .order_by(GoogleSyncOutbox.created_at.desc())
        .first()
    )
    assert third_job is not None
    assert third_job.operation == "delete_task"
    assert third_job.task_id == task.id


def test_recurrence_and_backup_import_queue_user_reconciliation(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)

    task_service.create_task(
        db_session,
        ScheduledTaskCreate(
            title="Daily",
            scheduled_start=datetime(2026, 7, 1, 9, 0, tzinfo=UTC),
            scheduled_end=datetime(2026, 7, 1, 10, 0, tzinfo=UTC),
            recurrence_rule="FREQ=DAILY;UNTIL=2026-07-03T00:00:00+00:00",
        ),
        user_id=user.id,
    )
    create_jobs = db_session.query(GoogleSyncOutbox).all()
    assert len(create_jobs) == 1
    assert create_jobs[0].operation == "reconcile_user"
    assert create_jobs[0].task_id is None
    db_session.query(GoogleSyncOutbox).delete()
    db_session.commit()
    recurring_task = db_session.query(ScheduledTask).filter_by(user_id=user.id).first()
    assert recurring_task is not None

    task_service.update_task(
        db_session,
        recurring_task.id,
        ScheduledTaskUpdate(title="Daily updated"),
        user_id=user.id,
        update_scope="series",
    )
    assert (
        db_session.query(GoogleSyncOutbox)
        .filter_by(user_id=user.id, operation="reconcile_user")
        .count()
        == 1
    )

    db_session.query(GoogleSyncOutbox).delete()
    db_session.commit()
    exported = backup_service.export_user_backup(db_session, user_id=user.id)
    backup_service.import_user_backup(db_session, backup_service.BackupImportRequest(**exported), user_id=user.id)
    assert (
        db_session.query(GoogleSyncOutbox)
        .filter_by(user_id=user.id, operation="reconcile_user")
        .count()
        == 1
    )


def test_category_color_change_does_not_queue_google_job(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task_list = task_list_service.create_task_list(
        db_session,
        TaskListCreate(name="Work", color="#cc0000"),
        user_id=user.id,
    )

    task_list_service.update_task_list(
        db_session,
        task_list.id,
        TaskListUpdate(color="#00cc00"),
        user_id=user.id,
    )

    assert db_session.query(GoogleSyncOutbox).count() == 0


def test_worker_claims_one_job_once(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()

    first_claim = claim_next_job(db_session, worker_id="worker-a")
    second_claim = claim_next_job(db_session, worker_id="worker-b")

    assert first_claim is not None
    assert first_claim.locked_by == "worker-a"
    assert second_claim is None


def test_delete_task_priority_is_claimed_before_reconcile_user(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    enqueue_user_reconciliation(db_session, user_id=user.id)
    enqueue_task_delete(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()

    claimed = claim_next_job(db_session, worker_id="worker")

    assert claimed is not None
    assert claimed.operation == "delete_task"
    assert claimed.priority == 100


def test_upsert_task_priority_is_claimed_before_reconcile_user(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    enqueue_user_reconciliation(db_session, user_id=user.id)
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()

    claimed = claim_next_job(db_session, worker_id="worker")

    assert claimed is not None
    assert claimed.operation == "upsert_task"
    assert claimed.priority == 90


def test_reconcile_yields_between_batches_for_high_priority_delete(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    tasks = [
        create_task(
            db_session,
            user,
            title=f"Yield {index}",
            scheduled_start=datetime.now(UTC) + timedelta(hours=index + 1),
            scheduled_end=datetime.now(UTC) + timedelta(hours=index + 2),
        )
        for index in range(11)
    ]
    enqueue_user_reconciliation(db_session, user_id=user.id)
    db_session.commit()
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    reconcile_job = claim_next_job(db_session, worker_id="worker")
    assert reconcile_job is not None
    process_claimed_job(db_session, reconcile_job, client=fake_client)
    db_session.refresh(reconcile_job)
    assert reconcile_job.status == "pending"
    assert reconcile_job.progress_state is not None

    enqueue_task_delete(db_session, user_id=user.id, task_id=tasks[0].id)
    db_session.commit()
    claimed = claim_next_job(db_session, worker_id="worker")

    assert claimed is not None
    assert claimed.operation == "delete_task"


def test_incomplete_reconcile_requeues_with_future_available_at(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    for index in range(11):
        create_task(
            db_session,
            user,
            title=f"Delayed {index}",
            scheduled_start=datetime.now(UTC) + timedelta(hours=index + 1),
            scheduled_end=datetime.now(UTC) + timedelta(hours=index + 2),
        )
    enqueue_user_reconciliation(db_session, user_id=user.id)
    db_session.commit()
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    job = claim_next_job(db_session, worker_id="worker")
    assert job is not None
    before_process = datetime.now(UTC)

    process_claimed_job(db_session, job, client=fake_client)
    db_session.refresh(job)

    assert job.status == "pending"
    assert service.ensure_utc(job.available_at) > before_process
    assert claim_next_job(db_session, worker_id="same-worker") is None


def test_worker_restart_resumes_reconcile_progress(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    for index in range(11):
        create_task(
            db_session,
            user,
            title=f"Resume {index}",
            scheduled_start=datetime.now(UTC) + timedelta(hours=index + 1),
            scheduled_end=datetime.now(UTC) + timedelta(hours=index + 2),
        )
    enqueue_user_reconciliation(db_session, user_id=user.id)
    db_session.commit()
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    first_worker_job = claim_next_job(db_session, worker_id="worker-before-restart")
    assert first_worker_job is not None
    process_claimed_job(db_session, first_worker_job, client=fake_client)
    db_session.refresh(first_worker_job)
    assert first_worker_job.status == "pending"
    assert service.ensure_utc(first_worker_job.available_at) > datetime.now(UTC)

    first_worker_job.available_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.add(first_worker_job)
    db_session.commit()

    resumed_job = claim_next_job(db_session, worker_id="worker-after-restart")
    assert resumed_job is not None
    process_claimed_job(db_session, resumed_job, client=fake_client)
    db_session.refresh(resumed_job)

    assert resumed_job.status == "done"
    assert [len(batch) for batch in fake_client.batch_requests] == [10, 1]
    assert db_session.query(GoogleEventMirror).filter_by(user_id=user.id).count() == 11


def test_reconcile_continuation_still_progresses_through_all_batches(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    for index in range(25):
        create_task(
            db_session,
            user,
            title=f"Continue {index}",
            scheduled_start=datetime.now(UTC) + timedelta(hours=index + 1),
            scheduled_end=datetime.now(UTC) + timedelta(hours=index + 2),
        )
    enqueue_user_reconciliation(db_session, user_id=user.id)
    db_session.commit()
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    while True:
        job = claim_next_job(db_session, worker_id="worker")
        assert job is not None
        process_claimed_job(db_session, job, client=fake_client)
        db_session.refresh(job)
        if job.status == "done":
            break
        job.available_at = datetime.now(UTC) - timedelta(seconds=1)
        db_session.add(job)
        db_session.commit()

    assert [len(batch) for batch in fake_client.batch_requests] == [10, 10, 5]
    assert db_session.query(GoogleEventMirror).filter_by(user_id=user.id).count() == 25


def test_worker_drains_multiple_pending_jobs_without_sleeping(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    for index in range(5):
        task = create_task(
            db_session,
            user,
            title=f"Drain {index}",
            scheduled_start=datetime.now(UTC) + timedelta(hours=index + 1),
            scheduled_end=datetime.now(UTC) + timedelta(hours=index + 2),
        )
        enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    monkeypatch.setattr(worker_module, "SessionLocal", lambda: nullcontext(db_session))

    processed_count = process_available_jobs(worker_id="worker", client=fake_client)

    assert processed_count == 5
    assert db_session.query(GoogleSyncOutbox).filter_by(status="done").count() == 5
    assert db_session.query(GoogleSyncOutbox).filter_by(status="pending").count() == 0
    assert db_session.query(GoogleEventMirror).filter_by(user_id=user.id).count() == 5


def test_worker_drain_respects_configured_job_limit(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    for index in range(4):
        task = create_task(
            db_session,
            user,
            title=f"Limited drain {index}",
            scheduled_start=datetime.now(UTC) + timedelta(hours=index + 1),
            scheduled_end=datetime.now(UTC) + timedelta(hours=index + 2),
        )
        enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    monkeypatch.setattr(worker_module, "SessionLocal", lambda: nullcontext(db_session))

    processed_count = process_available_jobs(
        worker_id="worker",
        client=fake_client,
        max_jobs=2,
    )

    assert processed_count == 2
    assert db_session.query(GoogleSyncOutbox).filter_by(status="done").count() == 2
    assert db_session.query(GoogleSyncOutbox).filter_by(status="pending").count() == 2


def test_normal_task_mutation_job_is_processed_by_worker(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = task_service.create_task(
        db_session,
        ScheduledTaskCreate(
            title="Automatic create",
            scheduled_start=datetime.now(UTC) + timedelta(hours=1),
            scheduled_end=datetime.now(UTC) + timedelta(hours=2),
        ),
        user_id=user.id,
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    monkeypatch.setattr(worker_module, "SessionLocal", lambda: nullcontext(db_session))

    assert process_available_jobs(worker_id="worker", client=fake_client) == 1

    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 1
    assert db_session.query(GoogleSyncOutbox).filter_by(status="done").count() == 1


def test_completion_and_undo_jobs_delete_and_recreate_google_event(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = task_service.create_task(
        db_session,
        ScheduledTaskCreate(
            title="Automatic completion",
            scheduled_start=datetime.now(UTC) + timedelta(hours=1),
            scheduled_end=datetime.now(UTC) + timedelta(hours=2),
        ),
        user_id=user.id,
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    monkeypatch.setattr(worker_module, "SessionLocal", lambda: nullcontext(db_session))
    process_available_jobs(worker_id="worker", client=fake_client)
    first_event_id = db_session.query(GoogleEventMirror).filter_by(task_id=task.id).one().google_event_id

    task_service.complete_task(db_session, task.id, user_id=user.id)
    assert process_available_jobs(worker_id="worker", client=fake_client) == 1
    assert first_event_id in fake_client.deleted_event_ids
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 0

    task_service.uncomplete_task(db_session, task.id, user_id=user.id)
    assert process_available_jobs(worker_id="worker", client=fake_client) == 1
    mirror = db_session.query(GoogleEventMirror).filter_by(task_id=task.id).one()
    assert mirror.google_event_id == first_event_id


def test_stale_processing_job_is_reclaimed_and_processed(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    crashed_job = claim_next_job(db_session, worker_id="crashed-worker")
    assert crashed_job is not None
    crashed_job.locked_at = datetime.now(UTC) - PROCESSING_LEASE_TIMEOUT - timedelta(seconds=1)
    db_session.add(crashed_job)
    db_session.commit()
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    reclaimed_job = claim_next_job(db_session, worker_id="replacement-worker")
    assert reclaimed_job is not None
    assert reclaimed_job.id == crashed_job.id
    assert reclaimed_job.locked_by == "replacement-worker"
    process_claimed_job(db_session, reclaimed_job, client=fake_client)
    db_session.refresh(reclaimed_job)

    assert reclaimed_job.status == "done"
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 1


def test_recent_processing_job_is_not_reclaimed(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    job = claim_next_job(db_session, worker_id="active-worker")
    assert job is not None

    assert claim_next_job(db_session, worker_id="other-worker") is None


def test_worker_crash_after_claim_can_be_completed_by_later_worker(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    claimed_job = claim_next_job(db_session, worker_id="worker-before-restart")
    assert claimed_job is not None
    claimed_job.locked_at = datetime.now(UTC) - PROCESSING_LEASE_TIMEOUT - timedelta(seconds=1)
    db_session.add(claimed_job)
    db_session.commit()
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    restarted_job = claim_next_job(db_session, worker_id="worker-after-restart")
    assert restarted_job is not None
    process_claimed_job(db_session, restarted_job, client=fake_client)

    db_session.refresh(restarted_job)
    assert restarted_job.status == "done"


def test_reclaimed_job_is_not_claimed_by_competing_worker(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    job = claim_next_job(db_session, worker_id="crashed-worker")
    assert job is not None
    job.locked_at = datetime.now(UTC) - PROCESSING_LEASE_TIMEOUT - timedelta(seconds=1)
    db_session.add(job)
    db_session.commit()

    first_reclaim = claim_next_job(db_session, worker_id="worker-a")
    second_reclaim = claim_next_job(db_session, worker_id="worker-b")

    assert first_reclaim is not None
    assert first_reclaim.id == job.id
    assert second_reclaim is None


def test_pending_and_failed_jobs_remain_claimable(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    pending_task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    failed_task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=3),
        scheduled_end=datetime.now(UTC) + timedelta(hours=4),
    )
    enqueue_task_upsert(db_session, user_id=user.id, task_id=pending_task.id)
    enqueue_task_upsert(db_session, user_id=user.id, task_id=failed_task.id)
    db_session.commit()
    failed_job = db_session.query(GoogleSyncOutbox).filter_by(task_id=failed_task.id).one()
    failed_job.status = "failed"
    failed_job.available_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.add(failed_job)
    db_session.commit()

    first_claim = claim_next_job(db_session, worker_id="worker-a")
    second_claim = claim_next_job(db_session, worker_id="worker-b")

    assert first_claim is not None
    assert second_claim is not None
    assert {first_claim.status, second_claim.status} == {"processing"}


def test_worker_processes_upsert_task_idempotently(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        title="Worker upsert",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    first_job = claim_next_job(db_session, worker_id="worker")
    assert first_job is not None
    process_claimed_job(db_session, first_job, client=fake_client)

    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    second_job = claim_next_job(db_session, worker_id="worker")
    assert second_job is not None
    process_claimed_job(db_session, second_job, client=fake_client)

    assert len(fake_client.created_event_payloads) == 1
    assert len(fake_client.updated_event_payloads) == 1
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 1


def test_retry_after_google_create_before_mapping_commit_does_not_duplicate_event(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        title="Crash after create",
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )

    original_add_event_mirror = service.add_event_mirror

    def fail_before_mapping_commit(*_args, **_kwargs) -> GoogleEventMirror:
        raise RuntimeError("simulated crash before mapping commit")

    monkeypatch.setattr(service, "add_event_mirror", fail_before_mapping_commit)
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    failed_job = claim_next_job(db_session, worker_id="worker")
    assert failed_job is not None
    process_claimed_job(db_session, failed_job, client=fake_client)
    db_session.refresh(failed_job)

    deterministic_event_id = service.build_google_event_id(user_id=user.id, task_id=task.id)
    assert failed_job.status == "failed"
    assert list(fake_client.events) == [deterministic_event_id]
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 0

    monkeypatch.setattr(service, "add_event_mirror", original_add_event_mirror)
    failed_job.available_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.add(failed_job)
    db_session.commit()
    retried_job = claim_next_job(db_session, worker_id="worker")
    assert retried_job is not None
    process_claimed_job(db_session, retried_job, client=fake_client)
    db_session.refresh(retried_job)

    mirror = db_session.query(GoogleEventMirror).filter_by(task_id=task.id).one()
    assert retried_job.status == "done"
    assert mirror.google_event_id == deterministic_event_id
    assert len(fake_client.created_event_payloads) == 1
    assert len(fake_client.updated_event_payloads) == 1
    assert list(fake_client.events) == [deterministic_event_id]


def test_worker_processes_delete_task_idempotently(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    service.sync_now(db_session, user_id=user.id, client=fake_client)
    mirror = db_session.query(GoogleEventMirror).filter_by(task_id=task.id).one()

    enqueue_task_delete(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    first_job = claim_next_job(db_session, worker_id="worker")
    assert first_job is not None
    process_claimed_job(db_session, first_job, client=fake_client)

    enqueue_task_delete(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    second_job = claim_next_job(db_session, worker_id="worker")
    assert second_job is not None
    process_claimed_job(db_session, second_job, client=fake_client)

    assert mirror.google_event_id in fake_client.deleted_event_ids
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 0
    assert all(job.status == "done" for job in db_session.query(GoogleSyncOutbox).all())


@pytest.mark.parametrize("provider_status_code", [401, 403, 429])
def test_worker_retryable_provider_failure_schedules_retry(
    db_session: Session,
    provider_status_code: int,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    fake_client.event_error = GoogleProviderError(
        "raw provider failure with token",
        status_code=provider_status_code,
    )
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    job = claim_next_job(db_session, worker_id="worker")
    assert job is not None

    process_claimed_job(db_session, job, client=fake_client)
    db_session.refresh(job)

    assert job.status == "failed"
    assert job.attempts == 1
    assert service.ensure_utc(job.available_at) > datetime.now(UTC)
    assert job.last_error == "Google Calendar sync failed"


def test_worker_revoked_auth_marks_reauth_and_stops_retrying(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.refresh_error = GoogleProviderError(
        "revoked token",
        status_code=400,
        error_code="invalid_grant",
    )
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    job = claim_next_job(db_session, worker_id="worker")
    assert job is not None

    process_claimed_job(db_session, job, client=fake_client)
    db_session.refresh(job)
    connection = service.get_connection(db_session, user_id=user.id)

    assert connection is not None
    assert connection.status == "needs_reauth"
    assert job.status == "dead"
    assert job.last_error == "Google Calendar reconnect is required"


def test_worker_generic_refresh_auth_failure_retries_without_reauth(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    connection = service.get_connection(db_session, user_id=user.id)
    assert connection is not None
    connection.last_successful_sync_at = datetime.now(UTC) - timedelta(minutes=5)
    db_session.add(connection)
    db_session.commit()
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.refresh_error = GoogleProviderError("auth endpoint failed", status_code=401)
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    job = claim_next_job(db_session, worker_id="worker")
    assert job is not None

    process_claimed_job(db_session, job, client=fake_client)
    db_session.refresh(job)
    db_session.refresh(connection)

    assert connection.google_calendar_id == "mirror-calendar-id"
    assert connection.google_calendar_summary == "TaskCalendar Mirror — Read Only"
    assert connection.last_successful_sync_at is not None
    assert connection.status == "error"
    assert connection.status != "needs_reauth"
    assert job.status == "failed"
    assert job.attempts == 1
    assert job.last_error == "Google Calendar sync failed"


def test_worker_retries_error_connection_and_recovers_on_success(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connection = connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    fake_client.event_error = GoogleProviderError("rate limited", status_code=429)
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    failed_job = claim_next_job(db_session, worker_id="worker")
    assert failed_job is not None

    process_claimed_job(db_session, failed_job, client=fake_client)
    db_session.refresh(failed_job)
    db_session.refresh(connection)
    assert connection.status == "error"
    assert failed_job.status == "failed"
    assert failed_job.last_error == "Google Calendar sync failed"

    fake_client.event_error = None
    failed_job.available_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.add(failed_job)
    db_session.commit()
    retried_job = claim_next_job(db_session, worker_id="worker")
    assert retried_job is not None

    process_claimed_job(db_session, retried_job, client=fake_client)
    db_session.refresh(retried_job)
    db_session.refresh(connection)

    assert fake_client.refreshed_tokens == ["refresh-token", "refresh-token"]
    assert retried_job.status == "done"
    assert connection.status == "connected"
    assert connection.last_error is None
    assert connection.last_successful_sync_at is not None
    assert fake_client.created_calendars == 0
    assert db_session.query(GoogleEventMirror).filter_by(task_id=task.id).count() == 1


def test_worker_error_connection_repeated_provider_failure_stays_recoverable(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connection = connect_google_calendar(db_session, user)
    connection.status = "error"
    connection.last_error = service.SAFE_LAST_ERROR
    db_session.add(connection)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    fake_client.event_error = GoogleProviderError("temporary forbidden", status_code=403)
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    job = claim_next_job(db_session, worker_id="worker")
    assert job is not None

    process_claimed_job(db_session, job, client=fake_client)
    db_session.refresh(job)
    db_session.refresh(connection)

    assert fake_client.refreshed_tokens == ["refresh-token"]
    assert connection.status == "error"
    assert connection.status != "needs_reauth"
    assert job.status == "failed"
    assert job.attempts == 1
    assert job.last_error == "Google Calendar sync failed"


def test_worker_error_connection_invalid_grant_marks_reauth(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connection = connect_google_calendar(db_session, user)
    connection.status = "error"
    connection.last_error = service.SAFE_LAST_ERROR
    db_session.add(connection)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.refresh_error = GoogleProviderError(
        "revoked token",
        status_code=400,
        error_code="invalid_grant",
    )
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    job = claim_next_job(db_session, worker_id="worker")
    assert job is not None

    process_claimed_job(db_session, job, client=fake_client)
    db_session.refresh(job)
    db_session.refresh(connection)

    assert connection.status == "needs_reauth"
    assert job.status == "dead"
    assert job.last_error == "Google Calendar reconnect is required"


def test_worker_needs_reauth_remains_blocked_without_google_request(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connection = connect_google_calendar(db_session, user)
    connection.status = "needs_reauth"
    connection.last_error = service.SAFE_LAST_ERROR
    db_session.add(connection)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    job = claim_next_job(db_session, worker_id="worker")
    assert job is not None

    process_claimed_job(db_session, job, client=fake_client)
    db_session.refresh(job)
    db_session.refresh(connection)

    assert fake_client.refreshed_tokens == []
    assert connection.status == "needs_reauth"
    assert job.status == "dead"
    assert job.last_error == "Google Calendar reconnect is required"


def test_worker_logs_safe_failure_classification(
    db_session: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = GoogleCalendarResource(
        id="mirror-calendar-id",
        summary="TaskCalendar Mirror — Read Only",
    )
    fake_client.event_error = GoogleProviderError(
        "raw provider failure with access-token-secret",
        status_code=403,
        error_code="PERMISSION_DENIED",
        error_reason="access-token-secret",
    )
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    job = claim_next_job(db_session, worker_id="worker")
    assert job is not None

    with caplog.at_level(logging.WARNING, logger=worker_module.logger.name):
        process_claimed_job(db_session, job, client=fake_client)

    record = next(
        record
        for record in caplog.records
        if "google_sync_job_failed" in record.message
    )
    payload = json.loads(record.message)
    elapsed_ms = payload.pop("elapsed_ms")
    assert isinstance(elapsed_ms, int)
    assert payload == {
        "attempts": 1,
        "event": "google_sync_job_failed",
        "exception_class": "GoogleProviderError",
        "failure_reason": "Google Calendar sync failed",
        "job_id": str(job.id),
        "job_status": "failed",
        "operation": "upsert_task",
        "provider_error_code": "PERMISSION_DENIED",
        "provider_error_reason": "[redacted]",
        "provider_status_code": 403,
        "reconcile_batch_size": None,
        "reconcile_phase": None,
        "reconcile_progress_state": None,
        "resulting_connection_status": "error",
        "retryable": True,
        "timeout_source": None,
    }
    assert record.operation == "upsert_task"
    assert record.job_id == str(job.id)
    assert record.exception_class == "GoogleProviderError"
    assert record.provider_status_code == 403
    assert record.provider_error_code == "PERMISSION_DENIED"
    assert record.provider_error_reason == "access-token-secret"
    assert record.connection_status == "error"
    assert record.retryable is True
    assert "raw provider failure" not in record.message
    assert "access-token-secret" not in record.message


def test_worker_missing_mirror_calendar_marks_error(db_session: Session) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    task = create_task(
        db_session,
        user,
        scheduled_start=datetime.now(UTC) + timedelta(hours=1),
        scheduled_end=datetime.now(UTC) + timedelta(hours=2),
    )
    fake_client = FakeGoogleClient()
    fake_client.existing_calendar = None
    enqueue_task_upsert(db_session, user_id=user.id, task_id=task.id)
    db_session.commit()
    job = claim_next_job(db_session, worker_id="worker")
    assert job is not None

    process_claimed_job(db_session, job, client=fake_client)
    db_session.refresh(job)
    connection = service.get_connection(db_session, user_id=user.id)

    assert connection is not None
    assert connection.status == "error"
    assert job.status == "dead"
    assert job.last_error == "Google mirror calendar is missing"


def test_pending_job_count_is_status_scoped_per_user(db_session: Session) -> None:
    alice = create_user(db_session, "alice")
    bob = create_user(db_session, "bob")
    connect_google_calendar(db_session, alice)
    connect_google_calendar(db_session, bob, calendar_id="bob-calendar")
    enqueue_user_reconciliation(db_session, user_id=alice.id)
    db_session.commit()

    alice_status = get_google_calendar_status(db_session, current_user=alice)
    bob_status = get_google_calendar_status(db_session, current_user=bob)

    assert alice_status.pending_sync_items == 1
    assert alice_status.processing_sync_items == 0
    assert alice_status.retrying_sync_items == 1
    assert bob_status.pending_sync_items == 0
    assert bob_status.processing_sync_items == 0
    assert bob_status.retrying_sync_items == 0


def test_google_status_splits_active_processing_and_retry_counts(
    db_session: Session,
) -> None:
    user = create_user(db_session)
    connect_google_calendar(db_session, user)
    pending_job = GoogleSyncOutbox(
        user_id=user.id,
        operation="reconcile_user",
        status="pending",
        priority=40,
        available_at=datetime.now(UTC),
    )
    failed_job = GoogleSyncOutbox(
        user_id=user.id,
        operation="reconcile_user",
        status="failed",
        priority=40,
        attempts=2,
        available_at=datetime.now(UTC) + timedelta(minutes=2),
    )
    processing_job = GoogleSyncOutbox(
        user_id=user.id,
        operation="reconcile_user",
        status="processing",
        priority=40,
        locked_at=datetime.now(UTC),
        locked_by="worker",
        available_at=datetime.now(UTC),
    )
    dead_job = GoogleSyncOutbox(
        user_id=user.id,
        operation="reconcile_user",
        status="dead",
        priority=40,
        attempts=6,
        available_at=datetime.now(UTC),
        processed_at=datetime.now(UTC),
    )
    db_session.add_all([pending_job, failed_job, processing_job, dead_job])
    db_session.commit()

    status = get_google_calendar_status(db_session, current_user=user)

    assert status.pending_sync_items == 3
    assert status.processing_sync_items == 1
    assert status.retrying_sync_items == 2
