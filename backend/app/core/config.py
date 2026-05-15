from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://calendar:calendar@localhost:5432/calendar"
    frontend_origins: str = (
        "http://localhost:5173,http://localhost:5174,http://localhost:5175,"
        "http://localhost:5176,http://localhost:5177,http://localhost:5178"
    )
    app_base_url: str | None = None
    app_timezone: str = "UTC"
    discord_webhook_url: str | None = None
    jwt_secret_key: str = "change-this-development-secret-at-least-32-bytes"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24

    @property
    def allowed_frontend_origins(self) -> list[str]:
        return [origin.strip() for origin in self.frontend_origins.split(",") if origin.strip()]

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
