from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.backup.schemas import BackupExportResponse, BackupImportRequest, BackupImportResponse
from app.backup.service import export_user_backup, import_user_backup
from app.core.database import get_db
from app.models.user import User

router = APIRouter(prefix="/backup", tags=["backup"])

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/export", response_model=BackupExportResponse)
def export_backup(db: DbSession, current_user: CurrentUser) -> BackupExportResponse:
    return BackupExportResponse(
        **export_user_backup(db, user_id=current_user.id),
    )


@router.post("/import", response_model=BackupImportResponse)
def import_backup(
    backup: BackupImportRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> BackupImportResponse:
    return BackupImportResponse(
        **import_user_backup(db, backup, user_id=current_user.id),
    )
