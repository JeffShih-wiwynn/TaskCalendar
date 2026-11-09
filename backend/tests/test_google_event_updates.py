import json

import pytest

from app.google_calendar import client


@pytest.mark.parametrize(
    ("time_fields", "cleared"),
    [
        ({"dateTime": "2026-11-28T19:00:00+08:00", "timeZone": "Asia/Taipei"},
         {"date": None}),
        ({"date": "2026-11-28"}, {"dateTime": None, "timeZone": None}),
    ],
)
def test_updates_clear_previous_event_type(monkeypatch, time_fields, cleared):
    payload = {"start": dict(time_fields), "end": dict(time_fields)}
    sent = []

    def capture(url, data, *, headers):
        sent.append(json.loads(data))
        return {"id": "event"}

    monkeypatch.setattr(client, "put_json", capture)
    client.GoogleCalendarClient().update_event(
        access_token="token", calendar_id="calendar", event_id="event", payload=payload,
    )
    assert sent[0]["start"] == {**time_fields, **cleared}
    assert sent[0]["end"] == {**time_fields, **cleared}
    body = client.build_batch_body(
        [client.GoogleBatchEventRequest("update", "PUT", "/events/event", payload)],
        boundary="test",
    )
    assert json.dumps(sent[0], separators=(",", ":")).encode() in body
    assert payload == {"start": time_fields, "end": time_fields}
