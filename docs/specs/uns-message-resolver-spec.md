# UNS Message Resolver Spec

**Status:** Active (2026-05-13)
**Owner:** mira-bots/shared
**Module:** `mira-bots/shared/uns_resolver.py`
**Related:** `docs/specs/uns-kg-unification-spec.md`,
`mira-crawler/ingest/uns.py`

---

## 1. Problem

`mira-bots/shared/engine.py` runs vendor/model/fault-code extraction in 14
separate places, every turn. The two helpers it uses
(`guardrails.vendor_name_from_text` and `response_formatter._looks_like_model_number`)
disagree on edge cases, and they have no shared notion of what was already
resolved earlier in the conversation.

Concrete failure (Mike's 2026-05-13 transcript):

> User: *"I have a powerflex 525 and it has it called f0004"*

- `vendor_name_from_text` → `"Rockwell Automation"` ✓
- `_looks_like_model_number` ranges left-to-right and accepts the first
  token that has both a letter and a digit. That's `"f0004"`. The fault
  code is captured *as the model*. `"525"` is rejected (no letters).

Downstream, every site that read this got the wrong answer.

## 2. Solution

One resolver, one call per turn, one canonical result. All 14 sites read from
it. The result is named `UNSContext` because every field it carries maps to a
UNS path segment defined in `mira-crawler/ingest/uns.py`.

### 2.1 `UNSContext` dataclass

Frozen dataclass. Fields:

| Field | Type | Meaning |
|---|---|---|
| `uns_path` | `str \| None` | Deepest UNS path that can be built from the resolved entities, e.g. `enterprise.knowledge_base.rockwell_automation.powerflex.525.fault_codes.f0004`. `None` if no manufacturer was identified. |
| `manufacturer` | `str \| None` | Canonical display name from `VENDOR_ALIASES`, e.g. `"Rockwell Automation"`. |
| `manufacturer_alias` | `str \| None` | The literal token the user wrote, e.g. `"PowerFlex"`. |
| `product_family` | `str \| None` | The family/series, e.g. `"PowerFlex"`. May equal `manufacturer_alias` when the alias IS the family. |
| `model` | `str \| None` | The model identifier, e.g. `"525"`. Pure-digit allowed when a family is also identified. |
| `fault_code` | `str \| None` | Normalized fault code (uppercase letter + zero-padded digits where the pattern matches), e.g. `"F0004"`. |
| `fault_code_raw` | `str \| None` | Raw token the user wrote, e.g. `"f0004"`. |
| `category` | `str \| None` | One of `"fault_codes"`, `"manuals"`, `"pm_schedules"`, `"parts_lists"`, or `None`. Derived from the message wording. |
| `site_path` | `str \| None` | The site-side instance path, when a tenant + asset can be identified in NeonDB. `None` in offline/anonymous mode. |
| `matched_entities` | `list[dict]` | `kg_entities` hits (id, uns_path, label). Empty when DB unreachable or no match. |
| `matched_kb_count` | `int` | Count of `knowledge_entries` under the resolved path. `0` when DB unreachable. |
| `confidence` | `float` | See §2.4 below. |

The dataclass exposes `as_dict()` for engine state serialization and round-trip
through SQLite.

### 2.2 `resolve_uns_path(message, tenant_id=None, prior_ctx=None)`

Returns `UNSContext`. Three stages:

**Stage 1 — Tokenize + extract fault codes FIRST.**
Run `FAULT_PATTERNS` against the message. Capture every match. *Then* strip
those tokens from the candidate set before model matching. This is the fix
for the f0004-as-model bug.

**Stage 2 — Alias-table match + path build.**
Lowercase the remaining tokens. Lookup each against `VENDOR_ALIASES`
(alias → canonical). On first hit, set `manufacturer`, `manufacturer_alias`,
and `product_family` (the family is the alias key when the alias maps to a
distinct family, e.g. `"powerflex" → "Rockwell Automation"` produces
`family="PowerFlex"`).

After vendor is known, look at the tokens *adjacent* to the vendor alias
for a model candidate. A model candidate is any token that:

- Is not in `RESERVED_LABELS` (uns.py)
- Is not a captured fault code
- Is alphanumeric, length 2–12
- Either contains a digit (so "525", "GS20", "X3" all qualify) OR is
  followed by digits in the next token (e.g. `"FR-D 700"`)

Build the deepest UNS path possible using `uns.py` builders:
`fault_code_path` if a fault code is present, else `model_path`, else
`manufacturer_path`. Fault codes are slugged through `uns.slug()` so they
land as lowercase labels in the path.

**Stage 3 — DB enrichment (optional).**
If a Neon connection is available (`mira-bots.shared.neon_recall`), run:

- `SELECT id, uns_path, label FROM kg_entities WHERE uns_path = $1 OR uns_path ~ $1::lquery`
- `SELECT count(*) FROM knowledge_entries WHERE equipment_entity_id IN (...)`
- (When `tenant_id` is set) `SELECT uns_path FROM cmms_equipment WHERE tenant_id = $1 AND (manufacturer = $2 AND model = $3)`

Populate `matched_entities`, `matched_kb_count`, `site_path`. On any DB
error: log and proceed with Stage-2-only result. **Offline must work.**

**Prior-context merge.** When `prior_ctx` is provided, each missing field on
the freshly-resolved context falls back to the prior value. This preserves
"PowerFlex 525 F0004" across the next turn when the user types only
"make a work order". Implementation: build the fresh ctx, then for each
field that is `None` / `0` / `[]`, take the prior value. Confidence
becomes `max(fresh.confidence, prior.confidence * 0.9)` — prior context
decays slightly each turn.

### 2.3 `VENDOR_ALIASES`

One authoritative dict. Source: consolidate `_VENDOR_DISPLAY_NAMES` from
`guardrails.py` plus the additional families Mike has flagged. Keys are
lowercase; values are canonical display names that match `kg_entities.label`
exactly so the path slug is reproducible.

```python
VENDOR_ALIASES: dict[str, str] = {
    "powerflex": "Rockwell Automation",
    "allen-bradley": "Rockwell Automation",
    "allen bradley": "Rockwell Automation",
    "ab": "Rockwell Automation",
    "rockwell": "Rockwell Automation",
    "rockwell automation": "Rockwell Automation",
    "gs10": "AutomationDirect",
    "gs20": "AutomationDirect",
    "automationdirect": "AutomationDirect",
    "automation direct": "AutomationDirect",
    "siemens": "Siemens",
    "micromaster": "Siemens",
    "sinamics": "Siemens",
    "yaskawa": "Yaskawa",
    "abb": "ABB",
    "omron": "Omron",
    "schneider electric": "Schneider Electric",
    "schneider": "Schneider Electric",
    "mitsubishi": "Mitsubishi Electric",
    "mitsubishi electric": "Mitsubishi Electric",
    "fr-e": "Mitsubishi Electric",
    "fr-a": "Mitsubishi Electric",
    "fr-d": "Mitsubishi Electric",
    "fr-f": "Mitsubishi Electric",
    "danfoss": "Danfoss",
    "aqua drive": "Danfoss",
    "eaton": "Eaton",
    "delta": "Delta Electronics",
    "lenze": "Lenze",
    "bosch rexroth": "Bosch Rexroth",
    "rexroth": "Bosch Rexroth",
    "pilz": "Pilz",
}
```

A separate `FAMILY_FROM_ALIAS` dict captures the family token when the alias
is a family rather than a brand:

```python
FAMILY_FROM_ALIAS: dict[str, str] = {
    "powerflex": "PowerFlex",
    "micromaster": "Micromaster",
    "sinamics": "Sinamics",
    "fr-e": "FR-E",
    "fr-a": "FR-A",
    "fr-d": "FR-D",
    "fr-f": "FR-F",
    "aqua drive": "AquaDrive",
    "gs10": "GS10",
    "gs20": "GS20",
}
```

### 2.4 Confidence scheme

Numeric, 0.0–1.0. Concrete bands:

| Value | Means |
|---|---|
| `1.0` | manufacturer + model + fault code, all DB-confirmed (`matched_entities` non-empty) |
| `0.9` | manufacturer + model + fault code, alias-table only |
| `0.7` | manufacturer + model, alias-table |
| `0.5` | manufacturer only |
| `0.3` | fault code only (no vendor identified) |
| `0.0` | nothing matched |

Stored on the dataclass so downstream consumers (router, rag_worker, DST) can
gate behavior on "we know enough to scope the KB".

### 2.5 `FAULT_PATTERNS`

```python
FAULT_PATTERNS = [
    re.compile(r"\b[fF]\d{2,6}\b"),   # F04, F004, F0004, F30004
    re.compile(r"\b[eE]\d{1,4}\b"),    # E01, E001
    re.compile(r"\bo[cC][a-zA-Z]?\b"), # oC, OC, ocA
    re.compile(r"\b[aA]\d{1,4}\b"),    # A02, A002
]
```

Fault codes are normalized: leading letter uppercased, digits zero-padded
to 4 places when the pattern is letter+digits (so `"F4"` becomes `"F0004"`
on the canonical side, but the raw user token is preserved in `fault_code_raw`).
The `oC` family is left as-is (case preserved).

## 3. Engine integration

One call near the top of `Supervisor.process()`:

```python
from shared.uns_resolver import resolve_uns_path

prior = state.get("uns_context") or None
ctx = resolve_uns_path(
    message,
    tenant_id=state.get("tenant_id"),
    prior_ctx=prior,
)
state["uns_context"] = ctx.as_dict()
if ctx.manufacturer:
    label = ctx.manufacturer
    if ctx.model:
        label = f"{label}, {ctx.model}"
    state["asset_identified"] = label
```

The 14 sites that previously called `vendor_name_from_text(message)` or
`_looks_like_model_number(message)` read from `state["uns_context"]` instead.
The `asset_identified` write preserves the existing engine contract — DST
and reflection logic continue to work without modification.

## 4. Replaced sites

Engine sites (15 total, audited 2026-05-13 — line numbers will drift):

- `engine.py:62, 91` — imports of `vendor_name_from_text` and
  `_looks_like_model_number`. Remove.
- `engine.py:682, 1271, 2492, 2494, 2502, 2504, 2517, 2519, 2688, 2689,
  2895, 3408, 3506, 3514` — read from `state["uns_context"]`.

Worker / DST sites (3):

- `mira-bots/shared/workers/rag_worker.py:21, 424` — KB cross-vendor filter
  reads `ctx.manufacturer` from state; entity-scoped query uses
  `ctx.uns_path` when set.
- `mira-bots/shared/dialogue_state.py:488-490` — read vendor from state.
- `mira-bots/shared/dialogue_acts.py:197-199` — read vendor from state.

## 5. Offline guarantee

The resolver must produce a useful `UNSContext` *without* NeonDB. Stage 2 is
the floor. Stage 3 is additive — any DB error returns to the Stage-2 result,
logged at INFO. This matches the existing pattern in `neon_recall` and means
no test in `tests/test_uns_resolver.py` requires a live database.

## 6. Tests

`tests/test_uns_resolver.py`, minimum 30 cases:

1. Mike's exact regression case → `mfr="Rockwell Automation",
   alias="powerflex", family="PowerFlex", model="525",
   fault_code="F0004"`.
2. `"PowerFlex 525 F0004"` → same.
3. `"GS10 ocA fault"` → `mfr="AutomationDirect", model="GS10", fault="oC"`.
4. `"Motor hums but won't turn"` → all None, confidence 0.
5. Empty string → all None, confidence 0.
6. Numeric model with no vendor (`"525 fault"`) → `model=None` (alone, "525"
   is ambiguous), `fault_code=None` (525 is not a fault pattern), confidence 0.
7. Multi-vendor in one message ("PowerFlex 525 not Yaskawa") → first match
   wins; comment on tie-break.
8. Carry-over: prior ctx with PowerFlex/525/F0004, current message
   "make a work order" → returned ctx still has all three.
9. + 22 more covering: every alias in `VENDOR_ALIASES`, every fault pattern,
   path-build correctness, the `_VENDOR_DISPLAY_NAMES` legacy alignment,
   the slug() normalization edge cases, the offline-only branch.

## 7. What this is NOT

- Not a router. It does not decide intent or pick a state.
- Not an FSM mutator. It does not write to `state["state"]`.
- Not a DST replacement. DST consumes its output — does not duplicate it.
- Not LLM-aware. Pure-Python deterministic extraction. No cascade calls.

## 8. Acceptance

- All 14 engine sites + 3 worker/DST sites read from `state["uns_context"]`.
- `vendor_name_from_text` and `_looks_like_model_number` removed from
  `engine.py`, `rag_worker.py`, `dialogue_state.py`, `dialogue_acts.py`
  imports.
- `tests/test_uns_resolver.py` ≥ 30 cases pass.
- `tests/eval/bot_regression.py` does not regress vs main.
- Net negative LOC.
- `ruff check` passes.
