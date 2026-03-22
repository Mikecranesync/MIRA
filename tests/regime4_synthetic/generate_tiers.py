#!/usr/bin/env python3
"""Generate tiered question variants from seed cases using Claude.

Usage:
    python tests/regime4_synthetic/generate_tiers.py
    python tests/regime4_synthetic/generate_tiers.py --dry-run
    python tests/regime4_synthetic/generate_tiers.py --limit 3

Outputs: tests/regime4_synthetic/golden_questions/v1/tiered_questions.json
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("generate-tiers")

REPO_ROOT = Path(__file__).parent.parent.parent
SEED_CASES_PATH = REPO_ROOT / "mira-core" / "data" / "seed_cases.json"
OUTPUT_PATH = Path(__file__).parent / "golden_questions" / "v1" / "tiered_questions.json"

# Tier transform instructions for Claude
TIER_PROMPTS = {
    "L1": (
        "Rewrite this evidence packet as a clear, well-formed question from a senior technician. "
        "Include the full equipment name, fault code, and clear symptom. "
        "Keep it professional and specific."
    ),
    "L2": (
        "Rewrite this evidence packet as a quick text message from a busy technician on the factory floor. "
        "Use abbreviations (PF525 not PowerFlex 525, OC not overcurrent, conv not conveyor). "
        "Minimal punctuation, no full sentences. Like a text message."
    ),
    "L3": (
        "Rewrite this evidence packet as a vague question from a tech who doesn't know what's wrong. "
        "Describe only the symptom (noise, heat, stops working) with NO fault code and NO equipment model. "
        "Make it ambiguous enough that multiple causes are plausible."
    ),
    "L4": (
        "Rewrite this evidence packet as a stressed, confused message with: "
        "1) At least two misspellings, 2) One wrong technical term, "
        "3) An additional unrelated symptom mixed in. "
        "Make it realistic — a tech having a bad day texting in a hurry."
    ),
}


def _generate_with_claude(seed_case: dict, tier: str, anthropic_client) -> str:
    """Generate a tier-specific question variant using Claude."""
    prompt = f"""{TIER_PROMPTS[tier]}

ORIGINAL EVIDENCE PACKET:
{seed_case['evidence_packet']}

EQUIPMENT: {seed_case['equipment_type']}
FAULT: {seed_case['title']}

Return ONLY the rewritten question/message text, nothing else."""

    resp = anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip()


def _generate_dry_run(seed_case: dict, tier: str) -> str:
    """Generate a placeholder question for dry-run mode."""
    ep = seed_case["evidence_packet"]
    if tier == "L1":
        return ep  # Use original as L1
    elif tier == "L2":
        return ep[:80] + "..."  # Truncated
    elif tier == "L3":
        return f"Something's wrong with the {seed_case['equipment_type']}. It's acting up."
    else:  # L4
        return f"the {seed_case['equipment_type']} thign is brokn again, also smells weird"


def generate(dry_run: bool = False, limit: int = 0) -> dict:
    """Generate tiered questions for all seed cases."""
    with open(SEED_CASES_PATH) as f:
        seed_cases = json.load(f)

    if limit > 0:
        seed_cases = seed_cases[:limit]

    anthropic_client = None
    if not dry_run:
        import anthropic
        anthropic_client = anthropic.Anthropic()

    output = {
        "description": "Tiered question variants generated from seed_cases.json",
        "tiers": ["L1", "L2", "L3", "L4"],
        "cases": [],
    }

    for case in seed_cases:
        logger.info("Generating tiers for: %s", case["title"])
        entry = {
            "seed_id": case["id"],
            "title": case["title"],
            "equipment_type": case["equipment_type"],
            "difficulty": case["difficulty"],
            "ground_truth": case["ground_truth"],
            "tiers": {},
        }

        for tier in ["L1", "L2", "L3", "L4"]:
            if dry_run:
                question = _generate_dry_run(case, tier)
            else:
                question = _generate_with_claude(case, tier, anthropic_client)
                logger.info("  %s: %s", tier, question[:60])

            entry["tiers"][tier] = {
                "question": question,
                "tier": tier,
            }

        output["cases"].append(entry)

    # Write output
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    logger.info("Written %d cases x 4 tiers to %s", len(seed_cases), OUTPUT_PATH)
    return output


def main():
    parser = argparse.ArgumentParser(description="Generate tiered question variants")
    parser.add_argument("--dry-run", action="store_true", help="Use placeholder questions (no API)")
    parser.add_argument("--limit", type=int, default=0, help="Max seed cases to process (0=all)")
    args = parser.parse_args()

    generate(dry_run=args.dry_run, limit=args.limit)


if __name__ == "__main__":
    main()
