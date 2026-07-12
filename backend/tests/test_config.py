from pathlib import Path

from pydantic_settings import SettingsConfigDict

from app.core.config import Settings


def test_settings_loads_env_file_independent_of_cwd(
    tmp_path: Path,
    monkeypatch,
) -> None:
    env_file = tmp_path / "backend.env"
    env_file.write_text(
        "FRONTEND_ORIGINS=http://example.test:5173,http://example.test:4173\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)

    class TempSettings(Settings):
        model_config = SettingsConfigDict(
            env_file=env_file,
            env_file_encoding="utf-8",
            extra="ignore",
        )

    settings = TempSettings()

    assert settings.allowed_frontend_origins == [
        "http://example.test:5173",
        "http://example.test:4173",
    ]


def test_settings_loads_public_google_oauth_redirect_and_origin(
    tmp_path: Path,
) -> None:
    env_file = tmp_path / "backend.env"
    env_file.write_text(
        "\n".join(
            [
                "FRONTEND_ORIGINS=https://taskcalendar.masatoserver.com",
                "APP_BASE_URL=https://taskcalendar.masatoserver.com",
                (
                    "GOOGLE_OAUTH_REDIRECT_URI="
                    "https://taskcalendar.masatoserver.com"
                    "/api/google-calendar/oauth/callback"
                ),
                "",
            ],
        ),
        encoding="utf-8",
    )

    class TempSettings(Settings):
        model_config = SettingsConfigDict(
            env_file=env_file,
            env_file_encoding="utf-8",
            extra="ignore",
        )

    settings = TempSettings()

    assert settings.allowed_frontend_origins == [
        "https://taskcalendar.masatoserver.com",
    ]
    assert settings.app_base_url == "https://taskcalendar.masatoserver.com"
    assert (
        settings.google_oauth_redirect_uri
        == "https://taskcalendar.masatoserver.com/api/google-calendar/oauth/callback"
    )
