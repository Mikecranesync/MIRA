"""Owner decision 2026-09-27: a safety-classified turn is answered under a
hazard banner. The banner names the specific hazard (mirrors hazardBanner() in
mira-hub/src/lib/safety-classifier.ts)."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from shared.guardrails import hazard_banner  # noqa: E402


def test_incident_in_progress_leads_with_get_clear():
    for msg in ("the drive is arcing", "smoke coming from the panel", "the gs10 is arc flashing"):
        assert hazard_banner(msg).startswith("⚠️ Possible active incident."), msg


def test_specific_hazard_classes():
    assert "Energized electrical work" in hazard_banner("can i open the 480v panel while live")
    assert "Confined space" in hazard_banner("entering the confined space under the tank")
    assert "Stored pressure" in hazard_banner("bleed the hydraulic accumulator")
    assert "Moving machinery" in hazard_banner("reach past the guard on the conveyor")


def test_unclassified_trigger_still_gets_a_flag():
    assert hazard_banner("something else entirely").startswith("⚠️ Safety flag.")


# Recorded ordinary-fault replies, independent of inbound hazard keywords.
import pytest
from shared import guardrails


@pytest.mark.parametrize('reply,required', [
    ('Measure voltage at the motor terminals under load.', 'qualified person'),
    ('Check incoming line and DC bus voltage now.', 'energized-work'),
    ('Megger the motor.', 'lock/tag'),
    ('Open the cabinet and inspect wiring.', 'verify absence of voltage'),
    ('Disconnect motor output wires.', 'stored energy'),
    ('Uncouple the motor and retry.', 'guards'),
    ('Does the yellow flash change when you press reset?', 'clear people'),
    ('Extend accel and retry.', 'authorized restart'),
])
def test_delivered_action_has_local_prerequisites(reply, required):
    apply = guardrails.ensure_action_safety_prerequisites
    result = apply(reply)
    assert required in result.lower()
    assert reply in result  # Warnings must not rewrite equipment claims.


@pytest.mark.parametrize('reply', [
    'What exact code is displayed?',
    'Is the motor still connected to T1-T3?',
    'Read the voltage from the display.',
    'Read the nameplate current rating.',
    'Does the reset indicator flash?',
    'Do not disconnect motor wires.',
    'Do not open the panel.',
    'Do not press reset.',
])
def test_observation_and_prohibitions_do_not_get_action_warning(reply):
    apply = guardrails.ensure_action_safety_prerequisites
    assert apply(reply) == reply


def test_unrelated_warning_cannot_cover_later_wiring_step():
    reply = 'Use PPE.\n\nDisconnect the motor wires.'
    apply = guardrails.ensure_action_safety_prerequisites
    assert 'verify absence of voltage' in apply(reply).lower()


@pytest.mark.parametrize('reply', [
    "Before opening the cabinet, lock/tag all energy sources, control stored energy and verify absence of voltage.",
    "Before measuring voltage, use a qualified person, de-energize whenever possible, and apply energized-work controls and PPE if power is required.",
    "Before you press reset: guards restored, clear people and tools; follow the authorized restart procedure.",
])
def test_already_adequate_action_is_unchanged(reply):
    assert guardrails.ensure_action_safety_prerequisites(reply) == reply


def test_prerequisite_augmentation_is_idempotent():
    reply = 'Disconnect motor output wires.\nUncouple the motor and retry.'
    once = guardrails.ensure_action_safety_prerequisites(reply)
    assert guardrails.ensure_action_safety_prerequisites(once) == once


@pytest.mark.asyncio
@pytest.mark.parametrize('late_stage', ['quality', 'rewrite'])
@pytest.mark.parametrize('draft,required', [
    ('Check incoming line and DC bus voltage now.', 'qualified person'),
    ('Disconnect motor output wires.', 'verify absence of voltage'),
    ('Uncouple the motor and retry.', 'authorized restart'),
    ('Does the yellow flash change when you press reset?', 'clear people'),
])
async def test_final_process_adds_prerequisites_on_ordinary_fault_prompt(monkeypatch, draft, required, late_stage):
    from unittest.mock import AsyncMock, MagicMock
    from shared import engine

    sup = engine.Supervisor.__new__(engine.Supervisor)
    sup.tenant_id = None
    sup._maybe_attach_live_snapshot = lambda chat_id, message, live_tags, platform: message
    sup.process_full = AsyncMock(return_value={'reply': 'What alarm is shown?', 'next_state': 'Q2'})
    sup._apply_quality_gate = AsyncMock(side_effect=lambda chat_id, message, reply, **kw: draft if late_stage == 'quality' else reply)
    sup._enforce_citation_rewrite = AsyncMock(side_effect=lambda reply, **kw: draft if late_stage == 'rewrite' else reply)
    sup._log_interaction = MagicMock()
    sup._schedule_decision_trace = MagicMock()
    sup._schedule_session_lifecycle = MagicMock()
    monkeypatch.setattr(engine, 'check_quota', AsyncMock(return_value=(True, '')))
    monkeypatch.setenv('MIRA_ANSWER_QC', 'off')
    monkeypatch.setenv('MIRA_CITATION_ENFORCE', '0')
    reply = await sup.process('ordinary-fault', 'GS10 OC on startup')
    assert required in reply.lower()
    assert draft in reply
    assert sup._log_interaction.call_args.args[2] == reply


@pytest.mark.parametrize('reply', [
    'Check current software version.',
    'Check current fault status.',
    'Check current settings on the display.',
])
def test_current_as_time_reference_does_not_mean_electrical_measurement(reply):
    assert guardrails.ensure_action_safety_prerequisites(reply) == reply


@pytest.mark.parametrize('reply', [
    'Retry uploading the manual.',
    'Restart the browser.',
    'Reset the password.',
    'Restart your network connection and retry the upload.',
    'Check voltage on the display.',
])
def test_software_actions_and_display_checks_are_not_machine_work(reply):
    assert guardrails.ensure_action_safety_prerequisites(reply) == reply


def test_software_action_does_not_hide_machine_action_on_same_line():
    reply = 'Restart the browser, then uncouple the motor and retry.'
    result = guardrails.ensure_action_safety_prerequisites(reply)
    assert 'authorized restart' in result
    assert 'lock/tag' in result


def test_uncoupled_test_question_requires_isolation():
    reply = 'Does it trip with the motor uncoupled?'
    assert 'stored energy' in guardrails.ensure_action_safety_prerequisites(reply)


def test_reported_uncoupled_state_is_only_an_observation():
    reply = 'The motor is already uncoupled. What code is displayed?'
    assert guardrails.ensure_action_safety_prerequisites(reply) == reply
