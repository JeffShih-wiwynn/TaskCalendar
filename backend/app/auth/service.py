from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.scheduled_task import ScheduledTask
from app.models.task_list import TaskList
from app.models.user import User
from app.auth.schemas import AuthCredentials, ChangePasswordRequest, DeleteAccountRequest
from app.auth.security import create_access_token, hash_password, verify_password


def register_user(db: Session, credentials: AuthCredentials) -> User:
    username = normalize_username(credentials.username)
    if get_user_by_username(db, username) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already registered",
        )

    user = User(username=username, password_hash=hash_password(credentials.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already registered",
        ) from exc
    db.refresh(user)
    return user


def authenticate_user(db: Session, credentials: AuthCredentials) -> str:
    username = normalize_username(credentials.username)
    user = get_user_by_username(db, username)
    if user is None or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return create_access_token(str(user.id))


def change_password(
    db: Session,
    *,
    current_user: User,
    data: ChangePasswordRequest,
) -> str:
    user = db.get(User, current_user.id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if data.new_password != data.confirm_new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New passwords do not match",
        )

    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user.password_hash = hash_password(data.new_password)
    db.add(user)
    db.commit()
    return "Password updated"


def delete_account(
    db: Session,
    *,
    current_user: User,
    data: DeleteAccountRequest,
) -> str:
    confirmation = data.confirmation.strip()
    if confirmation != "DELETE":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Type DELETE to confirm account deletion",
        )

    user = db.get(User, current_user.id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    db.execute(delete(ScheduledTask).where(ScheduledTask.user_id == user.id))
    db.execute(delete(TaskList).where(TaskList.user_id == user.id))
    db.delete(user)
    db.commit()
    return "Account deleted"


def get_user_by_username(db: Session, username: str) -> User | None:
    statement = select(User).where(User.username == username)
    return db.scalar(statement)


def normalize_username(username: str) -> str:
    return username.strip()
