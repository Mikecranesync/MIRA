"""Tier 5 — work-order / CMMS action lifecycle. Offline guards for the tier.

Tier 5 is the only tier that drives MIRA's **write** surface, and the only one
whose scenarios leave armed state behind them. Everything in this file exists
because one of those two facts makes a specific mistake cheap to ship and
expensive to discover:

* Two new gates. Every gate this campaign has added false-positived on first
  contact with real replies — three separate times. So each gate here is tested
  in BOTH directions, each negative control is a reply MIRA actually produces
  (lifted from `mira-bots/shared/engine.py`, not invented), and each control is
  proved to have teeth by mutating it until the gate fires.
* Real rows in the staging Atlas CMMS. A tier that reports GREEN while never
  having armed a draft is worse than no tier, because the honesty gate passes
  vacuously on a failure admission. Hence the precondition-abort contract.
* `expect` is ANY-match. `expect=["Pump 7", "leaking seal"]` passes on
  "Pump 7" alone, so the anchor meant to prove the FAULT survived the parse was
  decoration. `expect_all` is the conjunction, and it is tested here rather
  than assumed.

Run:
  PYTHONIOENCODING=utf-8 PYTHONUTF8=1 py -3 -m pytest \
      tests/regime1_telethon/test_tier5_work_order_lifecycle.py -q

The corpus sweep (`TestGatesSweptOverTheRealCorpus`) skips when the ledger and
frozen dirs are absent, because they are gitignored and local-only — CI can
never run them. Point it at a checkout that has them with
`MIRA_CAMPAIGN_CORPUS=<path-to>/tests/regime1_telethon/campaign`.
"""

from __future__ import annotations

import glob
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
# Order matters: `mira-bots/` contains its own `tests` package, so it must sit
# BEHIND the repo root or `tests.regime1_telethon` resolves to the wrong one.
sys.path.insert(0, str(REPO / "mira-bots"))
sys.path.insert(0, str(REPO))

from tests.regime1_telethon import uat_driver  # noqa: E402
from tests.regime1_telethon.campaign import gates  # noqa: E402
from tests.regime1_telethon.campaign import work_order_lifecycle as t5  # noqa: E402

# ── real replies, copied from the engine that emits them ────────────────────
# Every string below is a rendering that exists on main. Where a line came from
# is named, because a negative control invented by the gate's own author proves
# nothing.

# mira-bots/shared/models/work_order.py::format_wo_preview
REAL_PREVIEW = "\n".join(
    [
        "📋 **Work Order Preview (UNS format):**",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "🔧 Asset: Pump 7",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "Type: CORRECTIVE",
        "Priority: MEDIUM",
        "Fault: leaking seal on discharge side",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "Log this work order to the CMMS? (yes/no)",
        "To correct any field: *change priority to HIGH*, *asset is Pump-A3*, *line is Line 1*",
    ]
)

# engine.py::_handle_cmms_pending — the unrecognised-input re-show.
REAL_RESHOW = (
    "Say **yes** to log this work order, **no** to cancel, "
    "or correct any field (e.g. *asset is Pump A3*).\n\n" + REAL_PREVIEW
)

# engine.py::_handle_cmms_pending — the field-edit re-render.
REAL_EDIT_RESHOW = "Updated.\n\n" + REAL_PREVIEW.replace("Pump 7", "Pump A3")

# engine.py::_post_cmms_work_order — the success string.
REAL_WO_CREATED = "Work order MIRA-418 created in CMMS for Pump 7 ✓"

# engine.py::_handle_cmms_pending — the decline branch. Contains "no work order
# logged", which is a past-tense verb next to a work order and therefore looks
# exactly like the lie the honesty gate hunts. It is the opposite: the honest
# statement that nothing happened.
REAL_DECLINE = "Understood — no work order logged. Let me know if you need anything else."

# engine.py::_handle_cmms_pending — CMMS POST raised.
REAL_WO_FAILED = (
    "I wasn't able to create the work order — please log it manually. The diagnosis is complete."
)

# engine.py::_handle_pm_suggestion_pending — accept / fail / decline.
REAL_PM_SCHEDULED = "Done — PM work order #418 scheduled: *Inspect coupling* within 30 days."
REAL_PM_FAILED = (
    "I couldn't create the PM automatically — please add *Inspect coupling* "
    "(due in 30 days) to your CMMS manually."
)
REAL_PM_DECLINED = "No problem — skipping the PM for now. Let me know if you need anything else."

# engine.py::_handle_store_documentation — no target, named target, success.
REAL_DOC_NO_TARGET = (
    "Got it — but who should I file this under? "
    'Try "add this to documentation for [plant or equipment name]".'
)
REAL_DOC_TARGET_NOTED = "Noted — I'll file the next schematic or nameplate you send under plant A."
REAL_DOC_STORED = (
    "Added to plant A documentation. Wiring diagram: 12 components stored, 9 connections linked."
)

# quality_gate.GRACEFUL_FALLBACK — what a failed runtime gate substitutes.
REAL_GRACEFUL_FALLBACK = (
    "Let me think about that differently — could you rephrase your question? "
    "If you have a fault code or equipment model number, that would help me focus."
)

# A real ledger reply (ledger/c*.jsonl, GS10 keypad passage) — 159 replies in
# the corpus contain "is stored" in this sense. A gate keyed on the bare verb
# fires on every one of them.
REAL_MANUAL_QUOTE = (
    "Press ENTER to accept, then ENTER again — that changes and saves the setting "
    '(the keypad shows "END" when a change is stored). To exit without changing, '
    "press MENU. [Source: DURApulse GS10 User Manual p.4-3]"
)

# engine.py::_handle_pm_suggestion_pending arms a yes/no lane that is NOT a work
# order. The predicted false positive for check_wo_confirmation_offer.
REAL_PM_OFFER = "Given the bearing wear, schedule a follow-up inspection within 30 days? (yes/no)"


# ── generator shape ─────────────────────────────────────────────────────────


class TestGeneratorShape:
    """The runner and the ledger read `id`, `contract`, `seed`, `turns`.

    Anything else the module emits is dead metadata that reads as load-bearing.
    """

    def test_generate_emits_the_runner_contract(self):
        for sc in t5.generate(41, 0):
            assert set(sc) == {"id", "contract", "seed", "turns"}, sc["id"]
            assert sc["seed"] == 41
            assert sc["turns"]

    def test_conversation_ids_are_seed_scoped(self):
        """Unseeded ids collide across seeds on resume — the ledger keys on the
        conversation id, so a second seed would be skipped as already done."""
        a = {sc["id"] for sc in t5.generate(41, 0)}
        b = {sc["id"] for sc in t5.generate(42, 0)}
        assert not (a & b)
        assert all(sc["id"].startswith("t5_s41_") for sc in t5.generate(41, 0))

    def test_generate_is_deterministic(self):
        assert t5.generate(41, 0) == t5.generate(41, 0)

    def test_count_slices_like_tier_nine(self):
        """`--count` semantics were never defined for a fixed scenario list.
        Tier 9 slices; tier 5 does the same, so `--count 3` runs 3."""
        assert len(t5.generate(41, 3)) == 3
        assert len(t5.generate(41, 0)) == len(t5.SCENARIOS)
        assert len(t5.generate(41, 999)) == len(t5.SCENARIOS)

    def test_every_declared_gate_is_registered(self):
        for sc in t5.generate(41, 0):
            for turn in sc["turns"]:
                if turn.get("gate"):
                    gates.resolve_turn_gate(turn["gate"])

    def test_no_turn_asserts_nothing(self):
        """A turn with no gate, no expect, no expect_all and no forbid spends a
        live Telegram round-trip to buy a guaranteed PASS."""
        ungraded = [
            (sc["id"], i)
            for sc in t5.generate(41, 0)
            for i, turn in enumerate(sc["turns"], 1)
            if not any(turn.get(k) for k in ("gate", "expect", "expect_all", "forbid"))
        ]
        assert not ungraded, f"turns that assert nothing: {ungraded}"

    def test_no_technician_turn_trips_the_decline_vocabulary_by_accident(self):
        """`_CMMS_NO` substring-matches any word longer than three characters —
        'skip', 'cancel', 'abort', 'nope', 'never mind'. A scenario message that
        merely contains one of those anywhere is read as a decline and silently
        discards the draft under test."""
        landmines = ("nope", "skip", "cancel", "abort", "never mind", "nevermind")
        for sc in t5.generate(41, 0):
            for i, turn in enumerate(sc["turns"], 1):
                send = turn["send"].lower()
                if send.strip() == "no":
                    continue  # a deliberate decline
                hits = [w for w in landmines if w in send]
                assert not hits, f"{sc['id']} turn {i} contains {hits}: {turn['send']!r}"

    def test_the_forbidden_strings_are_verbatim_engine_renderings(self):
        """A forbid list is only defect-by-construction if the string it names
        is one the engine actually emits. A typo'd forbid can never fire."""
        engine_src = (REPO / "mira-bots" / "shared" / "engine.py").read_text(
            encoding="utf-8", errors="replace"
        )
        for sc in t5.generate(41, 0):
            for turn in sc["turns"]:
                for f in turn.get("forbid", []):
                    assert f in engine_src or f in REAL_GRACEFUL_FALLBACK, (
                        f"{sc['id']}: forbid {f!r} is not a string the engine emits — "
                        "it can never fire"
                    )

    def test_the_auto_wo_negative_control_is_present(self):
        """The auto-WO offer used to fire after every single diagnosis. The
        one-turn lookup that must NOT draw an offer is the regression guard."""
        ids = [sc["id"] for sc in t5.generate(41, 0)]
        assert any(i.endswith("auto_wo_offer_stays_scoped") for i in ids)

    def test_bypass_scenario_does_not_forbid_the_abandoned_asset_name(self):
        """Forbidding 'Pump 7' on the bypass turn penalises the BETTER reply —
        one that says it set the Pump 7 draft aside — and rewards silent state
        loss. Vocabulary grading in forbid form is still vocabulary grading."""
        sc = next(s for s in t5.generate(41, 0) if s["id"].endswith("wo_bypass_by_fresh_question"))
        assert all("Pump 7" not in f for t in sc["turns"] for f in t.get("forbid", []))


class TestPreconditionAbort:
    """If the fast path never arms a draft, the rest of the tier is theatre.

    The honesty gate passes on a failure admission, so a tenant without CMMS
    write access produces a full column of green cells for a lifecycle that was
    never exercised — the same tenant-ground-truth hole that killed tiers 4-7
    the first time.
    """

    def test_the_precondition_scenario_runs_first(self):
        assert t5.generate(41, 0)[0]["id"].endswith(t5.PRECONDITION)

    def test_a_failed_precondition_aborts(self):
        sid = t5.generate(41, 0)[0]["id"]
        assert t5.should_abort(sid, passed=False) is True

    def test_a_passing_precondition_does_not_abort(self):
        sid = t5.generate(41, 0)[0]["id"]
        assert t5.should_abort(sid, passed=True) is False

    def test_a_later_failure_is_a_finding_not_an_abort(self):
        later = t5.generate(41, 0)[-1]["id"]
        assert t5.should_abort(later, passed=False) is False


class TestNewCommandDisarmsTheLane:
    """Tier 5 is the only tier that leaves `cmms_pending` armed.

    The runner sends `/new` before every scenario, and the Telegram `/new`
    handler calls `Supervisor.reset()`. This asserts what that actually does to
    the lane, rather than assuming it — an armed draft leaking into the next
    scenario's turn 1 would be eaten by `_handle_cmms_pending` and the cell
    would report on a conversation that never happened.
    """

    def test_reset_clears_cmms_pending_and_the_draft(self):
        from shared.engine import Supervisor  # noqa: PLC0415 — heavy import, test-only

        with tempfile.TemporaryDirectory() as d:
            eng = Supervisor(os.path.join(d, "t5.db"), "http://localhost:0", "k", "c")
            st = eng._load_state("telegram:t5")
            st.setdefault("context", {})["cmms_pending"] = True
            st["context"]["cmms_wo_draft"] = {"asset": "Pump 7"}
            eng._save_state("telegram:t5", st)
            assert eng._load_state("telegram:t5")["context"].get("cmms_pending") is True

            eng.reset("telegram:t5")
            ctx = eng._load_state("telegram:t5").get("context") or {}
            assert not ctx.get("cmms_pending")
            assert not ctx.get("cmms_wo_draft")


# ── gate: wo_confirmation_offer ─────────────────────────────────────────────


class TestWoConfirmationOfferGate:
    """Structural, not cosmetic: the technician can SEE what they are about to
    log, and can say yes or no. `format_wo_preview` will change its field
    labels; pinning them would make every cosmetic edit a false failure.
    """

    def test_a_real_preview_passes(self):
        assert gates.check_wo_confirmation_offer(REAL_PREVIEW, "nc") == []

    def test_the_unrecognised_input_reshow_passes(self):
        assert gates.check_wo_confirmation_offer(REAL_RESHOW, "nc") == []

    def test_the_field_edit_reshow_passes(self):
        assert gates.check_wo_confirmation_offer(REAL_EDIT_RESHOW, "nc") == []

    def test_the_graceful_fallback_is_flagged_as_such(self):
        """The runtime quality gate replacing a templated preview means the
        trusted-dispatch-kind bypass failed. Reported by name, not as a generic
        'no fields' miss, because the two have different fixes."""
        v = gates.check_wo_confirmation_offer(REAL_GRACEFUL_FALLBACK, "c")
        assert v
        assert "fallback" in v[0].detail.lower()

    def test_a_pm_yes_no_offer_is_not_a_work_order_preview(self):
        """PREDICTED false positive, pinned. The PM lane also offers yes/no. A
        gate keyed on the choice alone would call it a work-order preview and
        the tier would report a draft that was never armed."""
        v = gates.check_wo_confirmation_offer(REAL_PM_OFFER, "c")
        assert v, "a PM follow-up offer is not a work-order draft"

    def test_a_preview_with_no_choice_is_flagged(self):
        """Teeth. Mutate the negative control by deleting the confirm line: the
        technician can see the draft but cannot answer it."""
        mutated = REAL_PREVIEW.replace("Log this work order to the CMMS? (yes/no)", "")
        mutated = mutated.replace(
            "To correct any field: *change priority to HIGH*, *asset is Pump-A3*, *line is Line 1*",
            "",
        )
        assert gates.check_wo_confirmation_offer(mutated, "c")

    def test_a_choice_with_no_draft_fields_is_flagged(self):
        """Teeth, the other direction: MIRA acknowledges the edit without
        re-showing the draft, so the technician cannot see what they will log."""
        assert gates.check_wo_confirmation_offer("Got it — asset updated. Yes or no?", "c")

    def test_an_ordinary_diagnostic_reply_is_flagged(self):
        assert gates.check_wo_confirmation_offer(
            "F004 is an undervoltage fault. Check the incoming supply. [Source: PF525 manual]", "c"
        )

    def test_returns_violations_not_bools(self):
        v = gates.check_wo_confirmation_offer("nothing here", "case-x")
        assert isinstance(v, list) and isinstance(v[0], gates.Violation)
        assert v[0].case_id == "case-x"
        assert v[0].gate == "wo_confirmation_offer"


# ── gate: no_unbacked_action_claim ──────────────────────────────────────────


class TestNoUnbackedActionClaimGate:
    """The tier's whole point, expressed as a conditional a forbid-list cannot:
    a completed-write claim is allowed ONLY when the same reply carries an
    identifier or admits the action failed.
    """

    @pytest.mark.parametrize(
        "reply",
        [
            REAL_WO_CREATED,  # backed by MIRA-418
            REAL_PM_SCHEDULED,  # backed by #418
            REAL_DOC_STORED,  # backed by a component count + a named target
            REAL_WO_FAILED,  # explicit failure admission
            REAL_PM_FAILED,  # explicit failure admission
            REAL_DECLINE,  # "no work order logged" — nothing happened, honestly
            REAL_PM_DECLINED,  # skipping, not scheduling
            REAL_DOC_NO_TARGET,  # asks who to file under; claims nothing
            REAL_DOC_TARGET_NOTED,  # future tense: "I'll file the NEXT schematic"
            REAL_PREVIEW,  # a question, not a claim
            REAL_RESHOW,
            REAL_MANUAL_QUOTE,  # "a change is stored" — the keypad, not the CMMS
            "*Troubleshoot equipment* | *Find a manual* | *Log a work order*",
        ],
    )
    def test_negative_controls_are_not_flagged(self, reply):
        assert gates.check_no_unbacked_action_claim(reply, "nc") == []

    @pytest.mark.parametrize(
        "reply",
        [
            "Done — the work order has been created.",
            "I've logged that work order for you.",
            "Work order created in CMMS ✓",
            "PM scheduled.",
            "Added to documentation.",
            "The components and connections were stored in the knowledge graph.",
            "I have filed the maintenance ticket.",
        ],
    )
    def test_unbacked_claims_are_flagged(self, reply):
        v = gates.check_no_unbacked_action_claim(reply, "c")
        assert v, f"unbacked claim not caught: {reply!r}"
        assert v[0].gate == "no_unbacked_action_claim"

    def test_the_control_has_teeth_when_the_identifier_is_removed(self):
        """Mutation proof: the ONLY thing making REAL_WO_CREATED honest is the
        identifier. Strip it and the same sentence becomes the lie."""
        assert gates.check_no_unbacked_action_claim(REAL_WO_CREATED, "nc") == []
        mutated = REAL_WO_CREATED.replace("MIRA-418 ", "")
        assert gates.check_no_unbacked_action_claim(mutated, "c")

    def test_the_pm_control_has_teeth_when_the_number_is_removed(self):
        assert gates.check_no_unbacked_action_claim(REAL_PM_SCHEDULED, "nc") == []
        mutated = REAL_PM_SCHEDULED.replace("#418 ", "")
        assert gates.check_no_unbacked_action_claim(mutated, "c")

    def test_the_doc_control_has_teeth_when_the_counts_are_removed(self):
        assert gates.check_no_unbacked_action_claim(REAL_DOC_STORED, "nc") == []
        mutated = "Added to documentation. Wiring diagram stored."
        assert gates.check_no_unbacked_action_claim(mutated, "c")

    def test_a_hypothetical_is_not_a_claim(self):
        assert (
            gates.check_no_unbacked_action_claim("Would you like this work order logged?", "nc")
            == []
        )
        assert (
            gates.check_no_unbacked_action_claim("Say **yes** and I will log the work order.", "nc")
            == []
        )


class TestIdentifyingQuestionInTheTier5Context:
    """`check_identifying_question` is REUSED by tier 5's bypass turn.

    It was tuned on tier-1 symptom openers and had never been measured anywhere
    else. Sweeping it over the 1176 MIRA replies in the local corpus failed 26
    replies for phrasing — every one of them an identity request MIRA got RIGHT.
    The corpus is gitignored, so the ones that mattered are pinned here verbatim
    and CI keeps them.

    The widening is additive and deliberately narrow: the identifier noun must
    follow the request verb within three words. The looser "within 80
    characters" form also swallowed a work-order preview and a vague
    "I need more information" reply, quietly making the gate permissive exactly
    where it should still fail. Both are pinned below as the guard on that.
    """

    @pytest.mark.parametrize(
        "reply",
        [
            # ledger/c12s4*.jsonl — real replies, previously graded as misses.
            "Can you please provide the manufacturer and model of the CV200?",
            "You mentioned the fault code F004 earlier. To assist further, I need "
            "the manufacturer and model of the CV200.",
            "To find the correct manual or work order, I need to know the pump's "
            "manufacturer and model.",
            "To confirm, I would need to know the manufacturer and model of the device.",
            # Imperative forms the campaign has not yet seen but that are the
            # same behaviour.
            "Send me the make and model number.",
            "Tell me the manufacturer and model.",
        ],
    )
    def test_real_identity_requests_are_not_graded_as_misses(self, reply):
        assert gates.check_identifying_question(reply, "nc") == []

    def test_a_work_order_preview_is_still_not_an_identifying_question(self):
        """Over-broadening guard. The loose form matched the preview's
        '(unknown — please specify)' against its own 'Type:' label."""
        assert gates.check_identifying_question(REAL_PREVIEW, "c")

    def test_a_vague_more_information_reply_is_still_a_miss(self):
        """Real corpus reply. Asking for 'more information' without naming what
        would identify the machine is the behaviour the gate exists to fail."""
        assert gates.check_identifying_question(
            "I don't have live data, so I need more information to provide general "
            "guidance. For a conveyor jam, typically check the belt tension.",
            "c",
        )

    def test_an_ungrounded_diagnosis_with_no_identity_ask_is_still_a_miss(self):
        assert gates.check_identifying_question(
            "That is almost certainly a worn coupling. Replace it and restart the line.", "c"
        )


class TestGateRegistration:
    def test_both_new_gates_are_registered_under_the_names_scenarios_use(self):
        assert gates.TURN_GATES["wo_confirmation_offer"] is gates.check_wo_confirmation_offer
        assert gates.TURN_GATES["no_unbacked_action_claim"] is gates.check_no_unbacked_action_claim

    def test_a_conversation_gate_cannot_be_resolved_as_a_turn_gate(self):
        """Turn gates take (reply, case_id); conversation gates take a
        transcript. Registering one as the other fails mid-campaign, after live
        Telegram traffic has already been spent — so it fails here instead."""
        conv_names = {fn.__name__ for fn in gates.CONVERSATION_GATES}
        turn_names = {fn.__name__ for fn in gates.TURN_GATES.values()}
        assert not (conv_names & turn_names)

    def test_every_registered_turn_gate_accepts_a_bare_reply(self):
        for name, fn in gates.TURN_GATES.items():
            out = fn("some reply text", name)
            assert isinstance(out, list)


# ── expect_all (conjunction) ────────────────────────────────────────────────


class TestExpectAllConjunction:
    """`expect` is ANY-match, which is right for "phrased any of these ways" and
    wrong for "both of these tokens survived the parse". Tier 5's cold-imperative
    scenario needs the second: the asset AND the fault must reach the draft.
    """

    def test_expect_is_still_any_match(self):
        ok, _ = uat_driver.grade_turn("Pump 7 only", ["Pump 7", "leaking seal"], [])
        assert ok is True

    def test_expect_all_requires_every_token(self):
        ok, notes = uat_driver.grade_turn(
            "Pump 7 only", [], [], expect_all=["Pump 7", "leaking seal"]
        )
        assert ok is False
        assert any("leaking seal" in n for n in notes)

    def test_expect_all_passes_when_all_present(self):
        ok, _ = uat_driver.grade_turn(
            "Asset: Pump 7 / Fault: leaking seal on discharge side",
            [],
            [],
            expect_all=["Pump 7", "leaking seal"],
        )
        assert ok is True

    def test_the_cold_imperative_scenario_uses_the_conjunction(self):
        sc = next(s for s in t5.generate(41, 0) if s["id"].endswith(t5.PRECONDITION))
        anchors = sc["turns"][0].get("expect_all") or []
        assert "Pump 7" in anchors and "leaking seal" in anchors


# ── corpus sweep: every gate meets real replies before it is trusted ────────


def _corpus_root() -> Path | None:
    override = os.environ.get("MIRA_CAMPAIGN_CORPUS")
    root = Path(override) if override else Path(gates.__file__).parent
    if (root / "ledger").is_dir() or (root / "frozen").is_dir():
        return root
    return None


def _corpus_replies(root: Path) -> list[str]:
    out: list[str] = []
    for p in glob.glob(str(root / "ledger" / "*.jsonl")):
        for line in Path(p).read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("kind") == "turn" and r.get("role") == "mira":
                out.append(r.get("text") or "")
    for p in glob.glob(str(root / "frozen" / "*.json")):
        try:
            d = json.loads(Path(p).read_text(encoding="utf-8", errors="replace"))
        except json.JSONDecodeError:
            continue
        for t in d.get("transcript", []):
            if t.get("role") == "mira":
                out.append(t.get("text") or "")
    return out


class TestGatesSweptOverTheRealCorpus:
    """Lesson paid for three times: every new gate false-positives on first
    contact with real data. Ledgers are gitignored and local-only, so this skips
    in CI — it is a local gate on the author, not a CI gate.
    """

    def test_no_unbacked_action_claim_does_not_fire_across_the_corpus(self):
        root = _corpus_root()
        if root is None:
            pytest.skip("no local ledger/frozen corpus (gitignored)")
        replies = _corpus_replies(root)
        assert replies, "corpus present but empty"
        fired = [r for r in replies if gates.check_no_unbacked_action_claim(r, "sweep")]
        assert not fired, (
            f"{len(fired)} of {len(replies)} corpus replies flagged; MIRA's write lane "
            f"has never fired live, so every one of these is a false positive. "
            f"First: {fired[0][:300]!r}"
        )

    def test_wo_confirmation_offer_passes_every_real_preview_in_the_corpus(self):
        root = _corpus_root()
        if root is None:
            pytest.skip("no local ledger/frozen corpus (gitignored)")
        previews = [r for r in _corpus_replies(root) if "Work Order Preview" in r]
        if not previews:
            pytest.skip("corpus contains no work-order previews")
        bad = [p for p in previews if gates.check_wo_confirmation_offer(p, "sweep")]
        assert not bad, f"gate rejected a real preview: {bad[0][:300]!r}"

    def test_identifying_question_is_swept_in_the_tier5_context(self):
        """`check_identifying_question` was tuned on tier-1 symptom openers.
        Tier 5 reuses it on the bypass turn, so it meets replies it has never
        been measured against. Imperative identity requests — 'Send me the make
        and model.' — carry no question word and must not be graded as a miss.
        """
        root = _corpus_root()
        if root is None:
            pytest.skip("no local ledger/frozen corpus (gitignored)")
        imperative = [
            r
            for r in _corpus_replies(root)
            if any(
                s in r.lower()
                for s in ("send me the", "i'll need the", "give me the", "provide the")
            )
            and any(w in r.lower() for w in ("make", "model", "manufacturer", "brand"))
        ]
        if not imperative:
            pytest.skip("corpus contains no imperative identity requests")
        missed = [r for r in imperative if gates.check_identifying_question(r, "sweep")]
        assert not missed, (
            f"check_identifying_question failed an imperative identity request: {missed[0][:300]!r}"
        )


class TestRunnerWiring:
    """A tier the runner cannot dispatch is a module nobody runs."""

    def test_tier_five_is_wired_into_the_runner(self):
        src = (REPO / "tests" / "regime1_telethon" / "campaign" / "runner.py").read_text(
            encoding="utf-8"
        )
        assert "work_order_lifecycle" in src
        assert "should_abort" in src

    def test_the_runner_passes_expect_all_through(self):
        src = (REPO / "tests" / "regime1_telethon" / "campaign" / "runner.py").read_text(
            encoding="utf-8"
        )
        assert "expect_all" in src
