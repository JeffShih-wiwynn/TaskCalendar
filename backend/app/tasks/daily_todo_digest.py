from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.scheduled_task import ScheduledTask

DailyTodoItemKind = Literal["all_day", "timed", "due"]

DISCORD_DAILY_DIGEST_MAX_LENGTH = 2_000
ELLIPSIS = "..."


@dataclass(frozen=True)
class DailyTodoItem:
    task_id: uuid.UUID
    title: str
    kind: DailyTodoItemKind
    sort_at: datetime
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    due_at: datetime | None = None
    all_day: bool = False


@dataclass(frozen=True)
class DailyTodoSelection:
    today: tuple[DailyTodoItem, ...]
    overdue: tuple[DailyTodoItem, ...]

    @property
    def has_tasks(self) -> bool:
        return bool(self.today or self.overdue)


@dataclass(frozen=True)
class DailyTodoDigest:
    message: str
    omitted_count: int = 0

    @property
    def has_content(self) -> bool:
        return bool(self.message)


def select_daily_todo_tasks(
    db: Session,
    *,
    user_id: uuid.UUID,
    local_date: date,
    timezone: str,
    snapshot_time: datetime,
) -> DailyTodoSelection:
    user_timezone = get_zoneinfo(timezone)
    snapshot_time = ensure_utc(snapshot_time)
    day_start_utc, day_end_utc = get_local_day_utc_bounds(
        local_date,
        user_timezone,
    )
    tasks = list(
        db.scalars(
            select(ScheduledTask)
            .where(
                ScheduledTask.user_id == user_id,
                ScheduledTask.completed.is_(False),
                or_(
                    ScheduledTask.scheduled_start.is_not(None),
                    ScheduledTask.due_at.is_not(None),
                ),
            )
            .order_by(ScheduledTask.created_at, ScheduledTask.id)
        ).all()
    )

    today: list[DailyTodoItem] = []
    overdue: list[DailyTodoItem] = []
    today_task_ids: set[uuid.UUID] = set()

    for task in tasks:
        today_item = classify_today_task(
            task,
            local_date=local_date,
            timezone=user_timezone,
            day_start_utc=day_start_utc,
            day_end_utc=day_end_utc,
        )
        if today_item is not None:
            today.append(today_item)
            today_task_ids.add(task.id)

    for task in tasks:
        if task.id in today_task_ids:
            continue

        overdue_item = classify_overdue_task(
            task,
            local_date=local_date,
            timezone=user_timezone,
            snapshot_time=snapshot_time,
        )
        if overdue_item is not None:
            overdue.append(overdue_item)

    return DailyTodoSelection(
        today=tuple(sorted(today, key=today_sort_key)),
        overdue=tuple(sorted(overdue, key=overdue_sort_key)),
    )


def build_daily_todo_digest(
    selection: DailyTodoSelection,
    *,
    local_date: date,
    timezone: str,
    app_url: str | None = None,
    max_length: int = DISCORD_DAILY_DIGEST_MAX_LENGTH,
) -> DailyTodoDigest:
    if not selection.has_tasks:
        return DailyTodoDigest(message="", omitted_count=0)

    user_timezone = get_zoneinfo(timezone)
    task_lines = build_task_lines(selection, user_timezone)
    header = f"Daily todo notification - {local_date.isoformat()}"
    footer = f"Open app: {app_url.rstrip('/')}" if app_url else None

    lines: list[str] = [fit_line(header, max_length)]
    omitted_count = 0
    task_index = 0
    total_tasks = len(selection.today) + len(selection.overdue)

    for section_title, section_lines in task_lines:
        if not section_lines:
            continue

        section_started = False
        for task_line in section_lines:
            remaining_after_current = total_tasks - task_index - 1
            reserve_line = (
                build_omission_line(remaining_after_current)
                if remaining_after_current > 0
                else None
            )
            candidate_lines = list(lines)
            if not section_started:
                candidate_lines.extend(["", section_title])
            candidate_lines.append(fit_line(task_line, max_length))
            if fits_with_reserve(candidate_lines, reserve_line, footer, max_length):
                lines = candidate_lines
                section_started = True
                task_index += 1
                continue

            truncated_line = fit_line(
                task_line,
                available_line_length(
                    lines,
                    section_title=section_title if not section_started else None,
                    reserve_line=reserve_line,
                    footer=footer,
                    max_length=max_length,
                ),
            )
            truncated_candidate_lines = list(lines)
            if not section_started:
                truncated_candidate_lines.extend(["", section_title])
            truncated_candidate_lines.append(truncated_line)
            if truncated_line and fits_with_reserve(
                truncated_candidate_lines,
                reserve_line,
                footer,
                max_length,
            ):
                lines = truncated_candidate_lines
                section_started = True
                task_index += 1
                continue

            omitted_count = total_tasks - task_index
            omission_line = build_omission_line(omitted_count)
            if can_add_line(lines, omission_line, max_length):
                lines.append(omission_line)
            elif len(lines) == 1:
                lines[0] = fit_line(lines[0], max_length)
            return DailyTodoDigest(
                message="\n".join(lines)[:max_length],
                omitted_count=omitted_count,
            )

    if footer and can_add_line([*lines, ""], footer, max_length):
        lines.extend(["", footer])

    message = "\n".join(lines)
    return DailyTodoDigest(
        message=message[:max_length],
        omitted_count=omitted_count,
    )


def classify_today_task(
    task: ScheduledTask,
    *,
    local_date: date,
    timezone: ZoneInfo,
    day_start_utc: datetime,
    day_end_utc: datetime,
) -> DailyTodoItem | None:
    scheduled_start = (
        optional_all_day_datetime(task.scheduled_start, timezone)
        if task.all_day
        else optional_utc(task.scheduled_start)
    )
    scheduled_end = optional_utc(task.scheduled_end)
    due_at = optional_utc(task.due_at)

    if task.all_day and scheduled_start is not None:
        local_start = scheduled_start.astimezone(timezone)
        if local_start.date() == local_date:
            return DailyTodoItem(
                task_id=task.id,
                title=task.title,
                kind="all_day",
                sort_at=datetime.combine(local_date, time.min, tzinfo=timezone).astimezone(UTC),
                scheduled_start=scheduled_start,
                all_day=True,
            )

    if not task.all_day and scheduled_start is not None:
        if scheduled_end is not None:
            if scheduled_start < day_end_utc and scheduled_end > day_start_utc:
                return DailyTodoItem(
                    task_id=task.id,
                    title=task.title,
                    kind="timed",
                    sort_at=scheduled_start,
                    scheduled_start=scheduled_start,
                    scheduled_end=scheduled_end,
                )
        elif day_start_utc <= scheduled_start < day_end_utc:
            return DailyTodoItem(
                task_id=task.id,
                title=task.title,
                kind="timed",
                sort_at=scheduled_start,
                scheduled_start=scheduled_start,
            )

    if due_at is not None and day_start_utc <= due_at < day_end_utc:
        return DailyTodoItem(
            task_id=task.id,
            title=task.title,
            kind="due",
            sort_at=due_at,
            due_at=due_at,
        )

    return None


def classify_overdue_task(
    task: ScheduledTask,
    *,
    local_date: date,
    timezone: ZoneInfo,
    snapshot_time: datetime,
) -> DailyTodoItem | None:
    scheduled_start = (
        optional_all_day_datetime(task.scheduled_start, timezone)
        if task.all_day
        else optional_utc(task.scheduled_start)
    )
    scheduled_end = optional_utc(task.scheduled_end)
    due_at = optional_utc(task.due_at)

    if task.all_day and scheduled_start is not None:
        local_start = scheduled_start.astimezone(timezone)
        if local_start.date() < local_date:
            return DailyTodoItem(
                task_id=task.id,
                title=task.title,
                kind="all_day",
                sort_at=datetime.combine(
                    local_start.date(),
                    time.min,
                    tzinfo=timezone,
                ).astimezone(UTC),
                scheduled_start=scheduled_start,
                all_day=True,
            )
        return None

    if scheduled_end is not None:
        if scheduled_end < snapshot_time:
            return DailyTodoItem(
                task_id=task.id,
                title=task.title,
                kind="timed",
                sort_at=scheduled_end,
                scheduled_start=scheduled_start,
                scheduled_end=scheduled_end,
            )
        return None

    if due_at is not None and due_at < snapshot_time:
        return DailyTodoItem(
            task_id=task.id,
            title=task.title,
            kind="due",
            sort_at=due_at,
            due_at=due_at,
        )

    return None


def get_local_day_utc_bounds(local_date: date, timezone: ZoneInfo) -> tuple[datetime, datetime]:
    day_start_local = datetime.combine(local_date, time.min, tzinfo=timezone)
    day_end_local = datetime.combine(
        local_date + timedelta(days=1),
        time.min,
        tzinfo=timezone,
    )
    return day_start_local.astimezone(UTC), day_end_local.astimezone(UTC)


def build_task_lines(
    selection: DailyTodoSelection,
    timezone: ZoneInfo,
) -> list[tuple[str, list[str]]]:
    today_lines = [format_today_item(item, timezone) for item in selection.today]
    overdue_lines = [format_overdue_item(item, timezone) for item in selection.overdue]
    return [("Today", today_lines), ("Overdue", overdue_lines)]


def format_today_item(item: DailyTodoItem, timezone: ZoneInfo) -> str:
    if item.kind == "all_day":
        return f"- All day {item.title}"
    if item.kind == "timed":
        start = format_local_time(item.scheduled_start, timezone)
        if item.scheduled_end is None:
            return f"- {start} {item.title}"
        return f"- {start}-{format_local_time(item.scheduled_end, timezone)} {item.title}"
    return f"- Due {format_local_time(item.due_at, timezone)} {item.title}"


def format_overdue_item(item: DailyTodoItem, timezone: ZoneInfo) -> str:
    if item.kind == "all_day":
        return f"- {format_local_date(item.scheduled_start, timezone)} {item.title}"
    if item.kind == "timed":
        value = item.scheduled_start or item.scheduled_end
        return f"- {format_local_date_time(value, timezone)} {item.title}"
    return f"- {format_local_date_time(item.due_at, timezone)} {item.title}"


def today_sort_key(item: DailyTodoItem) -> tuple[int, datetime, str, str]:
    kind_order = {"all_day": 0, "timed": 1, "due": 2}
    return kind_order[item.kind], item.sort_at, item.title.casefold(), str(item.task_id)


def overdue_sort_key(item: DailyTodoItem) -> tuple[datetime, str, str]:
    return item.sort_at, item.title.casefold(), str(item.task_id)


def fits_with_reserve(
    lines: list[str],
    reserve_line: str | None,
    footer: str | None,
    max_length: int,
) -> bool:
    candidate = list(lines)
    if reserve_line:
        candidate.append(reserve_line)
    if footer:
        candidate.extend(["", footer])
    return len("\n".join(candidate)) <= max_length


def can_add_line(lines: list[str], line: str, max_length: int) -> bool:
    return len("\n".join([*lines, line])) <= max_length


def available_line_length(
    lines: list[str],
    *,
    section_title: str | None,
    reserve_line: str | None,
    footer: str | None,
    max_length: int,
) -> int:
    prefix = list(lines)
    if section_title:
        prefix.extend(["", section_title])
    suffix: list[str] = []
    if reserve_line:
        suffix.append(reserve_line)
    if footer:
        suffix.extend(["", footer])

    fixed_lines = prefix + [""] + suffix
    used_length = len("\n".join(fixed_lines))
    return max(0, max_length - used_length)


def build_omission_line(count: int) -> str:
    return f"...and {count} more {'task' if count == 1 else 'tasks'}"


def fit_line(line: str, max_length: int) -> str:
    if len(line) <= max_length:
        return line
    if max_length <= len(ELLIPSIS):
        return ELLIPSIS[:max_length]
    return f"{line[: max_length - len(ELLIPSIS)]}{ELLIPSIS}"


def format_local_time(value: datetime | None, timezone: ZoneInfo) -> str:
    if value is None:
        return ""
    return ensure_utc(value).astimezone(timezone).strftime("%H:%M")


def format_local_date(value: datetime | None, timezone: ZoneInfo) -> str:
    if value is None:
        return ""
    return ensure_utc(value).astimezone(timezone).strftime("%Y-%m-%d")


def format_local_date_time(value: datetime | None, timezone: ZoneInfo) -> str:
    if value is None:
        return ""
    return ensure_utc(value).astimezone(timezone).strftime("%Y-%m-%d %H:%M")


def get_zoneinfo(timezone: str) -> ZoneInfo:
    try:
        return ZoneInfo(timezone)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("timezone must be a valid IANA timezone") from exc


def optional_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return ensure_utc(value)


def optional_all_day_datetime(value: datetime | None, timezone: ZoneInfo) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone)
    utc_value = value.astimezone(UTC)
    if utc_value.time() == time.min:
        return datetime.combine(utc_value.date(), time.min, tzinfo=timezone)
    return value


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
