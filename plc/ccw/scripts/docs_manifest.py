"""Walk docs/ and emit docs/manifest.json with checksums and metadata sidecars."""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DOCS = REPO / "docs"
MANIFEST = DOCS / "manifest.json"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    if not DOCS.exists():
        print("docs/ does not exist — run fetchers first", file=sys.stderr)
        return 1

    files: list[dict] = []
    for p in sorted(DOCS.rglob("*")):
        if not p.is_file():
            continue
        if p.name == "manifest.json" or p.name.endswith(".meta.json"):
            continue
        if p.name.endswith(".log"):
            continue
        rel = p.relative_to(DOCS).as_posix()
        sidecar = p.with_name(p.name + ".meta.json")
        meta: dict = {}
        if sidecar.exists():
            try:
                meta = json.loads(sidecar.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        is_pdf = False
        try:
            with open(p, "rb") as fh:
                is_pdf = fh.read(4) == b"%PDF"
        except Exception:
            pass
        files.append(
            {
                "path": rel,
                "bytes": p.stat().st_size,
                "sha256": sha256_file(p),
                "is_pdf": is_pdf,
                "source_url": meta.get("source_url"),
                "title": meta.get("title"),
                "publication": meta.get("publication"),
                "downloaded_at": meta.get("downloaded_at"),
            }
        )

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "root": "docs/",
        "count": len(files),
        "files": files,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2))
    print(f"wrote {MANIFEST} with {len(files)} entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
