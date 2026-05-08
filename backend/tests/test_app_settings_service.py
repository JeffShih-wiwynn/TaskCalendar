from collections.abc import Generator

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.app_settings import service
from app.app_settings.schemas import AppSettingsTestRequest, AppSettingsUpdate
from app.core.database import Base


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


def test_get_app_settings_creates_singleton(db_session: Session) -> None:
    settings = service.get_app_settings(db_session)

    assert settings.id == 1
    assert settings.discord_webhook_url is None
    assert settings.discord_message_template is None


def test_update_app_settings_trims_blank_values(db_session: Session) -> None:
    updated = service.update_app_settings(
        db_session,
        AppSettingsUpdate(
            discord_webhook_url=" https://discord.example/webhook ",
            discord_message_template=" Task due: {title} ",
        ),
    )

    assert updated.discord_webhook_url == "https://discord.example/webhook"
    assert updated.discord_message_template == "Task due: {title}"

    reset = service.update_app_settings(
        db_session,
        AppSettingsUpdate(
            discord_webhook_url="",
            discord_message_template="   ",
        ),
    )

    assert reset.discord_webhook_url is None
    assert reset.discord_message_template is None


def test_send_test_notification_uses_draft_values(db_session: Session) -> None:
    sent_messages: list[tuple[str, str]] = []

    message = service.send_test_notification(
        db_session,
        AppSettingsTestRequest(
            discord_webhook_url=" https://discord.example/webhook ",
            discord_message_template="Task {title}\nWhen {when}",
        ),
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
    with pytest.raises(Exception) as exc_info:
        service.send_test_notification(
            db_session,
            AppSettingsTestRequest(),
        )

    assert "Webhook URL is required" in str(exc_info.value)


def test_send_test_notification_surfaces_clear_discord_403_message(
    db_session: Session,
) -> None:
    with pytest.raises(HTTPException) as exc_info:
        service.send_test_notification(
            db_session,
            AppSettingsTestRequest(
                discord_webhook_url="https://discord.example/webhook",
            ),
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
