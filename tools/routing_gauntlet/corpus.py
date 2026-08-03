"""Labeled routing corpus generator — deterministic template x slot x transform.

Every generated case carries the ground-truth label the routing layer must
produce, in the 13-label conversation_router vocabulary plus a gate
expectation. Labels encode the UNS-gate doctrine
(.claude/rules/uns-confirmation-gate.md): a state/status/diagnostic question
that references a plant asset is asset-specific troubleshooting and must reach
the gate; educational questions must NOT be dragged into it.

Deterministic: same seed -> byte-identical corpus. No LLM, no network, no
randomness beyond a seeded PRNG used only for transform assignment.
"""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass

# ── classes ──────────────────────────────────────────────────────────────────
# expect_final:
#   "diagnose_equipment" — arbitration must land here under every router
#                          scenario the runner throws at it (the gate intent).
#   "keep"               — arbitration must NOT rewrite the router's vote.
# expect_gate: whether _should_fire_uns_gate should be True from IDLE with no
#              confirmed asset, given the expected final intent.

ASSET_STATE_TEMPLATES = [
    "What is the current state of {asset}?",
    "what's the current state of {asset}",
    "what is the status of {asset}?",
    "what's the status of {asset}",
    "current status of {asset}?",
    "{asset} status",
    "status of {asset}",
    "give me a status update on {asset}",
    "what state is {asset} in?",
    "is {asset} running?",
    "is {asset} running right now",
    "is {asset} down?",
    "is {asset} up?",
    "is {asset} ok?",
    "is {asset} stopped or running?",
    "is {asset} faulted?",
    "is {asset} online?",
    "how is {asset} doing?",
    "how is {asset} running today?",
    "why is {asset} stopped?",
    "why did {asset} stop?",
    "why is {asset} down?",
    "why is {asset} not running?",
    "is {asset} up or down right now",
    "anything wrong with {asset}?",
    "what speed is {asset} running at?",
    "is the motor on {asset} running?",
]

DIAGNOSTIC_TEMPLATES = [
    "{asset} is throwing fault {fault}",
    "getting {fault} on {asset}",
    "{asset} won't start",
    "{asset} will not start",
    "{asset} keeps tripping on overload",
    "{asset} tripped again",
    "{asset} is making a grinding noise",
    "{asset} just faulted out",
    "{asset} keeps faulting",
    "{asset} stopped mid cycle",
    "fault {fault} on {asset}, what do I check first?",
    "{asset} is dead, no lights on the drive",
]

EDUCATIONAL_TEMPLATES = [
    "what is a vfd?",
    "what's a vfd",
    "explain how a vfd works",
    "how does a conveyor work?",
    "what does pnp mean?",
    "what does npn stand for?",
    "difference between npn and pnp sensors",
    "what is modbus?",
    "explain sparkplug b",
    "define ladder logic",
    "how does a proximity sensor work?",
    "what is a plc used for?",
    "what is a contactor?",
    "how do you size an overload relay?",
    "explain the difference between a soft starter and a vfd",
    "what is a unified namespace?",
    "how does mqtt work?",
    "what is 4-20ma?",
]

GREETING_TEMPLATES = [
    "hi",
    "hello",
    "hey",
    "good morning",
    "hey mira",
    "thanks",
    "thank you",
    "yo",
]

DOCS_TEMPLATES = [
    "find the manual for {asset}",
    "show me the wiring diagram for {asset}",
    "where is the manual for {asset}?",
    "pull up the datasheet for {asset}",
    "do we have documentation on {asset}?",
]

SAFETY_TEMPLATES = [
    "the panel is arcing",
    "i can smell burning from the mcc",
    "someone just got shocked on the line",
    "arc flash just happened at the panel",
    "there is smoke coming from the drive",
    "the breaker just exploded",
    "I need to do lockout tagout on the conveyor",
    "is it safe to work on this live?",
]

OFF_TOPIC_TEMPLATES = [
    "what's the weather today?",
    "tell me a joke",
    "who won the game last night?",
    "write me a poem about robots",
]

# Slot fills. Tag-style, name-style, and pathological variants (no dash,
# model-number-only) are all present on purpose — technicians type all of them.
ASSETS = [
    "my garage conveyor",
    "the garage conveyor",
    "the conveyor",
    "cv-101",
    "CV-101",
    "cv101",
    "the cv-101 conveyor",
    "conveyor 1",
    "the bench conveyor",
    "the gs10",
    "the gs10 drive",
    "the vfd",
    "the vfd on cv-101",
    "the micro820 plc",
    "line 1",
    "pump 3",
    "the mixer",
    "mixer 7",
    "the compressor",
    "the powerflex 525",
]

FAULTS = ["F0004", "F7", "E001", "oC", "CE10", "err 9"]

# ── transforms (deterministic by index) ──────────────────────────────────────


def _t_identity(s: str) -> str:
    return s


def _t_lower(s: str) -> str:
    return s.lower()


def _t_no_punct(s: str) -> str:
    return s.rstrip("?!. ")


def _t_typo(s: str) -> str:
    """Swap two adjacent letters inside the first word longer than 4 chars."""
    words = s.split(" ")
    for i, w in enumerate(words):
        if len(w) > 4 and w.isalpha():
            mid = len(w) // 2
            words[i] = w[: mid - 1] + w[mid] + w[mid - 1] + w[mid + 1 :]
            break
    return " ".join(words)


def _t_casual_prefix(s: str) -> str:
    return "hey, " + s[0].lower() + s[1:] if s else s


def _t_trailing(s: str) -> str:
    return _t_no_punct(s) + " please"


TRANSFORMS = [_t_identity, _t_lower, _t_no_punct, _t_typo, _t_casual_prefix, _t_trailing]


@dataclass(frozen=True)
class RoutingCase:
    qid: str
    message: str
    cls: str  # asset_state | diagnostic | educational | greeting | docs | safety | off_topic
    expect_final: str  # "diagnose_equipment" or "keep"
    expect_gate: bool
    template: str
    transform: str

    def as_dict(self) -> dict:
        return asdict(self)


_CLASS_SPECS = [
    # (cls, templates, slots?, expect_final, expect_gate)
    ("asset_state", ASSET_STATE_TEMPLATES, True, "diagnose_equipment", True),
    ("diagnostic", DIAGNOSTIC_TEMPLATES, True, "diagnose_equipment", True),
    ("educational", EDUCATIONAL_TEMPLATES, False, "keep", False),
    ("greeting", GREETING_TEMPLATES, False, "keep", False),
    ("docs", DOCS_TEMPLATES, True, "keep", False),
    ("safety", SAFETY_TEMPLATES, False, "keep", False),  # safety wins pre-gate
    ("off_topic", OFF_TOPIC_TEMPLATES, False, "keep", False),
]


def generate(seed: int = 1337, transforms_per_case: int = 3) -> list[RoutingCase]:
    """Full corpus: every template x slot combination x N transforms."""
    rng = random.Random(seed)
    cases: list[RoutingCase] = []
    for cls, templates, has_slots, expect_final, expect_gate in _CLASS_SPECS:
        for ti, template in enumerate(templates):
            fills: list[dict] = [{}]
            if has_slots and "{asset}" in template:
                fills = [{"asset": a} for a in ASSETS]
            expanded: list[tuple[dict, str]] = []
            for fill in fills:
                msg = template
                if "{fault}" in msg:
                    msg = msg.replace("{fault}", FAULTS[ti % len(FAULTS)])
                if "{asset}" in msg:
                    msg = msg.replace("{asset}", fill["asset"])
                expanded.append((fill, msg))
            for fi, (_fill, msg) in enumerate(expanded):
                picks = rng.sample(
                    range(len(TRANSFORMS)), k=min(transforms_per_case, len(TRANSFORMS))
                )
                if 0 not in picks:  # identity always included
                    picks[0] = 0
                for pi in picks:
                    fn = TRANSFORMS[pi]
                    out = fn(msg)
                    cases.append(
                        RoutingCase(
                            qid=f"{cls}-{ti:02d}-{fi:02d}-{fn.__name__[3:]}",
                            message=out,
                            cls=cls,
                            expect_final=expect_final,
                            expect_gate=expect_gate,
                            template=template,
                            transform=fn.__name__[3:],
                        )
                    )
    # De-dup on message (transforms can collide, e.g. lower == identity on "hi")
    seen: set[str] = set()
    unique: list[RoutingCase] = []
    for c in cases:
        key = (c.cls, c.message)
        if key in seen:
            continue
        seen.add(key)
        unique.append(c)
    return unique


if __name__ == "__main__":
    corpus = generate()
    by_cls: dict[str, int] = {}
    for c in corpus:
        by_cls[c.cls] = by_cls.get(c.cls, 0) + 1
    print(f"total distinct cases: {len(corpus)}")
    for k, v in sorted(by_cls.items()):
        print(f"  {k}: {v}")
