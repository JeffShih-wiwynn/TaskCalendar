from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.backup.schemas import BackupImportRequest
from app.core.timezone import ensure_aware_datetime, now_in_app_timezone, to_app_isoformat
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
        "exported_at": now_in_app_timezone().isoformat(),
        "tasks": [serialize_task(task) for task in tasks],
        "task_lists": [serialize_task_list(task_list) for task_list in task_lists],
    }


def import_user_backup(
    db: Session,
    backup: BackupImportRequest,
    *,
    user_id: uuid.UUID,
) -> dict[str, int]:
    if backup.schema_version != BACKUP_SCHEMA_VERSION:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported backup schema_version",
        )

    task_list_id_map = build_id_map(
        db,
        model=TaskList,
        ids=[task_list.id for task_list in backup.task_lists],
        user_id=user_id,
    )
    task_id_map = build_id_map(
        db,
        model=ScheduledTask,
        ids=[task.id for task in backup.tasks],
        user_id=user_id,
    )

    try:
        with db.begin_nested():
            db.execute(delete(ScheduledTask).where(ScheduledTask.user_id == user_id))
            db.execute(delete(TaskList).where(TaskList.user_id == user_id))
            db.add_all(
                TaskList(
                    id=task_list_id_map[task_list.id],
                    user_id=user_id,
                    name=task_list.name.strip(),
                    color=task_list.color,
                    created_at=task_list.created_at,
                    updated_at=task_list.updated_at,
                )
                for task_list in backup.task_lists
            )
            db.flush()
            db.add_all(
                ScheduledTask(
                    id=task_id_map[task.id],
                    user_id=user_id,
                    list_id=(
                        task_list_id_map[task.list_id]
                        if task.list_id is not None
                        else None
                    ),
                    title=task.title,
                    notes=task.notes,
                    completed=task.completed,
                    scheduled_start=normalize_import_datetime(task.scheduled_start),
                    scheduled_end=normalize_import_datetime(task.scheduled_end),
                    all_day=task.all_day,
                    due_at=normalize_import_datetime(task.due_at),
                    timezone=task.timezone,
                    priority=task.priority,
                    unscheduled_order=task.unscheduled_order,
                    recurrence_rule=task.recurrence_rule,
                    recurrence_series_id=task.recurrence_series_id,
                    notification_enabled=task.notification_enabled,
                    notification_offset_minutes=task.notification_offset_minutes,
                    notification_channel=task.notification_channel,
                    notification_sent_at=normalize_import_datetime(task.notification_sent_at),
                    created_at=ensure_aware_datetime(task.created_at),
                    updated_at=ensure_aware_datetime(task.updated_at),
                    completed_at=normalize_import_datetime(task.completed_at),
                )
                for task in backup.tasks
            )
            db.flush()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Backup import failed",
        ) from exc

    db.commit()
    return {
        "imported_task_lists": len(backup.task_lists),
        "imported_tasks": len(backup.tasks),
    }


def build_id_map(
    db: Session,
    *,
    model: type[TaskList] | type[ScheduledTask],
    ids: list[uuid.UUID],
    user_id: uuid.UUID,
) -> dict[uuid.UUID, uuid.UUID]:
    id_map: dict[uuid.UUID, uuid.UUID] = {}
    for item_id in ids:
        existing = db.get(model, item_id)
        if existing is not None and existing.user_id != user_id:
            id_map[item_id] = uuid.uuid4()
        else:
            id_map[item_id] = item_id
    return id_map


def serialize_task(task: ScheduledTask) -> dict[str, Any]:
    return {
        "id": str(task.id),
        "user_id": str(task.user_id),
        "list_id": str(task.list_id) if task.list_id is not None else None,
        "title": task.title,
        "notes": task.notes,
        "completed": task.completed,
        "scheduled_start": to_app_isoformat(task.scheduled_start),
        "scheduled_end": to_app_isoformat(task.scheduled_end),
        "all_day": task.all_day,
        "due_at": to_app_isoformat(task.due_at),
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
        "notification_sent_at": to_app_isoformat(task.notification_sent_at),
        "created_at": to_app_isoformat(task.created_at),
        "updated_at": to_app_isoformat(task.updated_at),
        "completed_at": to_app_isoformat(task.completed_at),
    }


def serialize_task_list(task_list: TaskList) -> dict[str, Any]:
    return {
        "id": str(task_list.id),
        "user_id": str(task_list.user_id),
        "name": task_list.name,
        "color": task_list.color,
        "created_at": to_app_isoformat(task_list.created_at),
        "updated_at": to_app_isoformat(task_list.updated_at),
    }


def normalize_import_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return ensure_aware_datetime(value)
