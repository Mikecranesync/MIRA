"""mira-crawler configuration — all settings from env vars with safe defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class CrawlerConfig:
    """All crawler settings, loaded from environment variables."""

    # NeonDB
    neon_database_url: str = field(
        default_factory=lambda: os.getenv("NEON_DATABASE_URL", "")
    )
    mira_tenant_id: str = field(
        default_factory=lambda: os.getenv("MIRA_TENANT_ID", "")
    )

    # Ollama embedding
    ollama_base_url: str = field(
        default_factory=lambda: os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    )
    embed_model: str = field(
        default_factory=lambda: os.getenv("EMBED_MODEL", "nomic-embed-text:latest")
    )
    embed_batch_size: int = 32

    # Crawling
    rate_limit_sec: float = field(
        default_factory=lambda: float(os.getenv("CRAWL_RATE_LIMIT_SEC", "3"))
    )
    user_agent: str = field(
        default_factory=lambda: os.getenv(
            "CRAWLER_USER_AGENT", "MiraCrawler/1.0 Industrial Maintenance KB"
        )
    )
    robots_cache_ttl_hours: int = 24

    # Paths
    incoming_dir: Path = field(
        default_factory=lambda: Path(os.getenv("INCOMING_WATCH_DIR", "/data/incoming"))
    )
    cache_dir: Path = field(
        default_factory=lambda: Path(os.getenv("CRAWLER_CACHE_DIR", "/app/cache"))
    )
    sources_file: Path = field(
        default_factory=lambda: Path(__file__).parent / "sources.yaml"
    )
    dedup_db_path: Path = field(
        default_factory=lambda: Path(os.getenv("DEDUP_DB_PATH", "/data/crawler_dedup.db"))
    )

    # Chunking
    chunk_min_chars: int = 200
    chunk_max_chars: int = 2000

    # Converter
    use_docling: bool = field(
        default_factory=lambda: os.getenv("USE_DOCLING", "false").lower()
        in ("true", "1", "yes")
    )

    # Scheduler
    schedule_enabled: bool = field(
        default_factory=lambda: os.getenv("CRAWL_SCHEDULE_ENABLED", "true").lower()
        in ("true", "1", "yes")
    )
