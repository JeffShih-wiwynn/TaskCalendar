from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AppSettingsRead(BaseModel):
    id: int
    discord_webhook_url: str | None
    discord_message_template: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AppSettingsUpdate(BaseModel):
    discord_webhook_url: str | None = Field(default=None, max_length=4000)
    discord_message_template: str | None = Field(default=None, max_length=4000)


class AppSettingsTestRequest(BaseModel):
    discord_webhook_url: str | None = Field(default=None, max_length=4000)
    discord_message_template: str | None = Field(default=None, max_length=4000)


class AppSettingsTestResponse(BaseModel):
    message: str
