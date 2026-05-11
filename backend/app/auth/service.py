from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.schemas import AuthCredentials
from app.auth.security import create_access_token, hash_password, verify_password
from app.models.user import User


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


def get_user_by_username(db: Session, username: str) -> User | None:
    statement = select(User).where(User.username == username)
    return db.scalar(statement)


def normalize_username(username: str) -> str:
    return username.strip()
