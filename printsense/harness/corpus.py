"""PrintSense test-corpus loader — the immutable manifest + accessors.

Layer 1 (free, every PR) uses the frozen ``graph`` files committed under
``printsense/benchmarks/``. Layers 2/3 additionally resolve the source photos from
the directory named by ``$PRINTSENSE_CORPUS_IMAGES`` (kept out of git), each as
``<image.file>``, and verify them against the manifest's sha256 prefix so a swapped
input can't silently change the corpus.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path

from printsense.models import PrintSynthGraph

_BENCH = Path(__file__).resolve().parents[1] / "benchmarks"
_MANIFEST = _BENCH / "corpus_manifest.json"


def load_manifest() -> dict:
    return json.loads(_MANIFEST.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class Case:
    name: str
    routing: str
    graph_path: str | None
    rubric_path: str | None
    image_file: str
    image_sha256_prefix: str
    image_source: str
    min_signals: int
    forbid_tokens: tuple[str, ...]
    degraded: bool
    e2e_only: bool
    _image_root_env: str

    def has_frozen_graph(self) -> bool:
        return bool(self.graph_path and (_BENCH / self.graph_path).exists())

    def graph(self) -> PrintSynthGraph:
        return PrintSynthGraph.model_validate(
            json.loads((_BENCH / self.graph_path).read_text(encoding="utf-8"))
        )

    def rubric(self) -> dict | None:
        return json.loads((_BENCH / self.rubric_path).read_text(encoding="utf-8")) if self.rubric_path else None

    def image_path(self) -> Path | None:
        # Protected customer prints are NEVER in git. They resolve ONLY from the dir named
        # by $PRINTSENSE_CORPUS_IMAGES, populated at runtime by tools/printsense_corpus_sync.py
        # from controlled staging storage. Absent env → None → paid/E2E layers skip cleanly
        # (free Layer-1 tests use the committed golden graphs and need no images).
        root = os.getenv(self._image_root_env)
        return (Path(root) / self.image_file) if root else None

    def image_bytes_verified(self) -> bytes | None:
        """Read the pinned source image and verify its sha256 prefix, or None if the
        corpus image dir isn't configured / the file is absent (layers 2/3 skip then)."""
        p = self.image_path()
        if not p or not p.exists():
            return None
        data = p.read_bytes()
        if self.image_sha256_prefix and not hashlib.sha256(data).hexdigest().startswith(self.image_sha256_prefix):
            raise ValueError(
                f"corpus image {self.image_file} sha256 mismatch — this is not the pinned immutable input"
            )
        return data


def cases() -> list[Case]:
    m = load_manifest()
    env = m["image_root_env"]
    out: list[Case] = []
    for c in m["cases"]:
        img = c.get("image") or {}
        out.append(
            Case(
                name=c["name"],
                routing=c.get("routing", "electrical_print"),
                graph_path=c.get("graph"),
                rubric_path=c.get("rubric"),
                image_file=img.get("file", ""),
                image_sha256_prefix=img.get("sha256_prefix", ""),
                image_source=img.get("source", ""),
                min_signals=int(c.get("min_signals", 0)),
                forbid_tokens=tuple(c.get("forbid_tokens", [])),
                degraded=bool(c.get("degraded", False)),
                e2e_only=bool(c.get("e2e_only", False)),
                _image_root_env=env,
            )
        )
    return out


def cases_with_graph() -> list[Case]:
    """Cases that have a committed frozen graph — the layer-1 (free) set."""
    return [c for c in cases() if c.has_frozen_graph()]
