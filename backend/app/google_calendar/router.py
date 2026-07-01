from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.google_calendar import service
from app.google_calendar.schemas import (
    GoogleCalendarConnectResponse,
    GoogleCalendarDisconnectResponse,
    GoogleCalendarSyncNowResponse,
    GoogleCalendarStatusResponse,
)
from app.models.user import User

router = APIRouter(prefix="/api/google-calendar", tags=["google-calendar"])

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/status", response_model=GoogleCalendarStatusResponse)
def get_google_calendar_status(
    db: DbSession,
    current_user: CurrentUser,
) -> GoogleCalendarStatusResponse:
    return GoogleCalendarStatusResponse(**service.get_status(db, user_id=current_user.id))


@router.post("/connect", response_model=GoogleCalendarConnectResponse)
def connect_google_calendar(
    db: DbSession,
    current_user: CurrentUser,
) -> GoogleCalendarConnectResponse:
    return GoogleCalendarConnectResponse(
        authorization_url=service.create_connect_url(db, user_id=current_user.id),
    )


@router.get("/oauth/callback")
def google_calendar_oauth_callback(
    db: DbSession,
    state: Annotated[str | None, Query()] = None,
    code: Annotated[str | None, Query()] = None,
    error: Annotated[str | None, Query()] = None,
) -> RedirectResponse:
    connected = service.handle_oauth_callback(
        db,
        state_value=state,
        code=code,
        error_value=error,
    )
    result = "connected" if connected else "error"
    return RedirectResponse(f"{get_frontend_redirect_base()}?google_calendar={result}")


@router.post("/disconnect", response_model=GoogleCalendarDisconnectResponse)
def disconnect_google_calendar(
    db: DbSession,
    current_user: CurrentUser,
) -> GoogleCalendarDisconnectResponse:
    return GoogleCalendarDisconnectResponse(
        message=service.disconnect(db, user_id=current_user.id),
    )


@router.post("/sync-now", response_model=GoogleCalendarSyncNowResponse)
def sync_google_calendar_now(
    db: DbSession,
    current_user: CurrentUser,
) -> GoogleCalendarSyncNowResponse:
    return GoogleCalendarSyncNowResponse(
        **service.start_sync_now(db, user_id=current_user.id),
    )


def get_frontend_redirect_base() -> str:
    return (settings.app_base_url or "/").rstrip("/") or "/"
