from collections.abc import Generator

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.auth.router import change_password, delete_account, login, read_current_user, register
from app.auth.schemas import AuthCredentials, ChangePasswordRequest, DeleteAccountRequest
from app.core.database import Base
from app.models.user import User
from app.task_lists import service as task_list_service
from app.task_lists.schemas import TaskListCreate
from app.tasks import service as task_service
from app.tasks.schemas import ScheduledTaskCreate


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


def test_change_password_requires_current_password(db_session: Session) -> None:
    credentials = AuthCredentials(username="alice", password="secret-password")
    register(credentials, db_session)
    token = login(credentials, db_session).access_token
    current_user = get_current_user(token, db_session)

    with pytest.raises(HTTPException) as exc_info:
        change_password(
            ChangePasswordRequest(
                current_password="wrong-password",
                new_password="new-secret",
                confirm_new_password="new-secret",
            ),
            db_session,
            current_user=current_user,
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Current password is incorrect"


def test_change_password_updates_hash_and_requires_confirmation_match(
    db_session: Session,
) -> None:
    credentials = AuthCredentials(username="alice", password="secret-password")
    register(credentials, db_session)
    current_user = get_current_user(login(credentials, db_session).access_token, db_session)

    with pytest.raises(HTTPException) as exc_info:
        change_password(
            ChangePasswordRequest(
                current_password="secret-password",
                new_password="new-secret",
                confirm_new_password="different-secret",
            ),
            db_session,
            current_user=current_user,
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "New passwords do not match"

    response = change_password(
        ChangePasswordRequest(
            current_password="secret-password",
            new_password="new-secret",
            confirm_new_password="new-secret",
        ),
        db_session,
        current_user=current_user,
    )

    assert response.message == "Password updated"
    with pytest.raises(HTTPException) as exc_info:
        login(credentials, db_session)

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Invalid username or password"
    assert login(AuthCredentials(username="alice", password="new-secret"), db_session)


def test_delete_account_removes_owned_tasks_and_categories(
    db_session: Session,
) -> None:
    credentials = AuthCredentials(username="alice", password="secret-password")
    register(credentials, db_session)
    token = login(credentials, db_session).access_token
    current_user = get_current_user(token, db_session)
    task_list = task_list_service.create_task_list(
        db_session,
        TaskListCreate(name="Alice list", color="#2f80ed"),
        user_id=current_user.id,
    )
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Alice task", list_id=task_list.id),
        user_id=current_user.id,
    )

    with pytest.raises(HTTPException) as exc_info:
        delete_account(
            DeleteAccountRequest(confirmation="NOPE"),
            db_session,
            current_user=current_user,
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Type DELETE to confirm account deletion"

    response = delete_account(
        DeleteAccountRequest(confirmation="DELETE"),
        db_session,
        current_user=current_user,
    )

    assert response.message == "Account deleted"
    with pytest.raises(HTTPException) as exc_info:
        get_current_user(token, db_session)

    assert exc_info.value.status_code == 401
    assert db_session.query(User).filter_by(username="alice").count() == 0
    assert task_service.list_tasks(db_session, user_id=current_user.id) == []
    assert task_list_service.list_task_lists(db_session, user_id=current_user.id) == []
