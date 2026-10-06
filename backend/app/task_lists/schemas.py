import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TaskListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    color: str = Field(default="#176b58", pattern=r"^#[0-9a-fA-F]{6}$")
    google_sync_enabled: bool = False


class TaskListUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    google_sync_enabled: bool | None = None


class TaskListRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    color: str
    google_sync_enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
