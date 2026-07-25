from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.database import Base
from app.models.scheduled_task import ScheduledTask
from app.models.user import User
from app.tasks.daily_todo_digest import (
    DailyTodoSelection,
    build_daily_todo_digest,
    classify_today_task,
    get_local_day_utc_bounds,
    select_daily_todo_tasks,
)


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


def test_task_exactly_at_local_day_start_is_today(
    db_session: Session,
    user: User,
) -> None:
    task = create_task(
        db_session,
        user,
        title="At start",
        scheduled_start=parse_dt("2026-07-25T00:00:00+00:00"),
    )

    selection = select_selection(db_session, user)

    assert [item.task_id for item in selection.today] == [task.id]
    assert selection.overdue == ()


def test_task_exactly_at_local_day_end_is_not_today(
    db_session: Session,
    user: User,
) -> None:
    create_task(
        db_session,
        user,
        title="At end",
        scheduled_start=parse_dt("2026-07-26T00:00:00+00:00"),
    )

    selection = select_selection(db_session, user)

    assert selection.today == ()
    assert selection.overdue == ()


def test_task_ending_exactly_at_day_start_does_not_overlap_today(
    db_session: Session,
    user: User,
) -> None:
    create_task(
        db_session,
        user,
        title="Ends at start",
        scheduled_start=parse_dt("2026-07-24T23:00:00+00:00"),
        scheduled_end=parse_dt("2026-07-25T00:00:00+00:00"),
    )

    selection = select_selection(
        db_session,
        user,
        snapshot_time=parse_dt("2026-07-25T00:00:00+00:00"),
    )

    assert selection.today == ()
    assert selection.overdue == ()


def test_task_overlapping_day_boundary_is_today(
    db_session: Session,
    user: User,
) -> None:
    task = create_task(
        db_session,
        user,
        title="Overlaps",
        scheduled_start=parse_dt("2026-07-24T23:00:00+00:00"),
        scheduled_end=parse_dt("2026-07-25T01:00:00+00:00"),
    )

    selection = select_selection(db_session, user)

    assert [item.task_id for item in selection.today] == [task.id]


def test_no_end_timed_task_is_today_only_when_start_is_inside_day(
    db_session: Session,
    user: User,
) -> None:
    inside = create_task(
        db_session,
        user,
        title="Inside",
        scheduled_start=parse_dt("2026-07-25T10:00:00+00:00"),
    )
    create_task(
        db_session,
        user,
        title="Before",
        scheduled_start=parse_dt("2026-07-24T10:00:00+00:00"),
    )

    selection = select_selection(db_session, user)

    assert [item.task_id for item in selection.today] == [inside.id]


def test_local_date_differs_from_utc_date(
    db_session: Session,
    user: User,
) -> None:
    user.timezone = "Asia/Taipei"
    db_session.add(user)
    db_session.commit()
    task = create_task(
        db_session,
        user,
        title="Taipei morning",
        scheduled_start=parse_dt("2026-07-24T16:30:00+00:00"),
    )

    selection = select_selection(
        db_session,
        user,
        local_date=date(2026, 7, 25),
        timezone="Asia/Taipei",
        snapshot_time=parse_dt("2026-07-25T00:00:00+00:00"),
    )

    assert [item.task_id for item in selection.today] == [task.id]


@pytest.mark.parametrize(
    "timezone",
    [
        "Asia/Taipei",
        "America/New_York",
        "America/Los_Angeles",
    ],
)
def test_historical_naive_all_day_start_uses_record_local_date(
    db_session: Session,
    user: User,
    timezone: str,
) -> None:
    task = create_task(
        db_session,
        user,
        title=f"Historical all-day {timezone}",
        scheduled_start=datetime(2026, 7, 25),
        all_day=True,
    )

    selection = select_selection(
        db_session,
        user,
        local_date=date(2026, 7, 25),
        timezone=timezone,
        snapshot_time=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    assert [item.task_id for item in selection.today] == [task.id]
    assert selection.overdue == ()


@pytest.mark.parametrize("timezone", ["America/New_York", "America/Los_Angeles"])
def test_historical_utc_midnight_all_day_start_uses_record_local_date(
    timezone: str,
) -> None:
    from zoneinfo import ZoneInfo

    user_timezone = ZoneInfo(timezone)
    day_start, day_end = get_local_day_utc_bounds(date(2026, 7, 25), user_timezone)
    task = ScheduledTask(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        title=f"Historical UTC all-day {timezone}",
        completed=False,
        all_day=True,
        scheduled_start=parse_dt("2026-07-25T00:00:00+00:00"),
    )

    item = classify_today_task(
        task,
        local_date=date(2026, 7, 25),
        timezone=user_timezone,
        day_start_utc=day_start,
        day_end_utc=day_end,
    )

    assert item is not None
    assert item.task_id == task.id


def test_dst_day_boundaries_use_next_local_midnight() -> None:
    from zoneinfo import ZoneInfo

    start, end = get_local_day_utc_bounds(date(2026, 3, 8), ZoneInfo("America/New_York"))

    assert start == parse_dt("2026-03-08T05:00:00+00:00")
    assert end == parse_dt("2026-03-09T04:00:00+00:00")
    assert end - start == timedelta(hours=23)


def test_today_includes_timed_all_day_due_and_recurring_materialized_rows(
    db_session: Session,
    user: User,
) -> None:
    all_day = create_task(
        db_session,
        user,
        title="All day",
        scheduled_start=parse_dt("2026-07-25T00:00:00+00:00"),
        all_day=True,
    )
    timed = create_task(
        db_session,
        user,
        title="Timed",
        scheduled_start=parse_dt("2026-07-25T09:00:00+00:00"),
        scheduled_end=parse_dt("2026-07-25T10:00:00+00:00"),
    )
    due = create_task(
        db_session,
        user,
        title="Due",
        due_at=parse_dt("2026-07-25T17:00:00+00:00"),
    )
    recurring = create_task(
        db_session,
        user,
        title="Recurring occurrence",
        scheduled_start=parse_dt("2026-07-25T14:00:00+00:00"),
        recurrence_series_id=uuid.uuid4(),
    )

    selection = select_selection(db_session, user)

    assert [item.task_id for item in selection.today] == [
        all_day.id,
        timed.id,
        recurring.id,
        due.id,
    ]


def test_selection_excludes_completed_and_other_users_tasks(
    db_session: Session,
    user: User,
) -> None:
    create_task(
        db_session,
        user,
        title="Completed",
        completed=True,
        scheduled_start=parse_dt("2026-07-25T09:00:00+00:00"),
    )
    other_user = User(username="other", timezone="UTC")
    db_session.add(other_user)
    db_session.commit()
    create_task(
        db_session,
        other_user,
        title="Other user",
        scheduled_start=parse_dt("2026-07-25T09:00:00+00:00"),
    )

    selection = select_selection(db_session, user)

    assert selection.today == ()
    assert selection.overdue == ()


def test_scheduled_and_due_today_task_appears_once_as_scheduled(
    db_session: Session,
    user: User,
) -> None:
    task = create_task(
        db_session,
        user,
        title="Scheduled and due",
        scheduled_start=parse_dt("2026-07-25T09:00:00+00:00"),
        scheduled_end=parse_dt("2026-07-25T10:00:00+00:00"),
        due_at=parse_dt("2026-07-25T17:00:00+00:00"),
    )

    selection = select_selection(db_session, user)

    assert len(selection.today) == 1
    assert selection.today[0].task_id == task.id
    assert selection.today[0].kind == "timed"


def test_overdue_includes_past_all_day_timed_and_due_only_tasks(
    db_session: Session,
    user: User,
) -> None:
    all_day = create_task(
        db_session,
        user,
        title="Past all day",
        scheduled_start=parse_dt("2026-07-24T00:00:00+00:00"),
        all_day=True,
    )
    timed = create_task(
        db_session,
        user,
        title="Past timed",
        scheduled_start=parse_dt("2026-07-24T06:00:00+00:00"),
        scheduled_end=parse_dt("2026-07-24T07:00:00+00:00"),
    )
    due = create_task(
        db_session,
        user,
        title="Past due",
        due_at=parse_dt("2026-07-24T07:30:00+00:00"),
    )

    selection = select_selection(db_session, user)

    assert [item.task_id for item in selection.overdue] == [
        all_day.id,
        timed.id,
        due.id,
    ]


def test_timed_task_ending_exactly_at_snapshot_is_not_overdue(
    db_session: Session,
    user: User,
) -> None:
    create_task(
        db_session,
        user,
        title="Ends at snapshot",
        scheduled_start=parse_dt("2026-07-25T07:00:00+00:00"),
        scheduled_end=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    selection = select_selection(db_session, user)

    assert selection.today
    assert selection.overdue == ()


def test_scheduled_end_precedence_over_due_at_for_overdue(
    db_session: Session,
    user: User,
) -> None:
    create_task(
        db_session,
        user,
        title="Due before but schedule active",
        scheduled_start=parse_dt("2026-07-25T07:30:00+00:00"),
        scheduled_end=parse_dt("2026-07-25T09:00:00+00:00"),
        due_at=parse_dt("2026-07-24T09:00:00+00:00"),
    )

    selection = select_selection(db_session, user)

    assert len(selection.today) == 1
    assert selection.overdue == ()


def test_overdue_uses_snapshot_time_not_later_processing_time(
    db_session: Session,
    user: User,
) -> None:
    create_task(
        db_session,
        user,
        title="Future at snapshot",
        due_at=parse_dt("2026-07-25T09:00:00+00:00"),
    )

    selection = select_selection(
        db_session,
        user,
        snapshot_time=parse_dt("2026-07-25T08:00:00+00:00"),
    )

    assert len(selection.today) == 1
    assert selection.overdue == ()


def test_ordering_is_deterministic_for_today_and_overdue(
    db_session: Session,
    user: User,
) -> None:
    all_day = create_task(
        db_session,
        user,
        title="B all day",
        scheduled_start=parse_dt("2026-07-25T00:00:00+00:00"),
        all_day=True,
    )
    timed = create_task(
        db_session,
        user,
        title="A timed",
        scheduled_start=parse_dt("2026-07-25T09:00:00+00:00"),
    )
    due = create_task(
        db_session,
        user,
        title="C due",
        due_at=parse_dt("2026-07-25T08:30:00+00:00"),
    )
    oldest = create_task(
        db_session,
        user,
        title="Oldest",
        due_at=parse_dt("2026-07-23T08:00:00+00:00"),
    )
    newer = create_task(
        db_session,
        user,
        title="Newer",
        due_at=parse_dt("2026-07-24T08:00:00+00:00"),
    )

    selection = select_selection(db_session, user)

    assert [item.task_id for item in selection.today] == [all_day.id, timed.id, due.id]
    assert [item.task_id for item in selection.overdue] == [oldest.id, newer.id]


def test_formatter_returns_empty_result_for_empty_selection() -> None:
    digest = build_daily_todo_digest(
        DailyTodoSelection(today=(), overdue=()),
        local_date=date(2026, 7, 25),
        timezone="UTC",
    )

    assert digest.message == ""
    assert digest.has_content is False
    assert digest.omitted_count == 0


def test_formatter_builds_today_only_digest_with_app_url() -> None:
    selection = DailyTodoSelection(
        today=(
            digest_item("Renew certificate", "all_day"),
            digest_item(
                "Write project notes",
                "timed",
                start=parse_dt("2026-07-25T09:00:00+00:00"),
                end=parse_dt("2026-07-25T10:00:00+00:00"),
            ),
            digest_item(
                "Team meeting",
                "timed",
                start=parse_dt("2026-07-25T14:00:00+00:00"),
            ),
            digest_item(
                "Submit report",
                "due",
                due=parse_dt("2026-07-25T17:00:00+00:00"),
            ),
        ),
        overdue=(),
    )

    digest = build_daily_todo_digest(
        selection,
        local_date=date(2026, 7, 25),
        timezone="UTC",
        app_url="https://calendar.example/",
    )

    assert digest.message == (
        "Daily todo notification - 2026-07-25\n"
        "\n"
        "Today\n"
        "- All day Renew certificate\n"
        "- 09:00-10:00 Write project notes\n"
        "- 14:00 Team meeting\n"
        "- Due 17:00 Submit report\n"
        "\n"
        "Open app: https://calendar.example"
    )


def test_formatter_builds_overdue_only_and_combined_digest() -> None:
    selection = DailyTodoSelection(
        today=(digest_item("Today task", "timed", start=parse_dt("2026-07-25T12:00:00+00:00")),),
        overdue=(
            digest_item("Follow up", "due", due=parse_dt("2026-07-22T09:00:00+00:00")),
            digest_item(
                "Review PR",
                "timed",
                start=parse_dt("2026-07-24T15:00:00+00:00"),
                end=parse_dt("2026-07-24T16:00:00+00:00"),
            ),
        ),
    )

    digest = build_daily_todo_digest(
        selection,
        local_date=date(2026, 7, 25),
        timezone="UTC",
    )

    assert "Today\n- 12:00 Today task" in digest.message
    assert "Overdue\n- 2026-07-22 09:00 Follow up" in digest.message
    assert "- 2026-07-24 15:00 Review PR" in digest.message


def test_formatter_uses_local_timezone_and_excludes_notes() -> None:
    selection = DailyTodoSelection(
        today=(
            digest_item(
                "Taipei task",
                "timed",
                start=parse_dt("2026-07-25T01:00:00+00:00"),
                end=parse_dt("2026-07-25T02:00:00+00:00"),
            ),
        ),
        overdue=(),
    )

    digest = build_daily_todo_digest(
        selection,
        local_date=date(2026, 7, 25),
        timezone="Asia/Taipei",
    )

    assert "- 09:00-10:00 Taipei task" in digest.message
    assert "Notes" not in digest.message


def test_formatter_limits_output_without_cutting_lines_and_counts_omitted() -> None:
    selection = DailyTodoSelection(
        today=tuple(digest_item(f"Task {index}", "due") for index in range(20)),
        overdue=(),
    )

    digest = build_daily_todo_digest(
        selection,
        local_date=date(2026, 7, 25),
        timezone="UTC",
        max_length=130,
    )

    assert len(digest.message) <= 130
    assert digest.omitted_count > 0
    assert f"...and {digest.omitted_count} more tasks" in digest.message
    assert not digest.message.endswith("Tas")


def test_formatter_truncates_one_extremely_long_unicode_title() -> None:
    title = "重要なタスク" * 120
    selection = DailyTodoSelection(
        today=(digest_item(title, "due"),),
        overdue=(),
    )

    digest = build_daily_todo_digest(
        selection,
        local_date=date(2026, 7, 25),
        timezone="UTC",
        max_length=200,
    )

    assert len(digest.message) <= 200
    assert "重要な" in digest.message
    assert "..." in digest.message
    assert digest.omitted_count == 0


def test_formatter_handles_cjk_titles() -> None:
    selection = DailyTodoSelection(
        today=(digest_item("提交報告", "due"),),
        overdue=(digest_item("確認請求書", "due", due=parse_dt("2026-07-24T09:00:00+00:00")),),
    )

    digest = build_daily_todo_digest(
        selection,
        local_date=date(2026, 7, 25),
        timezone="Asia/Taipei",
    )

    assert "提交報告" in digest.message
    assert "確認請求書" in digest.message


def select_selection(
    db_session: Session,
    user: User,
    *,
    local_date: date = date(2026, 7, 25),
    timezone: str = "UTC",
    snapshot_time: datetime | None = None,
) -> DailyTodoSelection:
    snapshot_time = snapshot_time or parse_dt("2026-07-25T08:00:00+00:00")
    return select_daily_todo_tasks(
        db_session,
        user_id=user.id,
        local_date=local_date,
        timezone=timezone,
        snapshot_time=snapshot_time,
    )


def create_task(
    db_session: Session,
    user: User,
    *,
    title: str,
    completed: bool = False,
    scheduled_start: datetime | None = None,
    scheduled_end: datetime | None = None,
    all_day: bool = False,
    due_at: datetime | None = None,
    recurrence_series_id: uuid.UUID | None = None,
) -> ScheduledTask:
    now = parse_dt("2026-07-20T00:00:00+00:00")
    task = ScheduledTask(
        user_id=user.id,
        title=title,
        completed=completed,
        scheduled_start=scheduled_start,
        scheduled_end=scheduled_end,
        all_day=all_day,
        due_at=due_at,
        timezone=user.timezone or "UTC",
        recurrence_series_id=recurrence_series_id,
        created_at=now,
        updated_at=now,
    )
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)
    return task


def digest_item(
    title: str,
    kind: str,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    due: datetime | None = None,
):
    from app.tasks.daily_todo_digest import DailyTodoItem

    task_id = uuid.uuid4()
    if kind == "all_day":
        return DailyTodoItem(
            task_id=task_id,
            title=title,
            kind="all_day",
            sort_at=parse_dt("2026-07-25T00:00:00+00:00"),
            scheduled_start=parse_dt("2026-07-25T00:00:00+00:00"),
            all_day=True,
        )
    if kind == "timed":
        start = start or parse_dt("2026-07-25T09:00:00+00:00")
        return DailyTodoItem(
            task_id=task_id,
            title=title,
            kind="timed",
            sort_at=start,
            scheduled_start=start,
            scheduled_end=end,
        )
    due = due or parse_dt("2026-07-25T17:00:00+00:00")
    return DailyTodoItem(
        task_id=task_id,
        title=title,
        kind="due",
        sort_at=due,
        due_at=due,
    )


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(UTC)
