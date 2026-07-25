from __future__ import annotations

import socket
import uuid
from collections.abc import Callable, Generator
from contextlib import contextmanager
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.models import AppSettings
from app.core.database import Base
from app.models.daily_todo_notification import DailyTodoNotification
from app.models.scheduled_task import ScheduledTask
from app.models.user import User
from app.tasks.daily_todo_delivery import (
    DailyNotificationProcessingResult,
    process_available_daily_todo_notifications,
)
from app.tasks.notifications import DiscordWebhookError


def test_process_available_returns_cleanly_when_nothing_claimable(
    db_session: Session,
) -> None:
    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    assert result == DailyNotificationProcessingResult(claim_misses=1)


def test_process_available_respects_max_jobs(db_session: Session, user: User) -> None:
    settings = create_settings(db_session, user)
    for index in range(3):
        create_record(db_session, user, local_date=date(2026, 7, 25 + index))
        create_task(db_session, user, title=f"Task {index}")
    sent_messages: list[str] = []

    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        max_jobs=2,
        sender=lambda _url, message: sent_messages.append(message),
    )

    assert settings.daily_todo_notification_enabled is True
    assert result.claimed == 2
    assert result.sent + result.skipped == 2
    assert len(sent_messages) == 1
    assert (
        len(
            db_session.scalars(
                select(DailyTodoNotification).where(
                    DailyTodoNotification.status == "pending",
                )
            ).all()
        )
        == 1
    )


def test_multiple_jobs_continue_after_one_failure(db_session: Session, user: User) -> None:
    create_settings(db_session, user)
    first = create_record(db_session, user, local_date=date(2026, 7, 25))
    other_user = User(username="other", timezone="UTC")
    db_session.add(other_user)
    db_session.commit()
    create_settings(db_session, other_user)
    second = create_record(db_session, other_user, local_date=date(2026, 7, 25))
    create_task(db_session, user, title="Task")
    create_task(db_session, other_user, title="Other task")
    calls = 0

    def sender(_url: str, _message: str) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise TimeoutError("timed out")

    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        max_jobs=2,
        sender=sender,
    )

    db_session.refresh(first)
    db_session.refresh(second)
    assert result.failed == 1
    assert result.sent == 1
    assert first.status == "failed"
    assert second.status == "sent"


def test_disabled_toggle_marks_cancelled_and_sends_nothing(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user, enabled=False)
    record = create_record(db_session, user)
    create_task(db_session, user, title="Task")
    sent = False

    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=lambda _url, _message: set_sent_flag(),
    )

    db_session.refresh(record)
    assert sent is False
    assert result.cancelled == 1
    assert record.status == "cancelled"
    assert record.status_reason == "Daily todo notification disabled"

    def set_sent_flag() -> None:
        nonlocal sent
        sent = True


def test_missing_settings_row_is_created_default_and_cancelled(
    db_session: Session,
    user: User,
) -> None:
    record = create_record(db_session, user)
    create_task(db_session, user, title="Task")

    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=raising_sender,
    )

    db_session.refresh(record)
    settings = db_session.scalar(select(AppSettings).where(AppSettings.user_id == user.id))
    assert settings is not None
    assert settings.daily_todo_notification_enabled is False
    assert result.cancelled == 1
    assert record.status == "cancelled"


def test_missing_or_blank_webhook_marks_skipped(db_session: Session, user: User) -> None:
    settings = create_settings(db_session, user, webhook_url="   ")
    record = create_record(db_session, user)
    create_task(db_session, user, title="Task")

    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=raising_sender,
    )

    db_session.refresh(record)
    assert settings.discord_webhook_url == "   "
    assert result.skipped == 1
    assert record.status == "skipped"
    assert record.status_reason == "Discord webhook URL missing"


def test_invalid_stored_record_timezone_marks_skipped(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user)
    record = create_record(db_session, user, timezone="Not/A_Zone")
    create_task(db_session, user, title="Task")

    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=raising_sender,
    )

    db_session.refresh(record)
    assert result.skipped == 1
    assert record.status == "skipped"
    assert record.status_reason == "Daily notification timezone is invalid"


def test_no_relevant_tasks_marks_skipped(db_session: Session, user: User) -> None:
    create_settings(db_session, user)
    record = create_record(db_session, user)

    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=raising_sender,
    )

    db_session.refresh(record)
    assert result.skipped == 1
    assert record.status == "skipped"
    assert record.status_reason == "No relevant tasks"


def test_selection_uses_record_snapshot_values(
    db_session: Session,
    user: User,
    monkeypatch,
) -> None:
    create_settings(db_session, user)
    record = create_record(
        db_session,
        user,
        local_date=date(2026, 7, 24),
        timezone="Asia/Taipei",
        scheduled_for=parse_dt("2026-07-24T00:00:00+00:00"),
    )
    user.timezone = "UTC"
    db_session.add(user)
    db_session.commit()
    captured: dict[str, object] = {}

    def fake_select(db, *, user_id, local_date, timezone, snapshot_time):
        from app.tasks.daily_todo_digest import DailyTodoItem, DailyTodoSelection

        captured.update(
            {
                "user_id": user_id,
                "local_date": local_date,
                "timezone": timezone,
                "snapshot_time": snapshot_time,
            }
        )
        return DailyTodoSelection(
            today=(
                DailyTodoItem(
                    task_id=uuid.uuid4(),
                    title="Snapshot task",
                    kind="due",
                    sort_at=parse_dt("2026-07-24T00:00:00+00:00"),
                    due_at=parse_dt("2026-07-24T00:00:00+00:00"),
                ),
            ),
            overdue=(),
        )

    monkeypatch.setattr("app.tasks.daily_todo_delivery.select_daily_todo_tasks", fake_select)

    process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=lambda _url, _message: None,
    )

    assert captured == {
        "user_id": record.user_id,
        "local_date": date(2026, 7, 24),
        "timezone": "Asia/Taipei",
        "snapshot_time": parse_dt("2026-07-24T00:00:00+00:00").replace(tzinfo=None),
    }


def test_sends_exact_digest_and_ignores_single_task_template(
    db_session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.tasks.daily_todo_delivery.settings.app_base_url", None)
    settings = create_settings(db_session, user)
    settings.discord_message_template = "Task {title}"
    db_session.add(settings)
    create_record(db_session, user)
    create_task(db_session, user, title="Digest task")
    sent_messages: list[str] = []

    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=lambda _url, message: sent_messages.append(message),
        app_url=None,
    )

    assert result.sent == 1
    assert sent_messages == [
        "Daily todo notification - 2026-07-25\n\nToday\n- Due 09:00 Digest task"
    ]


def test_includes_configured_app_url_when_provided(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user)
    create_record(db_session, user)
    create_task(db_session, user, title="Digest task")
    sent_messages: list[str] = []

    process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=lambda _url, message: sent_messages.append(message),
        app_url="https://calendar.example/",
    )

    assert sent_messages[0].endswith("Open app: https://calendar.example")


def test_truncated_digest_output_is_sent_without_alteration(
    db_session: Session,
    user: User,
    monkeypatch,
) -> None:
    create_settings(db_session, user)
    create_record(db_session, user)
    create_task(db_session, user, title="Task")
    sent_messages: list[str] = []

    def fake_build(*args, **kwargs):
        from app.tasks.daily_todo_digest import DailyTodoDigest

        return DailyTodoDigest(message="truncated\n...and 7 more tasks", omitted_count=7)

    monkeypatch.setattr("app.tasks.daily_todo_delivery.build_daily_todo_digest", fake_build)

    process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=lambda _url, message: sent_messages.append(message),
    )

    assert sent_messages == ["truncated\n...and 7 more tasks"]


def test_successful_delivery_marks_sent_and_clears_lock(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user)
    record = create_record(db_session, user)
    create_task(db_session, user, title="Task")

    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=lambda _url, _message: None,
    )

    db_session.refresh(record)
    assert result.sent == 1
    assert record.status == "sent"
    assert record.sent_at == parse_dt("2026-07-25T08:00:00+00:00").replace(tzinfo=None)
    assert record.locked_at is None
    assert record.locked_by is None
    assert record.attempts == 1


def test_retryable_delivery_failures_mark_failed(
    db_session: Session,
    user: User,
) -> None:
    for exc in [
        OSError("network unreachable"),
        socket.gaierror("name lookup failed"),
        TimeoutError("timed out"),
        DiscordWebhookError("Discord webhook failed with 429", status_code=429, retryable=True),
        DiscordWebhookError("Discord webhook failed with 500", status_code=500, retryable=True),
        DiscordWebhookError("Discord webhook failed with 502", status_code=502, retryable=True),
        DiscordWebhookError("Discord webhook failed with 503", status_code=503, retryable=True),
    ]:
        db_session.rollback()
        clear_daily_data(db_session)
        create_settings(db_session, user)
        record = create_record(db_session, user)
        create_task(db_session, user, title="Task")

        result = process_available_daily_todo_notifications(
            session_factory(db_session),
            worker_id="worker",
            now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
            sender=lambda _url, _message, exc=exc: (_ for _ in ()).throw(exc),
        )

        db_session.refresh(record)
        assert result.failed == 1
        assert record.status == "failed"
        assert record.available_at == parse_dt("2026-07-25T08:00:30+00:00").replace(tzinfo=None)
        assert record.locked_at is None
        assert record.locked_by is None


def test_retryable_failure_at_max_attempts_transitions_to_dead(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user)
    record = create_record(db_session, user, attempts=5)
    create_task(db_session, user, title="Task")

    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=lambda _url, _message: (_ for _ in ()).throw(TimeoutError("timed out")),
    )

    db_session.refresh(record)
    assert result.dead == 1
    assert record.status == "dead"
    assert record.attempts == 6
    assert record.status_reason == "Maximum retry attempts exhausted"


def test_permanent_failures_mark_dead_without_leaking_webhook_url(
    db_session: Session,
    user: User,
) -> None:
    for status_code in [400, 401, 403, 404, 418]:
        db_session.rollback()
        clear_daily_data(db_session)
        create_settings(db_session, user, webhook_url="https://discord.example/secret-token")
        record = create_record(db_session, user)
        create_task(db_session, user, title="Task")

        result = process_available_daily_todo_notifications(
            session_factory(db_session),
            worker_id="worker",
            now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
            sender=lambda _url, _message, status_code=status_code: (_ for _ in ()).throw(
                DiscordWebhookError(
                    f"Discord webhook failed with {status_code} at https://discord.example/secret-token",
                    status_code=status_code,
                    retryable=False,
                )
            ),
        )

        db_session.refresh(record)
        assert result.dead == 1
        assert record.status == "dead"
        assert "secret-token" not in (record.last_error or "")
        assert "[redacted-url]" in (record.last_error or "")


def test_malformed_webhook_url_marks_dead_without_sending(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user, webhook_url="not-a-url-secret")
    record = create_record(db_session, user)
    create_task(db_session, user, title="Task")

    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=raising_sender,
    )

    db_session.refresh(record)
    assert result.dead == 1
    assert record.status == "dead"
    assert record.last_error == "Discord webhook URL is invalid"
    assert "not-a-url-secret" not in (record.last_error or "")


def test_lost_ownership_does_not_overwrite_state(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user)
    record = create_record(db_session, user)
    create_task(db_session, user, title="Task")

    def sender(_url: str, _message: str) -> None:
        db_session.refresh(record)
        record.locked_by = "other-worker"
        db_session.add(record)
        db_session.commit()

    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=sender,
    )

    db_session.refresh(record)
    assert result.finalization_conflicts == 1
    assert record.status == "processing"
    assert record.locked_by == "other-worker"


def test_stale_processing_record_remains_reclaimable_by_queue_helper(
    db_session: Session,
    user: User,
) -> None:
    from app.tasks.daily_notifications import claim_next_daily_notification

    create_settings(db_session, user)
    record = create_record(
        db_session,
        user,
        status="processing",
        attempts=1,
        locked_by="old-worker",
        locked_at=parse_dt("2026-07-25T07:54:00+00:00"),
    )

    claimed = claim_next_daily_notification(
        db_session,
        worker_id="new-worker",
        now=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    assert claimed is not None
    assert claimed.id == record.id
    assert claimed.locked_by == "new-worker"


def test_sender_runs_after_claim_session_is_closed(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user)
    record = create_record(db_session, user)
    create_task(db_session, user, title="Task")

    def sender(_url: str, _message: str) -> None:
        db_session.refresh(record)
        assert record.status == "processing"
        assert record.locked_by == "worker"

    result = process_available_daily_todo_notifications(
        session_factory(db_session),
        worker_id="worker",
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
        sender=sender,
    )

    assert result.sent == 1


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


@pytest.fixture()
def user(db_session: Session) -> User:
    user = User(username=f"user-{uuid.uuid4()}", timezone="UTC")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def create_settings(
    db_session: Session,
    user: User,
    *,
    enabled: bool = True,
    webhook_url: str | None = "https://discord.example/webhook",
) -> AppSettings:
    settings = AppSettings(
        user_id=user.id,
        discord_webhook_url=webhook_url,
        discord_message_template=None,
        working_hours_start="08:00",
        week_start="sunday",
        daily_todo_notification_enabled=enabled,
    )
    db_session.add(settings)
    db_session.commit()
    db_session.refresh(settings)
    return settings


def create_record(
    db_session: Session,
    user: User,
    *,
    local_date: date = date(2026, 7, 25),
    timezone: str = "UTC",
    scheduled_for: datetime | None = None,
    status: str = "pending",
    attempts: int = 0,
    locked_at: datetime | None = None,
    locked_by: str | None = None,
) -> DailyTodoNotification:
    scheduled_for = scheduled_for or parse_dt("2026-07-25T08:00:00+00:00")
    record = DailyTodoNotification(
        user_id=user.id,
        local_date=local_date,
        timezone=timezone,
        scheduled_for=scheduled_for,
        status=status,
        attempts=attempts,
        available_at=scheduled_for,
        locked_at=locked_at,
        locked_by=locked_by,
        created_at=parse_dt("2026-07-25T07:00:00+00:00"),
        updated_at=parse_dt("2026-07-25T07:00:00+00:00"),
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def create_task(db_session: Session, user: User, *, title: str) -> ScheduledTask:
    task = ScheduledTask(
        user_id=user.id,
        title=title,
        completed=False,
        due_at=parse_dt("2026-07-25T09:00:00+00:00"),
        timezone=user.timezone or "UTC",
        notification_enabled=False,
        notification_offset_minutes=0,
        created_at=parse_dt("2026-07-20T00:00:00+00:00"),
        updated_at=parse_dt("2026-07-20T00:00:00+00:00"),
    )
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)
    return task


def clear_daily_data(db_session: Session) -> None:
    db_session.query(DailyTodoNotification).delete()
    db_session.query(ScheduledTask).delete()
    db_session.query(AppSettings).delete()
    db_session.commit()


def session_factory(db_session: Session) -> Callable[[], object]:
    @contextmanager
    def factory() -> Generator[Session, None, None]:
        yield db_session

    return factory


def raising_sender(_url: str, _message: str) -> None:
    raise AssertionError("sender should not be called")


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(UTC)
