"""
Configuration for mira-sidecar.

Priority order (highest to lowest):
  1. Environment variables
  2. Java-style .properties file (path set via PROPERTIES_FILE env var)
  3. Defaults coded below

The .properties file format is key=value lines with # comments — used on
customer Ignition servers where a sysadmin drops a file instead of setting
env vars.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from pydantic import model_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource

logger = logging.getLogger("mira-sidecar")


# ---------------------------------------------------------------------------
# Custom settings source: Java-style .properties file
# ---------------------------------------------------------------------------


class PropertiesFileSource(PydanticBaseSettingsSource):
    """Load settings from a key=value .properties file.

    Only consulted when PROPERTIES_FILE env var points to an existing file.
    Environment variables always override values from this source.
    """

    def __init__(self, settings_cls: type[BaseSettings]) -> None:
        super().__init__(settings_cls)
        self._data: dict[str, str] = {}
        props_path = os.environ.get("PROPERTIES_FILE", "")
        if props_path:
            self._data = self._parse(Path(props_path))

    def _parse(self, path: Path) -> dict[str, str]:
        data: dict[str, str] = {}
        if not path.exists():
            logger.warning("Properties file not found: %s", path)
            return data
        try:
            for raw_line in path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or line.startswith("!"):
                    continue
                if "=" in line:
                    key, _, value = line.partition("=")
                    data[key.strip().lower()] = value.strip()
                elif ":" in line:
                    key, _, value = line.partition(":")
                    data[key.strip().lower()] = value.strip()
            logger.info("Loaded %d settings from %s", len(data), path)
        except OSError as exc:
            logger.error("Failed to read properties file %s: %s", path, exc)
        return data

    def __call__(self) -> dict[str, Any]:
        # Map from lower-case property key → field value
        return {k: v for k, v in self._data.items()}

    def get_field_value(self, field: Any, field_name: str) -> tuple[Any, str, bool]:  # type: ignore[override]
        value = self._data.get(field_name.lower())
        return value, field_name, False


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class Settings(BaseSettings):
    # LLM
    llm_provider: str = "openai"  # "openai" | "anthropic" | "ollama"
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"
    llm_model_openai: str = "gpt-4o-mini"
    llm_model_anthropic: str = "claude-sonnet-4-6"
    llm_model_ollama: str = "llama3"

    # Embedding
    embedding_provider: str = "ollama"  # "openai" | "ollama"
    openai_embed_model: str = "text-embedding-3-small"
    ollama_embed_model: str = "nomic-embed-text"

    # Sidecar
    host: str = "127.0.0.1"
    port: int = 5000

    # Storage
    docs_base_path: str = "./docs"
    chroma_path: str = "./chroma_data"

    # FSM thresholds
    fsm_n_sigma: float = 2.5
    fsm_stuck_multiplier: float = 3.0
    fsm_rare_threshold: float = 0.005
    fsm_min_baseline_cycles: int = 50

    # Properties file path (Java-style .properties for customer sites)
    properties_file: str = ""

    @model_validator(mode="after")
    def _warn_missing_keys(self) -> "Settings":
        """Log warnings when selected providers lack API keys."""
        if self.llm_provider == "openai" and not self.openai_api_key:
            logger.warning("llm_provider=openai but OPENAI_API_KEY is not set")
        if self.llm_provider == "anthropic" and not self.anthropic_api_key:
            logger.warning("llm_provider=anthropic but ANTHROPIC_API_KEY is not set")
        if self.embedding_provider == "openai" and not self.openai_api_key:
            logger.warning("embedding_provider=openai but OPENAI_API_KEY is not set")
        return self

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        secrets_dir: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # Priority: init > env vars > properties file > defaults
        return (
            init_settings,
            env_settings,
            PropertiesFileSource(settings_cls),
        )

    model_config = {
        "env_prefix": "",
        "case_sensitive": False,
        "extra": "ignore",
    }


# Module-level singleton — import this everywhere
settings = Settings()
