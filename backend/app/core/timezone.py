from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.config import settings


def get_app_timezone() -> ZoneInfo:
    try:
        return ZoneInfo(settings.app_timezone or "UTC")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def get_app_timezone_name() -> str:
    return get_app_timezone().key


def now_in_app_timezone() -> datetime:
    return datetime.now(get_app_timezone())


def ensure_aware_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=get_app_timezone())
    return value


def to_app_timezone(value: datetime) -> datetime:
    return ensure_aware_datetime(value).astimezone(get_app_timezone())


def to_app_isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    return to_app_timezone(value).isoformat()


def utc_now() -> datetime:
    return datetime.now(UTC)
