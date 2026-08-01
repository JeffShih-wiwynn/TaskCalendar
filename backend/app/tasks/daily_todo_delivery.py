from __future__ import annotations

import logging
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import ContextManager
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.app_settings.service import get_app_settings
from app.core.config import settings
from app.models.daily_todo_notification import DailyTodoNotification
from app.tasks.daily_notifications import (
    claim_next_daily_notification,
    mark_daily_notification_cancelled,
    mark_daily_notification_dead,
    mark_daily_notification_failed,
    mark_daily_notification_sent,
    mark_daily_notification_skipped,
)
from app.tasks.daily_todo_digest import (
    build_daily_todo_digest,
    select_daily_todo_tasks,
)
from app.tasks.notifications import DiscordWebhookError, send_discord_webhook_message

logger = logging.getLogger(__name__)
URL_REDACTION_PATTERN = re.compile(r"https?://\S+")

DailyDigestSender = Callable[[str, str], None]


@dataclass(frozen=True)
class DailyNotificationProcessingResult:
    claimed: int = 0
    sent: int = 0
    skipped: int = 0
    cancelled: int = 0
    failed: int = 0
    dead: int = 0
    claim_misses: int = 0
    finalization_conflicts: int = 0
    unexpected_errors: int = 0

    def add(self, field: str) -> "DailyNotificationProcessingResult":
        return DailyNotificationProcessingResult(
            claimed=self.claimed + (1 if field == "claimed" else 0),
            sent=self.sent + (1 if field == "sent" else 0),
            skipped=self.skipped + (1 if field == "skipped" else 0),
            cancelled=self.cancelled + (1 if field == "cancelled" else 0),
            failed=self.failed + (1 if field == "failed" else 0),
            dead=self.dead + (1 if field == "dead" else 0),
            claim_misses=self.claim_misses + (1 if field == "claim_misses" else 0),
            finalization_conflicts=self.finalization_conflicts
            + (1 if field == "finalization_conflicts" else 0),
            unexpected_errors=self.unexpected_errors
            + (1 if field == "unexpected_errors" else 0),
        )


def process_available_daily_todo_notifications(
    session_factory: Callable[[], ContextManager[Session]],
    *,
    worker_id: str,
    now_utc: datetime | None = None,
    max_jobs: int = 5,
    sender: DailyDigestSender | None = None,
    app_url: str | None = None,
) -> DailyNotificationProcessingResult:
    sender = sender or send_discord_webhook_message
    app_url = settings.app_base_url if app_url is None else app_url
    now_utc = ensure_utc(now_utc or datetime.now(UTC))
    result = DailyNotificationProcessingResult()

    for _ in range(max(0, max_jobs)):
        with session_factory() as db:
            record = claim_next_daily_notification(
                db,
                worker_id=worker_id,
                now=now_utc,
            )

        if record is None:
            return result.add("claim_misses")

        result = result.add("claimed")
        outcome = process_claimed_daily_notification(
            session_factory,
            record_id=record.id,
            worker_id=worker_id,
            sender=sender,
            app_url=app_url,
            now_utc=now_utc,
        )
        result = result.add(outcome)

    return result


def process_claimed_daily_notification(
    session_factory: Callable[[], ContextManager[Session]],
    *,
    record_id: uuid.UUID,
    worker_id: str,
    sender: DailyDigestSender,
    app_url: str | None,
    now_utc: datetime,
) -> str:
    try:
        preparation = prepare_daily_notification_delivery(
            session_factory,
            record_id=record_id,
            worker_id=worker_id,
            app_url=app_url,
        )
        if preparation.outcome is not None:
            return preparation.outcome

        assert preparation.webhook_url is not None
        assert preparation.message is not None
        sender(preparation.webhook_url, preparation.message)
        with session_factory() as db:
            finalized = mark_daily_notification_sent(
                db,
                record_id=record_id,
                worker_id=worker_id,
                sent_at=now_utc,
            )
        return "sent" if finalized is not None else "finalization_conflicts"
    except DiscordWebhookError as exc:
        return finalize_delivery_failure(
            session_factory,
            record_id=record_id,
            worker_id=worker_id,
            exc=exc,
            now_utc=now_utc,
        )
    except (ValueError, OSError) as exc:
        return finalize_delivery_failure(
            session_factory,
            record_id=record_id,
            worker_id=worker_id,
            exc=DiscordWebhookError(
                safe_delivery_error(exc),
                retryable=is_retryable_local_error(exc),
            ),
            now_utc=now_utc,
        )
    except Exception:
        logger.exception("Unexpected daily todo notification processing failure")
        try:
            with session_factory() as db:
                finalized = mark_daily_notification_failed(
                    db,
                    record_id=record_id,
                    worker_id=worker_id,
                    error_message="Daily todo notification processing failed",
                    now=now_utc,
                )
            if finalized is not None:
                return "unexpected_errors"
        except Exception:
            logger.exception("Failed to finalize daily todo notification failure")
        return "unexpected_errors"


@dataclass(frozen=True)
class PreparedDailyNotification:
    outcome: str | None = None
    webhook_url: str | None = None
    message: str | None = None


def prepare_daily_notification_delivery(
    session_factory: Callable[[], ContextManager[Session]],
    *,
    record_id: uuid.UUID,
    worker_id: str,
    app_url: str | None,
) -> PreparedDailyNotification:
    with session_factory() as db:
        record = db.get(DailyTodoNotification, record_id)
        if record is None or record.status != "processing" or record.locked_by != worker_id:
            return PreparedDailyNotification(outcome="finalization_conflicts")

        app_settings = get_app_settings(db, record.user_id)
        if not app_settings.daily_todo_notification_enabled:
            finalized = mark_daily_notification_cancelled(
                db,
                record_id=record.id,
                worker_id=worker_id,
                reason="Daily todo notification disabled",
            )
            return PreparedDailyNotification(
                outcome="cancelled" if finalized is not None else "finalization_conflicts",
            )

        webhook_url = normalize_webhook_url(app_settings.discord_webhook_url)
        if webhook_url is None:
            finalized = mark_daily_notification_skipped(
                db,
                record_id=record.id,
                worker_id=worker_id,
                reason="Discord webhook URL missing",
            )
            return PreparedDailyNotification(
                outcome="skipped" if finalized is not None else "finalization_conflicts",
            )

        if not is_valid_webhook_url(webhook_url):
            finalized = mark_daily_notification_dead(
                db,
                record_id=record.id,
                worker_id=worker_id,
                error_message="Discord webhook URL is invalid",
                reason="Permanent delivery failure",
            )
            return PreparedDailyNotification(
                outcome="dead" if finalized is not None else "finalization_conflicts",
            )

        try:
            ZoneInfo(record.timezone)
        except ZoneInfoNotFoundError:
            finalized = mark_daily_notification_skipped(
                db,
                record_id=record.id,
                worker_id=worker_id,
                reason="Daily notification timezone is invalid",
            )
            return PreparedDailyNotification(
                outcome="skipped" if finalized is not None else "finalization_conflicts",
            )

        selection = select_daily_todo_tasks(
            db,
            user_id=record.user_id,
            local_date=record.local_date,
            timezone=record.timezone,
            snapshot_time=record.scheduled_for,
        )
        if not selection.has_tasks:
            finalized = mark_daily_notification_skipped(
                db,
                record_id=record.id,
                worker_id=worker_id,
                reason="No relevant tasks",
            )
            return PreparedDailyNotification(
                outcome="skipped" if finalized is not None else "finalization_conflicts",
            )

        digest = build_daily_todo_digest(
            selection,
            local_date=record.local_date,
            timezone=record.timezone,
            app_url=app_url,
        )
        if not digest.has_content:
            finalized = mark_daily_notification_skipped(
                db,
                record_id=record.id,
                worker_id=worker_id,
                reason="No relevant tasks",
            )
            return PreparedDailyNotification(
                outcome="skipped" if finalized is not None else "finalization_conflicts",
            )

        return PreparedDailyNotification(
            webhook_url=webhook_url,
            message=digest.message,
        )


def finalize_delivery_failure(
    session_factory: Callable[[], ContextManager[Session]],
    *,
    record_id: uuid.UUID,
    worker_id: str,
    exc: DiscordWebhookError,
    now_utc: datetime,
) -> str:
    error_message = safe_delivery_error(exc)
    with session_factory() as db:
        if exc.retryable:
            finalized = mark_daily_notification_failed(
                db,
                record_id=record_id,
                worker_id=worker_id,
                error_message=error_message,
                now=now_utc,
            )
            if finalized is None:
                return "finalization_conflicts"
            return "dead" if finalized.status == "dead" else "failed"

        finalized = mark_daily_notification_dead(
            db,
            record_id=record_id,
            worker_id=worker_id,
            error_message=error_message,
            reason="Permanent delivery failure",
            now=now_utc,
        )
        if finalized is None:
            return "finalization_conflicts"
        return "dead"


def normalize_webhook_url(value: str | None) -> str | None:
    stripped = value.strip() if value else ""
    return stripped or None


def is_valid_webhook_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def is_retryable_local_error(exc: Exception) -> bool:
    return isinstance(exc, OSError)


def safe_delivery_error(exc: Exception) -> str:
    message = str(exc).strip()
    if not message:
        return "Discord webhook delivery failed"
    return URL_REDACTION_PATTERN.sub("[redacted-url]", message)[:500]


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
