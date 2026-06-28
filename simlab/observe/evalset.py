"""Eval-pack loader + validator (pillars 1 & 3: Evaluation, Data Foundation).

An eval pack is a boring, human-editable YAML (or JSON) list of test questions.
Each item is the goal's schema::

    - id: conveyor_why_stopped
      question: "Why did the conveyor stop?"
      expected_asset: "enterprise.plant1.packaging.line2.conv_belt_01"
      expected_tags: ["conv_belt_01.running", "vfd_gs20_01.output_amps"]
      expected_documents: ["troubleshooting.md"]
      expected_answer_points: ["physical jam", "belt", "not a sensor fault"]
      unacceptable_answer_patterns: ["replace both photoeyes"]   # optional
      required_citations: ["troubleshooting.md"]
      severity: demo            # demo | production | safety | compliance
      active: true
      # --- harness-only optional fields (ignored by the schema contract) ---
      simlab_scenario_id: conveyor_jam_01   # live-mode preseed (tags/uns context)
      mock_answer: "…"                       # mock-mode canned reply (self-test only)

The first block is the contract. ``simlab_scenario_id`` and ``mock_answer`` are
harness conveniences: the former lets live mode reuse a SimLab scenario's
direct-connection preseed; the latter lets mock mode exercise the grader/checks
deterministically with no LLM. Live mode ignores ``mock_answer`` entirely.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

VALID_SEVERITIES = frozenset({"demo", "production", "safety", "compliance"})

_REQUIRED_KEYS = ("id", "question", "expected_asset")
_LIST_KEYS = (
    "expected_tags",
    "expected_documents",
    "expected_answer_points",
    "unacceptable_answer_patterns",
    "required_citations",
)


class EvalPackError(ValueError):
    """Raised when an eval pack fails validation. Message lists every problem."""


@dataclass
class EvalItem:
    """One evaluation question + its ground truth."""

    id: str
    question: str
    expected_asset: str
    expected_tags: list[str] = field(default_factory=list)
    expected_documents: list[str] = field(default_factory=list)
    expected_answer_points: list[str] = field(default_factory=list)
    unacceptable_answer_patterns: list[str] = field(default_factory=list)
    required_citations: list[str] = field(default_factory=list)
    severity: str = "demo"
    active: bool = True
    # harness-only
    simlab_scenario_id: Optional[str] = None
    mock_answer: Optional[str] = None
    mock_expected_failure: bool = False

    @property
    def is_blocking(self) -> bool:
        """Safety/compliance items hold the highest bar — a governance miss fails them."""
        return self.severity in ("safety", "compliance")


def _coerce_item(raw: dict[str, Any], index: int) -> tuple[Optional[EvalItem], list[str]]:
    errors: list[str] = []
    where = f"item[{index}] (id={raw.get('id', '?')!r})"

    for key in _REQUIRED_KEYS:
        if not raw.get(key):
            errors.append(f"{where}: missing required key '{key}'")

    severity = raw.get("severity", "demo")
    if severity not in VALID_SEVERITIES:
        errors.append(f"{where}: severity {severity!r} not in {sorted(VALID_SEVERITIES)}")

    lists: dict[str, list[str]] = {}
    for key in _LIST_KEYS:
        val = raw.get(key, [])
        if val is None:
            val = []
        if not isinstance(val, list):
            errors.append(f"{where}: '{key}' must be a list, got {type(val).__name__}")
            val = []
        lists[key] = [str(v) for v in val]

    active = raw.get("active", True)
    if not isinstance(active, bool):
        errors.append(f"{where}: 'active' must be a boolean, got {type(active).__name__}")
        active = bool(active)

    mock_expected_failure = raw.get("mock_expected_failure", False)
    if not isinstance(mock_expected_failure, bool):
        errors.append(
            f"{where}: 'mock_expected_failure' must be a boolean, "
            f"got {type(mock_expected_failure).__name__}"
        )
        mock_expected_failure = bool(mock_expected_failure)

    if errors:
        return None, errors

    return (
        EvalItem(
            id=str(raw["id"]),
            question=str(raw["question"]),
            expected_asset=str(raw["expected_asset"]),
            expected_tags=lists["expected_tags"],
            expected_documents=lists["expected_documents"],
            expected_answer_points=lists["expected_answer_points"],
            unacceptable_answer_patterns=lists["unacceptable_answer_patterns"],
            required_citations=lists["required_citations"],
            severity=severity,
            active=active,
            simlab_scenario_id=raw.get("simlab_scenario_id"),
            mock_answer=raw.get("mock_answer"),
            mock_expected_failure=mock_expected_failure,
        ),
        [],
    )


def parse_pack(data: Any) -> list[EvalItem]:
    """Validate + coerce a loaded pack (a list, or {'items': [...]}) to EvalItems.

    Raises ``EvalPackError`` listing every problem if any item is invalid, and
    on duplicate ids (a silent overwrite would hide a test).
    """
    if isinstance(data, dict):
        data = data.get("items") or data.get("evals") or []
    if not isinstance(data, list):
        raise EvalPackError("eval pack must be a YAML/JSON list (or {'items': [...]})")

    items: list[EvalItem] = []
    errors: list[str] = []
    seen_ids: set[str] = set()

    for i, raw in enumerate(data):
        if not isinstance(raw, dict):
            errors.append(f"item[{i}]: expected a mapping, got {type(raw).__name__}")
            continue
        item, item_errors = _coerce_item(raw, i)
        errors.extend(item_errors)
        if item is None:
            continue
        if item.id in seen_ids:
            errors.append(f"item[{i}]: duplicate id {item.id!r}")
            continue
        seen_ids.add(item.id)
        items.append(item)

    if errors:
        raise EvalPackError("Invalid eval pack:\n  - " + "\n  - ".join(errors))
    return items


def load_pack(path: str | Path) -> list[EvalItem]:
    """Load an eval pack from a ``.yaml``/``.yml``/``.json`` file."""
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if p.suffix.lower() == ".json":
        import json

        data = json.loads(text)
    else:
        import yaml

        data = yaml.safe_load(text)  # never yaml.load (python-standards.md)
    return parse_pack(data)


def active_items(items: list[EvalItem]) -> list[EvalItem]:
    return [i for i in items if i.active]


# --- pack resolution (name → file) -----------------------------------------

_PACKS_DIR = Path(__file__).parent / "evalpacks"


def resolve_pack_path(name_or_path: str) -> Path:
    """Resolve a pack name ('conveyor_demo') or a path to a concrete file."""
    p = Path(name_or_path)
    if p.exists():
        return p
    for suffix in (".yaml", ".yml", ".json"):
        cand = _PACKS_DIR / f"{name_or_path}{suffix}"
        if cand.exists():
            return cand
    raise FileNotFoundError(
        f"Eval pack {name_or_path!r} not found (looked in {_PACKS_DIR} and as a path)"
    )
