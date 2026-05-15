import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator

from app.core.timezone import get_app_timezone_name, to_app_timezone


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
    unscheduled_order: int | None = None
    recurrence_rule: str | None = Field(default=None, max_length=255)
    notification_enabled: bool | None = None
    notification_offset_minutes: int | None = Field(default=None, ge=0, le=10_080)
    notification_channel: str | None = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def validate_scheduled_range(self) -> "ScheduledTaskBase":
        if (
            self.scheduled_start is not None
            and self.scheduled_end is not None
            and self.scheduled_end <= self.scheduled_start
        ):
            raise ValueError("scheduled_end must be after scheduled_start")
        return self

    @model_validator(mode="after")
    def validate_recurrence_rule(self) -> "ScheduledTaskBase":
        if self.recurrence_rule is None:
            return self

        validate_recurrence_rule_value(self.recurrence_rule)
        return self


class ScheduledTaskCreate(ScheduledTaskBase):
    user_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=500)
    timezone: str = Field(default_factory=get_app_timezone_name, min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_recurring_task_requires_start(self) -> "ScheduledTaskCreate":
        if self.recurrence_rule is not None and self.scheduled_start is None:
            raise ValueError("Recurring tasks require scheduled_start")
        return self


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
    unscheduled_order: int | None
    recurrence_rule: str | None
    recurrence_series_id: uuid.UUID | None
    notification_enabled: bool
    notification_offset_minutes: int
    notification_channel: str | None
    notification_sent_at: datetime | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)

    @field_serializer(
        "scheduled_start",
        "scheduled_end",
        "due_at",
        "notification_sent_at",
        "created_at",
        "updated_at",
        "completed_at",
    )
    def serialize_app_datetime(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return to_app_timezone(value).isoformat()


def validate_recurrence_rule_value(recurrence_rule: str) -> None:
    parts = {}
    for segment in recurrence_rule.split(";"):
        if "=" not in segment:
            continue
        key, value = segment.split("=", 1)
        parts[key.strip().upper()] = value.strip()

    frequency = parts.get("FREQ")
    if frequency not in {"DAILY", "WEEKLY", "MONTHLY", "YEARLY"}:
        raise ValueError("recurrence_rule must use FREQ=DAILY, WEEKLY, MONTHLY, or YEARLY")

    interval = parts.get("INTERVAL", "1")
    if not interval.isdigit() or int(interval) < 1:
        raise ValueError("recurrence_rule must use a positive INTERVAL")

    until = parts.get("UNTIL")
    if until is not None:
        try:
            datetime.fromisoformat(until.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("recurrence_rule UNTIL must be an ISO datetime") from error
