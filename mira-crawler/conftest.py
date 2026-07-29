"""pytest configuration — adds mira-crawler/ and repo root to sys.path."""

import sys
from pathlib import Path

# mira-crawler/ itself (for ingest.*, crawler.* imports)
sys.path.insert(0, str(Path(__file__).parent))

# Repo root (for mira_crawler.* package imports used by Celery tasks)
sys.path.insert(0, str(Path(__file__).parent.parent))

# mira-relay/ (for tag_diff_logger import used by the tag-diff historizer task)
sys.path.insert(0, str(Path(__file__).parent.parent / "mira-relay"))
