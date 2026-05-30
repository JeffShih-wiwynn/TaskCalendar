import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import Select, and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.core.timezone import now_in_app_timezone, to_app_timezone
from app.models.scheduled_task import ScheduledTask
from app.models.task_list import TaskList
from app.models.user import User
from app.tasks.recurrence import parse_recurrence_rule
from app.tasks.recurrence import build_recurrence_payloads
from app.tasks.recurrence import ensure_aware_datetime
from app.tasks.recurrence import validate_recurrence_until_not_before_start
from app.tasks.notifications import get_notification_start
from app.tasks.schemas import ScheduledTaskCreate, ScheduledTaskUpdate

DEFAULT_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
DEFAULT_USERNAME = "default"
SINGLE_OCCURRENCE_INDEPENDENT_FIELDS = {
    "title",
    "list_id",
    "scheduled_start",
    "scheduled_end",
    "all_day",
    "notification_enabled",
    "notification_offset_minutes",
    "notification_channel",
}


def list_tasks(
    db: Session,
    *,
    user_id: uuid.UUID | None = None,
    range_start: datetime | None = None,
    range_end: datetime | None = None,
    completed: bool | None = None,
    list_id: uuid.UUID | None = None,
    view: str | None = None,
) -> list[ScheduledTask]:
    is_unscheduled = (
        ScheduledTask.scheduled_start.is_(None)
        & ScheduledTask.scheduled_end.is_(None)
    )
    statement: Select[tuple[ScheduledTask]] = select(ScheduledTask).order_by(
        is_unscheduled,
        case((is_unscheduled, ScheduledTask.unscheduled_order.is_(None)), else_=False),
        case((is_unscheduled, ScheduledTask.unscheduled_order), else_=None),
        ScheduledTask.scheduled_start,
        ScheduledTask.created_at,
    )
    if user_id is not None:
        statement = statement.where(ScheduledTask.user_id == user_id)

    if completed is not None:
        statement = statement.where(ScheduledTask.completed.is_(completed))

    if list_id is not None:
        statement = statement.where(ScheduledTask.list_id == list_id)

    if view is not None:
        if view == "overdue":
            now = now_in_app_timezone()
            statement = statement.order_by(None)
            statement = statement.where(
                ScheduledTask.completed.is_(False),
                (
                    ScheduledTask.scheduled_end.is_not(None)
                    & (ScheduledTask.scheduled_end < now)
                )
                | (
                    ScheduledTask.scheduled_end.is_(None)
                    & ScheduledTask.due_at.is_not(None)
                    & (ScheduledTask.due_at < now)
                ),
            )
            statement = statement.order_by(
                func.coalesce(
                    ScheduledTask.scheduled_end,
                    ScheduledTask.due_at,
                    ScheduledTask.scheduled_start,
                ),
                ScheduledTask.created_at,
            )
        elif view != "all":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported view",
            )

    if range_start is not None or range_end is not None:
        if range_start is None or range_end is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Both from and to are required for range filtering",
            )
        if range_end <= range_start:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="to must be after from",
            )
        statement = statement.where(
            ScheduledTask.scheduled_start < range_end,
            or_(
                ScheduledTask.scheduled_end > range_start,
                and_(
                    ScheduledTask.all_day.is_(True),
                    ScheduledTask.scheduled_end.is_(None),
                    ScheduledTask.scheduled_start >= range_start,
                ),
            ),
        )

    return list(db.scalars(statement).all())


def create_task(
    db: Session,
    data: ScheduledTaskCreate,
    *,
    user_id: uuid.UUID | None = None,
) -> ScheduledTask:
    task_data = data.model_dump()
    task_data["user_id"] = user_id or task_data["user_id"] or get_or_create_default_user(db).id
    ensure_task_list_belongs_to_user(db, task_data.get("list_id"), task_data["user_id"])
    if task_data.get("notification_enabled") is None:
        task_data["notification_enabled"] = False
    if task_data.get("all_day") is None:
        task_data["all_day"] = False
    if task_data.get("scheduled_start") is None:
        task_data["all_day"] = False
    normalize_all_day_schedule(task_data)
    if task_data.get("notification_offset_minutes") is None:
        task_data["notification_offset_minutes"] = 0
    if task_data.get("notification_enabled") and task_data.get("notification_channel") is None:
        task_data["notification_channel"] = "discord"
    validate_notification_settings(task_data)
    validate_recurrence_until_not_before_start(
        task_data.get("recurrence_rule"),
        task_data.get("scheduled_start"),
    )
    payloads = build_recurrence_payloads(task_data)
    tasks = [ScheduledTask(**payload) for payload in payloads]
    db.add_all(tasks)
    db.commit()
    db.refresh(tasks[0])
    return tasks[0]


def get_task_or_404(
    db: Session,
    task_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
) -> ScheduledTask:
    statement = select(ScheduledTask).where(ScheduledTask.id == task_id)
    if user_id is not None:
        statement = statement.where(ScheduledTask.user_id == user_id)
    task = db.scalar(statement)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def update_task(
    db: Session,
    task_id: uuid.UUID,
    data: ScheduledTaskUpdate,
    *,
    user_id: uuid.UUID | None = None,
    update_scope: Literal["single", "series"] = "single",
) -> ScheduledTask:
    task = get_task_or_404(db, task_id, user_id=user_id)
    updates = data.model_dump(exclude_unset=True)
    ensure_task_list_belongs_to_user(db, updates.get("list_id"), task.user_id)
    validate_recurrence_until_not_before_start(
        updates.get("recurrence_rule", task.recurrence_rule),
        updates.get("scheduled_start", task.scheduled_start),
    )

    if "recurrence_rule" in updates:
        update_task_recurrence(db, task, updates, update_scope)
    elif update_scope == "series" and task.recurrence_series_id is not None:
        update_task_series(db, task, updates)
    else:
        detach_task_from_series_if_needed(task, updates)
        apply_task_updates(task, updates)
        db.add(task)

    db.commit()
    db.refresh(task)
    return task


def update_task_recurrence(
    db: Session,
    task: ScheduledTask,
    updates: dict,
    update_scope: Literal["single", "series"],
) -> None:
    new_rule = updates.get("recurrence_rule")

    if update_scope == "series" and task.recurrence_series_id is not None:
        tasks = list_tasks_in_series(db, task.recurrence_series_id, user_id=task.user_id)
        if new_rule is None:
            collapse_task_series_to_source(db, tasks, task, updates)
        else:
            rebuild_task_series(db, tasks, task, updates)
        return

    if task.recurrence_series_id is None:
        if new_rule is None:
            apply_task_updates(task, updates)
            db.add(task)
        else:
            convert_task_to_series(db, task, updates)
        return

    if new_rule is None:
        detach_task_from_series_if_needed(task, updates)
        apply_task_updates(task, updates)
        db.add(task)
        return

    convert_task_to_series(db, task, updates)


def delete_task(
    db: Session,
    task_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
    delete_scope: Literal["single", "following"] = "single",
) -> None:
    task = get_task_or_404(db, task_id, user_id=user_id)

    if (
        delete_scope == "single"
        or task.recurrence_series_id is None
        or task.scheduled_start is None
    ):
        db.delete(task)
        db.commit()
        return

    statement = select(ScheduledTask).where(
        ScheduledTask.recurrence_series_id == task.recurrence_series_id,
        ScheduledTask.scheduled_start >= task.scheduled_start,
    )
    if user_id is not None:
        statement = statement.where(ScheduledTask.user_id == user_id)
    tasks_to_delete = db.scalars(statement).all()

    for recurring_task in tasks_to_delete:
        db.delete(recurring_task)

    db.commit()


def list_tasks_in_series(db: Session, series_id: uuid.UUID, *, user_id: uuid.UUID) -> list[ScheduledTask]:
    return db.scalars(
        select(ScheduledTask).where(
            ScheduledTask.recurrence_series_id == series_id,
            ScheduledTask.user_id == user_id,
        )
    ).all()


def update_task_series(task_db: Session, source_task: ScheduledTask, updates: dict) -> None:
    tasks = list_tasks_in_series(
        task_db,
        source_task.recurrence_series_id,
        user_id=source_task.user_id,
    )

    start_changed = "scheduled_start" in updates
    end_changed = "scheduled_end" in updates
    source_start = (
        ensure_aware_datetime(source_task.scheduled_start)
        if source_task.scheduled_start is not None
        else None
    )
    final_source_start = updates.get("scheduled_start", source_start)
    if final_source_start is not None:
        final_source_start = ensure_aware_datetime(final_source_start)
    source_end = (
        ensure_aware_datetime(source_task.scheduled_end)
        if source_task.scheduled_end is not None
        else None
    )
    final_source_end = updates.get("scheduled_end", source_end)
    if final_source_end is not None:
        final_source_end = ensure_aware_datetime(final_source_end)
    start_delta: timedelta | None = None

    if (
        start_changed
        and source_start is not None
        and final_source_start is not None
    ):
        start_delta = final_source_start - source_start

    shifted_rule = None
    if start_delta is not None:
        shifted_rule = shift_recurrence_until(
            source_task.recurrence_rule,
            start_delta,
        )

    for task in tasks:
        task_updates = dict(updates)

        task_start = (
            ensure_aware_datetime(task.scheduled_start)
            if task.scheduled_start is not None
            else None
        )

        if start_delta is not None and task_start is not None:
            task_updates["scheduled_start"] = task_start + start_delta

        if start_changed or end_changed:
            if final_source_end is None or final_source_start is None:
                task_updates["scheduled_end"] = None
            else:
                duration = final_source_end - final_source_start
                shifted_start = task_updates.get("scheduled_start", task_start)
                task_updates["scheduled_end"] = (
                    shifted_start + duration if shifted_start is not None else None
                )

        if shifted_rule is not None:
            task_updates["recurrence_rule"] = shifted_rule

        apply_task_updates(task, task_updates)
        task_db.add(task)


def collapse_task_series_to_source(
    task_db: Session,
    tasks: list[ScheduledTask],
    source_task: ScheduledTask,
    updates: dict,
) -> None:
    for task in tasks:
        if task.id == source_task.id:
            task_updates = dict(updates)
            task_updates["recurrence_rule"] = None
            task.recurrence_series_id = None
            apply_task_updates(task, task_updates)
            task_db.add(task)
        else:
            task_db.delete(task)


def rebuild_task_series(
    task_db: Session,
    tasks: list[ScheduledTask],
    source_task: ScheduledTask,
    updates: dict,
) -> None:
    anchor_task = min(
        tasks,
        key=lambda task: task.scheduled_start or datetime.max.replace(tzinfo=None),
    )
    task_data = serialize_task_for_rebuild(anchor_task)
    task_data.update(updates)

    payloads = build_recurrence_payloads(task_data)
    series_id = source_task.recurrence_series_id
    for payload in payloads:
        payload["recurrence_series_id"] = series_id

    existing_tasks = sorted(
        tasks,
        key=lambda task: task.scheduled_start or datetime.max.replace(tzinfo=None),
    )

    for existing_task, payload in zip(existing_tasks, payloads, strict=False):
        apply_rebuilt_payload(existing_task, payload)
        task_db.add(existing_task)

    if len(existing_tasks) > len(payloads):
        for task in existing_tasks[len(payloads):]:
            task_db.delete(task)
    elif len(payloads) > len(existing_tasks):
        for payload in payloads[len(existing_tasks):]:
            task_db.add(ScheduledTask(**payload))


def convert_task_to_series(task_db: Session, task: ScheduledTask, updates: dict) -> None:
    task_data = serialize_task_for_rebuild(task)
    task_data.update(updates)
    payloads = build_recurrence_payloads(task_data)

    apply_rebuilt_payload(task, payloads[0])
    task_db.add(task)

    for payload in payloads[1:]:
        task_db.add(ScheduledTask(**payload))


def serialize_task_for_rebuild(task: ScheduledTask) -> dict:
    return {
        "user_id": task.user_id,
        "list_id": task.list_id,
        "title": task.title,
        "notes": task.notes,
        "completed": task.completed,
        "scheduled_start": ensure_aware_datetime(task.scheduled_start)
        if task.scheduled_start is not None
        else None,
        "scheduled_end": ensure_aware_datetime(task.scheduled_end)
        if task.scheduled_end is not None
        else None,
        "all_day": task.all_day,
        "due_at": ensure_aware_datetime(task.due_at)
        if task.due_at is not None
        else None,
        "timezone": task.timezone,
        "priority": task.priority,
        "unscheduled_order": task.unscheduled_order,
        "recurrence_rule": task.recurrence_rule,
        "notification_enabled": task.notification_enabled,
        "notification_offset_minutes": task.notification_offset_minutes,
        "notification_channel": task.notification_channel,
    }


def apply_rebuilt_payload(task: ScheduledTask, payload: dict) -> None:
    old_notify_at = get_task_notify_at(task)
    preserved_fields = {
        "id",
        "created_at",
        "updated_at",
        "completed_at",
        "notification_sent_at",
        "completed",
    }

    for field, value in payload.items():
        if field in preserved_fields:
            continue
        setattr(task, field, value)

    validate_notification_settings(
        {
            "all_day": task.all_day,
            "notification_enabled": task.notification_enabled,
            "notification_offset_minutes": task.notification_offset_minutes,
        },
    )

    reset_notification_sent_at_if_rescheduled(
        task,
        old_notify_at=old_notify_at,
        schedule_update_requested=True,
    )

    task.updated_at = datetime.now(UTC)


def apply_task_updates(task: ScheduledTask, updates: dict) -> None:
    old_notify_at = get_task_notify_at(task)
    schedule_update_requested = any(
        field in updates for field in ("scheduled_start", "scheduled_end", "all_day")
    )

    if "completed" in updates:
        now = datetime.now(UTC)
        if updates["completed"] and not task.completed:
            task.completed_at = now
        elif not updates["completed"]:
            task.completed_at = None

    validation_values = {
        "scheduled_start": task.scheduled_start,
        "scheduled_end": task.scheduled_end,
        "all_day": task.all_day,
        "notification_enabled": task.notification_enabled,
        "notification_offset_minutes": task.notification_offset_minutes,
    }
    validation_values.update(updates)
    normalize_all_day_schedule(validation_values)
    validate_notification_settings(validation_values)

    normalize_all_day_schedule(updates)

    for field, value in updates.items():
        setattr(task, field, value)

    if task.scheduled_start is None:
        task.all_day = False

    if task.scheduled_start is not None or task.scheduled_end is not None:
        task.unscheduled_order = None

    if task.notification_enabled and task.notification_channel is None:
        task.notification_channel = "discord"
    if task.notification_offset_minutes is None:
        task.notification_offset_minutes = 0

    reset_notification_sent_at_if_rescheduled(
        task,
        old_notify_at=old_notify_at,
        schedule_update_requested=schedule_update_requested,
    )

    task.updated_at = datetime.now(UTC)


def reset_notification_sent_at_if_rescheduled(
    task: ScheduledTask,
    *,
    old_notify_at: datetime | None,
    schedule_update_requested: bool,
) -> None:
    if (
        not schedule_update_requested
        or task.notification_sent_at is None
        or task.completed
        or not task.notification_enabled
    ):
        return

    new_notify_at = get_task_notify_at(task)
    if old_notify_at is None or new_notify_at is None:
        return
    if new_notify_at == old_notify_at:
        return
    if new_notify_at <= now_in_app_timezone():
        return

    task.notification_sent_at = None


def get_task_notify_at(task: ScheduledTask) -> datetime | None:
    if task.scheduled_start is None:
        return None

    offset = max(0, task.notification_offset_minutes or 0)
    return get_notification_start(task) - timedelta(minutes=offset)


def validate_notification_settings(values: dict) -> None:
    if not values.get("notification_enabled") or not values.get("all_day"):
        return

    offset = values.get("notification_offset_minutes") or 0
    if offset % 1_440 != 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="All-day reminders only support day offsets",
        )


def normalize_all_day_schedule(values: dict) -> None:
    if not values.get("all_day"):
        return

    scheduled_start = values.get("scheduled_start")
    if scheduled_start is None:
        values["all_day"] = False
        return

    local_start = to_app_timezone(ensure_aware_datetime(scheduled_start))
    values["scheduled_start"] = local_start.replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
        tzinfo=None,
    )
    values["scheduled_end"] = None


def detach_task_from_series_if_needed(task: ScheduledTask, updates: dict) -> None:
    if task.recurrence_series_id is None:
        return

    if not any(field in updates for field in SINGLE_OCCURRENCE_INDEPENDENT_FIELDS):
        return

    task.recurrence_series_id = None
    task.recurrence_rule = None


def shift_recurrence_until(recurrence_rule: str | None, delta: timedelta) -> str | None:
    if recurrence_rule is None or delta == timedelta(0):
        return recurrence_rule

    spec = parse_recurrence_rule(recurrence_rule)
    if spec.until is None:
        return recurrence_rule

    parts: list[str] = []
    for segment in recurrence_rule.split(";"):
        if "=" not in segment:
            parts.append(segment)
            continue

        key, value = segment.split("=", 1)
        if key.strip().upper() == "UNTIL":
            shifted_until = (spec.until + delta).isoformat()
            parts.append(f"{key.strip()}={shifted_until}")
        else:
            parts.append(f"{key.strip()}={value.strip()}")

    return ";".join(parts)


def complete_task(
    db: Session,
    task_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
) -> ScheduledTask:
    task = get_task_or_404(db, task_id, user_id=user_id)
    task.completed = True
    task.completed_at = datetime.now(UTC)
    task.updated_at = datetime.now(UTC)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def uncomplete_task(
    db: Session,
    task_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
) -> ScheduledTask:
    task = get_task_or_404(db, task_id, user_id=user_id)
    task.completed = False
    task.completed_at = None
    task.updated_at = datetime.now(UTC)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def get_or_create_default_user(db: Session) -> User:
    user = db.get(User, DEFAULT_USER_ID)
    if user is not None:
        return user

    user = User(id=DEFAULT_USER_ID, username=DEFAULT_USERNAME)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def ensure_task_list_belongs_to_user(
    db: Session,
    task_list_id: uuid.UUID | None,
    user_id: uuid.UUID,
) -> None:
    if task_list_id is None:
        return

    task_list = db.scalar(
        select(TaskList).where(
            TaskList.id == task_list_id,
            TaskList.user_id == user_id,
        )
    )
    if task_list is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
