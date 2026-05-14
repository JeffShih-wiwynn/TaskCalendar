from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.scheduled_task import ScheduledTask
from app.models.task_list import TaskList

BACKUP_SCHEMA_VERSION = 1


def export_user_backup(db: Session, *, user_id: uuid.UUID) -> dict[str, Any]:
    task_lists = db.scalars(
        select(TaskList).where(TaskList.user_id == user_id).order_by(TaskList.created_at)
    ).all()
    tasks = db.scalars(
        select(ScheduledTask).where(ScheduledTask.user_id == user_id).order_by(ScheduledTask.created_at)
    ).all()

    return {
        "schema_version": BACKUP_SCHEMA_VERSION,
        "exported_at": datetime.now(UTC).isoformat(),
        "tasks": [serialize_task(task) for task in tasks],
        "task_lists": [serialize_task_list(task_list) for task_list in task_lists],
    }


def serialize_task(task: ScheduledTask) -> dict[str, Any]:
    return {
        "id": str(task.id),
        "user_id": str(task.user_id),
        "list_id": str(task.list_id) if task.list_id is not None else None,
        "title": task.title,
        "notes": task.notes,
        "completed": task.completed,
        "scheduled_start": to_iso(task.scheduled_start),
        "scheduled_end": to_iso(task.scheduled_end),
        "due_at": to_iso(task.due_at),
        "timezone": task.timezone,
        "priority": task.priority,
        "unscheduled_order": task.unscheduled_order,
        "recurrence_rule": task.recurrence_rule,
        "recurrence_series_id": str(task.recurrence_series_id)
        if task.recurrence_series_id is not None
        else None,
        "notification_enabled": task.notification_enabled,
        "notification_offset_minutes": task.notification_offset_minutes,
        "notification_channel": task.notification_channel,
        "notification_sent_at": to_iso(task.notification_sent_at),
        "created_at": to_iso(task.created_at),
        "updated_at": to_iso(task.updated_at),
        "completed_at": to_iso(task.completed_at),
    }


def serialize_task_list(task_list: TaskList) -> dict[str, Any]:
    return {
        "id": str(task_list.id),
        "user_id": str(task_list.user_id),
        "name": task_list.name,
        "color": task_list.color,
        "created_at": to_iso(task_list.created_at),
        "updated_at": to_iso(task_list.updated_at),
    }


def to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()
