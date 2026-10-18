"""Excerpt applicability is decided by product FAMILY, not exact model.

Piece 2 of the #4465 split. Two owner decisions (grill, 2026-10-18) fix the line:

1. A sibling model in the same family keeps the manual; only a provably
   different family is dropped (a V1000 page never answers an A1000 question).
2. When MIRA cannot tell whether two models share a family, the excerpt stays,
   labelled "general context only" — dropping on doubt would erase the whole
   PowerFlex 520-series manual (7,547 staging excerpts tagged only
   "PowerFlex 525") for every 523 and 527 owner.

The model labels below are real `knowledge_entries.model_number` values read
from staging, so the comparator is exercised on the strings it actually sees.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from shared.uns_resolver import canonical_model, product_families_in
from shared.workers.rag_worker import RAGWorker, evidence_applicability

UNKNOWN_NOTE = "general/context only"


# ── The comparator ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("asked_model", "asked_family", "excerpt_label"),
    [
        # Same 520-series manual, different sibling model: kept (decision 2).
        ("523", "PowerFlex", "PowerFlex 525"),
        ("PowerFlex 527", "PowerFlex 527", "PowerFlex 525"),
        ("PowerFlex 520", "PowerFlex 520", "PowerFlex 525"),
        # 750-series manual tagged 753, asked about a 755.
        ("PowerFlex 755", "PowerFlex 755", "PowerFlex 753"),
        # 40P owner, 40 manual.
        ("40P", "PowerFlex", "PowerFlex 40"),
        # Untagged excerpt from the right vendor.
        ("A1000", "A1000", ""),
        ("GS10", "GS10", None),
        # A family the alias table does not know (GA800) proves nothing.
        ("A1000", "A1000", "GA800"),
        # An A1000 drive's catalog code is not a family name.
        ("A1000", "A1000", "CIMR-AU4A0058AAA"),
    ],
)
def test_undecidable_family_keeps_the_excerpt_as_general_context(
    asked_model, asked_family, excerpt_label
):
    assert evidence_applicability(excerpt_label, asked_model, asked_family) == "unknown"


@pytest.mark.parametrize(
    ("asked_model", "asked_family", "excerpt_label"),
    [
        ("A1000", "A1000", "V1000"),
        ("A1000", "A1000", "J1000"),
        ("GA700", "GA700", "GA500"),
        ("GS20", "GS20", "GS10"),
        ("V1000", "V1000", "A1000 Series"),
    ],
)
def test_a_provably_different_family_is_dropped(asked_model, asked_family, excerpt_label):
    assert evidence_applicability(excerpt_label, asked_model, asked_family) is None


@pytest.mark.parametrize(
    ("asked_model", "asked_family", "excerpt_label"),
    [
        ("PowerFlex 525", "PowerFlex 525", "PowerFlex 525"),
        ("525", "PowerFlex", "PowerFlex 525"),
        ("pf525", "PowerFlex 525", "PowerFlex 525"),
        ("V1000", "V1000", "V1000"),
        ("GA500", "GA500", "GA500 Series"),
    ],
)
def test_the_asked_model_itself_is_model_scope(asked_model, asked_family, excerpt_label):
    assert evidence_applicability(excerpt_label, asked_model, asked_family) == "model"


def test_a_shared_label_or_family_member_is_family_scope():
    # One manual labelled for two models covers the asked one.
    assert evidence_applicability("A1000 / V1000", "A1000", "A1000") == "family"
    # Same family-level product, a variant suffix on the label.
    assert evidence_applicability("V1000-4", "V1000", "V1000") == "family"


def test_a_stale_resolver_family_cannot_drop_the_corrected_model():
    # After "actually it's a V1000" the resolver can keep product_family=A1000
    # while the model becomes V1000. The asked MODEL decides, so the correct
    # V1000 manual is never dropped by the stale family.
    assert evidence_applicability("V1000", "V1000", "A1000") == "model"


def test_powerflex_aliases_are_never_family_level():
    # "pf525" / "pf527" name single models and "powerflex" names a brand line.
    # Treating them as families would drop the 520-series manual for a 527.
    assert product_families_in("PowerFlex 525") == set()
    assert product_families_in("pf527") == set()
    assert product_families_in("Yaskawa V1000 Technical Manual") == {"v1000"}
    assert product_families_in("GS100") == set()
    assert product_families_in("CIMR-AU4A0058AAA") == set()


def test_canonical_model_composes_a_bare_number_with_its_family():
    assert canonical_model("525", "PowerFlex") == canonical_model("PowerFlex 525")
    assert canonical_model("pf525") == canonical_model("PowerFlex 525")
    assert canonical_model("523", "PowerFlex") != canonical_model("PowerFlex 525")


# ── At the generation boundary ──────────────────────────────────────────────


def _make_worker():
    router = MagicMock()
    router.enabled = False
    worker = RAGWorker("http://test", "test", "test", router=router, tenant_id="tenant-a")
    worker._ingest_url = ""
    return worker


def _row(text, vendor, model):
    return {
        "content": text,
        "manufacturer": vendor,
        "model_number": model,
        "metadata": {},
        "retrieval_streams": ["bm25"],
        "similarity": 0.1,
    }


def _state(vendor, model, family, confidence=0.7):
    return {
        "state": "DIAGNOSIS",
        "exchange_count": 1,
        "asset_identified": f"{vendor} {model}",
        "context": {
            "uns_context": {
                "manufacturer": vendor,
                "model": model,
                "product_family": family,
                "confidence": confidence,
            }
        },
    }


async def _prompt_for(chunks, state, photo=None):
    worker = _make_worker()
    captured = []

    async def llm(messages, model=None):
        captured.append(str(messages))
        return "answer"

    with (
        patch.object(worker, "_embed_ollama", AsyncMock(return_value=None)),
        patch.object(worker, "_call_llm", llm),
        patch("shared.workers.rag_worker._neon_recall.recall_knowledge", return_value=chunks),
    ):
        await worker.process("What does this fault mean", state, photo_b64=photo)
    # Empty when retrieval left nothing and the no-coverage path answered
    # without a model call (a clarification request).
    return "\n".join(captured)


@pytest.mark.asyncio
async def test_a_523_owner_still_gets_the_520_series_manual_marked_general():
    s = _state("Rockwell Automation", "523", "PowerFlex")
    prompt = await _prompt_for(
        [_row("F004 UnderVoltage table", "Rockwell Automation", "PowerFlex 525")], s
    )
    assert "F004 UnderVoltage table" in prompt
    assert UNKNOWN_NOTE in prompt
    assert s["_rag_sources"] == ["F004 UnderVoltage table"]
    assert s["_rag_last_chunks"][0]["evidence_applicability"] == "unknown"


@pytest.mark.asyncio
async def test_an_a1000_question_never_sees_a_v1000_page():
    s = _state("Yaskawa", "A1000", "A1000")
    prompt = await _prompt_for(
        [
            _row("V1000 oV procedure", "Yaskawa", "V1000"),
            _row("A1000 oV procedure", "Yaskawa", "A1000"),
        ],
        s,
    )
    assert "V1000 oV procedure" not in prompt
    assert "A1000 oV procedure" in prompt
    # The asked model's own manual carries no general-context caveat.
    assert UNKNOWN_NOTE not in prompt
    assert s["_rag_sources"] == ["A1000 oV procedure"]
    assert s["_rag_last_chunks"][0]["evidence_applicability"] == "model"


@pytest.mark.asyncio
async def test_only_wrong_family_evidence_leaves_no_references():
    # Same outcome as a full cross-vendor suppress: the no-coverage path runs
    # and the GS10 page never reaches the model or the citation evidence.
    s = _state("AutomationDirect", "GS20", "GS20")
    prompt = await _prompt_for([_row("GS10 P09.03 comm timeout", "AutomationDirect", "GS10")], s)
    assert "GS10 P09.03 comm timeout" not in prompt
    assert not s.get("_rag_sources")
    assert not s.get("_rag_last_chunks")


@pytest.mark.asyncio
async def test_a_different_vendor_is_still_dropped():
    s = _state("Yaskawa", "A1000", "A1000")
    prompt = await _prompt_for(
        [
            _row("PowerFlex fault table", "Rockwell Automation", "PowerFlex 525"),
            _row("A1000 fault table", "Yaskawa", "A1000"),
        ],
        s,
    )
    assert "PowerFlex fault table" not in prompt
    assert "A1000 fault table" in prompt


@pytest.mark.asyncio
async def test_no_named_model_leaves_retrieval_exactly_as_before():
    # Manufacturer-only, below the #2211 confidence guard: nothing is scoped,
    # nothing is caveated — applicability is relative to an asked model.
    s = _state("Yaskawa", None, None, confidence=0.5)
    prompt = await _prompt_for([_row("V1000 oV procedure", "Yaskawa", "V1000")], s)
    assert "V1000 oV procedure" in prompt
    assert UNKNOWN_NOTE not in prompt
    assert "evidence_applicability" not in s["_rag_last_chunks"][0]


@pytest.mark.asyncio
async def test_photo_turns_are_unchanged_until_that_question_is_decided():
    # Whether photo turns are filtered too is an open owner question (grill Q5).
    s = _state("Yaskawa", "A1000", "A1000")
    with patch.object(RAGWorker, "_visual_search", AsyncMock(return_value=[])):
        prompt = await _prompt_for([_row("V1000 oV procedure", "Yaskawa", "V1000")], s, "b64")
    assert "V1000 oV procedure" in prompt
    assert UNKNOWN_NOTE not in prompt


@pytest.mark.parametrize("builder", ["_build_prompt", "_build_prompt_with_chunks"])
def test_both_prompt_builders_render_the_caveat_on_unknown_scope(builder):
    worker = _make_worker()
    s = _state("Rockwell Automation", "523", "PowerFlex")
    chunks = [
        {
            **_row("520-series passage", "Rockwell Automation", "PowerFlex 525"),
            "evidence_applicability": "unknown",
        },
        {
            **_row("exact passage", "Rockwell Automation", "PowerFlex 523"),
            "evidence_applicability": "model",
        },
    ]
    if builder == "_build_prompt":
        prompt = str(worker._build_prompt(s, "Explain", neon_chunks=chunks))
    else:
        prompt = str(worker._build_prompt_with_chunks(s, "Explain", chunks))
    assert prompt.count(UNKNOWN_NOTE) == 1
    note_at = prompt.index(UNKNOWN_NOTE)
    assert prompt.index("520-series passage") > note_at > prompt.index("[1]")
    assert prompt.index("exact passage") > prompt.index("[2]") > note_at
