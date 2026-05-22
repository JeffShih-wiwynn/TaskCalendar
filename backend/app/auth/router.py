from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.dependencies import get_current_user
from app.auth.schemas import (
    ActionResponse,
    AuthCredentials,
    ChangePasswordRequest,
    DeleteAccountRequest,
    TokenResponse,
    UserRead,
)
from app.core.database import get_db
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(credentials: AuthCredentials, db: DbSession) -> UserRead:
    return service.register_user(db, credentials)


@router.post("/login", response_model=TokenResponse)
def login(credentials: AuthCredentials, db: DbSession) -> TokenResponse:
    return TokenResponse(access_token=service.authenticate_user(db, credentials))


@router.get("/me", response_model=UserRead)
def read_current_user(current_user: CurrentUser) -> UserRead:
    return current_user


@router.patch("/password", response_model=ActionResponse)
def change_password(
    data: ChangePasswordRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> ActionResponse:
    return ActionResponse(
        message=service.change_password(db, current_user=current_user, data=data),
    )


@router.delete("/me", response_model=ActionResponse)
def delete_account(
    data: DeleteAccountRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> ActionResponse:
    return ActionResponse(
        message=service.delete_account(db, current_user=current_user, data=data),
    )
