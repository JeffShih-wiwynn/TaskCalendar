from fastapi import HTTPException, status
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.app_settings import AppSettings
from app.app_settings.schemas import AppSettingsTestRequest, AppSettingsUpdate

APP_SETTINGS_SINGLETON_ID = 1


def get_app_settings(db: Session) -> AppSettings:
    app_settings = db.get(AppSettings, APP_SETTINGS_SINGLETON_ID)
    if app_settings is not None:
        return app_settings

    app_settings = AppSettings(id=APP_SETTINGS_SINGLETON_ID)
    db.add(app_settings)
    db.commit()
    db.refresh(app_settings)
    return app_settings


def update_app_settings(db: Session, data: AppSettingsUpdate) -> AppSettings:
    app_settings = get_app_settings(db)
    updates = data.model_dump(exclude_unset=True)

    if "discord_webhook_url" in updates:
        webhook_url = updates["discord_webhook_url"]
        app_settings.discord_webhook_url = webhook_url.strip() or None if webhook_url else None

    if "discord_message_template" in updates:
        message_template = updates["discord_message_template"]
        app_settings.discord_message_template = (
            message_template.strip() or None if message_template else None
        )

    app_settings.updated_at = datetime.now(UTC)
    db.add(app_settings)
    db.commit()
    db.refresh(app_settings)
    return app_settings


def send_test_notification(
    db: Session,
    data: AppSettingsTestRequest,
    *,
    sender=None,
) -> str:
    from app.tasks.notifications import send_discord_notification

    app_settings = get_app_settings(db)
    webhook_url = normalize_text(
        data.discord_webhook_url,
    ) or app_settings.discord_webhook_url
    message_template = normalize_text(
        data.discord_message_template,
    ) or app_settings.discord_message_template

    if not webhook_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Webhook URL is required to send a test notification",
        )

    message = build_test_notification_message(
        app_base_url=settings.app_base_url,
        message_template=message_template,
    )

    if sender is None:
        sender = send_discord_notification

    try:
        sender(webhook_url, message)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return "Test webhook sent"


def build_test_notification_message(
    *,
    app_base_url: str | None,
    message_template: str | None,
) -> str:
    if message_template:
        from app.tasks.notifications import apply_message_template

        message = apply_message_template(
            message_template,
            {
                "title": "Test task",
                "when": "2026-05-08 10:00 - 2026-05-08 11:00",
                "notes": "This is a webhook test.",
                "app_url": app_base_url.rstrip("/") if app_base_url else "",
            },
        )
        if message:
            return message

    lines = ["Test notification from Calendar"]
    lines.append("Task: Test task")
    lines.append("When: 2026-05-08 10:00 - 2026-05-08 11:00")
    lines.append("Notes: This is a webhook test.")

    if app_base_url:
        lines.append(f"Open app: {app_base_url.rstrip('/')}")

    return "\n".join(lines)


def normalize_text(value: str | None) -> str | None:
    if value is None:
        return None

    stripped_value = value.strip()
    return stripped_value or None
