"""Discovery: walk a folder of messy customer exports and classify each file (read-only).

The compiler points at a directory and has to decide, per file, "can I parse this, and as what?"
without mutating anything. Classification reuses the content-first `detect()` and adds one thing
detect doesn't: recognizing **runtime value dumps** (a snapshot of live values, not a declaration
of tags) so they're ignored instead of mis-parsed into thousands of junk "tags".

Classes returned: parseable | value_dump | closed_project | unknown.
"""
from __future__ import annotations

from pathlib import Path

from .detect import detect

# formats we have a real parser for (pipeline._PARSERS keys).
PARSEABLE_FORMATS = {"rockwell_l5x", "csv_tags", "structured_text", "plcopen_xml"}
_MAX_BYTES = 50 * 1024 * 1024  # skip absurdly large files (not a real export)


def _looks_like_value_dump(text: str) -> bool:
    """A runtime VALUE dump (live snapshot), not a tag/variable declaration.

    Two tells: an INI-style section header (CCW LogicalValues starts with `[Version1]`), or a
    two-column `Name,Value` / `FullName,Value` table (a value per row, no datatype/address columns).
    """
    lines = [ln for ln in text.splitlines() if ln.strip()][:6]
    if not lines:
        return False
    first = lines[0].strip()
    if first.startswith("[") and first.endswith("]"):
        return True
    for delim in (",", ";", "\t", "|"):
        if delim in lines[0]:
            cols = [c.strip().strip('"').lower() for c in lines[0].split(delim) if c.strip()]
            if len(cols) == 2 and cols[1] in ("value", "val", "currentvalue") \
                    and any(k in cols[0] for k in ("name", "tag", "path")):
                return True
            break
    return False


def classify(filename: str, text: str) -> dict:
    """Classify one file's text. Returns {fmt, classification, reason, needs_export}."""
    if _looks_like_value_dump(text):
        return {"fmt": "value_dump", "classification": "value_dump",
                "reason": "runtime value snapshot (Name/Value rows or [Version] header) -- ignored",
                "needs_export": ""}
    det = detect(filename, text)
    if det.needs_export:
        cls = "closed_project"
    elif det.fmt in PARSEABLE_FORMATS:
        cls = "parseable"
    else:
        cls = "unknown"
    return {"fmt": det.fmt, "classification": cls, "reason": det.reason,
            "needs_export": det.needs_export}


def scan(folder) -> list[dict]:
    """Recursively classify every file under `folder`. Read-only; never writes or mutates inputs.

    Each item: {path, name, rel, fmt, classification, reason, needs_export, text}. `text` is carried
    only for parseable files (so the compiler doesn't re-read them); dropped otherwise.
    """
    root = Path(folder)
    items: list[dict] = []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        try:
            if path.stat().st_size > _MAX_BYTES:
                continue
            text = path.read_bytes().decode("utf-8", errors="replace")
        except OSError:
            continue
        info = classify(path.name, text)
        try:
            rel = str(path.relative_to(root))
        except ValueError:
            rel = path.name
        item = {"path": str(path), "name": path.name, "rel": rel, **info}
        if info["classification"] == "parseable":
            item["text"] = text
        items.append(item)
    return items
