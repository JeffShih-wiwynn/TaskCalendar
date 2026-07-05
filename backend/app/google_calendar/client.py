from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from email.parser import BytesParser
from email.policy import default
from typing import Any
from urllib import error, parse, request

from fastapi import HTTPException, status

from app.core.config import settings

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CALENDAR_API_BASE_URL = "https://www.googleapis.com/calendar/v3"
GOOGLE_CALENDAR_BATCH_URL = "https://www.googleapis.com/batch/calendar/v3"
GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created"
MIRROR_CALENDAR_SUMMARY = "TaskCalendar Mirror — Read Only"


@dataclass(frozen=True)
class GoogleTokenResponse:
    access_token: str
    refresh_token: str | None
    expires_in: int | None = None


@dataclass(frozen=True)
class GoogleCalendarResource:
    id: str
    summary: str | None


@dataclass(frozen=True)
class GoogleEventResource:
    id: str


@dataclass(frozen=True)
class GoogleBatchEventRequest:
    content_id: str
    method: str
    path: str
    payload: dict[str, Any] | None = None


@dataclass(frozen=True)
class GoogleBatchEventResponse:
    content_id: str | None
    status_code: int
    payload: dict[str, Any] | None = None


class GoogleProviderError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code


class GoogleCalendarClient:
    def build_authorization_url(self, *, state: str) -> str:
        require_google_oauth_config()
        params = {
            "client_id": settings.google_oauth_client_id,
            "redirect_uri": settings.google_oauth_redirect_uri,
            "response_type": "code",
            "scope": GOOGLE_CALENDAR_SCOPE,
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
        return f"{GOOGLE_AUTH_URL}?{parse.urlencode(params)}"

    def exchange_code(self, code: str) -> GoogleTokenResponse:
        require_google_oauth_config()
        payload = parse.urlencode(
            {
                "code": code,
                "client_id": settings.google_oauth_client_id,
                "client_secret": settings.google_oauth_client_secret,
                "redirect_uri": settings.google_oauth_redirect_uri,
                "grant_type": "authorization_code",
            }
        ).encode("utf-8")
        response = post_json(
            GOOGLE_TOKEN_URL,
            payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
        )
        access_token = response.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise provider_error("Google authorization failed")
        refresh_token = response.get("refresh_token")
        expires_in = response.get("expires_in")
        return GoogleTokenResponse(
            access_token=access_token,
            refresh_token=refresh_token if isinstance(refresh_token, str) else None,
            expires_in=expires_in if isinstance(expires_in, int) else None,
        )

    def refresh_access_token(self, refresh_token: str) -> GoogleTokenResponse:
        require_google_oauth_config()
        payload = parse.urlencode(
            {
                "client_id": settings.google_oauth_client_id,
                "client_secret": settings.google_oauth_client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            }
        ).encode("utf-8")
        response = post_json(
            GOOGLE_TOKEN_URL,
            payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
        )
        access_token = response.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise GoogleProviderError("Google authorization failed")
        expires_in = response.get("expires_in")
        return GoogleTokenResponse(
            access_token=access_token,
            refresh_token=None,
            expires_in=expires_in if isinstance(expires_in, int) else None,
        )

    def get_calendar(self, *, access_token: str, calendar_id: str) -> GoogleCalendarResource | None:
        try:
            response = get_json(
                f"{GOOGLE_CALENDAR_API_BASE_URL}/calendars/{parse.quote(calendar_id, safe='')}",
                access_token=access_token,
            )
        except GoogleProviderError as exc:
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                return None
            raise
        return parse_calendar_resource(response)

    def create_mirror_calendar(self, *, access_token: str) -> GoogleCalendarResource:
        response = post_json(
            f"{GOOGLE_CALENDAR_API_BASE_URL}/calendars",
            json.dumps({"summary": MIRROR_CALENDAR_SUMMARY}).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        return parse_calendar_resource(response)

    def get_event(
        self,
        *,
        access_token: str,
        calendar_id: str,
        event_id: str,
    ) -> GoogleEventResource | None:
        try:
            response = get_json(
                build_event_url(calendar_id=calendar_id, event_id=event_id),
                access_token=access_token,
            )
        except GoogleProviderError as exc:
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                return None
            raise
        return parse_event_resource(response)

    def create_event(
        self,
        *,
        access_token: str,
        calendar_id: str,
        payload: dict[str, Any],
    ) -> GoogleEventResource:
        response = post_json(
            build_events_url(calendar_id=calendar_id),
            json.dumps(payload).encode("utf-8"),
            headers=authorized_json_headers(access_token),
        )
        return parse_event_resource(response)

    def update_event(
        self,
        *,
        access_token: str,
        calendar_id: str,
        event_id: str,
        payload: dict[str, Any],
    ) -> GoogleEventResource:
        response = put_json(
            build_event_url(calendar_id=calendar_id, event_id=event_id),
            json.dumps(payload).encode("utf-8"),
            headers=authorized_json_headers(access_token),
        )
        return parse_event_resource(response)

    def delete_event(self, *, access_token: str, calendar_id: str, event_id: str) -> bool:
        try:
            delete(
                build_event_url(calendar_id=calendar_id, event_id=event_id),
                access_token=access_token,
            )
        except GoogleProviderError as exc:
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                return False
            raise
        return True

    def batch_event_requests(
        self,
        *,
        access_token: str,
        requests: list[GoogleBatchEventRequest],
    ) -> list[GoogleBatchEventResponse]:
        if not requests:
            return []
        boundary = f"batch_{uuid.uuid4().hex}"
        body = build_batch_body(requests, boundary=boundary)
        request_obj = request.Request(
            GOOGLE_CALENDAR_BATCH_URL,
            data=body,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": f"multipart/mixed; boundary={boundary}",
                "Accept": "multipart/mixed",
            },
            method="POST",
        )
        try:
            with request.urlopen(request_obj, timeout=30) as response:
                response_body = response.read()
                content_type = response.headers.get("Content-Type", "")
        except error.HTTPError as exc:
            raise GoogleProviderError(
                "Google Calendar request failed",
                status_code=exc.code,
            ) from exc
        except error.URLError as exc:
            raise GoogleProviderError("Google Calendar request failed") from exc
        return parse_batch_response(
            response_body,
            content_type=content_type,
            expected_count=len(requests),
        )


def require_google_oauth_config() -> None:
    if (
        not settings.google_oauth_client_id
        or not settings.google_oauth_client_secret
        or not settings.google_oauth_redirect_uri
    ):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth is not configured",
        )


def parse_calendar_resource(payload: dict[str, Any]) -> GoogleCalendarResource:
    calendar_id = payload.get("id")
    if not isinstance(calendar_id, str) or not calendar_id:
        raise GoogleProviderError("Google calendar setup failed")
    if calendar_id == "primary":
        raise GoogleProviderError("Google primary calendar cannot be used as the mirror calendar")
    summary = payload.get("summary")
    return GoogleCalendarResource(
        id=calendar_id,
        summary=summary if isinstance(summary, str) else None,
    )


def parse_event_resource(payload: dict[str, Any]) -> GoogleEventResource:
    event_id = payload.get("id")
    if not isinstance(event_id, str) or not event_id:
        raise GoogleProviderError("Google Calendar returned an invalid event response")
    return GoogleEventResource(id=event_id)


def authorized_json_headers(access_token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def build_events_url(*, calendar_id: str) -> str:
    return f"{GOOGLE_CALENDAR_API_BASE_URL}/calendars/{parse.quote(calendar_id, safe='')}/events"


def build_event_url(*, calendar_id: str, event_id: str) -> str:
    return f"{build_events_url(calendar_id=calendar_id)}/{parse.quote(event_id, safe='')}"


def build_events_path(*, calendar_id: str) -> str:
    return f"/calendar/v3/calendars/{parse.quote(calendar_id, safe='')}/events"


def build_event_path(*, calendar_id: str, event_id: str) -> str:
    return f"{build_events_path(calendar_id=calendar_id)}/{parse.quote(event_id, safe='')}"


def build_batch_body(
    requests: list[GoogleBatchEventRequest],
    *,
    boundary: str,
) -> bytes:
    lines: list[bytes] = []
    for event_request in requests:
        lines.extend(
            [
                f"--{boundary}".encode("utf-8"),
                b"Content-Type: application/http",
                f"Content-ID: <{event_request.content_id}>".encode("utf-8"),
                b"",
                f"{event_request.method} {event_request.path} HTTP/1.1".encode("utf-8"),
            ]
        )
        if event_request.payload is not None:
            payload = json.dumps(event_request.payload, separators=(",", ":")).encode("utf-8")
            lines.extend(
                [
                    b"Content-Type: application/json",
                    f"Content-Length: {len(payload)}".encode("utf-8"),
                    b"",
                    payload,
                ]
            )
        else:
            lines.append(b"")
    lines.append(f"--{boundary}--".encode("utf-8"))
    lines.append(b"")
    return b"\r\n".join(lines)


def parse_batch_response(
    body: bytes,
    *,
    content_type: str,
    expected_count: int,
) -> list[GoogleBatchEventResponse]:
    if "multipart/mixed" not in content_type:
        raise GoogleProviderError("Google Calendar returned an invalid batch response")
    message = BytesParser(policy=default).parsebytes(
        f"Content-Type: {content_type}\r\n\r\n".encode("utf-8") + body
    )
    parts = list(message.iter_parts())
    if len(parts) != expected_count:
        raise GoogleProviderError("Google Calendar returned an invalid batch response")

    responses: list[GoogleBatchEventResponse] = []
    for part in parts:
        content_id = parse_content_id(part.get("Content-ID"))
        payload = part.get_payload(decode=True) or b""
        responses.append(parse_batch_part(payload, content_id=content_id))
    return responses


def parse_batch_part(payload: bytes, *, content_id: str | None) -> GoogleBatchEventResponse:
    header_blob, _, body = payload.partition(b"\r\n\r\n")
    header_lines = header_blob.decode("utf-8", errors="replace").splitlines()
    if not header_lines or not header_lines[0].startswith("HTTP/"):
        raise GoogleProviderError("Google Calendar returned an invalid batch response")
    status_parts = header_lines[0].split(" ", 2)
    if len(status_parts) < 2:
        raise GoogleProviderError("Google Calendar returned an invalid batch response")
    try:
        status_code = int(status_parts[1])
    except ValueError as exc:
        raise GoogleProviderError("Google Calendar returned an invalid batch response") from exc

    parsed_payload: dict[str, Any] | None = None
    stripped_body = body.strip()
    if stripped_body:
        try:
            loaded = json.loads(stripped_body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise GoogleProviderError("Google Calendar returned an invalid batch response") from exc
        if isinstance(loaded, dict):
            parsed_payload = loaded
    return GoogleBatchEventResponse(
        content_id=content_id,
        status_code=status_code,
        payload=parsed_payload,
    )


def parse_content_id(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if cleaned.startswith("<") and cleaned.endswith(">"):
        cleaned = cleaned[1:-1]
    if cleaned.startswith("response-"):
        cleaned = cleaned.removeprefix("response-")
    return cleaned or None


def get_json(url: str, *, access_token: str) -> dict[str, Any]:
    request_obj = request.Request(
        url,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        },
        method="GET",
    )
    return read_json_response(request_obj)


def post_json(url: str, data: bytes, *, headers: dict[str, str]) -> dict[str, Any]:
    request_obj = request.Request(url, data=data, headers=headers, method="POST")
    return read_json_response(request_obj)


def put_json(url: str, data: bytes, *, headers: dict[str, str]) -> dict[str, Any]:
    request_obj = request.Request(url, data=data, headers=headers, method="PUT")
    return read_json_response(request_obj)


def delete(url: str, *, access_token: str) -> None:
    request_obj = request.Request(
        url,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        },
        method="DELETE",
    )
    read_response(request_obj)


def read_json_response(request_obj: request.Request) -> dict[str, Any]:
    body = read_response(request_obj)
    if not body:
        return {}
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise GoogleProviderError("Google Calendar returned an invalid response") from exc
    if not isinstance(payload, dict):
        raise GoogleProviderError("Google Calendar returned an invalid response")
    return payload


def read_response(request_obj: request.Request) -> str:
    try:
        with request.urlopen(request_obj, timeout=15) as response:
            return response.read().decode("utf-8")
    except error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")
        raise GoogleProviderError(
            "Google Calendar request failed",
            status_code=exc.code,
            error_code=parse_google_error_code(response_body),
        ) from exc
    except error.URLError as exc:
        raise GoogleProviderError("Google Calendar request failed") from exc


def provider_error(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


def parse_google_error_code(response_body: str) -> str | None:
    if not response_body:
        return None
    try:
        payload = json.loads(response_body)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    error_value = payload.get("error")
    if isinstance(error_value, str):
        return error_value
    if isinstance(error_value, dict):
        code = error_value.get("status") or error_value.get("reason")
        if isinstance(code, str):
            return code
    return None
