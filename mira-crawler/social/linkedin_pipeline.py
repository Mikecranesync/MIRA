"""LinkedIn content pipeline — queue-based review and posting.

Reads from linkedin_queue.json. Posts move through:
  draft -> approved -> scheduled/posted

Posting backends (most to least autonomous):
  1. LinkedIn API  — fully automated if LINKEDIN_ACCESS_TOKEN + LINKEDIN_PERSON_ID set
  2. Buffer        — scheduled posting if BUFFER_ACCESS_TOKEN + BUFFER_LINKEDIN_PROFILE_ID set
  3. Copy/paste    — prints formatted post to terminal (always available as fallback)

Usage:
  python3 linkedin_pipeline.py --status                 # queue overview
  python3 linkedin_pipeline.py --preview launch-001     # read one post
  python3 linkedin_pipeline.py --approve launch-001     # mark as approved
  python3 linkedin_pipeline.py --unapprove launch-001   # revert to draft
  python3 linkedin_pipeline.py --run                    # post all approved posts now
  python3 linkedin_pipeline.py --dry-run                # show what --run would do
  python3 linkedin_pipeline.py --next                   # preview next scheduled post
  python3 linkedin_pipeline.py --add                    # interactively add a post to queue

LinkedIn API setup (optional — free, requires one-time OAuth):
  1. Create a LinkedIn Developer App at developer.linkedin.com (free)
  2. Request 'w_member_social' permission (for personal profile)
     or 'w_organization_social' (for company page)
  3. Run OAuth 2.0 to get a user access token (valid 60 days)
  4. Set env vars: LINKEDIN_ACCESS_TOKEN + LINKEDIN_PERSON_ID (urn:li:person:xxxx)
  5. Note: LinkedIn group posting via API was removed in 2015 v2 -- not supported.
     Personal profile posts can then be shared TO a group manually.

Buffer setup (optional — free tier, 10 scheduled posts, 1 account):
  1. Sign up at buffer.com (free), connect your LinkedIn account
  2. Set env vars: BUFFER_ACCESS_TOKEN + BUFFER_LINKEDIN_PROFILE_ID
  3. Buffer handles timing (set schedule_date/schedule_time in queue entries)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

QUEUE_FILE = Path(__file__).parent / "linkedin_queue.json"
POSTED_LOG = Path(__file__).parent / "linkedin_posted.jsonl"

# ── Queue I/O ─────────────────────────────────────────────────────────────────

def load_queue() -> list[dict]:
    if not QUEUE_FILE.exists():
        return []
    with open(QUEUE_FILE) as f:
        return json.load(f)


def save_queue(queue: list[dict]) -> None:
    with open(QUEUE_FILE, "w") as f:
        json.dump(queue, f, indent=2)


def log_posted(entry: dict, result: dict) -> None:
    with open(POSTED_LOG, "a") as f:
        f.write(json.dumps({
            "id": entry["id"],
            "post_type": entry.get("post_type"),
            "posted_at": datetime.now(timezone.utc).isoformat(),
            "backend": result.get("backend"),
            "backend_id": result.get("backend_id"),
            "schedule_date": entry.get("schedule_date"),
        }) + "\n")

# ── Formatting ────────────────────────────────────────────────────────────────

STATUS_ICONS = {"draft": "⬜", "approved": "✅", "scheduled": "📅", "posted": "✔️"}

def _fmt_preview(entry: dict) -> str:
    lines = [
        f"{'=' * 60}",
        f"ID:       {entry['id']}",
        f"Type:     {entry.get('post_type', 'unknown')}",
        f"Date:     {entry.get('schedule_date', '—')} {entry.get('schedule_time', '')} {entry.get('timezone', '')}",
        f"Status:   {STATUS_ICONS.get(entry.get('status','draft'), '?')} {entry.get('status', 'draft')}",
        f"Chars:    {entry.get('char_count', '?')}",
        f"{'─' * 60}",
        "",
        entry.get("post_text", "(no post_text)"),
        "",
        f"{'─' * 60}",
        f"Image:    {entry.get('image_suggestion', '—')}",
        f"{'=' * 60}",
    ]
    return "\n".join(lines)


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_status(queue: list[dict]) -> None:
    print(f"\nLinkedIn Queue — {QUEUE_FILE}")
    print(f"{'ID':<16} {'Type':<24} {'Date':<12} {'Status'}")
    print("─" * 72)
    for e in queue:
        icon = STATUS_ICONS.get(e.get("status", "draft"), "?")
        print(f"{e['id']:<16} {e.get('post_type','?'):<24} {e.get('schedule_date','?'):<12} {icon} {e.get('status','draft')}")
    print()
    counts = {}
    for e in queue:
        s = e.get("status", "draft")
        counts[s] = counts.get(s, 0) + 1
    print("  " + "  |  ".join(f"{v} {k}" for k, v in counts.items()))
    print()


def cmd_preview(queue: list[dict], post_id: str) -> None:
    for e in queue:
        if e["id"] == post_id:
            print(_fmt_preview(e))
            return
    print(f"ERROR: no post with id '{post_id}'")
    sys.exit(1)


def cmd_next(queue: list[dict]) -> None:
    approved = [e for e in queue if e.get("status") == "approved"]
    if not approved:
        draft_count = sum(1 for e in queue if e.get("status") == "draft")
        print(f"No approved posts. {draft_count} draft(s) waiting for review.")
        print(f"Run: python3 {Path(__file__).name} --approve <id>")
        return
    # Sort by schedule_date then schedule_time
    nxt = sorted(approved, key=lambda e: (e.get("schedule_date",""), e.get("schedule_time","")))[0]
    print(f"\nNext post to go out ({nxt.get('schedule_date')} {nxt.get('schedule_time')} {nxt.get('timezone','ET')}):\n")
    print(_fmt_preview(nxt))


def cmd_approve(queue: list[dict], post_id: str) -> None:
    for e in queue:
        if e["id"] == post_id:
            if e.get("status") == "posted":
                print(f"Post '{post_id}' already posted. Nothing changed.")
                return
            e["status"] = "approved"
            save_queue(queue)
            print(f"✅ '{post_id}' marked approved. Run --run to post it.")
            return
    print(f"ERROR: no post with id '{post_id}'")
    sys.exit(1)


def cmd_unapprove(queue: list[dict], post_id: str) -> None:
    for e in queue:
        if e["id"] == post_id:
            if e.get("status") in ("posted", "scheduled"):
                print(f"Post '{post_id}' is already {e['status']} -- cannot revert.")
                return
            e["status"] = "draft"
            save_queue(queue)
            print(f"⬜ '{post_id}' reverted to draft.")
            return
    print(f"ERROR: no post with id '{post_id}'")
    sys.exit(1)


def cmd_add(queue: list[dict]) -> None:
    print("\nAdd a new post to the queue (Ctrl-C to cancel).\n")
    post_id = input("ID (e.g. 'week-03-pain'): ").strip()
    if any(e["id"] == post_id for e in queue):
        print(f"ERROR: id '{post_id}' already exists.")
        sys.exit(1)

    post_type = input("Post type (pain_story/general_ai_maintenance/hot_take/insight/community/myth_bust/hand_raiser): ").strip()
    schedule_date = input("Schedule date (YYYY-MM-DD): ").strip()
    schedule_time = input("Schedule time (HH:MM, 24h ET): ").strip() or "07:30"
    image_suggestion = input("Image suggestion (or blank): ").strip()

    print("\nPost text (paste then press Enter twice):")
    lines = []
    while True:
        line = input()
        if line == "" and lines and lines[-1] == "":
            break
        lines.append(line)
    post_text = "\n".join(lines).strip()

    entry = {
        "id": post_id,
        "post_type": post_type,
        "schedule_date": schedule_date,
        "schedule_time": schedule_time,
        "timezone": "America/New_York",
        "status": "draft",
        "hashtags": [],
        "image_suggestion": image_suggestion,
        "char_count": len(post_text),
        "post_text": post_text,
    }
    queue.append(entry)
    save_queue(queue)
    print(f"\n⬜ Post '{post_id}' added as draft. Review with --preview {post_id}")


# ── Posting backends ──────────────────────────────────────────────────────────

def _post_linkedin_api(entry: dict) -> dict:
    """Post directly to LinkedIn personal profile via API."""
    token = os.environ.get("LINKEDIN_ACCESS_TOKEN", "")
    person_id = os.environ.get("LINKEDIN_PERSON_ID", "")
    if not token or not person_id:
        return {"ok": False, "error": "LINKEDIN_ACCESS_TOKEN or LINKEDIN_PERSON_ID not set"}
    if not HAS_HTTPX:
        return {"ok": False, "error": "httpx not installed (pip install httpx)"}

    payload = {
        "author": person_id,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": entry["post_text"]},
                "shareMediaCategory": "NONE",
            }
        },
        "visibility": {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
        },
    }
    try:
        resp = httpx.post(
            "https://api.linkedin.com/v2/ugcPosts",
            headers={
                "Authorization": f"Bearer {token}",
                "LinkedIn-Version": "202304",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        post_id = resp.headers.get("x-restli-id", resp.text[:100])
        return {"ok": True, "backend": "linkedin_api", "backend_id": post_id}
    except Exception as exc:
        return {"ok": False, "backend": "linkedin_api", "error": str(exc)}


def _post_buffer(entry: dict) -> dict:
    """Schedule via Buffer API."""
    token = os.environ.get("BUFFER_ACCESS_TOKEN", "")
    profile_id = os.environ.get("BUFFER_LINKEDIN_PROFILE_ID", "")
    if not token or not profile_id:
        return {"ok": False, "error": "BUFFER_ACCESS_TOKEN or BUFFER_LINKEDIN_PROFILE_ID not set"}
    if not HAS_HTTPX:
        return {"ok": False, "error": "httpx not installed"}

    try:
        resp = httpx.post(
            "https://api.bufferapp.com/1/updates/create.json",
            data={
                "access_token": token,
                "text": entry["post_text"],
                "profile_ids[]": profile_id,
                "scheduled_at": _to_iso_scheduled(entry),
                "now": "false",
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        buf_id = data.get("updates", [{}])[0].get("id", "")
        return {"ok": True, "backend": "buffer", "backend_id": buf_id}
    except Exception as exc:
        return {"ok": False, "backend": "buffer", "error": str(exc)}


def _to_iso_scheduled(entry: dict) -> str:
    """Convert schedule_date + schedule_time (ET) to ISO 8601 UTC."""
    from datetime import datetime
    date_str = entry.get("schedule_date", "")
    time_str = entry.get("schedule_time", "07:30")
    if not date_str:
        return ""
    try:
        # Simple ET -> UTC offset: assume EST (-5h) for scheduling purposes
        # Production: install pytz for DST-aware conversion
        naive = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
        utc_offset_hours = 4  # EDT; change to 5 when EST
        from datetime import timedelta
        utc_dt = naive + timedelta(hours=utc_offset_hours)
        return utc_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return ""


def _print_copyable(entry: dict) -> None:
    """Print the post formatted for manual copy/paste."""
    print("\n" + "=" * 60)
    print(f"READY TO POST: {entry['id']} ({entry.get('schedule_date')} {entry.get('schedule_time')} ET)")
    print("=" * 60)
    print("\n--- COPY THIS ---")
    print(entry["post_text"])
    print("--- END ---\n")
    print(f"Image: {entry.get('image_suggestion', '(none)')}\n")
    print(f"LinkedIn: linkedin.com — paste into post composer, publish")
    print(f"Then mark done: python3 {Path(__file__).name} --mark-posted {entry['id']}")
    print("=" * 60 + "\n")


def _choose_backend(entry: dict, dry_run: bool) -> dict:
    """Try backends in priority order. Returns result dict."""
    if dry_run:
        return {"ok": True, "backend": "dry_run", "backend_id": None}

    # 1. LinkedIn direct API
    if os.environ.get("LINKEDIN_ACCESS_TOKEN") and os.environ.get("LINKEDIN_PERSON_ID"):
        result = _post_linkedin_api(entry)
        if result["ok"]:
            return result
        print(f"  LinkedIn API failed: {result.get('error')} — trying Buffer...")

    # 2. Buffer scheduling
    if os.environ.get("BUFFER_ACCESS_TOKEN") and os.environ.get("BUFFER_LINKEDIN_PROFILE_ID"):
        result = _post_buffer(entry)
        if result["ok"]:
            return result
        print(f"  Buffer failed: {result.get('error')} — falling back to copy/paste...")

    # 3. Copy/paste fallback (always works)
    _print_copyable(entry)
    return {"ok": True, "backend": "copy_paste", "backend_id": None}


def cmd_run(queue: list[dict], dry_run: bool = False) -> None:
    approved = [e for e in queue if e.get("status") == "approved"]
    if not approved:
        print("No approved posts to send. Use --approve <id> first.")
        return

    if dry_run:
        print(f"\nDRY RUN — would post {len(approved)} approved post(s):\n")
    else:
        print(f"\nPosting {len(approved)} approved post(s)...\n")

    for entry in approved:
        print(f"  → {entry['id']} ({entry.get('post_type')}, {entry.get('schedule_date')})")
        result = _choose_backend(entry, dry_run)

        if dry_run:
            print(f"     [dry-run] would post via {result.get('backend', 'copy_paste')}")
            continue

        if result["ok"]:
            backend = result.get("backend", "copy_paste")
            if backend != "copy_paste":
                entry["status"] = "posted"
                entry["posted_at"] = datetime.now(timezone.utc).isoformat()
                entry["backend"] = backend
                entry["backend_id"] = result.get("backend_id")
                log_posted(entry, result)
                print(f"     ✔ Posted via {backend} (id: {result.get('backend_id')})")
            else:
                # copy/paste: mark scheduled, don't auto-post
                entry["status"] = "scheduled"
                print(f"     📋 Copy/paste output shown above — mark done with --mark-posted {entry['id']}")
        else:
            print(f"     ✗ Failed: {result.get('error')}")

    save_queue(queue)


def cmd_mark_posted(queue: list[dict], post_id: str) -> None:
    for e in queue:
        if e["id"] == post_id:
            e["status"] = "posted"
            e["posted_at"] = datetime.now(timezone.utc).isoformat()
            save_queue(queue)
            log_posted(e, {"backend": "manual"})
            print(f"✔️  '{post_id}' marked as posted.")
            return
    print(f"ERROR: no post with id '{post_id}'")
    sys.exit(1)


# ── LinkedIn API auth info ────────────────────────────────────────────────────

def cmd_api_info() -> None:
    print("""
LinkedIn API Setup — one-time, free

WHAT'S AVAILABLE:
  Personal profile posting:  YES — via w_member_social OAuth permission
  Company page posting:      YES — via w_organization_social permission
  Group posting via API:     NO  — removed by LinkedIn in 2015 (v2 API)

FREE TIER:
  The LinkedIn Developer API is free. No paid plan required.
  Tokens expire after 60 days — you re-authorize every 2 months.

STEPS:
  1. Go to developer.linkedin.com → Create App
  2. Fill in: App name (e.g. "FactoryLM Content"), Company page, Privacy policy URL
  3. Under "Auth" → request these OAuth 2.0 scopes:
       w_member_social    (post on behalf of your personal profile)
       r_liteprofile      (read your person URN)
  4. Add a redirect URI: http://localhost:8080/callback
  5. Run the OAuth flow to get your access token:

     curl -s "https://www.linkedin.com/oauth/v2/authorization?\\
       response_type=code&\\
       client_id=YOUR_CLIENT_ID&\\
       redirect_uri=http://localhost:8080/callback&\\
       scope=w_member_social%20r_liteprofile"

     Open that URL in browser → authorize → grab the 'code' from the redirect URL.

     Exchange for token:
     curl -X POST https://www.linkedin.com/oauth/v2/accessToken \\
       -d "grant_type=authorization_code" \\
       -d "code=YOUR_CODE" \\
       -d "client_id=YOUR_CLIENT_ID" \\
       -d "client_secret=YOUR_SECRET" \\
       -d "redirect_uri=http://localhost:8080/callback"

  6. Get your person URN:
     curl -H "Authorization: Bearer YOUR_TOKEN" https://api.linkedin.com/v2/me
     Your 'id' field becomes: urn:li:person:{id}

  7. Set env vars (add to Doppler factorylm/prd):
       LINKEDIN_ACCESS_TOKEN = <token>
       LINKEDIN_PERSON_ID    = urn:li:person:<your_id>

  8. Re-authorize every 60 days.

FASTER ALTERNATIVE — Buffer (already wired in social.py):
  1. buffer.com → free plan → connect LinkedIn
  2. Your LinkedIn profile ID shows in Buffer under account settings
  3. Set: BUFFER_ACCESS_TOKEN + BUFFER_LINKEDIN_PROFILE_ID in Doppler
  4. Buffer handles the scheduling queue and the LinkedIn OAuth refresh

FOR GROUPS (Mike's hydraulics group):
  LinkedIn removed group posting from their API in 2015.
  Workaround: post to personal profile, then share post TO the group manually.
  Takes 10 seconds. This is the realistic flow for now.
""")

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="LinkedIn content pipeline — queue-based review and posting",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--status",     action="store_true",   help="Show queue overview")
    parser.add_argument("--preview",    metavar="ID",          help="Preview a post")
    parser.add_argument("--next",       action="store_true",   help="Preview next approved post")
    parser.add_argument("--approve",    metavar="ID",          help="Mark a post as approved")
    parser.add_argument("--unapprove",  metavar="ID",          help="Revert a post to draft")
    parser.add_argument("--mark-posted",metavar="ID",          help="Mark a post as posted (copy/paste flow)")
    parser.add_argument("--add",        action="store_true",   help="Interactively add a post")
    parser.add_argument("--run",        action="store_true",   help="Post all approved posts now")
    parser.add_argument("--dry-run",    action="store_true",   help="Show what --run would do, without posting")
    parser.add_argument("--api-info",   action="store_true",   help="LinkedIn API setup instructions")

    args = parser.parse_args()

    if args.api_info:
        cmd_api_info()
        return

    queue = load_queue()

    if args.status:
        cmd_status(queue)
    elif args.preview:
        cmd_preview(queue, args.preview)
    elif args.next:
        cmd_next(queue)
    elif args.approve:
        cmd_approve(queue, args.approve)
    elif args.unapprove:
        cmd_unapprove(queue, args.unapprove)
    elif args.mark_posted:
        cmd_mark_posted(queue, args.mark_posted)
    elif args.add:
        cmd_add(queue)
    elif args.run or args.dry_run:
        cmd_run(queue, dry_run=args.dry_run)
    else:
        # Default: show status + next post
        cmd_status(queue)
        cmd_next(queue)


if __name__ == "__main__":
    main()
