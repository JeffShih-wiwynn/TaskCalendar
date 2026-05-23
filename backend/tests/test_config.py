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
