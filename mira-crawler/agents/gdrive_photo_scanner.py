"""Google Drive Photo Scanner — Asset Intelligence Agent.

Scans Mike's Google Drive for equipment photos (nameplates / data plates),
extracts make+model via the MIRA Scan vision pipeline, and auto-queues a
manual KB download for any equipment not already in the knowledge base.

Pipeline:
    1. List image files in Drive (image/jpeg, image/png) — paged
    2. Skip noise: < 100 KB, "Screenshot" in name, or already processed
    3. Download bytes via Drive API
    4. POST to MIRA_SCAN_BACKEND_URL/scan/extract — get {make, model, confidence}
    5. If confidence >= 0.5, GET /kb/lookup?make=...&model=... ; otherwise skip
    6. If KB miss, POST /queue/manual-request to enqueue a manual download
    7. Persist processed file IDs to a JSON sidecar (idempotency)
    8. Push a Telegram summary as the "asset_intel" agent

Auth (one of, in priority order):
    GOOGLE_SERVICE_ACCOUNT_JSON   Raw or base64 service-account JSON. Domain-wide
                                  delegation lets us impersonate Mike via
                                  GOOGLE_DRIVE_IMPERSONATE=mike@factorylm.com.
    GOOGLE_DRIVE_TOKEN            OAuth2 access token (already-fresh). Used as-is.
    GOOGLE_DRIVE_REFRESH_TOKEN    OAuth2 refresh token; needs GOOGLE_CLIENT_ID +
                                  GOOGLE_CLIENT_SECRET to mint access tokens.

Doppler (factorylm/prd) is the source of truth — see docs/env-vars.md.

Usage:
    python3 mira-crawler/agents/gdrive_photo_scanner.py                # full run
    python3 mira-crawler/agents/gdrive_photo_scanner.py --dry-run      # no writes
    python3 mira-crawler/agents/gdrive_photo_scanner.py --max-files 5  # cap
    python3 mira-crawler/agents/gdrive_photo_scanner.py --reset-state  # rescan all

Crontab (VPS, daily at 09:00 UTC = 04:00 ET):
    0 9 * * * cd /opt/mira && doppler run -- \
      python3 mira-crawler/agents/gdrive_photo_scanner.py \
      >> /var/log/gdrive_photo_scanner.log 2>&1
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

# Make the repo importable when run directly
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

try:
    from mira_crawler.reporting.telegram_notify import notify as _tg_notify
except ImportError:
    def _tg_notify(*args: Any, **kwargs: Any) -> bool:
        del args, kwargs
        return False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("gdrive_photo_scanner")


# ── Tunables ──────────────────────────────────────────────────────────────────

MIN_IMAGE_BYTES = 100 * 1024            # 100 KB — skip thumbnails / spurious icons
MIN_VISION_CONFIDENCE = 0.5             # below this, treat as "not a nameplate"
DRIVE_API = "https://www.googleapis.com/drive/v3"
DRIVE_PAGE_SIZE = 100
DEFAULT_SCAN_BACKEND = "http://localhost:8090"
DEFAULT_DRIVE_QUERY = "(mimeType='image/jpeg' or mimeType='image/png') and trashed=false"

STATE_PATH = Path(__file__).parent / "gdrive_photo_scanner_state.json"


# ── State (idempotency) ───────────────────────────────────────────────────────

@dataclass
class ScannerState:
    """Persistent record of which Drive file IDs we've already classified.

    File ID is the immutable key — renames/moves don't trigger reprocessing.
    """

    processed: dict[str, dict[str, Any]] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path | None = None) -> "ScannerState":
        path = path or STATE_PATH
        if not path.exists():
            return cls()
        try:
            data = json.loads(path.read_text())
            return cls(processed=data.get("processed", {}))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("State file unreadable (%s) — starting fresh", exc)
            return cls()

    def save(self, path: Path | None = None) -> None:
        path = path or STATE_PATH
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"processed": self.processed}, indent=2))

    def has(self, file_id: str) -> bool:
        return file_id in self.processed

    def record(self, file_id: str, **fields: Any) -> None:
        entry = self.processed.get(file_id, {})
        entry.update(fields)
        entry.setdefault("first_seen", _ts())
        entry["last_updated"] = _ts()
        self.processed[file_id] = entry


# ── Filters ───────────────────────────────────────────────────────────────────

def should_skip(file_meta: dict[str, Any], state: ScannerState) -> str | None:
    """Return a skip reason string, or None if the file should be processed."""
    fid = file_meta.get("id", "")
    name = file_meta.get("name", "")
    size = int(file_meta.get("size", 0) or 0)
    mime = file_meta.get("mimeType", "")

    if state.has(fid):
        return "already_processed"
    if mime not in ("image/jpeg", "image/png"):
        return f"unsupported_mime:{mime}"
    if size < MIN_IMAGE_BYTES:
        return f"too_small:{size}b"
    if "screenshot" in name.lower():
        return "screenshot"
    return None


# ── Google Drive auth ─────────────────────────────────────────────────────────

class _DriveAuth:
    """Resolves a Bearer token for Drive API calls.

    Three modes — picked by which env vars are set:
      1. Service account (GOOGLE_SERVICE_ACCOUNT_JSON) — preferred for VPS cron
      2. Pre-issued access token (GOOGLE_DRIVE_TOKEN) — useful for testing
      3. OAuth refresh-token flow (GOOGLE_DRIVE_REFRESH_TOKEN)
    """

    _DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.readonly"

    def __init__(self) -> None:
        self._token: str = ""
        self._token_expires: float = 0.0
        self._workspace_client: Any | None = None  # lazy: WorkspaceClient

    async def get_token(self) -> str:
        sa_blob = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
        if sa_blob:
            return await self._token_from_service_account(sa_blob)

        static_token = os.getenv("GOOGLE_DRIVE_TOKEN", "").strip()
        if static_token:
            return static_token

        refresh = os.getenv("GOOGLE_DRIVE_REFRESH_TOKEN", "").strip()
        if refresh:
            return await self._token_from_refresh(refresh)

        raise RuntimeError(
            "No Google Drive credentials configured. Set one of: "
            "GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_DRIVE_TOKEN, GOOGLE_DRIVE_REFRESH_TOKEN. "
            "See module docstring for details."
        )

    async def _token_from_service_account(self, sa_blob: str) -> str:
        if self._workspace_client is None:
            try:
                from mira_bots.gchat.workspace_client import WorkspaceClient
            except ImportError:
                # Fallback: hand-roll the JWT exchange — keeps the script
                # runnable even when mira-bots isn't on PYTHONPATH.
                return await self._jwt_exchange(sa_blob)
            self._workspace_client = WorkspaceClient(sa_blob)
        return await self._workspace_client.get_token()

    async def _jwt_exchange(self, sa_blob: str) -> str:
        import time
        try:
            sa = json.loads(sa_blob)
        except json.JSONDecodeError:
            sa = json.loads(base64.b64decode(sa_blob).decode())

        try:
            import jwt  # PyJWT
        except ImportError as exc:
            raise RuntimeError(
                "PyJWT is required for service-account auth. `pip install pyjwt[crypto]`"
            ) from exc

        now = int(time.time())
        impersonate = os.getenv("GOOGLE_DRIVE_IMPERSONATE", "").strip() or sa["client_email"]
        claims = {
            "iss": sa["client_email"],
            "sub": impersonate,
            "aud": sa.get("token_uri", "https://oauth2.googleapis.com/token"),
            "iat": now,
            "exp": now + 3600,
            "scope": self._DRIVE_SCOPES,
        }
        assertion = jwt.encode(claims, sa["private_key"], algorithm="RS256")
        if isinstance(assertion, bytes):
            assertion = assertion.decode()

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                claims["aud"],
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": assertion,
                },
            )
            resp.raise_for_status()
            return resp.json()["access_token"]

    async def _token_from_refresh(self, refresh: str) -> str:
        client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
        client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
        if not (client_id and client_secret):
            raise RuntimeError(
                "GOOGLE_DRIVE_REFRESH_TOKEN requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET."
            )
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh,
                    "grant_type": "refresh_token",
                },
            )
            resp.raise_for_status()
            return resp.json()["access_token"]


# ── Drive list / download ─────────────────────────────────────────────────────

async def list_image_files(
    auth: _DriveAuth,
    *,
    query: str = DEFAULT_DRIVE_QUERY,
    max_files: int | None = None,
) -> list[dict[str, Any]]:
    """List image files Mike can see, paginated. Returns Drive file metadata dicts."""
    token = await auth.get_token()
    headers = {"Authorization": f"Bearer {token}"}
    params = {
        "q": query,
        "fields": "nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink)",
        "pageSize": str(DRIVE_PAGE_SIZE),
        "spaces": "drive",
    }

    files: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            resp = await client.get(f"{DRIVE_API}/files", params=params, headers=headers)
            if resp.status_code == 401:
                # Token may have expired mid-pagination — refresh once.
                token = await auth.get_token()
                headers["Authorization"] = f"Bearer {token}"
                resp = await client.get(f"{DRIVE_API}/files", params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            files.extend(data.get("files", []))
            if max_files is not None and len(files) >= max_files:
                return files[:max_files]
            next_token = data.get("nextPageToken")
            if not next_token:
                break
            params["pageToken"] = next_token
    return files


async def download_file(auth: _DriveAuth, file_id: str) -> bytes:
    token = await auth.get_token()
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(
            f"{DRIVE_API}/files/{file_id}",
            params={"alt": "media"},
            headers={"Authorization": f"Bearer {token}"},
            follow_redirects=True,
        )
        resp.raise_for_status()
        return resp.content


# ── MIRA Scan backend ─────────────────────────────────────────────────────────

@dataclass
class ScanExtract:
    make: str
    model: str
    confidence: float
    raw: dict[str, Any]

    @property
    def is_valid(self) -> bool:
        return bool(self.make and self.model and self.confidence >= MIN_VISION_CONFIDENCE)


class _ScanClient:
    """Thin async client for the MIRA Scan backend running on the VPS."""

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or os.getenv("MIRA_SCAN_BACKEND_URL") or DEFAULT_SCAN_BACKEND).rstrip("/")
        self._auth_header: dict[str, str] = {}
        api_key = os.getenv("MIRA_SCAN_API_KEY", "").strip()
        if api_key:
            self._auth_header = {"Authorization": f"Bearer {api_key}"}

    async def extract(self, image_bytes: bytes, mime_type: str, filename: str) -> ScanExtract:
        b64 = base64.b64encode(image_bytes).decode("ascii")
        payload = {"image_b64": b64, "mime_type": mime_type, "filename": filename}
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{self.base_url}/scan/extract",
                json=payload,
                headers=self._auth_header,
            )
            resp.raise_for_status()
            data = resp.json() or {}

        # Backend contracts vary — accept several shapes.
        make = (data.get("make") or data.get("manufacturer") or "").strip()
        model = (data.get("model") or data.get("model_number") or "").strip()
        conf_raw = data.get("confidence", 0.0)
        confidence = _coerce_confidence(conf_raw)
        return ScanExtract(make=make, model=model, confidence=confidence, raw=data)

    async def kb_lookup(self, make: str, model: str) -> bool:
        """Return True iff the KB already has docs for this make+model."""
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f"{self.base_url}/kb/lookup",
                params={"make": make, "model": model},
                headers=self._auth_header,
            )
            if resp.status_code == 404:
                return False
            resp.raise_for_status()
            data = resp.json() or {}
            # Accept {"found": bool}, {"hits": int}, or {"chunks": [...]}.
            if "found" in data:
                return bool(data["found"])
            if "hits" in data:
                return int(data["hits"]) > 0
            chunks = data.get("chunks") or data.get("results") or []
            return bool(chunks)

    async def queue_manual_request(
        self,
        *,
        make: str,
        model: str,
        source_file_id: str,
        source_filename: str,
        source_url: str | None,
    ) -> bool:
        payload = {
            "manufacturer": make,
            "model": model,
            "source": "gdrive_photo_scanner",
            "source_file_id": source_file_id,
            "source_filename": source_filename,
            "source_url": source_url,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{self.base_url}/queue/manual-request",
                json=payload,
                headers=self._auth_header,
            )
            if resp.status_code in (200, 201, 202):
                return True
            if resp.status_code == 409:
                # Already queued — that's still a "success" for our purposes.
                return True
            logger.warning(
                "queue/manual-request failed: HTTP %d — %s", resp.status_code, resp.text[:200]
            )
            return False


def _coerce_confidence(raw: Any) -> float:
    """Vision backends emit confidence as float, percent-int, or 'high'/'medium'/'low'."""
    if isinstance(raw, (int, float)):
        v = float(raw)
        return v / 100.0 if v > 1.0 else v
    if isinstance(raw, str):
        return {"high": 0.9, "medium": 0.7, "low": 0.3}.get(raw.lower(), 0.0)
    return 0.0


# ── Orchestration ─────────────────────────────────────────────────────────────

@dataclass
class RunSummary:
    listed: int = 0
    skipped: dict[str, int] = field(default_factory=dict)
    extracted: int = 0
    nameplates_found: int = 0
    kb_hits: int = 0
    queued: int = 0
    errors: int = 0

    def bump_skip(self, reason: str) -> None:
        # Bucket detailed reasons into top-level categories for the summary.
        bucket = reason.split(":", 1)[0]
        self.skipped[bucket] = self.skipped.get(bucket, 0) + 1


async def run(
    *,
    dry_run: bool = False,
    max_files: int | None = None,
    drive_query: str = DEFAULT_DRIVE_QUERY,
) -> RunSummary:
    state = ScannerState.load()
    summary = RunSummary()

    auth = _DriveAuth()
    scan = _ScanClient()

    files = await list_image_files(auth, query=drive_query, max_files=max_files)
    summary.listed = len(files)
    logger.info("Drive list: %d image file(s) returned", summary.listed)

    for f in files:
        fid = f["id"]
        name = f.get("name", "")
        skip_reason = should_skip(f, state)
        if skip_reason:
            summary.bump_skip(skip_reason)
            logger.debug("skip %s (%s) — %s", name, fid, skip_reason)
            continue

        try:
            blob = await download_file(auth, fid)
        except httpx.HTTPError as exc:
            summary.errors += 1
            logger.warning("download failed for %s: %s", name, exc)
            continue

        try:
            result = await scan.extract(blob, f.get("mimeType", "image/jpeg"), name)
        except httpx.HTTPError as exc:
            summary.errors += 1
            logger.warning("scan/extract failed for %s: %s", name, exc)
            continue

        summary.extracted += 1
        record: dict[str, Any] = {
            "filename": name,
            "make": result.make,
            "model": result.model,
            "confidence": result.confidence,
        }

        if not result.is_valid:
            record["outcome"] = "low_confidence_or_not_nameplate"
            state.record(fid, **record)
            logger.info("low-conf %s — make=%r model=%r conf=%.2f", name, result.make, result.model, result.confidence)
            continue

        summary.nameplates_found += 1
        try:
            in_kb = await scan.kb_lookup(result.make, result.model)
        except httpx.HTTPError as exc:
            summary.errors += 1
            logger.warning("kb/lookup failed for %s %s: %s", result.make, result.model, exc)
            in_kb = False

        if in_kb:
            summary.kb_hits += 1
            record["outcome"] = "kb_hit"
            state.record(fid, **record)
            logger.info("KB hit: %s %s (from %s)", result.make, result.model, name)
            continue

        if dry_run:
            record["outcome"] = "would_queue"
            logger.info("[dry-run] would queue: %s %s (from %s)", result.make, result.model, name)
        else:
            queued = await scan.queue_manual_request(
                make=result.make,
                model=result.model,
                source_file_id=fid,
                source_filename=name,
                source_url=f.get("webViewLink"),
            )
            if queued:
                summary.queued += 1
                record["outcome"] = "queued"
                logger.info("Queued for manual download: %s %s (from %s)", result.make, result.model, name)
            else:
                summary.errors += 1
                record["outcome"] = "queue_failed"

        state.record(fid, **record)

    if not dry_run:
        state.save()

    return summary


def _format_summary(s: RunSummary) -> str:
    skipped_lines = "\n".join(f"  • {k}: {v}" for k, v in sorted(s.skipped.items())) or "  • none"
    return (
        f"Processed {s.listed} Drive image(s):\n"
        f"• {s.extracted} sent to vision\n"
        f"• {s.nameplates_found} nameplate(s) extracted\n"
        f"• {s.kb_hits} already in KB\n"
        f"• *{s.queued} new equipment queued* for manual download\n"
        f"• {s.errors} error(s)\n\n"
        f"Skipped:\n{skipped_lines}"
    )


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── CLI entrypoint ────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--dry-run", action="store_true", help="No backend writes; print plan.")
    parser.add_argument("--max-files", type=int, default=None, help="Cap number of Drive files listed.")
    parser.add_argument(
        "--drive-query",
        default=DEFAULT_DRIVE_QUERY,
        help="Drive API q= filter (default: image/jpeg + image/png, not trashed).",
    )
    parser.add_argument("--reset-state", action="store_true", help="Delete state file before running.")
    parser.add_argument("--no-telegram", action="store_true", help="Skip Telegram notification.")
    args = parser.parse_args()

    if args.reset_state and STATE_PATH.exists():
        STATE_PATH.unlink()
        logger.info("State file deleted — every Drive file will be reprocessed")

    try:
        summary = asyncio.run(
            run(dry_run=args.dry_run, max_files=args.max_files, drive_query=args.drive_query)
        )
    except RuntimeError as exc:
        # Typically: missing Drive auth env vars.
        logger.error("Scanner aborted: %s", exc)
        return 2
    except httpx.HTTPError as exc:
        logger.error("HTTP error talking to Drive or scan backend: %s", exc)
        return 1

    msg = _format_summary(summary)
    logger.info("\n%s", msg)

    if not args.no_telegram and not args.dry_run:
        ok = _tg_notify("asset_intel", msg)
        if not ok:
            logger.debug("Telegram notify skipped (no token/chat_id) or failed")

    # Non-zero exit if everything failed — useful for cron alerts.
    if summary.listed > 0 and summary.extracted == 0 and summary.errors > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
