"""Content-addressed storage + versioned derivation cache (PR-F/Phase 8).

Keys are sha256 of content; derived artifacts key on
``(source_sha, stage, algorithm/prompt version)`` so an approved
interpretation is never paid for twice unless the source content, the
extraction version, or the prompt version changes (or the user forces
reanalysis). Writes are atomic (tmp + replace). Logs must carry hashes,
never content — nothing in this module ever logs payload bytes.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class CAS:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, kind: str, key: str) -> Path:
        return self.root / kind / key[:2] / key

    def put(self, data: bytes, kind: str = "blob") -> str:
        key = sha256_bytes(data)
        path = self._path(kind, key)
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_bytes(data)
            os.replace(tmp, path)
        return key

    def get(self, kind: str, key: str) -> bytes:
        return self._path(kind, key).read_bytes()

    def has(self, kind: str, key: str) -> bool:
        return self._path(kind, key).exists()

    # -- versioned derivation cache -------------------------------------
    @staticmethod
    def derived_key(source_sha: str, stage: str, version: str) -> str:
        return hashlib.sha256(f"{source_sha}|{stage}|{version}".encode()).hexdigest()

    def cache_get(self, source_sha: str, stage: str, version: str) -> dict | None:
        key = self.derived_key(source_sha, stage, version)
        if not self.has("derived", key):
            return None
        return json.loads(self.get("derived", key).decode("utf-8"))

    def cache_put(self, source_sha: str, stage: str, version: str,
                  payload: dict) -> str:
        key = self.derived_key(source_sha, stage, version)
        path = self._path("derived", key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(json.dumps(payload, sort_keys=True,
                                   ensure_ascii=False).encode("utf-8"))
        os.replace(tmp, path)
        return key
