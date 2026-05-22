import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.dependencies import get_current_admin_user
from app.auth.schemas import ActionResponse, UserRead
from app.core.database import get_db
from app.models.user import User

router = APIRouter(prefix="/admin", tags=["admin"])

DbSession = Annotated[Session, Depends(get_db)]
CurrentAdminUser = Annotated[User, Depends(get_current_admin_user)]


@router.get("/users", response_model=list[UserRead])
def list_users(db: DbSession, current_admin: CurrentAdminUser) -> list[UserRead]:
    del current_admin
    return service.list_users(db)


@router.get("/users/{user_id}", response_model=UserRead)
def get_user(
    user_id: uuid.UUID,
    db: DbSession,
    current_admin: CurrentAdminUser,
) -> UserRead:
    del current_admin
    return service.get_user_or_404(db, user_id)


@router.delete("/users/{user_id}", response_model=ActionResponse)
def delete_user(
    user_id: uuid.UUID,
    db: DbSession,
    current_admin: CurrentAdminUser,
) -> ActionResponse:
    del current_admin
    return ActionResponse(message=service.delete_user_as_admin(db, user_id=user_id))
