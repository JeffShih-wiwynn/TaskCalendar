from __future__ import annotations

from app.core.config import settings
from app.tasks import notifications
from app.tasks.daily_notifications import ScannerResult
from app.tasks.daily_todo_delivery import DailyNotificationProcessingResult


def test_notification_worker_once_invokes_per_task_scanner_and_processor(
    monkeypatch,
) -> None:
    calls: list[str] = []
    processor_kwargs: dict[str, object] = {}

    def fake_send_due_notifications(*args, **kwargs) -> int:
        calls.append("per-task")
        return 0

    def fake_scanner(session_factory):
        calls.append("scanner")
        return ScannerResult(records_created=1)

    def fake_processor(session_factory, **kwargs):
        calls.append("processor")
        processor_kwargs.update(kwargs)
        return DailyNotificationProcessingResult(claimed=1, sent=1)

    monkeypatch.setattr(notifications, "send_due_notifications", fake_send_due_notifications)
    monkeypatch.setattr(notifications, "enqueue_due_daily_todo_notifications", fake_scanner)
    monkeypatch.setattr(
        "app.tasks.daily_todo_delivery.process_available_daily_todo_notifications",
        fake_processor,
    )
    monkeypatch.setattr(settings, "app_base_url", "https://calendar.example")

    notifications.run_notification_worker_once(worker_id="worker-1")

    assert calls == ["per-task", "scanner", "processor"]
    assert processor_kwargs["worker_id"] == "worker-1"
    assert processor_kwargs["max_jobs"] == notifications.DAILY_NOTIFICATION_MAX_JOBS_PER_LOOP
    assert processor_kwargs["app_url"] == "https://calendar.example"


def test_notification_worker_passes_no_app_url_when_unconfigured(monkeypatch) -> None:
    processor_kwargs: dict[str, object] = {}

    monkeypatch.setattr(notifications, "send_due_notifications", lambda *args, **kwargs: 0)
    monkeypatch.setattr(
        notifications,
        "enqueue_due_daily_todo_notifications",
        lambda session_factory: ScannerResult(),
    )
    monkeypatch.setattr(
        "app.tasks.daily_todo_delivery.process_available_daily_todo_notifications",
        lambda session_factory, **kwargs: processor_kwargs.update(kwargs)
        or DailyNotificationProcessingResult(),
    )
    monkeypatch.setattr(settings, "app_base_url", "   ")

    notifications.run_notification_worker_once(worker_id="worker-1")

    assert processor_kwargs["app_url"] is None


def test_notification_worker_isolates_per_task_failure(monkeypatch) -> None:
    calls: list[str] = []

    def fake_send_due_notifications(*args, **kwargs) -> int:
        calls.append("per-task")
        raise RuntimeError("per-task failed")

    monkeypatch.setattr(notifications, "send_due_notifications", fake_send_due_notifications)
    monkeypatch.setattr(
        notifications,
        "enqueue_due_daily_todo_notifications",
        lambda session_factory: calls.append("scanner") or ScannerResult(),
    )
    monkeypatch.setattr(
        "app.tasks.daily_todo_delivery.process_available_daily_todo_notifications",
        lambda session_factory, **kwargs: calls.append("processor")
        or DailyNotificationProcessingResult(),
    )

    notifications.run_notification_worker_once(worker_id="worker-1")

    assert calls == ["per-task", "scanner", "processor"]


def test_notification_worker_isolates_scanner_failure(monkeypatch) -> None:
    calls: list[str] = []

    def fake_scanner(session_factory):
        calls.append("scanner")
        raise RuntimeError("scanner failed")

    monkeypatch.setattr(
        notifications,
        "send_due_notifications",
        lambda *args, **kwargs: calls.append("per-task") or 0,
    )
    monkeypatch.setattr(notifications, "enqueue_due_daily_todo_notifications", fake_scanner)
    monkeypatch.setattr(
        "app.tasks.daily_todo_delivery.process_available_daily_todo_notifications",
        lambda session_factory, **kwargs: calls.append("processor")
        or DailyNotificationProcessingResult(),
    )

    notifications.run_notification_worker_once(worker_id="worker-1")

    assert calls == ["per-task", "scanner", "processor"]


def test_notification_worker_isolates_processor_failure(monkeypatch) -> None:
    calls: list[str] = []

    def fake_processor(session_factory, **kwargs):
        calls.append("processor")
        raise RuntimeError("processor failed")

    monkeypatch.setattr(
        notifications,
        "send_due_notifications",
        lambda *args, **kwargs: calls.append("per-task") or 0,
    )
    monkeypatch.setattr(
        notifications,
        "enqueue_due_daily_todo_notifications",
        lambda session_factory: calls.append("scanner") or ScannerResult(),
    )
    monkeypatch.setattr(
        "app.tasks.daily_todo_delivery.process_available_daily_todo_notifications",
        fake_processor,
    )

    notifications.run_notification_worker_once(worker_id="worker-1")

    assert calls == ["per-task", "scanner", "processor"]


def test_notification_worker_id_is_stable_across_loop_iterations(monkeypatch) -> None:
    worker_ids: list[str] = []

    class StopAfterTwoWaits:
        waits = 0

        def is_set(self) -> bool:
            return self.waits >= 2

        def wait(self, _seconds: int) -> None:
            self.waits += 1

    monkeypatch.setattr(
        notifications,
        "run_notification_worker_once",
        lambda *, worker_id: worker_ids.append(worker_id),
    )

    notifications.run_notification_worker(StopAfterTwoWaits(), worker_id="stable-worker")

    assert worker_ids == ["stable-worker", "stable-worker"]


def test_generated_notification_worker_id_fits_locked_by_column() -> None:
    worker_id = notifications.build_notification_worker_id()

    assert worker_id.startswith("notification-worker:")
    assert len(worker_id) <= 100


def test_start_notification_worker_starts_one_thread(monkeypatch) -> None:
    started: list[object] = []

    class FakeThread:
        daemon = False
        name = ""

        def __init__(self, *, target, args, name, daemon):
            self.target = target
            self.args = args
            self.name = name
            self.daemon = daemon

        def start(self) -> None:
            started.append(self)

    monkeypatch.setattr(notifications.threading, "Thread", FakeThread)
    monkeypatch.setattr(notifications, "build_notification_worker_id", lambda: "worker")

    stop_event, thread = notifications.start_notification_worker()

    assert stop_event is not None
    assert thread.name == "notification-worker"
    assert thread.daemon is True
    assert len(started) == 1
    assert thread.args[1] == "worker"
