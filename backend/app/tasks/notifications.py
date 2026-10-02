from __future__ import annotations

import json
import logging
import os
import socket
import threading
import uuid
from datetime import datetime, time, timedelta
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
from app.tasks.daily_notifications import (
    ScannerResult,
    enqueue_due_daily_todo_notifications,
)

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 30
DAILY_NOTIFICATION_MAX_JOBS_PER_LOOP = 5
DISCORD_WEBHOOK_USER_AGENT = "CalendarWebhook/0.1"


def start_notification_worker() -> tuple[threading.Event, threading.Thread]:
    stop_event = threading.Event()
    worker_id = build_notification_worker_id()
    worker = threading.Thread(
        target=run_notification_worker,
        args=(stop_event, worker_id),
        name="notification-worker",
        daemon=True,
    )
    worker.start()
    return stop_event, worker


def run_notification_worker(stop_event: threading.Event, worker_id: str | None = None) -> None:
    worker_id = worker_id or build_notification_worker_id()
    while not stop_event.is_set():
        run_notification_worker_once(worker_id=worker_id)
        stop_event.wait(POLL_INTERVAL_SECONDS)


def run_notification_worker_once(*, worker_id: str) -> None:
    try:
        with SessionLocal() as db:
            send_due_notifications(
                db,
                now=now_in_app_timezone(),
                webhook_url=None,
                app_base_url=settings.app_base_url,
            )
    except Exception:
        logger.exception("Per-task notification worker step failed")

    try:
        scanner_result = enqueue_due_daily_todo_notifications(SessionLocal)
        log_daily_scanner_result(scanner_result)
    except Exception:
        logger.exception("Daily todo notification scanner step failed")

    try:
        from app.tasks.daily_todo_delivery import process_available_daily_todo_notifications

        processing_result = process_available_daily_todo_notifications(
            SessionLocal,
            worker_id=worker_id,
            max_jobs=DAILY_NOTIFICATION_MAX_JOBS_PER_LOOP,
            app_url=get_notification_app_url(),
        )
        log_daily_processing_result(processing_result)
    except Exception:
        logger.exception("Daily todo notification processing step failed")


def build_notification_worker_id() -> str:
    hostname = socket.gethostname()[:40]
    random_suffix = uuid.uuid4().hex[:12]
    return f"notification-worker:{hostname}:{os.getpid()}:{random_suffix}"[:100]


def get_notification_app_url() -> str | None:
    app_url = settings.app_base_url.strip() if settings.app_base_url else ""
    return app_url or None


def log_daily_scanner_result(result: ScannerResult) -> None:
    if not (
        result.records_created
        or result.invalid_timezone
        or result.invalid_working_hours
    ):
        return

    logger.info(
        "Daily todo notification scanner result",
        extra={
            "users_examined": result.users_examined,
            "records_created": result.records_created,
            "duplicates_ignored": result.duplicates_ignored,
            "before_schedule": result.before_schedule,
            "outside_grace_window": result.outside_grace_window,
            "invalid_timezone": result.invalid_timezone,
            "invalid_working_hours": result.invalid_working_hours,
        },
    )


def log_daily_processing_result(result) -> None:
    if not (
        result.claimed
        or result.finalization_conflicts
        or result.unexpected_errors
    ):
        return

    logger.info(
        "Daily todo notification processing result",
        extra={
            "claimed": result.claimed,
            "sent": result.sent,
            "skipped": result.skipped,
            "cancelled": result.cancelled,
            "failed": result.failed,
            "dead": result.dead,
            "claim_misses": result.claim_misses,
            "finalization_conflicts": result.finalization_conflicts,
            "unexpected_errors": result.unexpected_errors,
        },
    )


def send_due_notifications(
    db: Session,
    *,
    now: datetime,
    webhook_url: str | None,
    app_base_url: str | None,
    message_template: str | None = None,
    sender: Callable[[str, str], None] | None = None,
) -> int:
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
        task_settings = get_app_settings(db, task.user_id)
        notify_at = get_notify_at(
            task,
            working_hours_start=task_settings.working_hours_start,
        )
        if notify_at is None or notify_at > now:
            continue
        effective_webhook_url = (
            webhook_url
            or task_settings.discord_webhook_url
            or settings.discord_webhook_url
        )
        if not effective_webhook_url:
            continue

        try:
            sender(
                effective_webhook_url,
                build_discord_message(
                    task,
                    app_base_url,
                    message_template or task_settings.discord_message_template,
                ),
            )
        except Exception:
            logger.exception("Failed to send Discord notification for task %s", task.id)
            continue

        task.notification_sent_at = now
        db.add(task)
        db.commit()
        sent_count += 1

    return sent_count


def get_notify_at(
    task: ScheduledTask,
    *,
    working_hours_start: str | None = None,
) -> datetime | None:
    if task.scheduled_start is None:
        return None

    offset = max(0, task.notification_offset_minutes or 0)
    start = get_notification_start(task, working_hours_start=working_hours_start)
    return start - timedelta(minutes=offset)


def get_notification_start(
    task: ScheduledTask,
    *,
    working_hours_start: str | None = None,
) -> datetime:
    if not task.all_day:
        return ensure_aware_datetime(task.scheduled_start)

    notification_timezone = get_notification_timezone(task)
    scheduled_start = task.scheduled_start
    if scheduled_start.tzinfo is None:
        local_date = scheduled_start.date()
    else:
        local_date = scheduled_start.astimezone(notification_timezone).date()
    reminder_time = parse_working_hours_start(working_hours_start)
    return datetime.combine(
        local_date,
        reminder_time,
        tzinfo=notification_timezone,
    )


def get_notification_timezone(task: ScheduledTask) -> ZoneInfo:
    timezone_name = get_effective_notification_timezone(task)
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return get_app_timezone()


def parse_working_hours_start(value: str | None) -> time:
    if not value:
        return time(hour=8)

    try:
        hour_text, minute_text = value.split(":", 1)
        hour = int(hour_text)
        minute = int(minute_text)
    except ValueError:
        return time(hour=8)

    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return time(hour=8)

    return time(hour=hour, minute=minute)


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


class DiscordWebhookError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        retryable: bool,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable


def send_discord_webhook_message(webhook_url: str, message: str) -> None:
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
                raise DiscordWebhookError(
                    format_discord_webhook_error(response.status),
                    status_code=response.status,
                    retryable=is_retryable_discord_status(response.status),
                )
    except error.HTTPError as exc:
        detail = read_discord_error_detail(exc)
        raise DiscordWebhookError(
            format_discord_webhook_error(exc.code, detail),
            status_code=exc.code,
            retryable=is_retryable_discord_status(exc.code),
        ) from exc
    except error.URLError as exc:
        raise DiscordWebhookError(
            "Discord webhook request failed",
            status_code=None,
            retryable=True,
        ) from exc


def send_discord_notification(webhook_url: str, message: str) -> None:
    send_discord_webhook_message(webhook_url, message)


def is_retryable_discord_status(status_code: int) -> bool:
    return status_code == 429 or status_code >= 500


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
    timezone_name = get_effective_notification_timezone(task)
    start = format_local_datetime(task.scheduled_start, timezone_name)
    if task.scheduled_end is None:
        return start

    return f"{start} - {format_local_datetime(task.scheduled_end, timezone_name)}"


def get_effective_notification_timezone(task: ScheduledTask) -> str:
    user_timezone = task.user.timezone.strip() if task.user and task.user.timezone else ""
    return user_timezone or settings.app_timezone


def format_local_datetime(value: datetime | None, timezone_name: str) -> str:
    if value is None:
        return "unscheduled"

    try:
        timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        timezone = get_app_timezone()

    local_value = ensure_aware_datetime(value).astimezone(timezone)
    return local_value.strftime("%Y-%m-%d %H:%M")
