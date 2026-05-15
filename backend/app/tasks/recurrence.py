from __future__ import annotations

import uuid
from calendar import monthrange
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status

from app.core.timezone import ensure_aware_datetime


@dataclass(frozen=True)
class RecurrenceSpec:
    frequency: str
    interval: int
    until: datetime | None


def parse_recurrence_rule(recurrence_rule: str) -> RecurrenceSpec:
    parts: dict[str, str] = {}
    for segment in recurrence_rule.split(";"):
        if "=" not in segment:
            continue
        key, value = segment.split("=", 1)
        parts[key.strip().upper()] = value.strip()

    frequency = parts.get("FREQ")
    if frequency not in {"DAILY", "WEEKLY", "MONTHLY", "YEARLY"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="recurrence_rule must use FREQ=DAILY, WEEKLY, MONTHLY, or YEARLY",
        )

    interval_value = parts.get("INTERVAL", "1")
    if not interval_value.isdigit() or int(interval_value) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="recurrence_rule must use a positive INTERVAL",
        )

    until_value = parts.get("UNTIL")
    until = None
    if until_value is not None:
        try:
            until = datetime.fromisoformat(until_value.replace("Z", "+00:00"))
            until = ensure_aware_datetime(until)
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="recurrence_rule UNTIL must be an ISO datetime",
            ) from error

    return RecurrenceSpec(
        frequency=frequency,
        interval=int(interval_value),
        until=until,
    )


def validate_recurrence_until_not_before_start(
    recurrence_rule: str | None,
    scheduled_start: datetime | None,
) -> None:
    if recurrence_rule is None or scheduled_start is None:
        return

    spec = parse_recurrence_rule(recurrence_rule)
    if spec.until is None:
        return

    start = ensure_aware_datetime(scheduled_start)
    until = ensure_aware_datetime(spec.until)
    comparison_tz = start.tzinfo or UTC

    if until.astimezone(comparison_tz).date() < start.astimezone(comparison_tz).date():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="recurrence_rule UNTIL must not be earlier than scheduled_start",
        )


def build_recurrence_payloads(task_data: dict) -> list[dict]:
    recurrence_rule = task_data.get("recurrence_rule")
    if not recurrence_rule:
        return [task_data]

    scheduled_start = task_data.get("scheduled_start")
    if scheduled_start is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Recurring tasks require scheduled_start",
        )
    scheduled_start = ensure_aware_datetime(scheduled_start)

    task_data = dict(task_data)
    task_data["scheduled_start"] = scheduled_start
    if task_data.get("scheduled_end") is not None:
        task_data["scheduled_end"] = ensure_aware_datetime(task_data["scheduled_end"])

    validate_recurrence_until_not_before_start(recurrence_rule, scheduled_start)

    spec = parse_recurrence_rule(recurrence_rule)
    series_id = uuid.uuid4()
    duration: timedelta | None = None
    if task_data.get("scheduled_end") is not None:
        duration = ensure_aware_datetime(task_data["scheduled_end"]) - scheduled_start

    payloads = []
    base_payload = dict(task_data)
    base_payload["recurrence_series_id"] = series_id
    payloads.append(base_payload)

    horizon_end = spec.until or (scheduled_start + timedelta(days=365))
    next_start = scheduled_start

    while True:
        next_start = advance_datetime(next_start, spec.frequency, spec.interval)
        if next_start > horizon_end:
            break

        next_payload = dict(task_data)
        next_payload["scheduled_start"] = next_start
        if duration is not None:
            next_payload["scheduled_end"] = next_start + duration
        next_payload["recurrence_series_id"] = series_id
        payloads.append(next_payload)

    return payloads


def advance_datetime(value: datetime, frequency: str, interval: int) -> datetime:
    if frequency == "DAILY":
        return value + timedelta(days=interval)
    if frequency == "WEEKLY":
        return value + timedelta(weeks=interval)
    if frequency == "MONTHLY":
        return add_months(value, interval)
    if frequency == "YEARLY":
        return add_years(value, interval)

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Unsupported recurrence frequency",
    )


def add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def add_years(value: datetime, years: int) -> datetime:
    try:
        return value.replace(year=value.year + years)
    except ValueError:
        # Handle leap day by moving to the last valid day of February.
        return value.replace(month=2, day=28, year=value.year + years)
