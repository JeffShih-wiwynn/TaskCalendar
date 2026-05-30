from collections.abc import Generator
import asyncio

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

import app.models  # noqa: F401
from app.app_settings import service
from app.app_settings.schemas import AppSettingsTestRequest, AppSettingsUpdate
from app.auth.dependencies import get_current_user, oauth2_scheme
from app.core.database import Base
from app.main import create_app
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


def create_user(db_session: Session, username: str) -> User:
    user = User(username=username)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_get_app_settings_creates_user_scoped_settings(db_session: Session) -> None:
    user = create_user(db_session, "alice")

    settings = service.get_app_settings(db_session, user.id)

    assert settings.user_id == user.id
    assert settings.discord_webhook_url is None
    assert settings.discord_message_template is None
    assert settings.working_hours_start == "08:00"


def test_update_app_settings_trims_blank_values(db_session: Session) -> None:
    user = create_user(db_session, "alice")

    updated = service.update_app_settings(
        db_session,
        AppSettingsUpdate(
            discord_webhook_url=" https://discord.example/webhook ",
            discord_message_template=" Task due: {title} ",
            working_hours_start="09:00",
        ),
        user.id,
    )

    assert updated.discord_webhook_url == "https://discord.example/webhook"
    assert updated.discord_message_template == "Task due: {title}"
    assert updated.working_hours_start == "09:00"

    reset = service.update_app_settings(
        db_session,
        AppSettingsUpdate(
            discord_webhook_url="",
            discord_message_template="   ",
        ),
        user.id,
    )

    assert reset.discord_webhook_url is None
    assert reset.discord_message_template is None


def test_send_test_notification_uses_draft_values(db_session: Session) -> None:
    user = create_user(db_session, "alice")
    sent_messages: list[tuple[str, str]] = []

    message = service.send_test_notification(
        db_session,
        AppSettingsTestRequest(
            discord_webhook_url=" https://discord.example/webhook ",
            discord_message_template="Task {title}\nWhen {when}",
        ),
        user.id,
        sender=lambda webhook_url, payload: sent_messages.append(
            (webhook_url, payload),
        ),
    )

    assert message == "Test webhook sent"
    assert sent_messages == [
        (
            "https://discord.example/webhook",
            "Task Test task\nWhen 2026-05-08 10:00 - 2026-05-08 11:00",
        ),
    ]


def test_send_test_notification_requires_webhook_url(db_session: Session) -> None:
    user = create_user(db_session, "alice")

    with pytest.raises(Exception) as exc_info:
        service.send_test_notification(
            db_session,
            AppSettingsTestRequest(),
            user.id,
        )

    assert "Webhook URL is required" in str(exc_info.value)


def test_send_test_notification_surfaces_clear_discord_403_message(
    db_session: Session,
) -> None:
    user = create_user(db_session, "alice")

    with pytest.raises(HTTPException) as exc_info:
        service.send_test_notification(
            db_session,
            AppSettingsTestRequest(
                discord_webhook_url="https://discord.example/webhook",
            ),
            user.id,
            sender=lambda _webhook_url, _payload: (_ for _ in ()).throw(
                RuntimeError(
                    "Webhook rejected by Discord (403). "
                    "Check whether the webhook URL is valid, still active, and allowed to post.",
                ),
            ),
        )

    assert exc_info.value.status_code == 400
    assert (
        exc_info.value.detail
        == "Webhook rejected by Discord (403). "
        "Check whether the webhook URL is valid, still active, and allowed to post."
    )


def test_app_settings_routes_require_authentication() -> None:
    app = create_app(start_worker=False)
    settings_routes = [
        route
        for route in app.routes
        if isinstance(route, APIRoute)
        and route.path in {"/api/settings", "/api/settings/test-discord"}
    ]

    assert settings_routes
    for route in settings_routes:
        dependency_calls = {dependency.call for dependency in route.dependant.dependencies}
        assert get_current_user in dependency_calls

    async def run() -> None:
        request = Request({"type": "http", "headers": []})
        with pytest.raises(HTTPException) as exc_info:
            await oauth2_scheme(request)

        assert exc_info.value.status_code == 401

    asyncio.run(run())


def test_app_settings_are_user_scoped(db_session: Session) -> None:
    alice = create_user(db_session, "alice")
    bob = create_user(db_session, "bob")

    alice_settings = service.update_app_settings(
        db_session,
        AppSettingsUpdate(
            discord_webhook_url="https://discord.example/alice",
            discord_message_template="Alice {title}",
        ),
        alice.id,
    )
    bob_settings = service.update_app_settings(
        db_session,
        AppSettingsUpdate(
            discord_webhook_url="https://discord.example/bob",
            discord_message_template="Bob {title}",
        ),
        bob.id,
    )

    assert service.get_app_settings(db_session, alice.id).id == alice_settings.id
    assert service.get_app_settings(db_session, bob.id).id == bob_settings.id
    assert alice_settings.id != bob_settings.id
    assert alice_settings.discord_webhook_url == "https://discord.example/alice"
    assert bob_settings.discord_webhook_url == "https://discord.example/bob"


def test_send_test_notification_uses_current_users_saved_settings(
    db_session: Session,
) -> None:
    alice = create_user(db_session, "alice")
    bob = create_user(db_session, "bob")
    service.update_app_settings(
        db_session,
        AppSettingsUpdate(discord_webhook_url="https://discord.example/alice"),
        alice.id,
    )
    service.update_app_settings(
        db_session,
        AppSettingsUpdate(discord_webhook_url="https://discord.example/bob"),
        bob.id,
    )
    sent_urls: list[str] = []

    service.send_test_notification(
        db_session,
        AppSettingsTestRequest(),
        alice.id,
        sender=lambda webhook_url, _payload: sent_urls.append(webhook_url),
    )

    assert sent_urls == ["https://discord.example/alice"]
