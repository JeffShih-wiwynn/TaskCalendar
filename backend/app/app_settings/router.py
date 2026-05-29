from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.app_settings import service
from app.app_settings.schemas import (
    AppSettingsRead,
    AppSettingsTestRequest,
    AppSettingsTestResponse,
    AppSettingsUpdate,
)
from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.models.user import User

router = APIRouter(prefix="/api/settings", tags=["settings"])

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=AppSettingsRead)
def get_app_settings(db: DbSession, current_user: CurrentUser) -> AppSettingsRead:
    return service.get_app_settings(db, current_user.id)


@router.patch("", response_model=AppSettingsRead)
def update_app_settings(
    data: AppSettingsUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> AppSettingsRead:
    return service.update_app_settings(db, data, current_user.id)


@router.post("/test-discord", response_model=AppSettingsTestResponse)
def test_discord_webhook(
    data: AppSettingsTestRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> AppSettingsTestResponse:
    return AppSettingsTestResponse(
        message=service.send_test_notification(db, data, current_user.id),
    )
