from app.health.router import health_check


def test_health_check_returns_ok_status() -> None:
    response = health_check()

    assert response["status"] == "ok"
    assert response["service"] == "calendar-api"
