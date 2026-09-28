"""MIRA product arm: the deployed staging Hub notebook chat, driven with the
exact request shapes the web and phone clients send.

Reuses Answer Radar's staging plumbing (staging-only guard, redirect-refusing
Hub client, deployed-SHA pin, SSE frame parsing) and the acceptance suite's Hub
client for real uploads (`attach_manual`) and photos (`look`). No second chat
client, no second tenant path.

Workflows (PRD §4, never mixed in one score):
  native         the technician's normal path: a notebook bound to the machine
                 (user-confirmed identity) or a blank chat, question as typed.
  equal_context  the same authorized manual pages the other arms receive,
                 uploaded as real notebook sources and sent as `sourceDocIds`.
"""

from __future__ import annotations

import json
import sys
import time
import uuid
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from answer_radar.hub_runner import (  # noqa: E402
    TERMINAL_STATUSES,
    _citation_label,
    _frames,
    assert_staging,
    deployed_sha,
    load_hub_client,
)

WORKFLOWS = ("native", "equal_context")


def connect(base: str, cookie: str):
    """A staging Hub client, or SystemExit for any non-staging target."""
    assert_staging(base)
    return load_hub_client()(base.rstrip("/"), cookie)


class MiraStaging:
    name = "mira"

    def __init__(self, hub, *, workflow: str, fixtures_root: Path):
        if workflow not in WORKFLOWS:
            raise ValueError(workflow)
        self.hub = hub
        self.workflow = workflow
        self.fixtures_root = fixtures_root
        # Codex #3487 F4: one build for the whole run, not just within a case.
        self.pinned_sha: str | None = None

    def _fixture(self, ref: str) -> Path:
        return self.fixtures_root / ref.removeprefix("fixtures/")

    def _notebook(self, case: dict[str, Any], stamp: str) -> dict[str, Any]:
        binding = (case.get("native_workflow") or {}).get("binding")
        name = f"TechArena {case['id']} {self.workflow} {stamp}"
        if binding and binding.get("manufacturer") and binding.get("model"):
            return self.hub.create_notebook(
                name,
                manufacturer=binding["manufacturer"],
                model=binding["model"],
                identityStatus="user_confirmed",
            )
        return self.hub.create_notebook(name)

    def run_case(self, case: dict[str, Any]) -> list[dict[str, Any]]:
        """One record per user turn, or one not_run record with the reason."""
        pdfs: list[Path] = []
        if self.workflow == "equal_context":
            refs = [
                e.get("local_pdf") for e in (case.get("equal_context") or {}).get("excerpts", [])
            ]
            pdfs = [self._fixture(r) for r in refs if r]
            if not refs or any(not r for r in refs) or any(not p.exists() for p in pdfs):
                return [
                    {
                        "case_id": case["id"],
                        "arm": self.name,
                        "status": "not_run:equal_context_source_missing",
                    }
                ]

        sha = deployed_sha(self.hub)
        if self.pinned_sha is None:
            self.pinned_sha = sha
        elif sha != self.pinned_sha:
            raise SystemExit(
                f"staging moved {self.pinned_sha} -> {sha} between cases; no mixed-build run"
            )
        stamp = time.strftime("%Y%m%dT%H%M%S")
        nb = self._notebook(case, stamp)
        doc_ids = [self.hub.attach_manual(nb, p) for p in pdfs]
        thread = "thrd_" + uuid.uuid4().hex
        history: list[dict[str, str]] = []
        records: list[dict[str, Any]] = []
        for i, turn in enumerate(case.get("turns") or []):
            if turn.get("role") != "user":
                continue
            body: dict[str, Any] = {
                "message": turn["text"],
                "sourceDocIds": doc_ids,
                "clientRequestId": str(uuid.uuid4()),
                "threadId": thread,
                "history": history,
            }
            if not doc_ids:
                body["mode"] = "general"
            images = turn.get("images") or []
            if images:
                _, look = self.hub.look(nb["id"], self._fixture(images[0]))
                body["visualEvidence"] = {
                    "fileId": look["fileId"],
                    "capturedAt": look["observation"]["capturedAt"],
                }
            t0 = time.monotonic()
            st, hd, raw = self.hub._req(
                "POST",
                f"/api/equipment-notebooks/{nb['id']}/chat/",
                json.dumps(body).encode(),
                {"Content-Type": "application/json"},
            )
            ms = int((time.monotonic() - t0) * 1000)
            frames = _frames(raw)
            content = "".join(f.get("content", "") for f in frames if f.get("kind") == "content")
            status = next((f for f in frames if f.get("kind") == "status"), {})
            if not content and status.get("message"):
                content = str(status["message"])
            sources = next((f for f in frames if f.get("kind") == "sources"), {})
            evidence = next((f for f in frames if f.get("kind") == "evidence"), {})
            usage = next((f for f in frames if f.get("kind") == "usage"), {})
            # Codex #3487 F3: only a 200 stream ending in exactly one recognised,
            # non-error terminal status is an answer; anything else is an error
            # attempt that can never be graded (same rule as Answer Radar).
            terminal = [f.get("status") for f in frames if f.get("kind") == "status"]
            if st != 200:
                outcome = f"error:http_{st}"
            elif len(terminal) != 1 or terminal[0] not in TERMINAL_STATUSES:
                outcome = "error:no_terminal_status"
            elif terminal[0] == "error":
                outcome = "error:status_error"
            else:
                outcome = "ran"
            trace = hd.get("x-mira-trace-id")
            try:
                retrieval = (self.hub.diagnostics(nb["id"], trace).get("packet") or {}).get(
                    "retrieval"
                ) or {}
            except RuntimeError as exc:  # evidence about the run, never a gate on it
                retrieval = {"error": str(exc)[:200]}
            after = deployed_sha(self.hub)
            if after != sha:
                raise SystemExit(f"staging moved {sha} -> {after} mid-case {case['id']}; no result")
            records.append(
                {
                    "case_id": case["id"],
                    "arm": self.name,
                    "workflow": self.workflow,
                    "turn_index": i,
                    "status": outcome,
                    "answer": content,
                    "http": st,
                    "turn_status": status.get("status"),
                    "basis": evidence.get("basis"),
                    "citations": [_citation_label(c) for c in sources.get("citations") or []],
                    "model": usage.get("model"),
                    "input_tokens": usage.get("inputTokens"),
                    "output_tokens": usage.get("outputTokens"),
                    "latency_ms": ms,
                    "trace_id": trace,
                    "notebook_id": nb["id"],
                    "source_doc_ids": doc_ids,
                    "visual_evidence": body.get("visualEvidence"),
                    "retrieval": retrieval,
                    "deployed_sha": sha,
                }
            )
            history += [
                {"role": "user", "content": turn["text"]},
                {"role": "assistant", "content": content},
            ]
        return records
