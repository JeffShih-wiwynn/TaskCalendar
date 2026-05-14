import io
import uuid
from collections.abc import Generator
from datetime import datetime
from urllib import error

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import User
from app.models.scheduled_task import ScheduledTask
from app.tasks.notifications import (
    DISCORD_WEBHOOK_USER_AGENT,
    apply_message_template,
    format_discord_webhook_error,
    read_discord_error_detail,
    send_discord_notification,
    send_due_notifications,
)
from app.tasks import service
from app.tasks.schemas import ScheduledTaskCreate
from app.tasks.schemas import ScheduledTaskUpdate


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
def user_id(db_session: Session) -> uuid.UUID:
    user = User(username="test-user")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user.id


def test_create_task(db_session: Session, user_id: uuid.UUID) -> None:
    task = service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title="Plan calendar MVP",
            scheduled_start=parse_dt("2026-05-07T07:00:00+08:00"),
            scheduled_end=parse_dt("2026-05-07T09:00:00+08:00"),
        ),
    )

    assert task.id is not None
    assert task.title == "Plan calendar MVP"
    assert task.completed is False
    assert task.timezone == "Asia/Taipei"
    assert task.completed_at is None


def test_create_task_without_user_uses_default_user(db_session: Session) -> None:
    task = service.create_task(
        db_session,
        ScheduledTaskCreate(title="No auth task"),
    )

    assert task.user_id == service.DEFAULT_USER_ID


def test_reject_invalid_time_range(user_id: uuid.UUID) -> None:
    with pytest.raises(ValidationError):
        ScheduledTaskCreate(
            user_id=user_id,
            title="Invalid range",
            scheduled_start=parse_dt("2026-05-07T09:00:00+08:00"),
            scheduled_end=parse_dt("2026-05-07T07:00:00+08:00"),
        )


def test_create_recurring_task_rejects_until_before_start(
    db_session: Session, user_id: uuid.UUID
) -> None:
    with pytest.raises(HTTPException, match="recurrence_rule UNTIL must not be earlier"):
        service.create_task(
            db_session,
            ScheduledTaskCreate(
                user_id=user_id,
                title="Invalid recurring task",
                scheduled_start=parse_dt("2026-05-08T09:00:00+00:00"),
                recurrence_rule="FREQ=DAILY;INTERVAL=1;UNTIL=2026-05-07T23:59:59+00:00",
            ),
        )


def test_complete_task(db_session: Session, user_id: uuid.UUID) -> None:
    task = create_task(db_session, user_id, title="Complete me")

    completed = service.complete_task(db_session, task.id)

    assert completed.completed is True
    assert completed.completed_at is not None


def test_uncomplete_task(db_session: Session, user_id: uuid.UUID) -> None:
    task = create_task(db_session, user_id, title="Uncomplete me")
    service.complete_task(db_session, task.id)

    uncompleted = service.uncomplete_task(db_session, task.id)

    assert uncompleted.completed is False
    assert uncompleted.completed_at is None


def test_range_filtering(db_session: Session, user_id: uuid.UUID) -> None:
    included = create_task(
        db_session,
        user_id,
        title="Overlaps range",
        scheduled_start=parse_dt("2026-05-07T08:00:00+08:00"),
        scheduled_end=parse_dt("2026-05-07T10:00:00+08:00"),
    )
    create_task(
        db_session,
        user_id,
        title="Outside range",
        scheduled_start=parse_dt("2026-05-07T12:00:00+08:00"),
        scheduled_end=parse_dt("2026-05-07T13:00:00+08:00"),
    )

    tasks = service.list_tasks(
        db_session,
        range_start=parse_dt("2026-05-07T09:00:00+08:00"),
        range_end=parse_dt("2026-05-07T11:00:00+08:00"),
    )

    assert [task.id for task in tasks] == [included.id]


def test_overdue_filtering(db_session: Session, user_id: uuid.UUID) -> None:
    overdue = create_task(
        db_session,
        user_id,
        title="Overdue scheduled task",
        scheduled_start=parse_dt("2026-05-07T08:00:00+00:00"),
        scheduled_end=parse_dt("2026-05-07T09:00:00+00:00"),
    )
    due_overdue = create_task(
        db_session,
        user_id,
        title="Overdue due task",
        due_at=parse_dt("2026-05-07T07:00:00+00:00"),
    )
    completed = create_task(
        db_session,
        user_id,
        title="Completed overdue task",
        scheduled_start=parse_dt("2026-05-07T10:00:00+00:00"),
        scheduled_end=parse_dt("2026-05-07T11:00:00+00:00"),
    )
    service.complete_task(db_session, completed.id)

    tasks = service.list_tasks(db_session, view="overdue")

    assert [task.id for task in tasks] == [due_overdue.id, overdue.id]


def test_unscheduled_tasks_sort_by_unscheduled_order_then_created_at(
    db_session: Session, user_id: uuid.UUID
) -> None:
    scheduled = create_task(
        db_session,
        user_id,
        title="Scheduled task",
        scheduled_start=parse_dt("2026-05-07T08:00:00+00:00"),
        scheduled_end=parse_dt("2026-05-07T09:00:00+00:00"),
    )
    first = create_task(db_session, user_id, title="First unscheduled")
    second = create_task(db_session, user_id, title="Second unscheduled")
    third = create_task(db_session, user_id, title="Third unscheduled")

    service.update_task(
        db_session,
        third.id,
        ScheduledTaskUpdate(unscheduled_order=0),
    )
    service.update_task(
        db_session,
        first.id,
        ScheduledTaskUpdate(unscheduled_order=1),
    )

    tasks = service.list_tasks(db_session)

    assert [task.id for task in tasks] == [
        scheduled.id,
        third.id,
        first.id,
        second.id,
    ]


def test_unscheduled_order_updates_are_persisted_to_the_database(
    db_session: Session, user_id: uuid.UUID
) -> None:
    task = create_task(db_session, user_id, title="Inbox task")

    service.update_task(
        db_session,
        task.id,
        ScheduledTaskUpdate(unscheduled_order=2),
    )

    verification_session = sessionmaker(
        bind=db_session.get_bind(),
        autoflush=False,
        autocommit=False,
    )()
    try:
        stored_task = verification_session.get(ScheduledTask, task.id)
        assert stored_task is not None
        assert stored_task.unscheduled_order == 2
    finally:
        verification_session.close()

    tasks = service.list_tasks(db_session)
    assert [item.id for item in tasks] == [task.id]


def test_scheduling_task_clears_unscheduled_order(
    db_session: Session, user_id: uuid.UUID
) -> None:
    task = create_task(db_session, user_id, title="Inbox task")
    updated = service.update_task(
        db_session,
        task.id,
        ScheduledTaskUpdate(unscheduled_order=4),
    )

    assert updated.unscheduled_order == 4

    scheduled = service.update_task(
        db_session,
        task.id,
        ScheduledTaskUpdate(
            scheduled_start=parse_dt("2026-05-07T08:00:00+00:00"),
            scheduled_end=parse_dt("2026-05-07T09:00:00+00:00"),
        ),
    )

    assert scheduled.unscheduled_order is None

    verification_session = sessionmaker(
        bind=db_session.get_bind(),
        autoflush=False,
        autocommit=False,
    )()
    try:
        stored_task = verification_session.get(ScheduledTask, task.id)
        assert stored_task is not None
        assert stored_task.unscheduled_order is None
    finally:
        verification_session.close()


def test_create_recurring_task_materializes_occurrences(
    db_session: Session, user_id: uuid.UUID
) -> None:
    task = service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title="Recurring task",
            scheduled_start=parse_dt("2026-05-08T09:00:00+00:00"),
            scheduled_end=parse_dt("2026-05-08T10:00:00+00:00"),
            recurrence_rule="FREQ=DAILY;INTERVAL=2;UNTIL=2026-05-12T09:00:00+00:00",
        ),
    )

    tasks = service.list_tasks(db_session)

    assert len(tasks) == 3
    assert [item.scheduled_start for item in tasks] == [
        parse_dt("2026-05-08T09:00:00+00:00").replace(tzinfo=None),
        parse_dt("2026-05-10T09:00:00+00:00").replace(tzinfo=None),
        parse_dt("2026-05-12T09:00:00+00:00").replace(tzinfo=None),
    ]
    assert {item.recurrence_series_id for item in tasks} == {task.recurrence_series_id}
    assert task.recurrence_rule == "FREQ=DAILY;INTERVAL=2;UNTIL=2026-05-12T09:00:00+00:00"


def test_update_recurring_task_rejects_until_before_start(
    db_session: Session, user_id: uuid.UUID
) -> None:
    task = service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title="Recurring task",
            scheduled_start=parse_dt("2026-05-08T09:00:00+00:00"),
            scheduled_end=parse_dt("2026-05-08T10:00:00+00:00"),
            recurrence_rule="FREQ=DAILY;INTERVAL=1;UNTIL=2026-05-10T09:00:00+00:00",
        ),
    )

    with pytest.raises(HTTPException, match="recurrence_rule UNTIL must not be earlier"):
        service.update_task(
            db_session,
            task.id,
            ScheduledTaskUpdate(
                scheduled_start=parse_dt("2026-05-11T09:00:00+00:00"),
            ),
        )


def test_delete_recurring_task_only_removes_selected_occurrence(
    db_session: Session, user_id: uuid.UUID
) -> None:
    task = service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title="Recurring task",
            scheduled_start=parse_dt("2026-05-08T09:00:00+00:00"),
            scheduled_end=parse_dt("2026-05-08T10:00:00+00:00"),
            recurrence_rule="FREQ=DAILY;INTERVAL=1;UNTIL=2026-05-10T09:00:00+00:00",
        ),
    )

    tasks = service.list_tasks(db_session)

    service.delete_task(db_session, tasks[1].id)

    remaining = service.list_tasks(db_session)

    assert [item.id for item in remaining] == [task.id, tasks[2].id]


def test_delete_recurring_task_can_remove_following_occurrences(
    db_session: Session, user_id: uuid.UUID
) -> None:
    service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title="Recurring task",
            scheduled_start=parse_dt("2026-05-08T09:00:00+00:00"),
            scheduled_end=parse_dt("2026-05-08T10:00:00+00:00"),
            recurrence_rule="FREQ=DAILY;INTERVAL=1;UNTIL=2026-05-10T09:00:00+00:00",
        ),
    )

    tasks = service.list_tasks(db_session)

    service.delete_task(db_session, tasks[1].id, delete_scope="following")

    remaining = service.list_tasks(db_session)

    assert [item.id for item in remaining] == [tasks[0].id]


def test_update_recurring_task_can_update_whole_series(
    db_session: Session, user_id: uuid.UUID
) -> None:
    created = service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title="Recurring task",
            scheduled_start=parse_dt("2026-05-08T09:00:00+00:00"),
            scheduled_end=parse_dt("2026-05-08T10:00:00+00:00"),
            recurrence_rule="FREQ=DAILY;INTERVAL=1;UNTIL=2026-05-10T09:00:00+00:00",
            notification_enabled=True,
            notification_offset_minutes=15,
            notification_channel="discord",
        ),
    )

    tasks = service.list_tasks(db_session)

    updated = service.update_task(
        db_session,
        tasks[1].id,
        ScheduledTaskUpdate(
            title="Updated recurring task",
            scheduled_start=parse_dt("2026-05-09T08:30:00+00:00"),
            scheduled_end=parse_dt("2026-05-09T10:30:00+00:00"),
            notification_offset_minutes=30,
        ),
        update_scope="series",
    )

    refreshed = service.list_tasks(db_session)

    assert updated.title == "Updated recurring task"
    assert [task.title for task in refreshed] == [
        "Updated recurring task",
        "Updated recurring task",
        "Updated recurring task",
    ]
    assert [task.scheduled_start for task in refreshed] == [
        parse_dt("2026-05-08T08:30:00+00:00").replace(tzinfo=None),
        parse_dt("2026-05-09T08:30:00+00:00").replace(tzinfo=None),
        parse_dt("2026-05-10T08:30:00+00:00").replace(tzinfo=None),
    ]
    assert [task.scheduled_end for task in refreshed] == [
        parse_dt("2026-05-08T10:30:00+00:00").replace(tzinfo=None),
        parse_dt("2026-05-09T10:30:00+00:00").replace(tzinfo=None),
        parse_dt("2026-05-10T10:30:00+00:00").replace(tzinfo=None),
    ]
    assert all(task.notification_offset_minutes == 30 for task in refreshed)
    assert all(
        task.recurrence_rule == "FREQ=DAILY;INTERVAL=1;UNTIL=2026-05-10T08:30:00+00:00"
        for task in refreshed
    )
    assert created.recurrence_series_id == refreshed[0].recurrence_series_id


def test_update_recurring_task_rule_rebuilds_series(
    db_session: Session, user_id: uuid.UUID
) -> None:
    service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title="Recurring task",
            scheduled_start=parse_dt("2026-05-08T09:00:00+00:00"),
            scheduled_end=parse_dt("2026-05-08T10:00:00+00:00"),
            recurrence_rule="FREQ=WEEKLY;INTERVAL=1;UNTIL=2026-05-22T09:00:00+00:00",
        ),
    )

    tasks = service.list_tasks(db_session)

    service.update_task(
        db_session,
        tasks[0].id,
        ScheduledTaskUpdate(
            recurrence_rule="FREQ=YEARLY;INTERVAL=1;UNTIL=2028-05-08T09:00:00+00:00",
        ),
        update_scope="series",
    )

    refreshed = service.list_tasks(db_session)

    assert [task.scheduled_start for task in refreshed] == [
        parse_dt("2026-05-08T09:00:00+00:00").replace(tzinfo=None),
        parse_dt("2027-05-08T09:00:00+00:00").replace(tzinfo=None),
        parse_dt("2028-05-08T09:00:00+00:00").replace(tzinfo=None),
    ]
    assert all(
        task.recurrence_rule == "FREQ=YEARLY;INTERVAL=1;UNTIL=2028-05-08T09:00:00+00:00"
        for task in refreshed
    )


def test_update_non_recurring_task_to_recurring_creates_series(
    db_session: Session, user_id: uuid.UUID
) -> None:
    task = service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title="Standalone task",
            scheduled_start=parse_dt("2026-05-08T09:00:00+00:00"),
            scheduled_end=parse_dt("2026-05-08T10:00:00+00:00"),
        ),
    )

    updated = service.update_task(
        db_session,
        task.id,
        ScheduledTaskUpdate(
            recurrence_rule="FREQ=WEEKLY;INTERVAL=1;UNTIL=2026-05-22T09:00:00+00:00",
        ),
    )

    refreshed = service.list_tasks(db_session)

    assert updated.recurrence_series_id is not None
    assert [task.scheduled_start for task in refreshed] == [
        parse_dt("2026-05-08T09:00:00+00:00").replace(tzinfo=None),
        parse_dt("2026-05-15T09:00:00+00:00").replace(tzinfo=None),
        parse_dt("2026-05-22T09:00:00+00:00").replace(tzinfo=None),
    ]
    assert all(task.recurrence_series_id == updated.recurrence_series_id for task in refreshed)


def test_update_recurring_series_to_non_recurring_keeps_only_edited_occurrence(
    db_session: Session, user_id: uuid.UUID
) -> None:
    service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title="Recurring task",
            scheduled_start=parse_dt("2026-05-08T09:00:00+00:00"),
            scheduled_end=parse_dt("2026-05-08T10:00:00+00:00"),
            recurrence_rule="FREQ=WEEKLY;INTERVAL=1;UNTIL=2026-05-22T09:00:00+00:00",
        ),
    )

    tasks = service.list_tasks(db_session)
    edited_task = tasks[1]

    updated = service.update_task(
        db_session,
        edited_task.id,
        ScheduledTaskUpdate(
            title="Standalone task",
            recurrence_rule=None,
        ),
        update_scope="series",
    )

    refreshed = service.list_tasks(db_session)

    assert updated.id == edited_task.id
    assert updated.title == "Standalone task"
    assert updated.recurrence_rule is None
    assert updated.recurrence_series_id is None
    assert [task.id for task in refreshed] == [edited_task.id]


def test_update_single_recurring_occurrence_to_new_rule_creates_new_series(
    db_session: Session, user_id: uuid.UUID
) -> None:
    created = service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title="Recurring task",
            scheduled_start=parse_dt("2026-05-08T09:00:00+00:00"),
            scheduled_end=parse_dt("2026-05-08T10:00:00+00:00"),
            recurrence_rule="FREQ=WEEKLY;INTERVAL=1;UNTIL=2026-05-22T09:00:00+00:00",
        ),
    )

    tasks = service.list_tasks(db_session)

    updated = service.update_task(
        db_session,
        tasks[1].id,
        ScheduledTaskUpdate(
            recurrence_rule="FREQ=YEARLY;INTERVAL=1;UNTIL=2028-05-15T09:00:00+00:00",
        ),
        update_scope="single",
    )

    refreshed = service.list_tasks(db_session)
    old_series_tasks = [
        task for task in refreshed if task.recurrence_series_id == created.recurrence_series_id
    ]
    new_series_tasks = [
        task
        for task in refreshed
        if task.recurrence_series_id == updated.recurrence_series_id
        and task.recurrence_series_id != created.recurrence_series_id
    ]

    assert updated.recurrence_series_id != created.recurrence_series_id
    assert [task.scheduled_start for task in old_series_tasks] == [
        parse_dt("2026-05-08T09:00:00+00:00").replace(tzinfo=None),
        parse_dt("2026-05-22T09:00:00+00:00").replace(tzinfo=None),
    ]
    assert [task.scheduled_start for task in new_series_tasks] == [
        parse_dt("2026-05-15T09:00:00+00:00").replace(tzinfo=None),
        parse_dt("2027-05-15T09:00:00+00:00").replace(tzinfo=None),
        parse_dt("2028-05-15T09:00:00+00:00").replace(tzinfo=None),
    ]


def test_update_single_recurring_occurrence_becomes_independent_task(
    db_session: Session, user_id: uuid.UUID
) -> None:
    created = service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title="Recurring task",
            scheduled_start=parse_dt("2026-05-08T09:00:00+00:00"),
            scheduled_end=parse_dt("2026-05-08T10:00:00+00:00"),
            recurrence_rule="FREQ=DAILY;INTERVAL=1;UNTIL=2026-05-10T09:00:00+00:00",
        ),
    )

    tasks = service.list_tasks(db_session)

    updated = service.update_task(
        db_session,
        tasks[1].id,
        ScheduledTaskUpdate(title="Edited once"),
        update_scope="single",
    )

    refreshed = service.list_tasks(db_session)
    recurring_tasks = [
        task for task in refreshed if task.recurrence_series_id == created.recurrence_series_id
    ]
    independent_tasks = [task for task in refreshed if task.recurrence_series_id is None]

    assert updated.title == "Edited once"
    assert updated.recurrence_series_id is None
    assert updated.recurrence_rule is None
    assert [task.title for task in recurring_tasks] == ["Recurring task", "Recurring task"]
    assert [task.title for task in independent_tasks] == ["Edited once"]


def test_send_due_notifications_marks_tasks_as_sent(
    db_session: Session, user_id: uuid.UUID
) -> None:
    task = create_task(
        db_session,
        user_id,
        title="Notify me",
        due_at=parse_dt("2026-05-08T09:00:00+00:00"),
        scheduled_start=parse_dt("2026-05-08T10:00:00+00:00"),
        scheduled_end=parse_dt("2026-05-08T11:00:00+00:00"),
    )
    task.notes = "Bring agenda"
    task.notification_enabled = True
    task.notification_offset_minutes = 15
    task.notification_channel = "discord"
    db_session.add(task)
    db_session.commit()

    sent_messages: list[str] = []

    sent_count = send_due_notifications(
        db_session,
        now=parse_dt("2026-05-08T10:00:00+00:00"),
        webhook_url="https://discord.example/webhook",
        app_base_url="https://calendar.example",
        sender=lambda _url, message: sent_messages.append(message),
    )

    refreshed = service.get_task_or_404(db_session, task.id)

    assert sent_count == 1
    assert refreshed.notification_sent_at is not None
    assert sent_messages == [
        "Task due: Notify me\n"
        "When: 2026-05-08 18:00 - 2026-05-08 19:00\n"
        "Notes: Bring agenda\n"
        "Open app: https://calendar.example"
    ]


def test_send_due_notifications_uses_custom_message_template(
    db_session: Session, user_id: uuid.UUID
) -> None:
    task = create_task(
        db_session,
        user_id,
        title="Notify me",
        scheduled_start=parse_dt("2026-05-08T10:00:00+00:00"),
    )
    task.notes = "Bring agenda"
    task.notification_enabled = True
    task.notification_channel = "discord"
    db_session.add(task)
    db_session.commit()

    sent_messages: list[str] = []

    send_due_notifications(
        db_session,
        now=parse_dt("2026-05-08T10:00:00+00:00"),
        webhook_url="https://discord.example/webhook",
        app_base_url="https://calendar.example",
        message_template="Task {title}\nWhen {when}\nLink {app_url}\nNotes {notes}",
        sender=lambda _url, message: sent_messages.append(message),
    )

    assert sent_messages == [
        "Task Notify me\n"
        "When 2026-05-08 18:00\n"
        "Link https://calendar.example\n"
        "Notes Bring agenda"
    ]


def test_apply_message_template_preserves_unknown_placeholders() -> None:
    message = apply_message_template(
        "Task {title} {unknown}",
        {"title": "Notify me"},
    )

    assert message == "Task Notify me {unknown}"


def test_read_discord_error_detail_parses_json_message() -> None:
    http_error = error.HTTPError(
        url="https://discord.example/webhook",
        code=403,
        msg="Forbidden",
        hdrs=None,
        fp=io.BytesIO(b'{"message":"Unknown Webhook","code":10015}'),
    )

    assert read_discord_error_detail(http_error) == "Unknown Webhook (code 10015)"


def test_format_discord_webhook_error_includes_detail_for_403() -> None:
    assert format_discord_webhook_error(403, "Unknown Webhook (code 10015)") == (
        "Webhook rejected by Discord (403). "
        "Check whether the webhook URL is valid, still active, and allowed to post. "
        "Discord said: Unknown Webhook (code 10015)"
    )


def test_send_discord_notification_sets_explicit_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_headers: dict[str, str] = {}

    class DummyResponse:
        status = 204

        def __enter__(self) -> "DummyResponse":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

    def fake_urlopen(request_obj, timeout: int) -> DummyResponse:
        nonlocal captured_headers
        captured_headers = dict(request_obj.header_items())
        assert timeout == 10
        return DummyResponse()

    monkeypatch.setattr("app.tasks.notifications.request.urlopen", fake_urlopen)

    send_discord_notification("https://discord.example/webhook", "hello")

    lowered_headers = {key.lower(): value for key, value in captured_headers.items()}
    assert lowered_headers["content-type"] == "application/json"
    assert lowered_headers["accept"] == "application/json"
    assert lowered_headers["user-agent"] == DISCORD_WEBHOOK_USER_AGENT
def create_task(
    db_session: Session,
    user_id: uuid.UUID,
    *,
    title: str,
    scheduled_start: datetime | None = None,
    scheduled_end: datetime | None = None,
    due_at: datetime | None = None,
    recurrence_rule: str | None = None,
    notification_enabled: bool | None = None,
    notification_offset_minutes: int | None = None,
    notification_channel: str | None = None,
    unscheduled_order: int | None = None,
):
    return service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title=title,
            scheduled_start=scheduled_start,
            scheduled_end=scheduled_end,
            due_at=due_at,
            recurrence_rule=recurrence_rule,
            notification_enabled=notification_enabled,
            notification_offset_minutes=notification_offset_minutes,
            notification_channel=notification_channel,
            unscheduled_order=unscheduled_order,
        ),
    )


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)
