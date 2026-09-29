from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="PRINT_", extra="ignore")

    app_name: str = "print-platform"
    app_version: str = "0.3.0"
    database_url: str = "sqlite:///./print-platform.db"
    cors_allowed_origins: str = "http://localhost:5173,http://localhost:3000"

    security_enabled: bool = False
    security_admin_key: str = ""
    security_designer_key: str = ""
    security_operator_key: str = ""
    security_viewer_key: str = ""

    cloud_template_enabled: bool = False
    cloud_template_provider: str = "neon"
    cloud_template_publisher_enabled: bool = False
    cloud_template_account_id: str = ""

    ai_layout_endpoint: str = ""
    ai_provider: str = "external-adapter"
    ai_model: str = "layout-default"
    ai_api_key: str = ""

    agent_heartbeat_seconds: int = 30
    agent_unknown_after_seconds: int = 90
    agent_offline_after_seconds: int = 300

    system_log_cleanup_batch_size: int = 1000
    system_log_cleanup_max_batches: int = 100
    system_log_cleanup_preserve_unresolved_errors: bool = True
    system_log_retention_debug_days: int = 7
    system_log_retention_info_days: int = 30
    system_log_retention_warn_days: int = 90
    system_log_retention_error_days: int = 180
    system_log_retention_fatal_days: int = 365

    @property
    def cors_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_allowed_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
