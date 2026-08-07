"""Tier 2 — conversation-state attacks. Seeded, deterministic multi-turn scripts
that attack memory/state: pivots, continuations, asset/fault switches,
abandoned paths, pronouns, clarification recovery.
"""

from __future__ import annotations

import random

# Slot values (must exist in the staging KB / pack registry).
ASSETS = [
    ("DURApulse GS10", "gs10", "CE10"),
    ("PowerFlex 525", "pf525", "F004"),
]

TEMPLATES = [
    # (template id, list of turn factories taking (asset_a, asset_b))
    (
        "pivot_after_fault",
        lambda a, b: [
            dict(send=f"What does {a[2]} mean on a {a[0]}?", expect=[a[2]]),
            dict(send="How do I reset it?", expect=["reset"]),
            dict(
                send="Actually forget that — my conveyor keeps stopping.",
                expect=[
                    "conveyor",
                    "manufacturer",
                    "model",
                    "fault code",
                    "display",
                    "what changed",
                    "equipment",
                    "machine",
                    "new asset",
                ],
                forbid=[a[2]],
            ),
        ],
    ),
    (
        "asset_switch_direct",
        lambda a, b: [
            dict(send=f"What does {a[2]} mean on a {a[0]}?", expect=[a[2]]),
            dict(send=f"What does {b[2]} mean on a {b[0]}?", expect=[b[2]], forbid=[a[2]]),
            dict(send=f"go back to the {a[1]}", forbid=[b[2]]),
        ],
    ),
    (
        "continuation_is_kept",
        lambda a, b: [
            dict(send=f"What does {a[2]} mean on a {a[0]}?", expect=[a[2]]),
            # Legitimate continuation — pronoun, no pivot. The reply may
            # reference the same fault; that is CORRECT (CTX-002 side).
            dict(send="is that fault serious?", expect=[a[2], "fault", "serious", "depends"]),
        ],
    ),
    (
        "abandoned_path_recovery",
        lambda a, b: [
            dict(
                send="Something's wrong with one of our drives, it keeps faulting",
                expect=["manufacturer", "model", "equipment"],
            ),
            dict(
                send="hang on, wrong machine. it's actually the mixer acting up",
                expect=["mixer", "manufacturer", "model", "equipment"],
            ),
            dict(send=f"ok it's a {a[0]} showing {a[2]}", expect=[a[2]]),
        ],
    ),
    (
        "confused_correction",
        lambda a, b: [
            dict(
                send=f"my drive is showing {b[2]}, it's a {a[0]}",
                expect=[a[2], b[2], "confirm", a[0].split()[0].lower()],
            ),
            dict(
                send=f"actually maybe it's a {b[0]}, not sure",
                expect=[b[0].split()[-1], "confirm", b[2], "model"],
            ),
        ],
    ),
]


def generate(seed: int, count: int) -> list[dict]:
    rng = random.Random(seed)
    out = []
    for i in range(count):
        tid, factory = TEMPLATES[i % len(TEMPLATES)]
        a, b = ASSETS if rng.random() < 0.5 else (ASSETS[1], ASSETS[0])
        out.append(
            dict(
                id=f"t2_{i:03d}_{tid}",
                contract=f"Tier2 state-attack ({tid})",
                seed=seed,
                turns=factory(a, b),
            )
        )
    return out
