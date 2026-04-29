"""Social Media Publisher — reads approved posts from linkedin_queue.json and publishes them.

Backend priority (auto-detected from env, or forced with --backend):
  zernio     — Zernio REST API (ZERNIO_API_KEY + ZERNIO_LINKEDIN_PROFILE_ID)
  buffer     — Buffer API (BUFFER_ACCESS_TOKEN + BUFFER_LINKEDIN_PROFILE_ID)
  clipboard  — writes post text to /tmp/mira_post_clipboard.txt for manual copy/paste
  dry-run    — prints what would be posted, changes nothing (default)

Usage:
  python publisher.py --dry-run              # preview all due approved posts
  python publisher.py --publish              # post all approved posts due today
  python publisher.py --publish --backend zernio
  python publisher.py --publish --backend clipboard
  python publisher.py --status              # queue summary
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from abc import ABC, abstractmethod
from datetime import date, datetime, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("publisher")

QUEUE_FILE = Path(__file__).parent / "linkedin_queue.json"
LOG_FILE = Path(__file__).parent / "publish_log.jsonl"
CLIPBOARD_FILE = Path("/tmp/mira_post_clipboard.txt")

# ── Backend protocol ──────────────────────────────────────────────────────────

class PublishResult:
    def __init__(self, ok: bool, backend: str, backend_id: str = "", error: str = "") -> None:
        self.ok = ok
        self.backend = backend
        self.backend_id = backend_id
        self.error = error

    def __repr__(self) -> str:
        if self.ok:
            return f"PublishResult(ok=True, backend={self.backend!r}, id={self.backend_id!r})"
        return f"PublishResult(ok=False, backend={self.backend!r}, error={self.error!r})"


class Backend(ABC):
    name: str

    @abstractmethod
    def publish(self, post: dict) -> PublishResult:
        ...

    def available(self) -> bool:
        return True


# ── DryRun ────────────────────────────────────────────────────────────────────

class DryRunBackend(Backend):
    name = "dry-run"

    def publish(self, post: dict) -> PublishResult:
        bar = "─" * 60
        print(f"\n{bar}")
        print(f"[DRY-RUN] {post['id']} | {post.get('post_type')} | {post.get('schedule_date')}")
        print(bar)
        print(post["post_text"])
        print(f"\nImage: {post.get('image_suggestion', '(none)')}")
        print(bar)
        return PublishResult(ok=True, backend=self.name, backend_id="dry-run")


# ── Clipboard ─────────────────────────────────────────────────────────────────

class ClipboardBackend(Backend):
    name = "clipboard"

    def publish(self, post: dict) -> PublishResult:
        content = (
            f"=== {post['id']} | {post.get('post_type')} | {post.get('schedule_date')} ===\n\n"
            f"{post['post_text']}\n\n"
            f"--- Image suggestion ---\n{post.get('image_suggestion', '(none)')}\n"
            f"--- Hashtags ---\n{' '.join(post.get('hashtags', []))}\n"
        )
        CLIPBOARD_FILE.write_text(content)
        logger.info("Clipboard: post written to %s", CLIPBOARD_FILE)
        print(f"\n✔  '{post['id']}' written to {CLIPBOARD_FILE}")
        print("   Open the file, copy the text, paste to LinkedIn.")
        return PublishResult(ok=True, backend=self.name, backend_id=str(CLIPBOARD_FILE))


# ── Zernio ────────────────────────────────────────────────────────────────────

class ZernioBackend(Backend):
    name = "zernio"
    BASE = "https://api.zernio.com/v1"

    def __init__(self) -> None:
        self.api_key = os.environ.get("ZERNIO_API_KEY", "")
        self.profile_ids: dict[str, str] = {}
        if os.environ.get("ZERNIO_LINKEDIN_PROFILE_ID"):
            self.profile_ids["linkedin"] = os.environ["ZERNIO_LINKEDIN_PROFILE_ID"]
        if os.environ.get("ZERNIO_TWITTER_PROFILE_ID"):
            self.profile_ids["twitter"] = os.environ["ZERNIO_TWITTER_PROFILE_ID"]

    def available(self) -> bool:
        return bool(self.api_key and self.profile_ids)

    def publish(self, post: dict) -> PublishResult:
        try:
            import httpx
        except ImportError:
            return PublishResult(ok=False, backend=self.name, error="httpx not installed — pip install httpx")

        results: list[str] = []
        for platform, profile_id in self.profile_ids.items():
            try:
                resp = httpx.post(
                    f"{self.BASE}/posts",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={
                        "profile_id": profile_id,
                        "platform": platform,
                        "content": post["post_text"],
                        "hashtags": post.get("hashtags", []),
                    },
                    timeout=30,
                )
                resp.raise_for_status()
                data = resp.json()
                post_id = data.get("id", data.get("post_id", ""))
                results.append(f"{platform}:{post_id}")
                logger.info("Zernio: posted to %s — id=%s", platform, post_id)
            except Exception as exc:
                return PublishResult(ok=False, backend=self.name, error=f"{platform}: {exc}")

        return PublishResult(ok=True, backend=self.name, backend_id=",".join(results))


# ── Buffer ────────────────────────────────────────────────────────────────────

class BufferBackend(Backend):
    name = "buffer"
    BASE = "https://api.bufferapp.com/1"

    def __init__(self) -> None:
        self.token = os.environ.get("BUFFER_ACCESS_TOKEN", "")
        self.linkedin_profile = os.environ.get("BUFFER_LINKEDIN_PROFILE_ID", "")

    def available(self) -> bool:
        return bool(self.token and self.linkedin_profile)

    def publish(self, post: dict) -> PublishResult:
        try:
            import httpx
        except ImportError:
            return PublishResult(ok=False, backend=self.name, error="httpx not installed")

        try:
            resp = httpx.post(
                f"{self.BASE}/updates/create.json",
                data={
                    "access_token": self.token,
                    "text": post["post_text"],
                    "profile_ids[]": self.linkedin_profile,
                    "now": "true",
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            buf_id = data.get("updates", [{}])[0].get("id", "")
            logger.info("Buffer: queued — id=%s", buf_id)
            return PublishResult(ok=True, backend=self.name, backend_id=buf_id)
        except Exception as exc:
            return PublishResult(ok=False, backend=self.name, error=str(exc))


# ── Backend registry ──────────────────────────────────────────────────────────

BACKENDS: dict[str, type[Backend]] = {
    "zernio":    ZernioBackend,
    "buffer":    BufferBackend,
    "clipboard": ClipboardBackend,
    "dry-run":   DryRunBackend,
}


def auto_backend(forced: str | None = None) -> Backend:
    """Return the highest-priority available backend, or force a specific one."""
    if forced:
        cls = BACKENDS.get(forced)
        if not cls:
            logger.error("Unknown backend: %s. Choices: %s", forced, list(BACKENDS))
            sys.exit(1)
        b = cls()
        if not b.available() and forced not in ("dry-run", "clipboard"):
            logger.warning("Backend '%s' requested but required env vars are missing — falling back to dry-run", forced)
            return DryRunBackend()
        return b

    for cls in (ZernioBackend, BufferBackend):
        b = cls()
        if b.available():
            logger.info("Auto-selected backend: %s", cls.name)  # type: ignore[attr-defined]
            return b

    logger.info("No API keys found — using dry-run backend")
    return DryRunBackend()


# ── Queue helpers ─────────────────────────────────────────────────────────────

def load_queue() -> list[dict]:
    if not QUEUE_FILE.exists():
        logger.error("Queue file not found: %s", QUEUE_FILE)
        sys.exit(1)
    with open(QUEUE_FILE) as f:
        return json.load(f)


def save_queue(queue: list[dict]) -> None:
    with open(QUEUE_FILE, "w") as f:
        json.dump(queue, f, indent=2)


def append_log(entry: dict) -> None:
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")


def posts_due(queue: list[dict], today: date) -> list[dict]:
    """Approved posts whose schedule_date is today or earlier."""
    due = []
    for p in queue:
        if p.get("status") != "approved":
            continue
        try:
            sched = date.fromisoformat(p.get("schedule_date", "9999-12-31"))
        except ValueError:
            continue
        if sched <= today:
            due.append(p)
    return sorted(due, key=lambda p: p.get("schedule_date", ""))


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_status(queue: list[dict]) -> None:
    today = date.today()
    counts: dict[str, int] = {}
    for p in queue:
        s = p.get("status", "draft")
        counts[s] = counts.get(s, 0) + 1

    print(f"\nQueue: {QUEUE_FILE}")
    print(f"{'ID':<16} {'Type':<24} {'Date':<12} {'Status'}")
    print("─" * 70)
    for p in queue:
        flag = " ◄ DUE" if p.get("status") == "approved" and p.get("schedule_date", "9999") <= str(today) else ""
        print(f"{p['id']:<16} {p.get('post_type','?'):<24} {p.get('schedule_date','?'):<12} {p.get('status','draft')}{flag}")
    print()
    print("  " + "  |  ".join(f"{v} {k}" for k, v in counts.items()))
    due = posts_due(queue, today)
    if due:
        print(f"\n  {len(due)} post(s) due today and approved — run --publish to send.")
    print()


def cmd_dry_run(queue: list[dict]) -> None:
    today = date.today()
    due = posts_due(queue, today)
    if not due:
        approved = sum(1 for p in queue if p.get("status") == "approved")
        drafts = sum(1 for p in queue if p.get("status") == "draft")
        print(f"\nNothing due today. {approved} approved (future-dated), {drafts} drafts awaiting review.")
        return
    print(f"\n{len(due)} post(s) due today:\n")
    backend = DryRunBackend()
    for post in due:
        backend.publish(post)


def cmd_publish(queue: list[dict], backend: Backend) -> None:
    today = date.today()
    due = posts_due(queue, today)
    if not due:
        logger.info("No approved posts due today.")
        return

    logger.info("Publishing %d post(s) via %s", len(due), backend.name)
    published = 0
    failed = 0

    for post in due:
        logger.info("Publishing: %s (%s)", post["id"], post.get("post_type"))
        result = backend.publish(post)

        now = datetime.now(timezone.utc).isoformat()
        log_entry = {
            "id": post["id"],
            "post_type": post.get("post_type"),
            "schedule_date": post.get("schedule_date"),
            "published_at": now,
            "backend": result.backend,
            "backend_id": result.backend_id,
            "ok": result.ok,
            "error": result.error or None,
        }

        if result.ok:
            if backend.name not in ("dry-run",):
                # Only mutate queue for real backends
                post["status"] = "published"
                post["published_at"] = now
                post["backend"] = result.backend
                post["backend_id"] = result.backend_id
            append_log(log_entry)
            published += 1
            logger.info("✔ %s — %s", post["id"], result.backend_id or "ok")
        else:
            logger.error("✗ %s — %s", post["id"], result.error)
            failed += 1

    if backend.name not in ("dry-run",):
        save_queue(queue)

    logger.info("Done. published=%d failed=%d backend=%s", published, failed, backend.name)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Social media publisher — reads approved posts from linkedin_queue.json",
    )
    parser.add_argument("--publish",    action="store_true", help="Publish all approved posts due today")
    parser.add_argument("--dry-run",    action="store_true", help="Preview what would be posted (no changes)")
    parser.add_argument("--status",     action="store_true", help="Show queue summary")
    parser.add_argument(
        "--backend",
        choices=list(BACKENDS),
        help="Force a specific backend (default: auto-detect from env)",
    )
    args = parser.parse_args()

    queue = load_queue()

    if args.status:
        cmd_status(queue)
    elif args.dry_run:
        cmd_dry_run(queue)
    elif args.publish:
        backend = auto_backend(args.backend)
        cmd_publish(queue, backend)
    else:
        # Default: status + dry-run preview
        cmd_status(queue)
        cmd_dry_run(queue)


if __name__ == "__main__":
    main()
