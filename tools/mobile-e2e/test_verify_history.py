"""Offline controls for the cold-restart stage; live device proof remains separate."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location("journey", Path(__file__).with_name("journey.py"))
journey = importlib.util.module_from_spec(_SPEC)
sys.modules["journey"] = journey
_SPEC.loader.exec_module(journey)

QUESTION = "When do I need to derate this drive for altitude"


def state(*, thread="notebook-n1:thread-t1", question_count=1, citation=True,
          source=True, page="p.117", lifecycle="completed", user_id="42-q",
          answer_text="Stop the drive. [1]", thread_count=1, assistant_count=1):
    return {
        "notebookId": "n1", "threadItemId": thread, "threadItemCount": thread_count,
        "questionCount": question_count,
        "answers": [{"lifecycle": lifecycle, "userTurnId": user_id,
                     "assistantTurnId": f"{user_id[:-2]}-a", "answerText": answer_text,
                     "pairedAssistantCount": assistant_count,
                     "citationIds": ["1"] if citation else [],
                     "sources": [{"id": "1", "text": f"manual.pdf {page}"}] if source else []}],
    }


class StubDevice:
    def __init__(self):
        self.commands = []
        self.shots = []
        self.pids = iter(["100", "", "101"])

    def shell(self, *args):
        self.commands.append(args)
        if args[:1] == ("pidof",):
            return next(self.pids, "101")
        return ""

    def _run(self, args):
        self.commands.append(tuple(args))
        if args[:2] == ["shell", "pidof"]:
            pid = next(self.pids, "101")
            return subprocess.CompletedProcess(args, 0 if pid else 1, pid, "")
        return subprocess.CompletedProcess(args, 0, "", "")

    def top_package(self):
        return journey.PKG

    def screenshot(self, name):
        self.shots.append(name)


def test_home_reopen_requires_exact_persisted_project_and_thread(monkeypatch):
    calls = []

    def dom(_dev, action, question, project_id=""):
        calls.append((action, question, project_id))
        return state()

    monkeypatch.setattr(journey, "history_dom", dom)
    dev = StubDevice()
    journey.verify_history(dev, QUESTION, 117)
    assert calls == [("capture", QUESTION, ""), ("restore", QUESTION, "project-n1"),
                     ("restore", QUESTION, "project-n1")]
    assert ("shell", "am", "force-stop", journey.PKG) in dev.commands
    assert ("shell", "am", "start", "-n", journey.ACTIVITY) in dev.commands
    assert "history-restored" in dev.shots


def test_wrong_thread_after_home_reopen_fails(monkeypatch):
    states = iter([state(), state(thread="notebook-n1:thread-t2")])
    monkeypatch.setattr(journey, "history_dom", lambda *_args: next(states))
    dev = StubDevice()
    with pytest.raises(journey.Fail, match="wrong project/thread"):
        journey.verify_history(dev, QUESTION, 117)
    assert "history-restored" not in dev.shots


@pytest.mark.parametrize("result,match", [
    (state(question_count=0), "exact question"),
    (state(question_count=2), "exact question"),
    (state(citation=False), "citation evidence"),
    (state(source=False), "citation evidence"),
    (state(page="p.118"), "citation evidence"),
    (state(lifecycle="failed"), "not completed"),
])
def test_prose_filename_or_wrong_turn_cannot_replace_answer_evidence(result, match):
    # A filename or 'see p.117' elsewhere is intentionally absent from this
    # structured, matched-turn proof, even if UIA would find it on screen.
    with pytest.raises(journey.Fail, match=match):
        journey.assert_history_state(result, QUESTION, None, 117)


def test_citation_on_other_assistant_does_not_satisfy_restored_answer():
    result = state(source=False)
    result["otherTurn"] = {"text": "see p.117", "sources": [{"id": "1"}]}
    with pytest.raises(journey.Fail, match="citation evidence"):
        journey.assert_history_state(result, QUESTION, None, 117)


def test_actual_shared_source_locator_and_same_source_survive_restart():
    before = journey.assert_history_state(state(page="p. 117"), QUESTION, None, 117)
    journey.assert_history_state(state(page="p. 117"), QUESTION, before, 117)
    with pytest.raises(journey.Fail, match="citation evidence"):
        journey.assert_history_state(state(page="p.117; different source"), QUESTION, before, 117)


@pytest.mark.parametrize("replacement", [
    state(user_id="replacement99-q"),
    state(answer_text="Run the drive. [1]"),
])
def test_replaced_persisted_row_or_answer_is_not_a_history_pass(replacement):
    before = journey.assert_history_state(state(), QUESTION, None, 117)
    with pytest.raises(journey.Fail, match="turn identity|answer text"):
        journey.assert_history_state(replacement, QUESTION, before, 117)


@pytest.mark.parametrize("ambiguous", [
    state(thread_count=2),
    state(assistant_count=2),
    state(thread="notebook-n1:thread-"),
])
def test_ambiguous_or_empty_active_identity_is_rejected(ambiguous):
    with pytest.raises(journey.Fail, match="identifiable|ambiguous"):
        journey.assert_history_state(ambiguous, QUESTION, None, 117)


def test_live_only_row_is_not_persisted_evidence(monkeypatch):
    monkeypatch.setattr(journey, "history_dom", lambda *_args: state(user_id="live-0-q"))
    with pytest.raises(journey.Fail, match="persisted"):
        journey.verify_history(StubDevice(), QUESTION, 117)


def test_empty_server_turn_stem_is_not_persisted_identity():
    with pytest.raises(journey.Fail, match="turn identity"):
        journey.assert_history_state(state(user_id="-q"), QUESTION, None, 117,
                                     require_persisted=True)


@pytest.mark.parametrize("phase,observation", [
    ("before", (0, "not-a-pid", "")),
    ("before", (2, "100", "error: device offline")),
    ("before", (1, "", "error: device offline")),
    ("stopped", (1, "", "error: device offline")),
    ("stopped", (2, "", "")),
    ("started", (0, "not-a-pid", "")),
    ("started", (2, "101", "error: device offline")),
    ("started", (1, "101", "error: device offline")),
])
def test_pidof_transport_or_invalid_output_never_counts_as_process_proof(
    monkeypatch, phase, observation,
):
    monkeypatch.setattr(journey, "history_dom", lambda *_args: state())
    normal = {"before": (0, "100", ""), "stopped": (1, "", ""),
              "started": (0, "101", "")}
    plan = [observation if point == phase else normal[point]
            for point in ("before", "stopped", "started")]

    class PidDevice(StubDevice):
        def __init__(self):
            super().__init__()
            self.observations = iter(plan)

        def _run(self, args):
            self.commands.append(tuple(args))
            if args[:2] == ["shell", "pidof"]:
                code, out, err = next(self.observations, normal["started"])
                return subprocess.CompletedProcess(args, code, out, err)
            return subprocess.CompletedProcess(args, 0, "", "")

        def shell(self, *args):
            if args[:1] == ("pidof",):
                return (self._run(["shell", *args]).stdout or "").strip()
            return super().shell(*args)

    dev = PidDevice()
    with pytest.raises(journey.Fail, match="pidof"):
        journey.verify_history(dev, QUESTION, 117)
    assert "history-restored" not in dev.shots


@pytest.mark.parametrize("failed_am", ["force-stop", "start"])
def test_failed_restart_command_cannot_pass_with_unchanged_dom(monkeypatch, failed_am):
    monkeypatch.setattr(journey, "history_dom", lambda *_args: state())

    class FailedDevice(StubDevice):
        def _run(self, args):
            self.commands.append(tuple(args))
            if failed_am in args:
                return subprocess.CompletedProcess(args, 1, "", "adb transport error")
            return super()._run(args)

    dev = FailedDevice()
    with pytest.raises(journey.Fail, match="force-stop|start"):
        journey.verify_history(dev, QUESTION, 117)
    assert "history-restored" not in dev.shots


def test_start_error_output_or_unchanged_pid_cannot_pass(monkeypatch):
    monkeypatch.setattr(journey, "history_dom", lambda *_args: state())

    class ErrorDevice(StubDevice):
        def _run(self, args):
            self.commands.append(tuple(args))
            if "start" in args:
                return subprocess.CompletedProcess(args, 0, "Error: Activity class does not exist", "")
            return super()._run(args)

    with pytest.raises(journey.Fail, match="start failed"):
        journey.verify_history(ErrorDevice(), QUESTION, 117)

    reused = StubDevice()
    reused.pids = iter(["100", "", "100"])
    with pytest.raises(journey.Fail, match="process identity did not change"):
        journey.verify_history(reused, QUESTION, 117)
    assert "history-restored" not in reused.shots


def test_package_selection_targets_staging_activity():
    script = f"import importlib.util; s=importlib.util.spec_from_file_location('j',{str(Path(journey.__file__))!r}); j=importlib.util.module_from_spec(s); import sys; sys.modules['j']=j; s.loader.exec_module(j); print(j.ACTIVITY)"
    env = {**os.environ, "MIRA_PKG": "com.factorylm.mira.staging"}
    out = subprocess.check_output([sys.executable, "-c", script], env=env, text=True).strip()
    assert out == "com.factorylm.mira.staging/com.factorylm.mira.MainActivity"


def test_install_updates_only_matching_package_without_uninstall(monkeypatch, tmp_path):
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"fixture")
    monkeypatch.setattr(journey.shutil, "which", lambda _name: "/sdk/aapt")
    real_run = journey.subprocess.run
    monkeypatch.setattr(journey.subprocess, "run", lambda *args, **kwargs:
                        subprocess.CompletedProcess(args, 0, "package: name='com.factorylm.mira'\n", ""))

    class InstallDevice(StubDevice):
        def _run(self, args):
            self.commands.append(tuple(args))
            return subprocess.CompletedProcess(args, 0, "Success", "")

    dev = InstallDevice()
    try:
        journey.install(dev, apk)
    finally:
        monkeypatch.setattr(journey.subprocess, "run", real_run)
    assert ("install", "-r", str(apk)) in dev.commands
    assert not any("uninstall" in command for command in dev.commands)


def test_install_rejects_wrong_apk_before_adb(monkeypatch, tmp_path):
    monkeypatch.setattr(journey.shutil, "which", lambda _name: "/sdk/aapt")
    monkeypatch.setattr(journey.subprocess, "run", lambda *args, **kwargs:
                        subprocess.CompletedProcess(args, 0, "package: name='com.factorylm.mira.staging'\n", ""))
    dev = StubDevice()
    with pytest.raises(journey.Fail, match="does not match MIRA_PKG"):
        journey.install(dev, tmp_path / "app.apk")
    assert not dev.commands
