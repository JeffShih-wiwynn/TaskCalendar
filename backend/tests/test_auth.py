from collections.abc import Generator

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.auth.router import login, read_current_user, register
from app.auth.schemas import AuthCredentials
from app.core.database import Base
from app.models.user import User


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with TestingSessionLocal() as session:
        yield session

    Base.metadata.drop_all(bind=engine)


def test_register_creates_user_with_password_hash(db_session: Session) -> None:
    response = register(
        AuthCredentials(username="alice", password="secret-password"),
        db_session,
    )

    assert response.username == "alice"

    user = db_session.query(User).filter_by(username="alice").one()
    assert user.password_hash
    assert user.password_hash != "secret-password"


def test_register_rejects_duplicate_username(db_session: Session) -> None:
    credentials = AuthCredentials(username="alice", password="secret-password")
    register(credentials, db_session)

    with pytest.raises(HTTPException) as exc_info:
        register(credentials, db_session)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Username already registered"


def test_login_returns_token_for_valid_credentials(db_session: Session) -> None:
    credentials = AuthCredentials(username="alice", password="secret-password")
    register(credentials, db_session)

    response = login(credentials, db_session)

    assert response.token_type == "bearer"
    assert response.access_token


def test_login_rejects_invalid_credentials(db_session: Session) -> None:
    register(
        AuthCredentials(username="alice", password="secret-password"),
        db_session,
    )

    with pytest.raises(HTTPException) as exc_info:
        login(
            AuthCredentials(username="alice", password="wrong-password"),
            db_session,
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Invalid username or password"


def test_current_user_dependency_returns_authenticated_user(db_session: Session) -> None:
    credentials = AuthCredentials(username="alice", password="secret-password")
    register(credentials, db_session)
    token = login(credentials, db_session).access_token

    current_user = get_current_user(token, db_session)

    assert current_user.username == "alice"


def test_me_returns_authenticated_current_user(db_session: Session) -> None:
    credentials = AuthCredentials(username="alice", password="secret-password")
    register(credentials, db_session)
    token = login(credentials, db_session).access_token
    current_user = get_current_user(token, db_session)

    response = read_current_user(current_user)

    assert response.username == "alice"
