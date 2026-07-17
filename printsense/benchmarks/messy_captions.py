"""Messy-caption lane — how technicians ACTUALLY phrase print questions.

Owner direction (Mike, 2026-07-17): technicians ask in normal, often terrible
English — typos, fragments, no punctuation, voice-to-text spellings, ESL
phrasing — never in canonical benchmark English and never via commands. This
corpus maps realistic messy captions onto the frozen Phase-2 cases so two
things can be measured:

1. ROUTING (free, deterministic): does ``print_translator.is_print_question``
   — the keyword caption gate that decides whether a photo enters the grounded
   print path at all — accept the caption? A miss silently sends the tech to
   the generic engine. This gate already rejected 4/6 CANONICAL questions once
   (fixed in #2752); messy English is strictly harder for a phrase list.
2. ANSWERING (bounded, paid): a sampled subset through the real rung, graded
   against the PARENT case's frozen expectations — same truth, messier ask.

Negative controls (captions that must NOT route) measure precision, so the
gate can't "pass" by accepting everything.

Variants are frozen (``messy_digest`` vs ``messy_captions.sha256``) exactly
like the other Phase-2 truth files: editing them is a loud two-file diff.
All content is fictional and matches the synthetic corpus (sheets 9x, K9xx).
"""

from __future__ import annotations

import hashlib
import json

MESSY_VERSION = "messy_captions_v1"

# variant_id -> (parent phase-2 case_id, caption). Buckets per case:
# typo / fragment / no-punctuation / voice-to-text / ESL / chatty.
VARIANTS: list[dict] = [
    # --- q_circuit_function: "What does this circuit do?" ---
    {"variant_id": "cf_typo", "parent": "q_circuit_function", "caption": "wat does this do"},
    {
        "variant_id": "cf_chatty",
        "parent": "q_circuit_function",
        "caption": "can u explain what this does",
    },
    {
        "variant_id": "cf_fragment",
        "parent": "q_circuit_function",
        "caption": "whats going on in this print",
    },
    {"variant_id": "cf_bare", "parent": "q_circuit_function", "caption": "explain this"},
    {
        "variant_id": "cf_looking",
        "parent": "q_circuit_function",
        "caption": "what am i looking at here",
    },
    # --- q_designation_meaning: "What does -91/K01 mean?" ---
    {"variant_id": "dm_whats", "parent": "q_designation_meaning", "caption": "whats k01"},
    {"variant_id": "dm_nomean", "parent": "q_designation_meaning", "caption": "what is -91/K01"},
    {"variant_id": "dm_meaning", "parent": "q_designation_meaning", "caption": "k01 meaning?"},
    {
        "variant_id": "dm_standfor",
        "parent": "q_designation_meaning",
        "caption": "what does -91/K01 stand for",
    },
    {"variant_id": "dm_esl", "parent": "q_designation_meaning", "caption": "k01 is what device"},
    # --- q_contact_convention: "Is 13/14 normally open?" ---
    {
        "variant_id": "cc_openclosed",
        "parent": "q_contact_convention",
        "caption": "is 13 14 open or closed",
    },
    {"variant_id": "cc_nonc", "parent": "q_contact_convention", "caption": "13/14 no or nc??"},
    {
        "variant_id": "cc_contact",
        "parent": "q_contact_convention",
        "caption": "is this contact open when off",
    },
    {
        "variant_id": "cc_nopunct",
        "parent": "q_contact_convention",
        "caption": "13 14 normally open",
    },
    {
        "variant_id": "cc_voice",
        "parent": "q_contact_convention",
        "caption": "thirteen fourteen open or closed",
    },
    # --- q_where_continue: "Where does this continue?" ---
    {"variant_id": "wc_typo", "parent": "q_where_continue", "caption": "were does this go"},
    {
        "variant_id": "wc_whatpage",
        "parent": "q_where_continue",
        "caption": "this goes to what page",
    },
    {"variant_id": "wc_wire", "parent": "q_where_continue", "caption": "wire goes where"},
    {"variant_id": "wc_clean", "parent": "q_where_continue", "caption": "where does this continue"},
    {
        "variant_id": "wc_sheet",
        "parent": "q_where_continue",
        "caption": "what sheet does this continue on",
    },
    # --- q_photograph_next: "What should I photograph next?" ---
    {
        "variant_id": "pn_need",
        "parent": "q_photograph_next",
        "caption": "what else do u need to see",
    },
    {
        "variant_id": "pn_picture",
        "parent": "q_photograph_next",
        "caption": "what should i take a picture of next",
    },
    {"variant_id": "pn_another", "parent": "q_photograph_next", "caption": "need another photo?"},
    {
        "variant_id": "pn_nextpage",
        "parent": "q_photograph_next",
        "caption": "what next page you need",
    },
    # --- q_not_energize: "Why would this contactor not energize?" ---
    {
        "variant_id": "ne_pullin",
        "parent": "q_not_energize",
        "caption": "contactor wont pull in why",
    },
    {"variant_id": "ne_turnon", "parent": "q_not_energize", "caption": "k02 wont turn on"},
    {"variant_id": "ne_coil", "parent": "q_not_energize", "caption": "no power at the coil why"},
    {"variant_id": "ne_wont", "parent": "q_not_energize", "caption": "why wont this energize"},
    {
        "variant_id": "ne_ing",
        "parent": "q_not_energize",
        "caption": "it not energizing whats wrong",
    },
]

# Captions that must NOT route to the print path (gate precision): a tech
# small-talking or asking about a physical thing in the same chat.
NEGATIVE_CONTROLS: list[dict] = [
    {"variant_id": "neg_smalltalk", "caption": "thanks that fixed it"},
    {"variant_id": "neg_tool", "caption": "look at my new multimeter"},
    {"variant_id": "neg_schedule", "caption": "u there tomorrow morning?"},
    {"variant_id": "neg_partnum", "caption": "need a part number for this breaker handle"},
]


def messy_digest() -> str:
    src = {
        "variants": [
            {"variant_id": v["variant_id"], "parent": v["parent"], "caption": v["caption"]}
            for v in sorted(VARIANTS, key=lambda v: v["variant_id"])
        ],
        "negatives": [
            {"variant_id": n["variant_id"], "caption": n["caption"]}
            for n in sorted(NEGATIVE_CONTROLS, key=lambda n: n["variant_id"])
        ],
    }
    blob = json.dumps(src, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def routing_report(is_print_question) -> dict:
    """Free, deterministic routing measurement against the caption gate.

    Returns per-variant hits/misses + recall and negative-control precision.
    No LLM, no image — this is the pure-Python gate every photo caption passes
    through before the print path can claim the turn.
    """
    hits, misses = [], []
    for v in VARIANTS:
        (hits if is_print_question(v["caption"]) else misses).append(v)
    false_routes = [n for n in NEGATIVE_CONTROLS if is_print_question(n["caption"])]
    return {
        "version": MESSY_VERSION,
        "total": len(VARIANTS),
        "routed": len(hits),
        "recall": round(len(hits) / len(VARIANTS), 3),
        "misses": [{"variant_id": v["variant_id"], "caption": v["caption"]} for v in misses],
        "negatives_total": len(NEGATIVE_CONTROLS),
        "false_routes": [
            {"variant_id": n["variant_id"], "caption": n["caption"]} for n in false_routes
        ],
        "precision_controls_ok": len(NEGATIVE_CONTROLS) - len(false_routes),
    }
