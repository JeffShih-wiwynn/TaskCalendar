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
from app.core.database import get_db

router = APIRouter(prefix="/api/settings", tags=["settings"])

DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=AppSettingsRead)
def get_app_settings(db: DbSession) -> AppSettingsRead:
    return service.get_app_settings(db)


@router.patch("", response_model=AppSettingsRead)
def update_app_settings(data: AppSettingsUpdate, db: DbSession) -> AppSettingsRead:
    return service.update_app_settings(db, data)


@router.post("/test-discord", response_model=AppSettingsTestResponse)
def test_discord_webhook(
    data: AppSettingsTestRequest,
    db: DbSession,
) -> AppSettingsTestResponse:
    return AppSettingsTestResponse(
        message=service.send_test_notification(db, data),
    )
