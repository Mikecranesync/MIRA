"""Drift-guard: the evidence catalog must list every kind + adapter in code.

Keeps ``docs/architecture/evidence-catalog.md`` honest against
``materialized_evidence/context_contract.py``. Pure stdlib (``ast`` + ``pathlib``)
— no import of the package, no third-party deps — so it runs anywhere.

The guard keys on **names**, not line numbers: it asserts that every
``EvidenceKind`` value and every top-level ``evidence_from_*`` adapter defined in
the contract appears somewhere in the catalog text. Renames/additions in code
that skip the catalog fail the build. See the hub doc §5 and the
add-a-producer runbook.
"""

from __future__ import annotations

import ast
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_CONTRACT = _ROOT / "materialized_evidence" / "context_contract.py"
_CATALOG = _ROOT / "docs" / "architecture" / "evidence-catalog.md"


def _contract_tree() -> ast.Module:
    return ast.parse(_CONTRACT.read_text(encoding="utf-8"))


def _evidence_kind_values(tree: ast.Module) -> set[str]:
    """String values of the ``EvidenceKind`` enum members."""
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "EvidenceKind":
            values: set[str] = set()
            for stmt in node.body:
                if isinstance(stmt, ast.Assign) and isinstance(stmt.value, ast.Constant):
                    if isinstance(stmt.value.value, str):
                        values.add(stmt.value.value)
            return values
    raise AssertionError("EvidenceKind enum not found in context_contract.py")


def _evidence_adapter_names(tree: ast.Module) -> set[str]:
    """Top-level function names starting with ``evidence_from_``."""
    return {
        node.name
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name.startswith("evidence_from_")
    }


def test_catalog_lists_every_evidence_kind() -> None:
    tree = _contract_tree()
    kinds = _evidence_kind_values(tree)
    assert kinds, "no EvidenceKind values parsed — parser regression?"
    catalog = _CATALOG.read_text(encoding="utf-8")
    missing = sorted(k for k in kinds if k not in catalog)
    assert not missing, (
        f"EvidenceKind values missing from evidence-catalog.md: {missing}. "
        "Add a catalog row (see docs/runbooks/evidence-add-a-producer.md step 6)."
    )


def test_catalog_lists_every_evidence_adapter() -> None:
    tree = _contract_tree()
    adapters = _evidence_adapter_names(tree)
    assert adapters, "no evidence_from_* adapters parsed — parser regression?"
    catalog = _CATALOG.read_text(encoding="utf-8")
    missing = sorted(a for a in adapters if a not in catalog)
    assert not missing, (
        f"evidence_from_* adapters missing from evidence-catalog.md: {missing}. "
        "Add a catalog row (see docs/runbooks/evidence-add-a-producer.md step 6)."
    )
