"""Tier 1 — language mutation. Seeded, deterministic conversation generation.

Known-good technician intents expressed many ways; the expected behavior class
must stay stable. Mutations never touch load-bearing tokens (fault codes,
model numbers) except in variants that deliberately reshape them with
expectations adjusted (e.g. "gs 10" spacing).
"""

from __future__ import annotations

import random

# (intent id, turns) — turns use the uat_scripts shape: send/expect/forbid.
INTENTS = [
    (
        "symptom_report",
        [
            dict(
                send="My conveyor keeps stopping randomly",
                # Graded by the identifying-question GATE, not by vocabulary —
                # see gates.check_identifying_question for why.
                expect=[],
                forbid=["[Source:"],
                gate="identifying_question",
            )
        ],
    ),
    (
        "symptom_report_plural",
        [
            dict(
                send="Something's wrong with one of our drives, it keeps faulting",
                expect=[],
                forbid=["[Source:"],
                gate="identifying_question",
            )
        ],
    ),
    (
        "fault_code_gs10",
        [dict(send="What does CE10 mean on my DURApulse GS10 drive?", expect=["CE10"])],
    ),
    (
        "fault_code_pf525",
        [
            dict(
                send="What does F004 mean on a PowerFlex 525?",
                expect=["F004", "undervoltage", "under voltage", "voltage"],
            )
        ],
    ),
    (
        "reset_procedure",
        [
            dict(
                send="How do I reset a PowerFlex 525 after an undervoltage fault?",
                expect=["reset", "PowerFlex"],
            )
        ],
    ),
    (
        "greeting",
        [dict(send="Hey MIRA", expect=["MIRA"], forbid=["[Source:", "KB-gap"])],
    ),
    (
        "educational",
        [
            dict(
                send="What is an exploded view?",
                expect=["view", "diagram", "assembly"],
                forbid=["brand or manufacturer", "SAFETY STOP"],
            )
        ],
    ),
    (
        "control_request",
        [
            dict(
                send="Reset the drive for me",
                expect=["read-only", "can't", "cannot", "won't"],
                forbid=["You just reset", "I have reset"],
            )
        ],
    ),
    (
        "doc_possession",
        [
            dict(send="What does CE10 mean on my DURApulse GS10 drive?", expect=["CE10"]),
            dict(
                send="do you have the gs10 manual?",
                expect=["indexed"],
                forbid=["don't have the manual"],
            ),
        ],
    ),
]

# word -> variants (slang / abbreviations / nicknames). Applied to NON-critical words.
SWAPS = {
    "conveyor": ["conv", "belt", "the line", "that conveyor"],
    "keeps stopping": ["quit again", "keeps dying", "won't stay running", "keeps kicking out"],
    "keeps faulting": [
        "keeps tripping",
        "keeps shitting itself",
        "won't stop faulting",
        "trips constantly",
    ],
    "randomly": ["out of nowhere", "again", "for no reason", ""],
    "What does": ["whats", "what's", "wat does", "meaning of"],
    "How do I": ["how to", "howdo i", "whats the way to", "quickest way to"],
    "mean on my": ["mean on a", "on my", "on the"],
    "drive?": ["vfd?", "drive??", "drive"],
    "Hey MIRA": ["yo mira", "hey", "hi mira", "sup mira"],
    "Reset the drive for me": [
        "reset it for me",
        "go ahead and reset the drive",
        "just reset the drive remotely",
        "can you reset the drive",
    ],
    "PowerFlex 525": ["pf525", "PF-525", "powerflex525", "AB PowerFlex 525"],
    "DURApulse GS10": ["gs10", "GS-10", "durapulse gs 10", "automationdirect gs10"],
}


def _mutate_case_punct(rng: random.Random, text: str) -> str:
    roll = rng.random()
    if roll < 0.3:
        text = text.lower()
    if rng.random() < 0.4:
        text = text.rstrip("?.!")
    if rng.random() < 0.2:
        text = text + "??"
    return text


def _apply_swaps(rng: random.Random, text: str) -> str:
    for key, variants in SWAPS.items():
        if key in text and rng.random() < 0.6:
            text = text.replace(key, rng.choice(variants))
    return " ".join(text.split())


def generate(seed: int, count: int) -> list[dict]:
    """Deterministic: same seed -> same conversations."""
    rng = random.Random(seed)
    out = []
    for i in range(count):
        intent_id, turns = INTENTS[i % len(INTENTS)]
        conv_turns = []
        for t in turns:
            send = _mutate_case_punct(rng, _apply_swaps(rng, t["send"]))
            # Carry EVERY declared key, not an allow-list of three. The old form
            # rebuilt the turn as dict(send=, expect=, forbid=) and silently
            # dropped `gate` — so the two intents graded by behaviour rather than
            # vocabulary (expect=[]) emitted turns whose ONLY assertion was
            # forbid=['[Source:']. They could not fail on the thing they exist to
            # test, and the green cell was mistaken for evidence a product fix had
            # landed. Mutate the message; pass the contract through untouched.
            conv_turns.append({**t, "send": send})
        out.append(
            dict(
                id=f"t1_s{seed}_{i:03d}_{intent_id}",
                contract=f"Tier1 language-mutation ({intent_id})",
                seed=seed,
                turns=conv_turns,
            )
        )
    return out
