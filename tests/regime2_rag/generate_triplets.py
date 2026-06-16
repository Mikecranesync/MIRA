#!/usr/bin/env python3
"""Generate (question, expected_chunk_ids, expected_answer) triplets from NeonDB.

Queries NeonDB for random knowledge chunks (stratified by equipment_type),
then uses Claude to generate a question whose answer requires that chunk.

Usage:
    python tests/regime2_rag/generate_triplets.py
    python tests/regime2_rag/generate_triplets.py --dry-run
    python tests/regime2_rag/generate_triplets.py --limit 20

Requires: NEON_DATABASE_URL, MIRA_TENANT_ID, ANTHROPIC_API_KEY in env (via Doppler).
Outputs: tests/regime2_rag/golden_triplets/v1/triplets.json
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("generate-triplets")

OUTPUT_PATH = Path(__file__).parent / "golden_triplets" / "v1" / "triplets.json"

# Seed-based triplets from existing ground truth (works without NeonDB)
SEED_TRIPLETS = [
    {
        "id": "triplet-seed-001",
        "question": "What causes an overcurrent fault F004 on a PowerFlex 525 VFD during startup?",
        "expected_keywords": ["phase loss", "input power", "fuse", "voltage imbalance", "overcurrent"],
        "expected_answer_summary": "Phase loss on input power causing excessive current draw on remaining phases.",
        "source": "seed_cases.json:seed-001",
        "equipment_type": "VFD",
    },
    {
        "id": "triplet-seed-002",
        "question": "What are the symptoms of bearing failure on a continuous-duty pump motor?",
        "expected_keywords": ["bearing", "vibration", "lubrication", "grinding", "overheating"],
        "expected_answer_summary": "Elevated vibration velocity, localized heat at drive end, grinding noise.",
        "source": "seed_cases.json:seed-002",
        "equipment_type": "motor",
    },
    {
        "id": "triplet-seed-003",
        "question": "What causes intermittent EtherNet/IP communication loss after adding a VFD?",
        "expected_keywords": ["EMI", "interference", "shielded cable", "separation", "VFD"],
        "expected_answer_summary": "EMI from VFD power cables corrupting Ethernet communication.",
        "source": "seed_cases.json:seed-003",
        "equipment_type": "PLC",
    },
    {
        "id": "triplet-seed-004",
        "question": "Why would a compressor alarm on high discharge pressure with normal downstream demand?",
        "expected_keywords": ["minimum pressure valve", "check valve", "stuck", "discharge pressure"],
        "expected_answer_summary": "Minimum pressure check valve stuck partially closed.",
        "source": "seed_cases.json:seed-004",
        "equipment_type": "compressor",
    },
    {
        "id": "triplet-seed-005",
        "question": "How do you fix conveyor belt tracking drift to one side?",
        "expected_keywords": ["tracking", "alignment", "level", "idler", "perpendicular"],
        "expected_answer_summary": "Check frame level, clean idler rollers, verify perpendicular alignment.",
        "source": "seed_cases.json:seed-005",
        "equipment_type": "conveyor",
    },
    {
        "id": "triplet-seed-006",
        "question": "Why would a rewound motor start overheating 4 months after a rewind?",
        "expected_keywords": ["rewind", "overcurrent", "FLA", "winding resistance", "wire gauge"],
        "expected_answer_summary": "Incorrect wire gauge or turn count during rewind causing progressive insulation degradation.",
        "source": "seed_cases.json:seed-006",
        "equipment_type": "motor",
    },
    {
        "id": "triplet-seed-007",
        "question": "What causes a hydraulic cylinder to slow down while other cylinders are fine?",
        "expected_keywords": ["piston seal", "bypass", "internal leakage", "cylinder bore"],
        "expected_answer_summary": "Worn piston seals allowing internal bypass of hydraulic fluid.",
        "source": "seed_cases.json:seed-007",
        "equipment_type": "hydraulic",
    },
    {
        "id": "triplet-seed-008",
        "question": "Why does a proximity sensor flicker intermittently after replacing it with a new one?",
        "expected_keywords": ["wiring", "connector", "loose", "vibration", "cable"],
        "expected_answer_summary": "Loose or corroded wiring connection, not the sensor itself.",
        "source": "seed_cases.json:seed-008",
        "equipment_type": "sensor",
    },
    {
        "id": "triplet-seed-009",
        "question": "What happens when a soft starter bypass contactor doesn't engage after ramp-up?",
        "expected_keywords": ["bypass contactor", "coil", "SCR", "overheat", "control relay"],
        "expected_answer_summary": "Contactor coil failure keeps current flowing through SCRs, causing overheating.",
        "source": "seed_cases.json:seed-009",
        "equipment_type": "soft starter",
    },
    {
        "id": "triplet-seed-010",
        "question": "How do you diagnose a slow refrigerant leak in a chiller using R-410A?",
        "expected_keywords": ["refrigerant leak", "brazed joint", "Schrader valve", "leak detection"],
        "expected_answer_summary": "Electronic leak detection sweep of brazed joints and Schrader valves.",
        "source": "seed_cases.json:seed-010",
        "equipment_type": "chiller",
    },
]


def generate(dry_run: bool = False, limit: int = 0) -> dict:
    """Generate RAG evaluation triplets."""
    if dry_run:
        triplets = SEED_TRIPLETS[:limit] if limit > 0 else SEED_TRIPLETS
        logger.info("Dry-run: using %d seed-based triplets", len(triplets))
    else:
        # TODO: Query NeonDB for random chunks and generate triplets via Claude
        logger.info("Live generation requires NeonDB + Claude API — using seeds as base")
        triplets = SEED_TRIPLETS[:limit] if limit > 0 else SEED_TRIPLETS

    output = {
        "description": "RAG evaluation triplets for retrieval precision testing",
        "triplet_count": len(triplets),
        "triplets": triplets,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    logger.info("Written %d triplets to %s", len(triplets), OUTPUT_PATH)
    return output


def main():
    parser = argparse.ArgumentParser(description="Generate RAG evaluation triplets")
    parser.add_argument("--dry-run", action="store_true", help="Use seed-based triplets (no NeonDB)")
    parser.add_argument("--limit", type=int, default=0, help="Max triplets (0=all)")
    args = parser.parse_args()

    generate(dry_run=args.dry_run, limit=args.limit)


if __name__ == "__main__":
    main()
