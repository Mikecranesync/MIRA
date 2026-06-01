"""Orchestrates the YouTube content pipeline. Run daily via launchd; skips if <48h since last run."""
from __future__ import annotations

import logging
import os
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("yt-pipeline")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

_PIPELINE_DIR = Path(__file__).parent
_CALENDAR_FILE = _PIPELINE_DIR / "calendar.json"
_ERROR_LOG = Path("/tmp/yt-pipeline/errors.log")
_PAUSE_SENTINEL = Path("/tmp/yt-pipeline/PAUSED")
_YT_DRAFTS_DIR = Path.home() / "yt-pipeline-drafts"
_MIN_INTERVAL_HOURS = 47  # fire if >=47h since last run (buffer for launchd jitter)


def _should_run(cal: dict) -> bool:
    """Check if enough time has passed since the last run."""
    last = cal.get("last_run_utc")
    if last is None:
        return True
    last_dt = datetime.fromisoformat(last)
    hours_since = (datetime.now(timezone.utc) - last_dt).total_seconds() / 3600
    return hours_since >= _MIN_INTERVAL_HOURS


def run(dry_run: bool = False, force: bool = False) -> None:
    """
    Execute the pipeline orchestration.

    Stages:
    1. plan_next() -> plan dict
    2. produce() -> assets dict
    3. assemble() -> final.mp4 path
    4a. VOICED: upload() -> video_id (requires YouTube creds)
    4b. SILENT: save to drafts folder with narration_script + meta.txt

    On error: log, update consecutive_failures counter, pause after 3 failures.

    When `force=True`, skip the 48h "last run was recent" guard — used by
    the publish-now/on-demand workflow.
    """
    from .assembler import assemble
    from .planner import load_calendar, plan_next, save_calendar
    from .producer import produce
    from .uploader import upload

    if _PAUSE_SENTINEL.exists():
        log.warning("Pipeline paused. Delete %s to resume.", _PAUSE_SENTINEL)
        return

    cal = load_calendar(_CALENDAR_FILE)
    if not force and not _should_run(cal):
        log.info("Last run was recent — skipping this trigger. Pass --force to override.")
        return

    run_id = uuid.uuid4().hex[:8]
    run_dir = Path(f"/tmp/yt-pipeline/{run_id}")

    try:
        groq_key = os.environ["GROQ_API_KEY"]
        log.info("Run %s starting (dry_run=%s)", run_id, dry_run)
        plan = plan_next(groq_key)
        log.info("Planned: %s", plan["title"])

        if dry_run:
            log.info("Dry run — stopping after planner. Plan:\n%s", plan)
            return

        # Secrets only needed for the full pipeline are read AFTER the dry-run
        # early-return, so a dry-run works with just GROQ_API_KEY present.
        # BytePlus is optional — empty string means screenshot-only pipeline.
        # OpenAI is optional — empty string means silent draft (no TTS).
        byteplus_key = os.environ.get("BYTEPLUS_API_KEY", "")
        openai_key = os.environ.get("OPENAI_API_KEY", "")

        assets = produce(plan, run_dir, byteplus_api_key=byteplus_key, openai_api_key=openai_key)
        video_path = assemble(plan, assets, run_dir)

        # Determine if this is a voiced (with audio) or silent (draft) run
        is_voiced = "narration_audio" in assets

        upload_failed_reason = None
        if is_voiced:
            # Voiced path: try to upload to YouTube. If that fails (bad token,
            # network, quota), DON'T lose the MP4 — degrade to the draft path
            # below so the run dir gets preserved and the user can upload it
            # manually via YouTube Studio.
            yt_client_id = os.environ["YOUTUBE_CLIENT_ID"]
            yt_client_secret = os.environ["YOUTUBE_CLIENT_SECRET"]
            yt_refresh_token = os.environ["YOUTUBE_REFRESH_TOKEN_ISH"]
            auto_publish = os.environ.get("AUTO_PUBLISH", "false").lower() == "true"

            try:
                video_id = upload(
                    plan, video_path, yt_client_id, yt_client_secret, yt_refresh_token, auto_publish
                )
                cal["next_angle_index"] = plan["angle_index"] + 1
                cal["last_run_utc"] = datetime.now(timezone.utc).isoformat()
                cal["consecutive_failures"] = 0
                cal.setdefault("published", []).append({
                    "video_id": video_id,
                    "title": plan["title"],
                    "topic": plan["area"],
                    "angle_index": plan["angle_index"],
                    "status": "public" if auto_publish else "private",
                    "uploaded_at": datetime.now(timezone.utc).isoformat(),
                })
                save_calendar(cal, _CALENDAR_FILE)
                log.info("Run %s complete -> https://youtube.com/watch?v=%s", run_id, video_id)
                is_voiced = False  # done; skip the draft-save block below
            except Exception as upload_exc:
                upload_failed_reason = f"{type(upload_exc).__name__}: {upload_exc}"
                log.error(
                    "YouTube upload failed (%s) — saving voiced MP4 to drafts so it isn't lost. "
                    "Regenerate YOUTUBE_REFRESH_TOKEN_ISH and re-run.",
                    upload_failed_reason,
                )
                # Fall through to the draft-save block below — but flag is_voiced
                # False-ish so we use the draft path, AND keep the narration audio
                # by routing it into the draft dir alongside the script.
                is_voiced = False

        if not is_voiced:
            # Silent path: save to drafts folder
            draft_timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
            # Build slug from title: lowercase, non-alphanumeric -> dash
            title_slug = "".join(c.lower() if c.isalnum() else "-" for c in plan["title"])
            title_slug = "".join(c for c in title_slug if c.isalnum() or c == "-")
            title_slug = "-".join(w for w in title_slug.split("-") if w)  # Remove empty parts
            title_slug = title_slug[:50]  # Trim to reasonable length

            draft_dir = _YT_DRAFTS_DIR / f"{draft_timestamp}_{title_slug}"
            draft_dir.mkdir(parents=True, exist_ok=True)

            # Copy final.mp4 and narration_script.txt
            import shutil as _shutil
            _shutil.copy2(video_path, draft_dir / "final.mp4")
            _shutil.copy2(assets["narration_script"], draft_dir / "narration_script.txt")
            # If this was a voiced run whose upload failed, also copy the narration.mp3
            # so the user has the complete asset bundle for a manual upload.
            if "narration_audio" in assets:
                _shutil.copy2(assets["narration_audio"], draft_dir / "narration.mp3")

            # Write meta.txt with metadata for manual upload
            meta_lines = [
                f"title: {plan['title']}",
                f"description: {plan['description']}",
                f"tags: {', '.join(plan['tags'])}",
            ]
            if upload_failed_reason:
                meta_lines.append(f"upload_failure: {upload_failed_reason}")
            (draft_dir / "meta.txt").write_text("\n".join(meta_lines))

            # Update calendar with draft entry
            cal["next_angle_index"] = plan["angle_index"] + 1
            cal["last_run_utc"] = datetime.now(timezone.utc).isoformat()
            cal["consecutive_failures"] = 0
            cal.setdefault("drafts", []).append({
                "title": plan["title"],
                "topic": plan["area"],
                "angle_index": plan["angle_index"],
                "draft_dir": str(draft_dir),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            save_calendar(cal, _CALENDAR_FILE)
            log.info("Silent draft saved: %s", draft_dir)

    except Exception as exc:
        log.exception("Run %s failed: %s", run_id, exc)
        _ERROR_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(_ERROR_LOG, "a") as f:
            f.write(f"{datetime.now(timezone.utc).isoformat()} run={run_id} error={exc}\n")
        cal = load_calendar(_CALENDAR_FILE)
        failures = cal.get("consecutive_failures", 0) + 1
        cal["consecutive_failures"] = failures
        save_calendar(cal, _CALENDAR_FILE)
        if failures >= 3:
            _PAUSE_SENTINEL.parent.mkdir(parents=True, exist_ok=True)
            _PAUSE_SENTINEL.write_text(f"Paused after {failures} failures. Last: {exc}")
            log.error("Pipeline paused after 3 failures. Delete %s to resume.", _PAUSE_SENTINEL)
        sys.exit(1)
    finally:
        if run_dir.exists():
            shutil.rmtree(run_dir, ignore_errors=True)


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    force = "--force" in sys.argv
    run(dry_run=dry_run, force=force)
