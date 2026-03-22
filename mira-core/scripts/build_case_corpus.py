#!/usr/bin/env python3
"""Build Prejudged Case Corpus — Load seed cases + Reddit solved threads.

Usage:
    # Seed cases only (no network)
    python mira-core/scripts/build_case_corpus.py --seed-only

    # Seed + Reddit solved threads (needs ANTHROPIC_API_KEY for structuring)
    doppler run --project factorylm --config prd -- \
      python mira-core/scripts/build_case_corpus.py

Env vars:
    MIRA_DB_PATH       — SQLite path (default: ./data/mira.db)
    ANTHROPIC_API_KEY   — Required for Reddit solved thread structuring
"""

import argparse
import json
import logging
import os
import re
import sys
import time

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("build-case-corpus")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "mira-bots"))

from shared.benchmark_db import (  # noqa: E402
    ensure_tables,
    insert_prejudged_case,
    count_prejudged_cases,
    list_questions,
    count_questions,
)

SEED_CASES_PATH = os.path.join(REPO_ROOT, "mira-core", "data", "seed_cases.json")
USER_AGENT = "MIRA-Benchmark/1.0 by FactoryLM (non-commercial research)"

# Signals that a Reddit comment contains a verified solution
SOLVED_SIGNALS = re.compile(
    r"(turned out to be|it was the|fixed it|problem was|ended up being"
    r"|root cause was|solution was|issue was|found the|cause was"
    r"|resolved by|that fixed|the fix was|solved it|finally found)",
    re.IGNORECASE,
)


def load_seed_cases(db_path: str | None = None) -> int:
    """Load seed cases from seed_cases.json into the DB. Returns count inserted."""
    if not os.path.exists(SEED_CASES_PATH):
        logger.error("Seed cases file not found: %s", SEED_CASES_PATH)
        return 0

    with open(SEED_CASES_PATH) as f:
        cases = json.load(f)

    inserted = 0
    for case in cases:
        row_id = insert_prejudged_case(
            source="seed",
            source_id=case["id"],
            title=case["title"],
            equipment_type=case.get("equipment_type", ""),
            fault_category=case.get("fault_category", ""),
            evidence_packet=case["evidence_packet"],
            ground_truth=case["ground_truth"],
            difficulty=case.get("difficulty", "medium"),
            db_path=db_path,
        )
        if row_id > 0:
            inserted += 1
            logger.info("  Loaded seed case: %s", case["title"])
        else:
            logger.debug("  Skipped duplicate: %s", case["id"])

    logger.info("Seed cases: %d inserted, %d total", inserted, len(cases))
    return inserted


def _fetch_comments(post_id: str, subreddit: str, client: httpx.Client) -> list[dict]:
    """Fetch comments for a Reddit post via public JSON."""
    url = f"https://www.reddit.com/r/{subreddit}/comments/{post_id}.json"
    try:
        resp = client.get(url)
    except httpx.HTTPError as exc:
        logger.warning("Failed to fetch comments for %s: %s", post_id, exc)
        return []

    if resp.status_code != 200:
        logger.warning("Comments for %s returned %d", post_id, resp.status_code)
        return []

    data = resp.json()
    if not isinstance(data, list) or len(data) < 2:
        return []

    comments = []
    for child in data[1].get("data", {}).get("children", []):
        body = child.get("data", {}).get("body", "")
        score = child.get("data", {}).get("score", 0)
        if body and score > 0:
            comments.append({"body": body, "score": score})

    return comments


def _find_solved_comment(comments: list[dict]) -> str | None:
    """Find the best comment that indicates a verified solution."""
    candidates = []
    for c in comments:
        if SOLVED_SIGNALS.search(c["body"]) and len(c["body"]) > 30:
            candidates.append(c)

    if not candidates:
        return None

    # Return highest-scored solved comment
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates[0]["body"]


def _structure_solution(
    title: str,
    body: str,
    solved_comment: str,
    anthropic_client,
) -> dict | None:
    """Use Claude haiku to structure a solved comment into ground truth JSON."""
    prompt = f"""Given this Reddit maintenance question and its verified solution comment, extract structured ground truth.

QUESTION TITLE: {title}
QUESTION BODY: {body[:500]}

VERIFIED SOLUTION COMMENT: {solved_comment[:800]}

Return a JSON object with exactly these fields:
- root_cause: string — the root cause of the problem (1-2 sentences)
- fix: string — what was done to fix it (1-2 sentences)
- keywords: array of strings — 5-8 technical keywords relevant to the diagnosis

Return ONLY the JSON object, no other text."""

    try:
        resp = anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        # Parse JSON from response
        if text.startswith("{"):
            return json.loads(text)
        # Try to extract JSON from markdown code block
        match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group())
    except Exception as exc:
        logger.warning("Failed to structure solution: %s", exc)

    return None


def load_reddit_solved(db_path: str | None = None, limit: int = 50) -> int:
    """Scan harvested Reddit posts for solved threads and add as prejudged cases.

    Returns count of cases inserted.
    """
    try:
        import anthropic
        client = anthropic.Anthropic()
    except Exception as exc:
        logger.error("Cannot import/init anthropic SDK: %s", exc)
        logger.error("Set ANTHROPIC_API_KEY to enable Reddit solved thread parsing")
        return 0

    total_questions = count_questions(db_path)
    if total_questions == 0:
        logger.warning("No harvested questions — run reddit_harvest.py first")
        return 0

    questions = list_questions(limit=limit, db_path=db_path)
    # Filter for posts with decent engagement
    questions = [q for q in questions if q.get("score", 0) > 5]
    logger.info("Scanning %d high-score posts for solved threads...", len(questions))

    inserted = 0
    headers = {"User-Agent": USER_AGENT}

    with httpx.Client(headers=headers, timeout=30, follow_redirects=True) as http:
        for q in questions:
            post_id = q.get("post_id", "")
            subreddit = q.get("subreddit", "")
            if not post_id or not subreddit:
                continue

            time.sleep(2)  # rate limit

            comments = _fetch_comments(post_id, subreddit, http)
            if not comments:
                continue

            solved_comment = _find_solved_comment(comments)
            if not solved_comment:
                continue

            logger.info("  Found solved thread: %s", q["title"][:60])

            ground_truth = _structure_solution(
                q["title"], q.get("body", ""), solved_comment, client,
            )
            if not ground_truth:
                continue

            # Build evidence packet from title + body
            evidence = q["title"]
            if q.get("body"):
                evidence += "\n\n" + q["body"][:500]

            row_id = insert_prejudged_case(
                source="reddit_solved",
                source_id=f"reddit-{post_id}",
                title=q["title"],
                equipment_type="",  # inferred by haiku in keywords
                fault_category="",
                evidence_packet=evidence,
                ground_truth=ground_truth,
                difficulty="medium",
                metadata={"subreddit": subreddit, "score": q.get("score", 0)},
                db_path=db_path,
            )
            if row_id > 0:
                inserted += 1
                logger.info("    -> Inserted as prejudged case (id=%d)", row_id)

    logger.info("Reddit solved: %d inserted from %d scanned", inserted, len(questions))
    return inserted


def main():
    parser = argparse.ArgumentParser(description="Build Prejudged Case Corpus")
    parser.add_argument("--seed-only", action="store_true", help="Load seed cases only (no network)")
    parser.add_argument("--reddit-limit", type=int, default=50, help="Max Reddit posts to scan")
    parser.add_argument("--db", default="", help="SQLite DB path override")
    args = parser.parse_args()

    db_path = args.db or os.getenv("MIRA_DB_PATH")
    ensure_tables(db_path)

    seed_count = load_seed_cases(db_path)
    reddit_count = 0

    if not args.seed_only:
        reddit_count = load_reddit_solved(db_path, limit=args.reddit_limit)

    total = count_prejudged_cases(db_path=db_path)
    print(f"\nCorpus built: {seed_count} seed + {reddit_count} reddit = {seed_count + reddit_count} new")
    print(f"Total prejudged cases in DB: {total}")


if __name__ == "__main__":
    main()
