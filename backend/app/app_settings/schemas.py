from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AppSettingsRead(BaseModel):
    id: int
    discord_webhook_url: str | None
    discord_message_template: str | None
    working_hours_start: str
    week_start: Literal["sunday", "monday"]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AppSettingsUpdate(BaseModel):
    discord_webhook_url: str | None = Field(default=None, max_length=4000)
    discord_message_template: str | None = Field(default=None, max_length=4000)
    working_hours_start: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    week_start: Literal["sunday", "monday"] | None = None

    @field_validator("working_hours_start")
    @classmethod
    def validate_working_hours_start(cls, value: str | None) -> str | None:
        if value is None:
            return None

        hour, minute = (int(part) for part in value.split(":", 1))
        if hour > 23 or minute > 59:
            raise ValueError("working_hours_start must be a valid HH:MM time")
        return value


class AppSettingsTestRequest(BaseModel):
    discord_webhook_url: str | None = Field(default=None, max_length=4000)
    discord_message_template: str | None = Field(default=None, max_length=4000)


class AppSettingsTestResponse(BaseModel):
    message: str
