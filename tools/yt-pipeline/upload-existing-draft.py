"""Upload a draft folder's final.mp4 to YouTube using the existing uploader.

Used for one-off recovery: a draft that was produced when the YouTube token
was invalid, then preserved in `~/yt-pipeline-drafts/`. Now that the token
is valid, we can publish it without re-running the full pipeline (and
without burning more OpenAI TTS spend).

Usage:
    doppler run --project factorylm --config prd -- \\
        python3.12 tools/yt-pipeline/upload-existing-draft.py \\
        <path-to-draft-folder>

The draft folder must contain `final.mp4` and `meta.txt` (in the format
written by main.py's silent-path block). Title/description/tags are parsed
from meta.txt.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Make `from tools.yt_pipeline.uploader import upload` resolve.
REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tools.yt_pipeline.uploader import upload  # noqa: E402


def parse_meta(meta_path: Path) -> dict:
    """Parse meta.txt into a dict the uploader expects."""
    plan: dict = {"title": "", "description": "", "tags": []}
    text = meta_path.read_text(encoding="utf-8")
    # The meta block is line-based but the description includes the
    # `Chapters:` section verbatim. Parse top-level keys conservatively.
    lines = text.splitlines()
    desc_start = None
    desc_end = len(lines)
    for i, line in enumerate(lines):
        if line.startswith("title: "):
            plan["title"] = line[len("title: "):]
        elif line.startswith("description: "):
            plan["description"] = line[len("description: "):]
            desc_start = i + 1
        elif line.startswith("tags: "):
            plan["tags"] = [t.strip() for t in line[len("tags: "):].split(",")]
            desc_end = i
            break
    # Anything between `description:` and `tags:` is appended (preserves
    # the Chapters section the pipeline wrote into the description).
    if desc_start is not None and desc_end > desc_start:
        extra = "\n".join(lines[desc_start:desc_end]).strip()
        if extra:
            plan["description"] = (plan["description"] + "\n\n" + extra).strip()
    return plan


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: upload-existing-draft.py <draft-folder>", file=sys.stderr)
        return 2

    draft_dir = Path(sys.argv[1]).resolve()
    final_mp4 = draft_dir / "final.mp4"
    meta_path = draft_dir / "meta.txt"

    if not final_mp4.exists() or not meta_path.exists():
        print(
            f"ERROR: {draft_dir} is missing final.mp4 or meta.txt",
            file=sys.stderr,
        )
        return 2

    plan = parse_meta(meta_path)
    if not plan["title"]:
        print(f"ERROR: meta.txt at {meta_path} has no title", file=sys.stderr)
        return 2

    client_id = os.environ["YOUTUBE_CLIENT_ID"]
    client_secret = os.environ["YOUTUBE_CLIENT_SECRET"]
    refresh_token = os.environ["YOUTUBE_REFRESH_TOKEN_ISH"]
    auto_publish = os.environ.get("AUTO_PUBLISH", "false").lower() == "true"

    video_id = upload(
        plan, final_mp4, client_id, client_secret, refresh_token, auto_publish
    )
    visibility = "public" if auto_publish else "private"
    print(f"uploaded ({visibility}): https://youtube.com/watch?v={video_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
