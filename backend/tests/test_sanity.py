from collections.abc import Generator
import asyncio

import app.models  # noqa: F401
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

from app.auth.dependencies import get_current_user, oauth2_scheme
from app.auth.router import login, register
from app.auth.schemas import AuthCredentials
from app.backup.router import export_backup
from app.core.database import Base
from app.health.router import health_check
from app.main import create_app
from app.task_lists.router import list_task_lists
from app.tasks.router import list_tasks


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


def test_app_imports_and_health_endpoint_responds() -> None:
    app = create_app(start_worker=False)

    assert app.title == "Calendar API"
    assert health_check()["status"] == "ok"


def test_auth_task_category_and_backup_sanity_flow(db_session: Session) -> None:
    credentials = AuthCredentials(username="sanity", password="secret-password")

    registered = register(credentials, db_session)
    assert registered.username == "sanity"

    token = login(credentials, db_session).access_token
    current_user = get_current_user(token, db_session)

    assert list_tasks(db_session, current_user=current_user) == []
    assert list_task_lists(db_session, current_user=current_user) == []

    backup = export_backup(db_session, current_user=current_user)
    assert backup.schema_version == 1
    assert backup.tasks == []
    assert backup.task_lists == []


def test_user_scoped_dependencies_reject_invalid_auth(db_session: Session) -> None:
    with pytest.raises(HTTPException) as exc_info:
        get_current_user("invalid-token", db_session)

    assert exc_info.value.status_code == 401


def test_user_scoped_dependencies_reject_missing_auth() -> None:
    async def run() -> None:
        request = Request({"type": "http", "headers": []})
        with pytest.raises(HTTPException) as exc_info:
            await oauth2_scheme(request)

        assert exc_info.value.status_code == 401

    asyncio.run(run())
