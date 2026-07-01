from datetime import datetime
from typing import Literal

from pydantic import BaseModel


GoogleCalendarConnectionStatus = Literal["connected", "needs_reauth", "disabled", "error"]


class GoogleCalendarStatusResponse(BaseModel):
    connected: bool
    status: GoogleCalendarConnectionStatus
    mirror_calendar_summary: str | None
    last_successful_sync_at: datetime | None
    last_error_when_safe_to_show: str | None
    pending_sync_items: int


class GoogleCalendarConnectResponse(BaseModel):
    authorization_url: str


class GoogleCalendarDisconnectResponse(BaseModel):
    message: str


class GoogleCalendarSyncNowResponse(BaseModel):
    started: bool
    pending_sync_items: int
    message: str
