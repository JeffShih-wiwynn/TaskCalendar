from __future__ import annotations

import uuid
from collections.abc import Callable, Generator
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.config import settings
from app.core.database import Base
from app.models.app_settings import AppSettings
from app.models.daily_todo_notification import DailyTodoNotification
from app.models.user import User
from app.tasks import daily_notifications


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


def test_create_daily_notification_record_creates_pending_record(
    db_session: Session,
    user: User,
) -> None:
    scheduled_for = parse_dt("2026-07-25T00:00:00+00:00")
    available_at = parse_dt("2026-07-25T00:00:00+00:00")

    record = daily_notifications.create_daily_notification_record(
        db_session,
        user_id=user.id,
        local_date=date(2026, 7, 25),
        timezone="Asia/Taipei",
        scheduled_for=scheduled_for,
        available_at=available_at,
    )

    assert record.status == "pending"
    assert record.attempts == 0
    assert record.local_date == date(2026, 7, 25)
    assert record.timezone == "Asia/Taipei"
    assert record.scheduled_for == scheduled_for.replace(tzinfo=None)
    assert record.available_at == available_at.replace(tzinfo=None)


def test_scanner_toggle_disabled_creates_nothing(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user, enabled=False)

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    assert result.users_examined == 0
    assert result.records_created == 0
    assert count_records(db_session) == 0


def test_scanner_before_working_hours_start_creates_nothing(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user, working_hours_start="08:00")
    user.timezone = "UTC"
    db_session.add(user)
    db_session.commit()

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T07:59:59+00:00"),
    )

    assert result.users_examined == 1
    assert result.before_schedule == 1
    assert result.records_created == 0
    assert count_records(db_session) == 0


def test_scanner_exactly_at_working_hours_start_creates_pending_record(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user, working_hours_start="08:00")

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    record = db_session.scalar(select(DailyTodoNotification))
    assert result.records_created == 1
    assert record is not None
    assert record.status == "pending"
    assert record.attempts == 0
    assert record.local_date == date(2026, 7, 25)
    assert record.timezone == "UTC"
    assert record.scheduled_for == parse_dt("2026-07-25T08:00:00+00:00").replace(
        tzinfo=None,
    )
    assert record.available_at == record.scheduled_for


def test_scanner_inside_grace_window_creates_one_record(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user, working_hours_start="08:00")

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T08:14:59+00:00"),
    )

    assert result.records_created == 1
    assert count_records(db_session) == 1


def test_scanner_at_grace_window_end_creates_nothing(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user, working_hours_start="08:00")

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T08:15:00+00:00"),
    )

    assert result.outside_grace_window == 1
    assert result.records_created == 0
    assert count_records(db_session) == 0


def test_scanner_after_grace_window_creates_nothing(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user, working_hours_start="08:00")

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T09:00:00+00:00"),
    )

    assert result.outside_grace_window == 1
    assert result.records_created == 0
    assert count_records(db_session) == 0


def test_scanner_repeated_runs_create_only_one_record(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user, working_hours_start="08:00")
    factory = session_factory(db_session)

    first = daily_notifications.enqueue_due_daily_todo_notifications(
        factory,
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
    )
    second = daily_notifications.enqueue_due_daily_todo_notifications(
        factory,
        now_utc=parse_dt("2026-07-25T08:05:00+00:00"),
    )

    assert first.records_created == 1
    assert second.duplicates_ignored == 1
    assert count_records(db_session) == 1


def test_scanner_uses_user_timezone_with_local_date_different_from_utc(
    db_session: Session,
    user: User,
) -> None:
    user.timezone = "Asia/Taipei"
    db_session.add(user)
    create_settings(db_session, user, working_hours_start="08:00")

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-24T00:05:00+00:00"),
    )

    record = db_session.scalar(select(DailyTodoNotification))
    assert result.records_created == 1
    assert record is not None
    assert record.local_date == date(2026, 7, 24)
    assert record.timezone == "Asia/Taipei"
    assert record.scheduled_for == parse_dt("2026-07-24T00:00:00+00:00").replace(
        tzinfo=None,
    )


def test_scanner_missing_timezone_uses_app_timezone(
    db_session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "app_timezone", "Asia/Taipei")
    user.timezone = None
    db_session.add(user)
    create_settings(db_session, user, working_hours_start="08:00")

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T00:05:00+00:00"),
    )

    record = db_session.scalar(select(DailyTodoNotification))
    assert result.users_examined == 1
    assert result.invalid_timezone == 0
    assert result.records_created == 1
    assert record is not None
    assert record.timezone == "Asia/Taipei"
    assert record.local_date == date(2026, 7, 25)
    assert record.scheduled_for == parse_dt("2026-07-25T00:00:00+00:00").replace(
        tzinfo=None,
    )


def test_scanner_blank_timezone_uses_app_timezone(
    db_session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "app_timezone", "Asia/Taipei")
    user.timezone = " "
    db_session.add(user)
    create_settings(db_session, user, working_hours_start="08:00")

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T00:05:00+00:00"),
    )

    record = db_session.scalar(select(DailyTodoNotification))
    assert result.invalid_timezone == 0
    assert result.records_created == 1
    assert record is not None
    assert record.timezone == "Asia/Taipei"


def test_scanner_invalid_timezone_skips_without_aborting(
    db_session: Session,
    user: User,
) -> None:
    user.timezone = "Not/A_Zone"
    db_session.add(user)
    create_settings(db_session, user, working_hours_start="08:00")
    other_user = create_user(db_session, "other")
    create_settings(db_session, other_user, working_hours_start="08:00")

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    assert result.invalid_timezone == 1
    assert result.records_created == 1
    assert count_records(db_session) == 1


def test_scanner_invalid_working_hours_skips_without_aborting(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user, working_hours_start="99:99")
    other_user = create_user(db_session, "other")
    create_settings(db_session, other_user, working_hours_start="08:00")

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    assert result.invalid_working_hours == 1
    assert result.records_created == 1
    assert count_records(db_session) == 1


def test_scanner_evaluates_different_working_hours_independently(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user, working_hours_start="08:00")
    later_user = create_user(db_session, "later")
    create_settings(db_session, later_user, working_hours_start="09:00")

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T08:05:00+00:00"),
    )

    assert result.records_created == 1
    assert result.before_schedule == 1
    assert count_records(db_session) == 1


def test_scanner_enabling_within_grace_window_creates_record(
    db_session: Session,
    user: User,
) -> None:
    settings = create_settings(db_session, user, enabled=False, working_hours_start="08:00")
    settings.daily_todo_notification_enabled = True
    db_session.add(settings)
    db_session.commit()

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T08:05:00+00:00"),
    )

    assert result.records_created == 1


def test_scanner_enabling_after_grace_window_does_not_create_record(
    db_session: Session,
    user: User,
) -> None:
    settings = create_settings(db_session, user, enabled=False, working_hours_start="08:00")
    settings.daily_todo_notification_enabled = True
    db_session.add(settings)
    db_session.commit()

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T08:30:00+00:00"),
    )

    assert result.outside_grace_window == 1
    assert result.records_created == 0


def test_scanner_working_hours_change_before_creation_is_respected(
    db_session: Session,
    user: User,
) -> None:
    settings = create_settings(db_session, user, working_hours_start="09:00")
    first = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T08:05:00+00:00"),
    )
    settings.working_hours_start = "08:00"
    db_session.add(settings)
    db_session.commit()

    second = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T08:05:00+00:00"),
    )

    assert first.before_schedule == 1
    assert second.records_created == 1


def test_scanner_timezone_change_before_creation_uses_new_timezone(
    db_session: Session,
    user: User,
) -> None:
    user.timezone = "UTC"
    db_session.add(user)
    create_settings(db_session, user, working_hours_start="08:00")
    user.timezone = "Asia/Taipei"
    db_session.add(user)
    db_session.commit()

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T00:05:00+00:00"),
    )

    record = db_session.scalar(select(DailyTodoNotification))
    assert result.records_created == 1
    assert record is not None
    assert record.timezone == "Asia/Taipei"
    assert record.local_date == date(2026, 7, 25)


def test_scanner_existing_record_prevents_another_after_settings_change(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user, working_hours_start="08:00")
    create_record(db_session, user, local_date=date(2026, 7, 25), timezone="UTC")
    user.timezone = "Europe/Berlin"
    db_session.add(user)
    db_session.commit()

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T06:05:00+00:00"),
    )

    assert result.duplicates_ignored == 1
    assert result.records_created == 0
    assert count_records(db_session) == 1


def test_scanner_record_does_not_store_webhook_configuration(
    db_session: Session,
    user: User,
) -> None:
    settings = create_settings(db_session, user, working_hours_start="08:00")
    settings.discord_webhook_url = "https://discord.example/webhook"
    db_session.add(settings)
    db_session.commit()

    daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    record = db_session.scalar(select(DailyTodoNotification))
    assert record is not None
    assert not hasattr(record, "discord_webhook_url")


def test_scanner_duplicate_existing_record_does_not_abort_other_users(
    db_session: Session,
    user: User,
) -> None:
    create_settings(db_session, user, working_hours_start="08:00")
    create_record(db_session, user, local_date=date(2026, 7, 25), timezone="UTC")
    other_user = create_user(db_session, "other")
    create_settings(db_session, other_user, working_hours_start="08:00")

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    assert result.duplicates_ignored == 1
    assert result.records_created == 1
    assert count_records(db_session) == 2


def test_scanner_dst_observing_timezone_uses_zoneinfo_conversion(
    db_session: Session,
    user: User,
) -> None:
    user.timezone = "America/New_York"
    db_session.add(user)
    create_settings(db_session, user, working_hours_start="08:00")

    result = daily_notifications.enqueue_due_daily_todo_notifications(
        session_factory(db_session),
        now_utc=parse_dt("2026-07-01T12:05:00+00:00"),
    )

    record = db_session.scalar(select(DailyTodoNotification))
    assert result.records_created == 1
    assert record is not None
    assert record.local_date == date(2026, 7, 1)
    assert record.timezone == "America/New_York"
    assert record.scheduled_for == parse_dt("2026-07-01T12:00:00+00:00").replace(
        tzinfo=None,
    )


def test_create_daily_notification_record_returns_existing_duplicate(
    db_session: Session,
    user: User,
) -> None:
    first = create_record(db_session, user)
    second = daily_notifications.create_daily_notification_record(
        db_session,
        user_id=user.id,
        local_date=first.local_date,
        timezone="Europe/Berlin",
        scheduled_for=parse_dt("2026-07-25T05:00:00+00:00"),
        available_at=parse_dt("2026-07-25T05:00:00+00:00"),
    )

    count = db_session.scalar(select(func.count()).select_from(DailyTodoNotification))

    assert second.id == first.id
    assert count == 1
    assert second.timezone == "UTC"


def test_claim_next_daily_notification_claims_available_pending_record(
    db_session: Session,
    user: User,
) -> None:
    record = create_record(
        db_session,
        user,
        available_at=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    claimed = daily_notifications.claim_next_daily_notification(
        db_session,
        worker_id="worker-a",
        now=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    assert claimed is not None
    assert claimed.id == record.id
    assert claimed.status == "processing"
    assert claimed.locked_at == parse_dt("2026-07-25T08:00:00+00:00").replace(tzinfo=None)
    assert claimed.locked_by == "worker-a"
    assert claimed.attempts == 1


def test_claim_next_daily_notification_does_not_claim_future_pending_record(
    db_session: Session,
    user: User,
) -> None:
    create_record(
        db_session,
        user,
        available_at=parse_dt("2026-07-25T09:00:00+00:00"),
    )

    claimed = daily_notifications.claim_next_daily_notification(
        db_session,
        worker_id="worker-a",
        now=parse_dt("2026-07-25T08:59:59+00:00"),
    )

    assert claimed is None


def test_claim_next_daily_notification_claims_available_failed_record(
    db_session: Session,
    user: User,
) -> None:
    record = create_record(
        db_session,
        user,
        status="failed",
        attempts=1,
        available_at=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    claimed = daily_notifications.claim_next_daily_notification(
        db_session,
        worker_id="worker-a",
        now=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    assert claimed is not None
    assert claimed.id == record.id
    assert claimed.status == "processing"
    assert claimed.attempts == 2


def test_claim_next_daily_notification_does_not_claim_non_stale_processing_record(
    db_session: Session,
    user: User,
) -> None:
    create_record(
        db_session,
        user,
        status="processing",
        attempts=1,
        locked_at=parse_dt("2026-07-25T07:56:00+00:00"),
        locked_by="worker-a",
    )

    claimed = daily_notifications.claim_next_daily_notification(
        db_session,
        worker_id="worker-b",
        now=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    assert claimed is None


def test_claim_next_daily_notification_reclaims_stale_processing_record(
    db_session: Session,
    user: User,
) -> None:
    record = create_record(
        db_session,
        user,
        status="processing",
        attempts=1,
        locked_at=parse_dt("2026-07-25T07:54:59+00:00"),
        locked_by="worker-a",
    )

    claimed = daily_notifications.claim_next_daily_notification(
        db_session,
        worker_id="worker-b",
        now=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    assert claimed is not None
    assert claimed.id == record.id
    assert claimed.locked_by == "worker-b"
    assert claimed.attempts == 2


def test_sequential_claims_cannot_claim_same_active_record_twice(
    db_session: Session,
    user: User,
) -> None:
    create_record(db_session, user)

    first = daily_notifications.claim_next_daily_notification(
        db_session,
        worker_id="worker-a",
        now=parse_dt("2026-07-25T08:00:00+00:00"),
    )
    second = daily_notifications.claim_next_daily_notification(
        db_session,
        worker_id="worker-b",
        now=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    assert first is not None
    assert second is None


def test_matching_worker_can_mark_sent(db_session: Session, user: User) -> None:
    claimed = claim_record(db_session, user)

    finalized = daily_notifications.mark_daily_notification_sent(
        db_session,
        record_id=claimed.id,
        worker_id="worker-a",
        sent_at=parse_dt("2026-07-25T08:01:00+00:00"),
    )

    assert finalized is not None
    assert finalized.status == "sent"
    assert finalized.sent_at == parse_dt("2026-07-25T08:01:00+00:00").replace(tzinfo=None)
    assert finalized.locked_at is None
    assert finalized.locked_by is None
    assert finalized.last_error is None
    assert finalized.status_reason is None


def test_matching_worker_can_mark_skipped(db_session: Session, user: User) -> None:
    claimed = claim_record(db_session, user)

    finalized = daily_notifications.mark_daily_notification_skipped(
        db_session,
        record_id=claimed.id,
        worker_id="worker-a",
        reason="No relevant tasks",
        skipped_at=parse_dt("2026-07-25T08:01:00+00:00"),
    )

    assert finalized is not None
    assert finalized.status == "skipped"
    assert finalized.skipped_at == parse_dt("2026-07-25T08:01:00+00:00").replace(tzinfo=None)
    assert finalized.status_reason == "No relevant tasks"
    assert finalized.locked_at is None
    assert finalized.locked_by is None


def test_matching_worker_can_mark_cancelled(db_session: Session, user: User) -> None:
    claimed = claim_record(db_session, user)

    finalized = daily_notifications.mark_daily_notification_cancelled(
        db_session,
        record_id=claimed.id,
        worker_id="worker-a",
        reason="Daily todo notification disabled",
        cancelled_at=parse_dt("2026-07-25T08:01:00+00:00"),
    )

    assert finalized is not None
    assert finalized.status == "cancelled"
    assert finalized.cancelled_at == parse_dt("2026-07-25T08:01:00+00:00").replace(tzinfo=None)
    assert finalized.status_reason == "Daily todo notification disabled"
    assert finalized.locked_at is None
    assert finalized.locked_by is None


def test_matching_worker_can_mark_failed_with_future_available_at(
    db_session: Session,
    user: User,
) -> None:
    claimed = claim_record(db_session, user)
    now = parse_dt("2026-07-25T08:01:00+00:00")

    finalized = daily_notifications.mark_daily_notification_failed(
        db_session,
        record_id=claimed.id,
        worker_id="worker-a",
        error_message="Discord request failed",
        now=now,
    )

    assert finalized is not None
    assert finalized.status == "failed"
    assert finalized.last_error == "Discord request failed"
    assert finalized.available_at == (now + timedelta(seconds=30)).replace(tzinfo=None)
    assert finalized.locked_at is None
    assert finalized.locked_by is None


def test_matching_worker_can_mark_dead(db_session: Session, user: User) -> None:
    claimed = claim_record(db_session, user)

    finalized = daily_notifications.mark_daily_notification_dead(
        db_session,
        record_id=claimed.id,
        worker_id="worker-a",
        error_message="Discord webhook rejected",
        reason="Permanent delivery failure",
        now=parse_dt("2026-07-25T08:01:00+00:00"),
    )

    assert finalized is not None
    assert finalized.status == "dead"
    assert finalized.last_error == "Discord webhook rejected"
    assert finalized.status_reason == "Permanent delivery failure"
    assert finalized.locked_at is None
    assert finalized.locked_by is None


def test_different_worker_cannot_finalize_active_claim(
    db_session: Session,
    user: User,
) -> None:
    claimed = claim_record(db_session, user)

    finalized = daily_notifications.mark_daily_notification_sent(
        db_session,
        record_id=claimed.id,
        worker_id="worker-b",
        sent_at=parse_dt("2026-07-25T08:01:00+00:00"),
    )
    db_session.refresh(claimed)

    assert finalized is None
    assert claimed.status == "processing"
    assert claimed.locked_by == "worker-a"


def test_retry_backoff_increases_and_is_bounded() -> None:
    assert daily_notifications.get_retry_backoff(1) == timedelta(seconds=30)
    assert daily_notifications.get_retry_backoff(2) == timedelta(seconds=60)
    assert daily_notifications.get_retry_backoff(3) == timedelta(seconds=120)
    assert daily_notifications.get_retry_backoff(20) == timedelta(minutes=30)


def test_mark_failed_transitions_to_dead_at_max_attempts(
    db_session: Session,
    user: User,
) -> None:
    record = create_record(db_session, user, attempts=daily_notifications.MAX_ATTEMPTS - 1)
    claimed = daily_notifications.claim_next_daily_notification(
        db_session,
        worker_id="worker-a",
        now=parse_dt("2026-07-25T08:00:00+00:00"),
    )
    assert claimed is not None
    assert claimed.id == record.id
    assert claimed.attempts == daily_notifications.MAX_ATTEMPTS

    finalized = daily_notifications.mark_daily_notification_failed(
        db_session,
        record_id=claimed.id,
        worker_id="worker-a",
        error_message="Discord request failed",
        now=parse_dt("2026-07-25T08:01:00+00:00"),
    )

    assert finalized is not None
    assert finalized.status == "dead"
    assert finalized.last_error == "Discord request failed"
    assert finalized.status_reason == "Maximum retry attempts exhausted"
    assert finalized.locked_at is None
    assert finalized.locked_by is None


def create_record(
    db_session: Session,
    user: User,
    *,
    local_date: date = date(2026, 7, 25),
    timezone: str = "UTC",
    scheduled_for: datetime | None = None,
    status: str = "pending",
    attempts: int = 0,
    available_at: datetime | None = None,
    locked_at: datetime | None = None,
    locked_by: str | None = None,
) -> DailyTodoNotification:
    now = parse_dt("2026-07-25T07:00:00+00:00")
    scheduled_for = scheduled_for or parse_dt("2026-07-25T08:00:00+00:00")
    available_at = available_at or parse_dt("2026-07-25T08:00:00+00:00")
    record = DailyTodoNotification(
        user_id=user.id,
        local_date=local_date,
        timezone=timezone,
        scheduled_for=scheduled_for,
        status=status,
        attempts=attempts,
        available_at=available_at,
        locked_at=locked_at,
        locked_by=locked_by,
        created_at=now,
        updated_at=now,
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def claim_record(db_session: Session, user: User) -> DailyTodoNotification:
    create_record(db_session, user)
    claimed = daily_notifications.claim_next_daily_notification(
        db_session,
        worker_id="worker-a",
        now=parse_dt("2026-07-25T08:00:00+00:00"),
    )
    assert claimed is not None
    return claimed


def create_user(db_session: Session, username: str) -> User:
    user = User(username=username, timezone="UTC")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def create_settings(
    db_session: Session,
    user: User,
    *,
    enabled: bool = True,
    working_hours_start: str = "08:00",
) -> AppSettings:
    settings = AppSettings(
        user_id=user.id,
        working_hours_start=working_hours_start,
        week_start="sunday",
        daily_todo_notification_enabled=enabled,
    )
    db_session.add(settings)
    db_session.commit()
    db_session.refresh(settings)
    return settings


def session_factory(db_session: Session) -> Callable[[], object]:
    @contextmanager
    def factory() -> Generator[Session, None, None]:
        yield db_session

    return factory


def count_records(db_session: Session) -> int:
    return int(db_session.scalar(select(func.count()).select_from(DailyTodoNotification)) or 0)


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(UTC)
