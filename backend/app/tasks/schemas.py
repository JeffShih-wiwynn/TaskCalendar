import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ScheduledTaskBase(BaseModel):
    list_id: uuid.UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=500)
    notes: str | None = None
    completed: bool | None = None
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    due_at: datetime | None = None
    timezone: str | None = Field(default=None, min_length=1, max_length=100)
    priority: int | None = None

    @model_validator(mode="after")
    def validate_scheduled_range(self) -> "ScheduledTaskBase":
        if (
            self.scheduled_start is not None
            and self.scheduled_end is not None
            and self.scheduled_end <= self.scheduled_start
        ):
            raise ValueError("scheduled_end must be after scheduled_start")
        return self


class ScheduledTaskCreate(ScheduledTaskBase):
    user_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=500)
    timezone: str = Field(default="Asia/Taipei", min_length=1, max_length=100)


class ScheduledTaskUpdate(ScheduledTaskBase):
    pass


class ScheduledTaskRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    list_id: uuid.UUID | None
    title: str
    notes: str | None
    completed: bool
    scheduled_start: datetime | None
    scheduled_end: datetime | None
    due_at: datetime | None
    timezone: str
    priority: int | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)
