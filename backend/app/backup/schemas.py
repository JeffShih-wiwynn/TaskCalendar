from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class BackupExportResponse(BaseModel):
    schema_version: int
    exported_at: datetime
    tasks: list[dict[str, Any]]
    task_lists: list[dict[str, Any]]

    model_config = ConfigDict(from_attributes=True)


class BackupTaskListImport(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str = Field(min_length=1, max_length=255)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(extra="forbid")


class BackupTaskImport(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    list_id: uuid.UUID | None
    title: str = Field(min_length=1, max_length=500)
    notes: str | None
    completed: bool
    scheduled_start: datetime | None
    scheduled_end: datetime | None
    due_at: datetime | None
    timezone: str = Field(min_length=1, max_length=100)
    priority: int | None
    unscheduled_order: int | None
    recurrence_rule: str | None = Field(max_length=255)
    recurrence_series_id: uuid.UUID | None
    notification_enabled: bool
    notification_offset_minutes: int = Field(ge=0, le=10_080)
    notification_channel: str | None = Field(max_length=50)
    notification_sent_at: datetime | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_scheduled_range(self) -> "BackupTaskImport":
        if (
            self.scheduled_start is not None
            and self.scheduled_end is not None
            and self.scheduled_end <= self.scheduled_start
        ):
            raise ValueError("scheduled_end must be after scheduled_start")
        return self


class BackupImportRequest(BaseModel):
    schema_version: int
    exported_at: datetime
    tasks: list[BackupTaskImport]
    task_lists: list[BackupTaskListImport]

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_references(self) -> "BackupImportRequest":
        task_list_ids = [task_list.id for task_list in self.task_lists]
        if len(set(task_list_ids)) != len(task_list_ids):
            raise ValueError("task_lists contain duplicate ids")

        task_ids = [task.id for task in self.tasks]
        if len(set(task_ids)) != len(task_ids):
            raise ValueError("tasks contain duplicate ids")

        task_list_id_set = set(task_list_ids)
        for task in self.tasks:
            if task.list_id is not None and task.list_id not in task_list_id_set:
                raise ValueError("tasks contain list_id values not present in task_lists")
        return self


class BackupImportResponse(BaseModel):
    imported_task_lists: int
    imported_tasks: int
