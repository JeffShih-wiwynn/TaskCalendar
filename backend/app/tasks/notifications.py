from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timedelta
from typing import Callable
from urllib import error, request
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session

from app.app_settings.service import get_app_settings
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.timezone import ensure_aware_datetime, get_app_timezone, now_in_app_timezone
from app.models.scheduled_task import ScheduledTask

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 30
DISCORD_WEBHOOK_USER_AGENT = "CalendarWebhook/0.1"


def start_notification_worker() -> tuple[threading.Event, threading.Thread]:
    stop_event = threading.Event()
    worker = threading.Thread(
        target=run_notification_worker,
        args=(stop_event,),
        name="notification-worker",
        daemon=True,
    )
    worker.start()
    return stop_event, worker


def run_notification_worker(stop_event: threading.Event) -> None:
    while not stop_event.is_set():
        try:
            with SessionLocal() as db:
                app_settings = get_app_settings(db)
                send_due_notifications(
                    db,
                    now=now_in_app_timezone(),
                    webhook_url=(
                        app_settings.discord_webhook_url
                        or settings.discord_webhook_url
                    ),
                    app_base_url=settings.app_base_url,
                    message_template=app_settings.discord_message_template,
                )
        except Exception:
            logger.exception("Notification worker loop failed")
        stop_event.wait(POLL_INTERVAL_SECONDS)


def send_due_notifications(
    db: Session,
    *,
    now: datetime,
    webhook_url: str | None,
    app_base_url: str | None,
    message_template: str | None = None,
    sender: Callable[[str, str], None] | None = None,
) -> int:
    if not webhook_url:
        return 0

    if sender is None:
        sender = send_discord_notification

    now = ensure_aware_datetime(now)

    statement: Select[tuple[ScheduledTask]] = select(ScheduledTask).where(
        ScheduledTask.notification_enabled.is_(True),
        ScheduledTask.notification_sent_at.is_(None),
        ScheduledTask.completed.is_(False),
        or_(
            ScheduledTask.notification_channel.is_(None),
            ScheduledTask.notification_channel == "discord",
        ),
        ScheduledTask.scheduled_start.is_not(None),
    )

    tasks = list(db.scalars(statement.order_by(ScheduledTask.scheduled_start)).all())
    sent_count = 0

    for task in tasks:
        notify_at = get_notify_at(task)
        if notify_at is None or notify_at > now:
            continue

        try:
            sender(
                webhook_url,
                build_discord_message(task, app_base_url, message_template),
            )
        except Exception:
            logger.exception("Failed to send Discord notification for task %s", task.id)
            continue

        task.notification_sent_at = now
        db.add(task)
        db.commit()
        sent_count += 1

    return sent_count


def get_notify_at(task: ScheduledTask) -> datetime | None:
    if task.scheduled_start is None:
        return None

    offset = max(0, task.notification_offset_minutes or 0)
    start = task.scheduled_start
    start = ensure_aware_datetime(start)
    return start - timedelta(minutes=offset)


def build_discord_message(
    task: ScheduledTask,
    app_base_url: str | None,
    message_template: str | None = None,
) -> str:
    if message_template:
        message = apply_message_template(
            message_template,
            {
                "title": task.title,
                "when": format_task_time_range(task),
                "notes": task.notes or "",
                "app_url": app_base_url.rstrip("/") if app_base_url else "",
            },
        )
        if message:
            return message

    lines = [f"Task due: {task.title}"]
    lines.append(f"When: {format_task_time_range(task)}")

    if task.notes:
        lines.append(f"Notes: {task.notes}")

    if app_base_url:
        lines.append(f"Open app: {app_base_url.rstrip('/')}")

    return "\n".join(lines)


def apply_message_template(template: str, values: dict[str, str]) -> str:
    message = template
    for key, value in values.items():
        message = message.replace(f"{{{key}}}", value)
    return message.strip()


def send_discord_notification(webhook_url: str, message: str) -> None:
    payload = json.dumps({"content": message}).encode("utf-8")
    request_obj = request.Request(
        webhook_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": DISCORD_WEBHOOK_USER_AGENT,
        },
        method="POST",
    )

    try:
        with request.urlopen(request_obj, timeout=10) as response:
            if response.status >= 400:
                raise RuntimeError(format_discord_webhook_error(response.status))
    except error.HTTPError as exc:
        detail = read_discord_error_detail(exc)
        raise RuntimeError(format_discord_webhook_error(exc.code, detail)) from exc
    except error.URLError as exc:
        raise RuntimeError("Discord webhook request failed") from exc


def format_discord_webhook_error(
    status_code: int,
    detail: str | None = None,
) -> str:
    if status_code == 403:
        message = (
            "Webhook rejected by Discord (403). "
            "Check whether the webhook URL is valid, still active, and allowed to post."
        )
        return f"{message} Discord said: {detail}" if detail else message

    if detail:
        return f"Discord webhook failed with {status_code}. Discord said: {detail}"

    return f"Discord webhook failed with {status_code}"


def read_discord_error_detail(exc: error.HTTPError) -> str | None:
    try:
        response_body = exc.read().decode("utf-8").strip()
    except Exception:
        return None

    if not response_body:
        return None

    try:
        payload = json.loads(response_body)
    except json.JSONDecodeError:
        return response_body

    message = payload.get("message")
    code = payload.get("code")

    if isinstance(message, str) and code is not None:
        return f"{message} (code {code})"
    if isinstance(message, str):
        return message

    return response_body


def format_task_time_range(task: ScheduledTask) -> str:
    start = format_local_datetime(task.scheduled_start, task.timezone)
    if task.scheduled_end is None:
        return start

    return f"{start} - {format_local_datetime(task.scheduled_end, task.timezone)}"


def format_local_datetime(value: datetime | None, timezone_name: str) -> str:
    if value is None:
        return "unscheduled"

    try:
        timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        timezone = get_app_timezone()

    local_value = ensure_aware_datetime(value).astimezone(timezone)
    return local_value.strftime("%Y-%m-%d %H:%M")
