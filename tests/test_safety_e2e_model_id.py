"""Contract for the e2e safety harness's model-id canonicalizer (#4372).

tools/safety_e2e/model_id_cases.json is the one source of truth; the TS twin
(mira-hub/tests/safety-e2e/model-id.ts) is held to the same rows by
mira-hub/tests/safety-e2e/model-id.test.ts.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1] / "tools" / "safety_e2e"
CASES = json.loads((ROOT / "model_id_cases.json").read_text())
_spec = importlib.util.spec_from_file_location("model_id", ROOT / "model_id.py")
model_id = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(model_id)


@pytest.mark.parametrize("raw,want", CASES["canonical"])
def test_canonical(raw, want):
    assert model_id.canonical_model_id(raw) == want


@pytest.mark.parametrize("raw,want", CASES["family"])
def test_family(raw, want):
    assert model_id.model_family(raw) == want
