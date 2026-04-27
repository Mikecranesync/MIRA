"""asset_tag sanitization for mira-ingest.

`asset_tag` is user-controlled and used as a filesystem path component
(`PHOTOS_DIR / asset_tag`) in `/ingest/photo`. The hub validates strictly
at the UI boundary (`mira-hub/src/lib/asset-tag.ts`); this module is the
belt-and-suspenders safety net for non-UI callers (Telegram bot, mira-pipeline,
test runners) where captions may contain spaces, unicode, or punctuation.

The whitelist matches the hub side: `^[A-Za-z0-9_-]{1,64}$`. We coerce
unsafe input rather than rejecting it so the bot flows keep working.
"""

import logging
import os
import re

from fastapi import HTTPException

logger = logging.getLogger("mira-ingest")

ASSET_TAG_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_INVALID_RE = re.compile(r"[^A-Za-z0-9_-]")


def sanitize_asset_tag(asset_tag: str) -> str:
    """Coerce asset_tag into a safe filesystem path component.

    Replaces any character outside [A-Za-z0-9_-] with an underscore,
    truncates to 64, and rejects only the case where nothing usable
    remains (raises 400). The result always matches ASSET_TAG_RE, so
    `PHOTOS_DIR / result` can never traverse out of PHOTOS_DIR.
    """
    candidate = (asset_tag or "").strip()
    safe = _INVALID_RE.sub("_", candidate)[:64].strip("_-") or ""
    if not safe:
        raise HTTPException(
            status_code=400,
            detail="asset_tag must contain at least one of [A-Za-z0-9_-]",
        )
    if safe != candidate:
        logger.info("asset_tag coerced: %r -> %r", candidate, safe)
    if os.path.basename(safe) != safe:
        # Defence in depth — the regex already excludes `/` and `\`, but the
        # check makes the intent explicit and survives future regex edits.
        raise HTTPException(status_code=400, detail="asset_tag contains path component")
    return safe
