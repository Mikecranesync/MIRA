# OCR Regime — Permanent Repair & Keep-Alive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every OCR lane in MIRA deterministic-first, alive in production, provenance-tagged, and impossible to break silently again.

**Architecture:** Tesseract (already shipped in the bot image, already adapted in `printsense/xref_extractor.py::ocr_tokens`) becomes the **explicit deterministic floor** that feeds `ocr_items`/`ocr_tokens` live; the dead hardcoded glm-ocr/Open-WebUI lane is retired and replaced by a router-based model-OCR lane that is **off by default**; every `vision_data` carries `ocr_source` provenance end-to-end (autoeval + interactions); a boot-time lane self-check, a CI recall gate on fixture ground truth, and a scheduled staging probe make lane death loud within hours instead of silent for weeks.

**Tech Stack:** Python 3.12, pytesseract/Pillow (already in `mira-bots/telegram/requirements.txt`), httpx, existing InferenceRouter cascade (Groq→Cerebras→Together gemma-3n), pytest, GitHub Actions.

## Corrected diagnosis (supersedes the 2026-07-18 chat report — one claim was wrong)

| Piece | Real state (verified in code 2026-07-18) |
|---|---|
| Tesseract binary | ✅ **IN the bot image** — `mira-bots/telegram/Dockerfile:3` installs `tesseract-ocr`. (Earlier chat claim "not in the image" was wrong — grepped a nonexistent `mira-bots/Dockerfile`.) |
| pytesseract + Pillow | ✅ in `mira-bots/telegram/requirements.txt` (`pytesseract>=0.3.13`, `Pillow>=12.2.0`) |
| `_ocr_extract` (tesseract_text) | ✅ works live — but produces a **string** consumed only as `ctx["ocr_text"]` (`engine.py:2541`). No deterministic consumer reads it. |
| `_call_ocr` (feeds `ocr_items`) | ❌ **DEAD live** — bypasses the router, POSTs `http://mira-core:8080` (default `OPENWEBUI_BASE_URL`) for model `glm-ocr:latest` (default `GLM_OCR_MODEL`); neither var is set in stg Doppler / VPS compose / env-vars.md; the VPS has no such model; exception swallowed by `asyncio.gather(return_exceptions=True)` → `ocr_items=[]` every live photo turn. |
| `ocr_tokens` (bboxes) | ❌ never emitted by the live path at all — only fixtures (`PrecomputedVision`) and `rebuild_vision_data` produce it, yet `ingest_print_photo` already consumes it (`print_workspace.py:292`) and EvidenceAnswer renders honest bbox coordinates from it. |
| `xref_extractor.ocr_tokens(image_bytes)` | ✅ existing Tesseract `image_to_data` adapter returning `[{text, bbox, line}]`, raising explicit `OcrUnavailable` — proven 3/3 vs vision 0/3 in the degraded-mode program (PRs #2730–#2739). |
| Consumers starved by `ocr_items=[]` | `printsense/deterministic_qa.py::_ocr_items` (the $0 UNSEEN fast-path), `print_workspace.ingest_print_photo` (live persistent-Q&A observations), autoeval evidence lanes, `_classify_photo` density signal. |
| gemma-3n itself | ✅ works (classification prose via router). Separate defect: theory step truncation at `engine.py:937` (`max_tokens=1200`). Weak at schematic OCR (UNSEEN benchmark) — never make it the floor. |
| Paid interpreter (`printsense/interpret.py`) | Cleanly off (OpenAI quota exhausted). Latent effort-mapping bug documented in memory (minimal/xhigh handling). Guarded file — owner-gated. |
| Docling KB-ingest OCR | ❌ prod kb_growth broken: docling container removed, pipeline still calls `:5001` (`mira-ingest/main.py:930` fallback path; `mira-crawler/ingest/converter.py:279 extract_from_docling`). pdfplumber→Tika fallback chain exists (`extract_from_pdf_with_fallback:254`). |

**Root cause of the silence:** the OCR floor's failure mode was a per-turn WARNING log nobody reads, with no provenance in persisted rows, no boot check, no CI/staging probe, and its config existing only as code defaults valid in one dev compose file (the enumerated-compose-env-block trap, third occurrence).

## Global Constraints

- **Zero paid inference for dev/debug** (`.claude/rules/zero-token-architecture.md`): every test hermetic; run pytest with `env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY`; Together free-tier probes only when a task explicitly declares them.
- **`py` works, `python` is broken** on the dev machine — always `py -m pytest`, `py -m ruff`.
- **Never mix test trees in one invocation**: `py -m pytest mira-bots/tests -q` and `py -m pytest tests/ -q` SEPARATELY (conftest collision).
- **Never-calibrate guarded files** (must not be edited by any task): `printsense/benchmarks/single_photo_cases.py` (content), `session_cases.py`, `robustness_transforms.py`, `mira-bots/shared/print_translator.py`, `printsense/interpret.py` (PR-F touches interpret.py ONLY with explicit owner sign-off).
- **Enumerated compose env-block trap**: every new env var needs rows in `docker-compose.staging-vps.yml` + `docker-compose.saas.yml` (+ dev compose where relevant) AND `docs/env-vars.md`, or the env-drift Architecture gate fails. Numeric env vars parse via `int(os.getenv(X) or "default")` (compose `${VAR:-}` delivers empty strings).
- **Version law**: each PR bumps `/VERSION` (claim next-free at commit — concurrent sessions land constantly; `git fetch origin main` first) + `docs/CHANGELOG.md` entry.
- **ruff 0.9.10**: `py -m ruff check` + `py -m ruff format` on every touched file.
- **Worktree hygiene**: execute in a FRESH worktree/branch off `origin/main` (e.g. `C:\wt-ocr`), NOT `C:\wt-ps3` (that branch is PR #2798, spec-frozen DO-NOT-MERGE). Never stage foreign files. Default checkout `~\Documents\GitHub\MIRA` carries foreign WIP — don't work there.
- **engine.py edits** require `codegraph_impact` on the touched symbol first (repo CodeGraph rule); run `tools/codegraph-preflight.sh` before coding.
- **Merge authority**: each PR goes green → report → Mike merges/directs (program law: no merge/deploy without Mike).
- **PR ordering**: A → B → C are sequential (C's monitoring asserts A's provenance). D is independent. E independent. F blocked on Mike (credits + sign-off).

## File Structure (what each PR creates/modifies)

```
PR-A (the bridge — repair):
  M printsense/xref_extractor.py            # + public line_items() helper (NOT guarded)
  M mira-bots/shared/workers/vision_worker.py  # bridge, router-based model lane, ocr_source
  M mira-bots/shared/engine.py              # album-failure dict gains ocr_source key (1 line)
  M mira-bots/telegram/bot.py               # boot lane self-check log
  M mira-bots/telegram/printsense_testkit.py   # /printsense_test ocr status surface
  M docker-compose.staging-vps.yml, docker-compose.saas.yml, mira-bots/docker-compose.yml
  M docs/env-vars.md
  C mira-bots/tests/test_vision_worker_ocr_floor.py
  M VERSION, docs/CHANGELOG.md
PR-B (calibration + CI gate):
  C printsense/benchmarks/ocr_recall_bench.py
  C tests/printsense/test_ocr_recall_gate.py
  M .github/workflows/ci.yml               # dedicated job WITH tesseract (existing job at
                                           # ci.yml:264 keeps pytesseract intentionally absent)
  M VERSION, docs/CHANGELOG.md
PR-C (keep-alive):
  M mira-bots/shared/print_autoeval.py     # ocr_floor_dead rule (env-gated severity)
  M .github/workflows/printsense-staging-e2e.yml  # scheduled in-container OCR probe job
  C docs/runbooks/ocr-regime.md
  M CLAUDE.md (one pointer line), wiki/hot.md
  M VERSION, docs/CHANGELOG.md
PR-D (theory cap): M mira-bots/shared/engine.py:937 + compose rows + env-vars.md + VERSION/CHANGELOG
PR-E (docling reconcile): decision memo + chosen fix in mira-ingest/main.py or compose
PR-F (paid interpreter — Mike-gated): M printsense/interpret.py effort map + acceptance run
```

---

## PR-A — The Bridge: Tesseract floor feeds `ocr_items`/`ocr_tokens` live

### Task A1: Public `line_items()` helper in xref_extractor

**Files:**
- Modify: `printsense/xref_extractor.py` (after `_join_lines`, ~line 109)
- Test: `tests/printsense/test_xref_extractor.py` (append)

**Interfaces:**
- Consumes: existing private `_join_lines(tokens: list[dict]) -> list[dict]`
- Produces: `line_items(tokens: list[dict]) -> list[str]` — order-stable, deduped, joined-line strings **plus** singleton tokens (exactly `_join_lines` coverage). Task A4 imports this.

- [ ] **Step 1: Write the failing test** (append to `tests/printsense/test_xref_extractor.py`):

```python
def test_line_items_joins_lines_and_keeps_singletons_deduped():
    from printsense.xref_extractor import line_items

    tokens = [
        {"text": "A1", "bbox": [10, 10, 20, 18], "line": (0, 1)},
        {"text": "A2", "bbox": [24, 10, 34, 18], "line": (0, 1)},
        {"text": "-K17", "bbox": [40, 30, 70, 38], "line": (0, 2)},
    ]
    items = line_items(tokens)
    assert "A1 A2" in items          # joined line string
    assert "A1" in items and "A2" in items  # singletons preserved
    assert "-K17" in items
    assert items.count("-K17") == 1  # single-token line deduped (join == singleton)
    assert items.index("A1 A2") < items.index("-K17")  # order stable by line


def test_line_items_empty():
    from printsense.xref_extractor import line_items

    assert line_items([]) == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd C:/wt-ocr && env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY py -m pytest tests/printsense/test_xref_extractor.py -q -k line_items`
Expected: FAIL — `ImportError: cannot import name 'line_items'`

- [ ] **Step 3: Implement** (in `printsense/xref_extractor.py`, directly after `_join_lines`):

```python
def line_items(tokens: list[dict]) -> list[str]:
    """OCR tokens -> flat evidence strings for ``vision_data['ocr_items']``.

    Joined per-line strings first (so multi-token labels like ``A1 A2``
    survive), then singleton tokens — the same coverage `_join_lines`
    gives the lexical layer — order-stable and deduplicated.
    """
    seen: set[str] = set()
    out: list[str] = []
    for entry in _join_lines(tokens):
        text = entry["text"].strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out
```

- [ ] **Step 4: Run to verify pass**: same command. Expected: 2 passed.
- [ ] **Step 5: Regression check the module**: `env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY py -m pytest tests/printsense/test_xref_extractor.py -q` — all green (the file's existing tests untouched).
- [ ] **Step 6: Commit**

```bash
git add printsense/xref_extractor.py tests/printsense/test_xref_extractor.py
git commit -m "feat(printsense): line_items() — public OCR-token->evidence-strings helper"
```

### Task A2: Extract the model-OCR reply parser as a pure function

**Files:**
- Modify: `mira-bots/shared/workers/vision_worker.py` (`_call_ocr` body, lines ~408–434)
- Test: Create `mira-bots/tests/test_vision_worker_ocr_floor.py`

**Interfaces:**
- Produces: module-level `def parse_ocr_reply(raw: str) -> list[str]` in `vision_worker.py` — the EXACT current parsing block (numbered-list stripping, code-fence/JSON-noise skip, markdown-table cell extraction, bold/italic stripping). Tasks A3 uses it; behavior-preserving refactor.

- [ ] **Step 1: Write the failing test** (new file `mira-bots/tests/test_vision_worker_ocr_floor.py`):

```python
"""OCR floor + provenance tests for VisionWorker (OCR-regime repair PR-A)."""

from shared.workers.vision_worker import parse_ocr_reply


class TestParseOcrReply:
    def test_numbered_list(self):
        raw = "1. -K17\n2. A1 A2\n3. 24VDC"
        assert parse_ocr_reply(raw) == ["-K17", "A1 A2", "24VDC"]

    def test_markdown_table_and_fences(self):
        raw = "```\n| -F12 | fuse |\n|:--|:--|\n{\n1. -S1\n```"
        items = parse_ocr_reply(raw)
        assert "-F12" in items and "fuse" in items and "-S1" in items
        assert "{" not in items

    def test_empty(self):
        assert parse_ocr_reply("") == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd C:/wt-ocr && env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY py -m pytest mira-bots/tests/test_vision_worker_ocr_floor.py -q`
Expected: FAIL — `ImportError: cannot import name 'parse_ocr_reply'`

- [ ] **Step 3: Implement** — move the body of `_call_ocr`'s parsing loop (current lines 409–434, from `items = []` through `return items`) verbatim into a module-level function; `_call_ocr` calls it:

```python
def parse_ocr_reply(raw: str) -> list[str]:
    """Model OCR reply -> clean text items (numbered list / markdown tolerant)."""
    items = []
    for line in raw.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("```") or line in ("{", "}", "[", "]"):
            continue
        if re.match(r"^[|:\-\s]+$", line):
            continue
        if line.startswith("|") and line.endswith("|"):
            cells = [c.strip() for c in line.split("|") if c.strip()]
            for cell in cells:
                cell = re.sub(r"[*`]", "", cell).strip()
                if cell and not cell.startswith("```"):
                    items.append(cell)
            continue
        line = re.sub(r"[*`]", "", line)
        cleaned = re.sub(r"^\d+[\.\)\-\s]+", "", line).strip()
        if cleaned and not cleaned.startswith("```"):
            items.append(cleaned)
    return items
```

(Inside `_call_ocr`, the block becomes `return parse_ocr_reply(raw)`.)

- [ ] **Step 4: Run to verify pass**: same command. Expected: 3 passed.
- [ ] **Step 5: Commit**

```bash
git add mira-bots/shared/workers/vision_worker.py mira-bots/tests/test_vision_worker_ocr_floor.py
git commit -m "refactor(bots): extract parse_ocr_reply — pure model-OCR reply parser"
```

### Task A3: Retire the hardcoded glm-ocr lane — router-based, off by default

**Files:**
- Modify: `mira-bots/shared/workers/vision_worker.py` (`_call_ocr`, lines ~364–408)
- Modify: `mira-bots/docker-compose.yml:44` (replace `GLM_OCR_MODEL` row with `OCR_MODEL_LANE`)
- Test: `mira-bots/tests/test_vision_worker_ocr_floor.py` (append)

**Interfaces:**
- Consumes: module-global `_inference_router` (already imported for `_call_vision`), `parse_ocr_reply` (A2).
- Produces: `_call_ocr(photo_b64) -> list[str]` that returns `[]` immediately unless `OCR_MODEL_LANE=on`; when on, sends the SAME numbered-list prompt through `_inference_router.complete(messages)` (identical shape to `_call_vision` — image + text content blocks). No `openwebui_url`/`GLM_OCR_MODEL` dependency remains.

- [ ] **Step 1: Write the failing tests** (append):

```python
import pytest
from unittest.mock import AsyncMock, patch

from shared.workers.vision_worker import VisionWorker


def _worker() -> VisionWorker:
    return VisionWorker("http://unused:9", "", "unused-model")


class TestModelOcrLane:
    @pytest.mark.asyncio
    async def test_lane_off_by_default_no_network(self, monkeypatch):
        monkeypatch.delenv("OCR_MODEL_LANE", raising=False)
        with patch("shared.workers.vision_worker._inference_router") as router:
            router.complete = AsyncMock()
            assert await _worker()._call_ocr("aGk=") == []
            router.complete.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_lane_on_routes_through_router(self, monkeypatch):
        monkeypatch.setenv("OCR_MODEL_LANE", "on")
        with patch("shared.workers.vision_worker._inference_router") as router:
            router.complete = AsyncMock(return_value=("1. -K17\n2. A1", {}))
            items = await _worker()._call_ocr("aGk=")
        assert items == ["-K17", "A1"]
        (messages,), _ = router.complete.await_args
        assert messages[0]["content"][0]["type"] == "image_url"

    @pytest.mark.asyncio
    async def test_lane_on_router_empty_returns_empty(self, monkeypatch):
        monkeypatch.setenv("OCR_MODEL_LANE", "on")
        with patch("shared.workers.vision_worker._inference_router") as router:
            router.complete = AsyncMock(return_value=("", {}))
            assert await _worker()._call_ocr("aGk=") == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY py -m pytest mira-bots/tests/test_vision_worker_ocr_floor.py -q -k ModelOcrLane`
Expected: FAIL (`test_lane_off...` fails — current code POSTs via httpx and raises on connect; `test_lane_on...` fails — no router path).

- [ ] **Step 3: Implement** — replace `_call_ocr` entirely:

```python
    async def _call_ocr(self, photo_b64: str) -> list:
        """Model-OCR enrichment lane (OFF by default — the deterministic floor
        is Tesseract, see ``process``). When ``OCR_MODEL_LANE=on``, sends the
        numbered-list OCR prompt through the inference router (same cascade
        as ``_call_vision``); free-tier VL models misread dense schematics
        (2026-07-17 UNSEEN benchmark), so this lane supplements the floor —
        it must never replace it."""
        if os.environ.get("OCR_MODEL_LANE", "off").strip().lower() != "on":
            return []

        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{photo_b64}"},
                    },
                    {
                        "type": "text",
                        "text": (
                            "You are a precision OCR engine. Extract ALL text visible "
                            "in this image exactly as printed. Preserve wire numbers, "
                            "part numbers, terminal labels, fault codes, and all "
                            "alphanumeric content. Output as a plain numbered list — "
                            "no code blocks, no JSON, no markdown formatting. "
                            "Each line: a number, a period, then the extracted text. "
                            "NEVER interpret, explain, or add content not visible. "
                            "If text is unclear write [UNCLEAR]."
                        ),
                    },
                ],
            }
        ]
        content, _usage = await _inference_router.complete(messages)
        if not content:
            return []
        return parse_ocr_reply(content)
```

- [ ] **Step 4: Run to verify pass**: same command. Expected: 3 passed.
- [ ] **Step 5: Update the dev compose row** — `mira-bots/docker-compose.yml:44`: replace `GLM_OCR_MODEL: ${GLM_OCR_MODEL:-glm4v:9b-q4_0}` with `OCR_MODEL_LANE: ${OCR_MODEL_LANE:-off}`.
- [ ] **Step 6: Grep for dead references**: `grep -rn "GLM_OCR_MODEL" --include="*.py" --include="*.yml" --include="*.md" .` → only historical docs/CHANGELOG hits may remain; no live code/compose references.
- [ ] **Step 7: Commit**

```bash
git add mira-bots/shared/workers/vision_worker.py mira-bots/tests/test_vision_worker_ocr_floor.py mira-bots/docker-compose.yml
git commit -m "fix(bots): retire dead glm-ocr lane — model OCR routes through the cascade, off by default"
```

### Task A4: The bridge — Tesseract floor in `VisionWorker.process()`

**Files:**
- Modify: `mira-bots/shared/workers/vision_worker.py` (`process`, lines ~251–302; `_ocr_extract` retired into the new single-pass path)
- Test: `mira-bots/tests/test_vision_worker_ocr_floor.py` (append)

**Interfaces:**
- Consumes: `printsense.xref_extractor.ocr_tokens(image_bytes)` + `OcrUnavailable` + `line_items(tokens)` (A1); `_call_ocr` (A3).
- Produces: `process()` return dict gains three keys ALL downstream code may rely on:
  - `ocr_tokens: list[dict]` — `[{text, bbox:[x0,y0,x1,y1], line}]` from Tesseract (deterministic; `[]` when unavailable)
  - `ocr_source: str` — `"tesseract" | "tesseract+model" | "model" | "none"`
  - `ocr_items: list[str]` — floor = `line_items(ocr_tokens)`; model items appended (deduped) only when the model lane returned any
  - `tesseract_text: str` — now derived from the same single Tesseract pass (newline-joined line strings), preserving the `engine.py:2541 ctx["ocr_text"]` contract without a second OCR run.

- [ ] **Step 1: Write the failing tests** (append):

```python
_TOKENS = [
    {"text": "-K17", "bbox": [640, 100, 700, 118], "line": (0, 1)},
    {"text": "A1", "bbox": [644, 132, 660, 144], "line": (0, 2)},
    {"text": "A2", "bbox": [666, 132, 682, 144], "line": (0, 2)},
]


def _patched_worker(monkeypatch, tokens=None, model_items=None):
    """Worker with vision prose + tesseract adapter + model lane all stubbed."""
    w = _worker()
    monkeypatch.setattr(
        "shared.workers.vision_worker.VisionWorker._call_vision",
        AsyncMock(return_value="electrical drawing, ladder logic"),
    )
    if tokens is None:
        from printsense.xref_extractor import OcrUnavailable

        def _raise(_b):
            raise OcrUnavailable("no binary")

        monkeypatch.setattr("shared.workers.vision_worker._tesseract_tokens_impl", _raise)
    else:
        monkeypatch.setattr(
            "shared.workers.vision_worker._tesseract_tokens_impl", lambda _b: tokens
        )
    monkeypatch.setattr(
        "shared.workers.vision_worker.VisionWorker._call_ocr",
        AsyncMock(return_value=model_items or []),
    )
    return w


class TestOcrFloor:
    @pytest.mark.asyncio
    async def test_tesseract_floor_feeds_items_tokens_source(self, monkeypatch):
        w = _patched_worker(monkeypatch, tokens=_TOKENS)
        out = await w.process("aGk=", "what is this")
        assert out["ocr_source"] == "tesseract"
        assert out["ocr_tokens"] == _TOKENS
        assert "-K17" in out["ocr_items"] and "A1 A2" in out["ocr_items"]
        assert "-K17" in out["tesseract_text"]

    @pytest.mark.asyncio
    async def test_both_lanes_dead_is_honest_none(self, monkeypatch):
        w = _patched_worker(monkeypatch, tokens=None, model_items=[])
        out = await w.process("aGk=", "what is this")
        assert out["ocr_source"] == "none"
        assert out["ocr_items"] == [] and out["ocr_tokens"] == []
        assert out["classification"]  # classification still works off vision prose

    @pytest.mark.asyncio
    async def test_model_lane_supplements_never_replaces(self, monkeypatch):
        w = _patched_worker(monkeypatch, tokens=_TOKENS, model_items=["-F12", "-K17"])
        out = await w.process("aGk=", "what is this")
        assert out["ocr_source"] == "tesseract+model"
        assert "-F12" in out["ocr_items"]           # model addition kept
        assert out["ocr_items"].count("-K17") == 1  # deduped, floor first

    @pytest.mark.asyncio
    async def test_model_only_when_floor_unavailable(self, monkeypatch):
        w = _patched_worker(monkeypatch, tokens=None, model_items=["-F12"])
        out = await w.process("aGk=", "what is this")
        assert out["ocr_source"] == "model"
        assert out["ocr_items"] == ["-F12"] and out["ocr_tokens"] == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY py -m pytest mira-bots/tests/test_vision_worker_ocr_floor.py -q -k OcrFloor`
Expected: FAIL — `AttributeError: ... has no attribute '_tesseract_tokens_impl'` / KeyError `ocr_source`.

- [ ] **Step 3: Implement.** In `vision_worker.py`:

(a) module level, near the top with the other helpers:

```python
def _tesseract_tokens_impl(image_bytes: bytes) -> list[dict]:
    """Deterministic word boxes via the shared printsense adapter.

    Raises printsense.xref_extractor.OcrUnavailable when the binary or
    pytesseract is absent (local Windows dev) — callers degrade honestly.
    """
    from printsense.xref_extractor import ocr_tokens

    return ocr_tokens(image_bytes)
```

(b) replace the body of `process()` (keep the docstring, extend the "Returns" section with the three new keys) so the fan-out and assembly become:

```python
        import asyncio

        vision_coro = self._call_vision(photo_b64, message)
        ocr_coro = self._call_ocr(photo_b64)

        def _floor() -> list[dict]:
            from printsense.xref_extractor import OcrUnavailable

            try:
                return _tesseract_tokens_impl(base64.b64decode(photo_b64))
            except OcrUnavailable as exc:
                logger.warning("tesseract floor unavailable: %s", exc)
                return []
            except Exception as exc:  # noqa: BLE001 — floor failure must not eat the turn
                logger.warning("tesseract floor error: %s", exc)
                return []

        floor_coro = asyncio.to_thread(_floor)
        results = await asyncio.gather(
            vision_coro, ocr_coro, floor_coro, return_exceptions=True
        )

        vision_result = results[0] if not isinstance(results[0], Exception) else message
        model_items = results[1] if not isinstance(results[1], Exception) else []
        ocr_tokens_ = results[2] if not isinstance(results[2], Exception) else []

        if isinstance(results[0], Exception):
            logger.error("Vision call failed: %s", results[0])
        if isinstance(results[1], Exception):
            logger.warning("model-OCR lane failed: %s", results[1])

        from printsense.xref_extractor import line_items

        floor_items = line_items(ocr_tokens_)
        ocr_items = list(floor_items)
        for item in model_items if isinstance(model_items, list) else []:
            if item not in ocr_items:
                ocr_items.append(item)

        if floor_items and len(ocr_items) > len(floor_items):
            ocr_source = "tesseract+model"
        elif floor_items:
            ocr_source = "tesseract"
        elif ocr_items:
            ocr_source = "model"
        else:
            ocr_source = "none"

        line_texts = [e["text"] for e in ocr_tokens_] if ocr_tokens_ else []
        tesseract_text = "\n".join(floor_items) if floor_items else ""

        classify_result = self._classify_photo(str(vision_result), ocr_items, message)
        classification = classify_result["type"]
        classify_confidence = classify_result["confidence"]
        logger.info(
            "Photo classified as %s (confidence=%.2f, %d OCR items, ocr_source=%s)",
            classification,
            classify_confidence,
            len(ocr_items),
            ocr_source,
        )

        drawing_type = None
        drawing_confidence = 0.0
        if classification == "ELECTRICAL_PRINT":
            dt_result = self._detect_drawing_type(str(vision_result))
            drawing_type = dt_result["type"]
            drawing_confidence = dt_result["confidence"]

        return {
            "classification": classification,
            "classification_confidence": classify_confidence,
            "vision_result": vision_result,
            "ocr_items": ocr_items,
            "ocr_tokens": ocr_tokens_,
            "ocr_source": ocr_source,
            "tesseract_text": tesseract_text,
            "drawing_type": drawing_type,
            "drawing_type_confidence": drawing_confidence,
        }
```

(c) delete `_ocr_extract` **only if** `grep -rn "_ocr_extract" mira-bots/ --include="*.py"` shows no other caller; otherwise leave it and note in the PR.

(Note: `line_texts` is intentionally unused scaffolding — remove it before commit; listed here so the implementer doesn't re-derive per-token text joins.)

- [ ] **Step 4: Run to verify pass**: `-k OcrFloor` → 4 passed; then the whole file → all passed.
- [ ] **Step 5: Regression sweep the direct consumers**:

```
env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY py -m pytest mira-bots/tests/test_print_workspace_followup.py mira-bots/tests/test_print_workspace_store.py mira-bots/tests/test_print_workspace_golden.py mira-bots/tests/test_ask_api_workspace.py mira-bots/tests/test_print_turn_persistence.py -q
```

Expected: all green (fixtures use `PrecomputedVision`, untouched by the bridge). Then `py -m pytest tests/printsense -q` (536 expected) and `py -m printsense.grader_gate` (GATE PASS).

- [ ] **Step 6: Commit**

```bash
git add mira-bots/shared/workers/vision_worker.py mira-bots/tests/test_vision_worker_ocr_floor.py
git commit -m "fix(bots): Tesseract floor bridges into ocr_items/ocr_tokens with ocr_source provenance"
```

### Task A5: Album-path failure dict carries the new shape (engine.py, one edit)

**Files:**
- Modify: `mira-bots/shared/engine.py:1868-1876` (the `vresult` fallback literal)

**Interfaces:** Produces: every album-path `vresult` (success or failure) has `ocr_tokens`/`ocr_source` keys, so multi-photo consumers never KeyError.

- [ ] **Step 1: CodeGraph discipline**: run `tools/codegraph-preflight.sh "album vision fallback shape"`; if READY, `codegraph_impact` on `_interpret_print_anthropic_pages` (the containing method) — expect no surprises (additive keys in a literal).
- [ ] **Step 2: Edit** the literal at `engine.py:1868-1876` — add two keys:

```python
                    vresult = {
                        "classification": "UNCLEAR",
                        "classification_confidence": 0.0,
                        "vision_result": "unclear",
                        "ocr_items": [],
                        "ocr_tokens": [],
                        "ocr_source": "none",
                        "tesseract_text": "",
                        "drawing_type": None,
                        "drawing_type_confidence": 0.0,
                    }
```

- [ ] **Step 3: Verify no other literal builders**: `grep -rn '"tesseract_text"' mira-bots/shared --include="*.py"` → each construction site (engine.py fallback, `visual/demo.py:57`, fixtures) either gains the keys or provably never flows into `ocr_source` consumers (demo.py is offline demo — add the keys anyway for shape honesty).
- [ ] **Step 4: Run**: `env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY py -m pytest mira-bots/tests -q --continue-on-collection-errors` — no NEW failures vs the documented pre-existing set (14 fails + 2 collection errors as of 2026-07-18).
- [ ] **Step 5: Commit**

```bash
git add mira-bots/shared/engine.py mira-bots/shared/visual/demo.py
git commit -m "fix(engine): album-path vision fallback carries ocr_tokens/ocr_source shape"
```

### Task A6: Boot-time OCR lane self-check + phone-visible status

**Files:**
- Modify: `mira-bots/telegram/bot.py` (immediately after the `engine = Supervisor(...)` block at :143-151)
- Modify: `mira-bots/telegram/printsense_testkit.py` (register `ocr` subcommand alongside the existing `/printsense_test` lanes — read its existing subcommand dispatch first and mirror it)
- Test: `mira-bots/tests/test_vision_worker_ocr_floor.py` (append)

**Interfaces:**
- Produces: `shared.workers.vision_worker.ocr_lane_report() -> dict` — `{"tesseract": {"available": bool, "version": str|None}, "model_lane": "on"|"off", "expected_floor": bool, "verdict": "ok"|"DEGRADED"|"DEAD"}`. bot.py logs it once at boot (`OCR_LANES <json>`); testkit renders it for `/printsense_test ocr`.

- [ ] **Step 1: Write the failing tests** (append):

```python
class TestOcrLaneReport:
    def test_report_shape_when_floor_unavailable(self, monkeypatch):
        from shared.workers import vision_worker

        monkeypatch.setenv("OCR_EXPECT_TESSERACT", "1")
        monkeypatch.delenv("OCR_MODEL_LANE", raising=False)

        def _raise():
            raise RuntimeError("tesseract not installed")

        monkeypatch.setattr(vision_worker, "_tesseract_version_impl", _raise)
        report = vision_worker.ocr_lane_report()
        assert report["tesseract"]["available"] is False
        assert report["model_lane"] == "off"
        assert report["expected_floor"] is True
        assert report["verdict"] == "DEAD"

    def test_report_ok(self, monkeypatch):
        from shared.workers import vision_worker

        monkeypatch.setenv("OCR_EXPECT_TESSERACT", "1")
        monkeypatch.setattr(vision_worker, "_tesseract_version_impl", lambda: "5.3.0")
        report = vision_worker.ocr_lane_report()
        assert report["tesseract"] == {"available": True, "version": "5.3.0"}
        assert report["verdict"] == "ok"

    def test_not_expected_is_degraded_not_dead(self, monkeypatch):
        from shared.workers import vision_worker

        monkeypatch.delenv("OCR_EXPECT_TESSERACT", raising=False)

        def _raise():
            raise RuntimeError("no binary")

        monkeypatch.setattr(vision_worker, "_tesseract_version_impl", _raise)
        assert vision_worker.ocr_lane_report()["verdict"] == "DEGRADED"
```

- [ ] **Step 2: Run to verify fail** (`-k OcrLaneReport`) — ImportError/AttributeError expected.
- [ ] **Step 3: Implement** in `vision_worker.py` (module level):

```python
def _tesseract_version_impl() -> str:
    import pytesseract

    return str(pytesseract.get_tesseract_version())


def ocr_lane_report() -> dict:
    """One-shot health report for every OCR lane. Logged at bot boot and
    rendered by /printsense_test ocr — the mechanism that makes a dead
    floor loud instead of a per-turn WARNING nobody reads (the 2026-07
    glm-ocr lane died silently for weeks)."""
    expected = (os.environ.get("OCR_EXPECT_TESSERACT", "0").strip() or "0") == "1"
    model_lane = (
        "on"
        if os.environ.get("OCR_MODEL_LANE", "off").strip().lower() == "on"
        else "off"
    )
    try:
        version: str | None = _tesseract_version_impl()
        available = True
    except Exception:  # noqa: BLE001 — absence is a report state, not an error
        version = None
        available = False
    if available:
        verdict = "ok"
    elif expected:
        verdict = "DEAD"
    else:
        verdict = "DEGRADED"
    return {
        "tesseract": {"available": available, "version": version},
        "model_lane": model_lane,
        "expected_floor": expected,
        "verdict": verdict,
    }
```

In `bot.py`, directly after the `engine = Supervisor(...)` block:

```python
_ocr_report = __import__("json").dumps(vision_worker_lane_report := __import__(
    "shared.workers.vision_worker", fromlist=["ocr_lane_report"]
).ocr_lane_report())
logger.info("OCR_LANES %s", _ocr_report)
```

(Implementer: replace that with a plain top-of-file `from shared.workers.vision_worker import ocr_lane_report` + `logger.info("OCR_LANES %s", json.dumps(ocr_lane_report()))` — match bot.py's existing import style; the compressed form above only documents intent.)

In `printsense_testkit.py`: read the existing `/printsense_test` subcommand dispatch and add an `ocr` branch that replies with the report fields, one per line, verdict first (e.g. `OCR: ok — tesseract 5.3.0, model lane off, floor expected`). Follow the existing reply-formatting helpers in that file exactly.

- [ ] **Step 4: Run to verify pass** (`-k OcrLaneReport`) → 3 passed.
- [ ] **Step 5: Commit**

```bash
git add mira-bots/shared/workers/vision_worker.py mira-bots/telegram/bot.py mira-bots/telegram/printsense_testkit.py mira-bots/tests/test_vision_worker_ocr_floor.py
git commit -m "feat(bots): boot-time OCR lane self-check + /printsense_test ocr status"
```

### Task A7: Compose + env-vars rows (the trap, closed)

**Files:**
- Modify: `docker-compose.staging-vps.yml` (bot service env block, near :398), `docker-compose.saas.yml` (near :312), `mira-bots/docker-compose.yml`
- Modify: `docs/env-vars.md`

- [ ] **Step 1:** Add to BOTH VPS compose bot env blocks (staging-vps + saas):

```yaml
      OCR_MODEL_LANE: ${OCR_MODEL_LANE:-off}
      OCR_EXPECT_TESSERACT: ${OCR_EXPECT_TESSERACT:-1}
```

(dev compose already updated in A3; add `OCR_EXPECT_TESSERACT: ${OCR_EXPECT_TESSERACT:-0}` there — local dev machines lack the binary.)

- [ ] **Step 2:** Add two rows to `docs/env-vars.md` matching its table format: `OCR_MODEL_LANE` (off|on — model-OCR enrichment via the cascade; floor is Tesseract) and `OCR_EXPECT_TESSERACT` (1 in containers; boot check reports DEAD if floor missing).
- [ ] **Step 3:** Run whatever env-drift check the Architecture gate uses locally if available (`py -m pytest tests/test_architecture.py -q`), plus `grep -n "OCR_" docker-compose.staging-vps.yml docker-compose.saas.yml docs/env-vars.md` to eyeball all three present.
- [ ] **Step 4: Commit**

```bash
git add docker-compose.staging-vps.yml docker-compose.saas.yml mira-bots/docker-compose.yml docs/env-vars.md
git commit -m "chore(compose): OCR_MODEL_LANE + OCR_EXPECT_TESSERACT mapped everywhere + env-vars rows"
```

### Task A8: Live-shape integration test — bridge feeds the persistent workspace with real coordinates

**Files:**
- Test: `mira-bots/tests/test_vision_worker_ocr_floor.py` (append)

**Interfaces:** Consumes `ingest_print_photo` (Package A) + the A4 `process()` shape. Proves the OCR-regime repair lights up live workspace observations with bboxes (the thing PR #2798's live caveat is waiting on).

- [ ] **Step 1: Write the test** (hermetic idiom from `test_print_turn_persistence.py` — tmp `MIRA_DB_PATH`, `delenv NEON_DATABASE_URL`, InMemory store):

```python
class TestBridgeFeedsWorkspace:
    @pytest.mark.asyncio
    async def test_live_shape_vision_data_creates_bbox_observations(
        self, monkeypatch, tmp_path
    ):
        monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira.db"))
        monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
        from shared import print_workspace

        w = _patched_worker(monkeypatch, tokens=_TOKENS)
        vision_data = await w.process("aGk=", "what would energize K17?")
        assert vision_data["ocr_source"] == "tesseract"

        adapter = print_workspace.PrecomputedVision(vision_data)
        session_id, tenant_id = await print_workspace.ingest_print_photo(
            chat_id="ocrfloor-chat",
            tenant_id="t-ocrfloor",
            image_bytes=b"png-bytes",
            caption="what would energize K17?",
            vision=adapter,
        )
        service = print_workspace._get_service()
        obs = await service.store.load_observations(
            session_id, tenant_id, active_only=True
        )
        k17 = [o for o in obs if o.raw_value == "-K17"]
        assert k17, "bridge tokens must become workspace observations"
        assert k17[0].bbox == [640, 100, 700, 118]
```

(Implementer: `ingest_print_photo`'s exact signature/kwargs are in `mira-bots/shared/print_workspace.py` — match it; the golden test `test_print_workspace_golden.py` shows a working call. Adjust attribute names (`raw_value`, `bbox`) to the observation model's actual fields as used in `test_print_workspace_store.py`.)

- [ ] **Step 2: Run** — adjust to real field names until it passes GENUINELY (no assert weakening): `-k BridgeFeedsWorkspace`.
- [ ] **Step 3: Commit**

```bash
git add mira-bots/tests/test_vision_worker_ocr_floor.py
git commit -m "test(bots): bridge-to-workspace integration — live OCR floor yields bbox observations"
```

### Task A9: Version, changelog, full verify, PR

- [ ] **Step 1:** `git fetch origin main && git show origin/main:VERSION` → claim next-free minor in `/VERSION` (expect 3.167.0 if #2798 still unmerged — VERIFY at commit time); add `docs/CHANGELOG.md` entry (v3.166.0 style): "OCR regime repair — Tesseract floor bridges into ocr_items/ocr_tokens with provenance; dead glm-ocr lane retired (router-based, off by default); boot self-check + /printsense_test ocr."
- [ ] **Step 2: Full verify** (each command separately):

```
env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY py -m pytest mira-bots/tests -q --continue-on-collection-errors
env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY py -m pytest tests/ -q
py -m pytest tests/printsense -q
py -m printsense.grader_gate
py -m ruff check <every touched file> && py -m ruff format --check <every touched file>
```

Expected: only the documented pre-existing failures (mira-bots: 14F/2 collection errors; tests/: ~99F/47E Windows-env classes); printsense 536 passed; GATE PASS; ruff clean.

- [ ] **Step 3:** Push branch `fix/ocr-regime-floor`, `gh pr create` — body: corrected diagnosis table (from this plan's top), the bridge design, test evidence, rollback (`OCR_MODEL_LANE` stays off; revert = one commit; no schema changes). Report to Mike — **Mike merges**.
- [ ] **Step 4 (post-merge, Mike-directed):** deploy staging (`gh workflow run deploy-staging.yml -f services="mira-bot-telegram"`); verify boot log line via the sanctioned read (`ssh factorylm-prod "docker logs stg-mira-bot-telegram 2>&1 | grep OCR_LANES | tail -1"` — human-run or approved); phone check: send a print photo to @Mira_stagong_bot, then `/printsense_test ocr` → expect `OCR: ok — tesseract 5.x`; a photo turn now logs `ocr_source=tesseract` with a non-zero item count.

---

## PR-B — Calibration bench + CI recall gate (fixture ground truth, $0 forever)

### Task B1: Recall bench over fixture truth

**Files:**
- Create: `printsense/benchmarks/ocr_recall_bench.py`
- Test: `tests/printsense/test_ocr_recall_gate.py`

**Interfaces:**
- Consumes: `printsense.benchmarks.persistent_qa_fixture.BASE` + `page_png(base)` (synthetic K17 sheet with known token strings + bboxes); `printsense.xref_extractor.ocr_tokens` + `line_items`.
- Produces: `recall(base: dict, psm: int | None = None) -> dict` → `{"expected": int, "found": int, "recall": float, "missing": list[str]}` where a fixture token counts as found if its exact text appears in `line_items(ocr_tokens(page_png(base)))` (whitespace-normalized). CLI: `py -m printsense.benchmarks.ocr_recall_bench [--psm N]` prints one line per PSM ∈ {3, 6, 11} plus the winner.

- [ ] **Step 1: Write the bench** (~60 lines; pure; import-guard with `OcrUnavailable` → exit code 3 "tesseract unavailable — run in container/CI").

```python
"""OCR recall bench — Tesseract vs fixture ground truth ($0, deterministic).

The persistent-QA fixture knows exactly which token strings are printed and
where. Recall = |found| / |expected|. Used to (a) pick the default PSM,
(b) gate CI so a Tesseract/config regression can never ship silently."""

from __future__ import annotations

import argparse
import sys


def _norm(s: str) -> str:
    return " ".join(s.split()).upper()


def recall(base: dict, psm: int | None = None) -> dict:
    from printsense.benchmarks.persistent_qa_fixture import page_png
    from printsense.xref_extractor import line_items, ocr_tokens

    png = page_png(base)
    tokens = ocr_tokens(png)  # psm hook: see note below
    found_set = {_norm(t) for t in line_items(tokens)}
    expected = [t["text"] for t in base["tokens"]]
    missing = [t for t in expected if _norm(t) not in found_set]
    return {
        "expected": len(expected),
        "found": len(expected) - len(missing),
        "recall": (len(expected) - len(missing)) / max(1, len(expected)),
        "missing": missing,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--psm", type=int, default=None)
    args = ap.parse_args()
    from printsense.benchmarks.persistent_qa_fixture import BASE
    from printsense.xref_extractor import OcrUnavailable

    try:
        r = recall(BASE, psm=args.psm)
    except OcrUnavailable as exc:
        print(f"tesseract unavailable: {exc}")
        return 3
    print(
        f"psm={args.psm or 'default'} recall={r['recall']:.2f} "
        f"({r['found']}/{r['expected']}) missing={r['missing']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

**PSM note:** `xref_extractor.ocr_tokens` currently has no psm parameter. If PSM sweeps prove valuable, add an optional `psm: int | None = None` keyword to `ocr_tokens` (config passthrough `--psm N`, default None = current behavior — backward compatible, existing callers unchanged). Only do this if the sweep shows ≥0.1 recall spread; otherwise YAGNI, keep the adapter untouched.

- [ ] **Step 2: Run in a tesseract-capable environment** (CI or container; locally prints "unavailable" exit 3 — that's correct). Record the numbers in the PR body.
- [ ] **Step 3: Write the CI gate test** (`tests/printsense/test_ocr_recall_gate.py`):

```python
"""CI gate: Tesseract recall on the synthetic fixture must stay >= floor.

Skips (not fails) where tesseract is absent — the dedicated CI job installs
it; local Windows dev runs skip. The floor value is calibrated evidence:
set it 0.10 below the measured recall at merge time, never above."""

import pytest

from printsense.xref_extractor import OcrUnavailable

RECALL_FLOOR = 0.60  # ADJUST at implementation to (measured - 0.10); see PR body


def test_fixture_recall_floor():
    from printsense.benchmarks.ocr_recall_bench import recall
    from printsense.benchmarks.persistent_qa_fixture import BASE

    try:
        r = recall(BASE)
    except OcrUnavailable:
        pytest.skip("tesseract unavailable in this environment")
    assert r["recall"] >= RECALL_FLOOR, f"OCR recall regressed: {r}"
```

- [ ] **Step 4: Add the CI job** to `.github/workflows/ci.yml` — a NEW job (do NOT touch the existing unit job whose pytesseract absence is intentional per the comment at ci.yml:264):

```yaml
  ocr-recall-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: sudo apt-get update && sudo apt-get install -y --no-install-recommends tesseract-ocr
      - run: pip install pytest pillow pytesseract
      - run: python -m pytest tests/printsense/test_ocr_recall_gate.py -q
```

(Match the workflow's existing checkout/setup action versions and any pip-cache pattern; NEVER rename existing check names — CI-latency program law.)

- [ ] **Step 5:** VERSION next-free + CHANGELOG; push; PR with the measured recall table (psm default/6/11) in the body; Mike merges.

---

## PR-C — Keep-alive: provenance rule, scheduled probe, runbook

### Task C1: Autoeval rule — dead floor is loud in the graded stream

**Files:**
- Modify: `mira-bots/shared/print_autoeval.py` (inside `evaluate_print_turn`, alongside the existing P0 rules at ~:113-205)
- Test: extend the autoeval test file that covers the existing rules (locate via `grep -rln "evaluate_print_turn" mira-bots/tests/`)

**Interfaces:** Consumes `vision_data["ocr_source"]` (PR-A) + env `OCR_EXPECT_TESSERACT`. Produces a flag `{"rule": "ocr_floor_dead", "severity": "P0"}` when a print turn ran with `ocr_source == "none"` while the floor was expected — P0 pushes ntfy via the existing pipeline, so a dead floor pages within one live turn instead of weeks.

- [ ] **Step 1: Failing test** (in the located autoeval test file, matching its fixture style):

```python
def test_ocr_floor_dead_flags_p0_when_expected(monkeypatch):
    monkeypatch.setenv("OCR_EXPECT_TESSERACT", "1")
    result = evaluate_print_turn(
        question="what feeds K17?",
        answer="The workspace has no legible evidence for that.",
        vision_data={"classification": "ELECTRICAL_PRINT", "ocr_items": [], "ocr_source": "none"},
        branch="workspace_followup",
    )
    assert any(f["rule"] == "ocr_floor_dead" and f["severity"] == "P0" for f in result["flags"])


def test_ocr_floor_dead_silent_when_not_expected(monkeypatch):
    monkeypatch.delenv("OCR_EXPECT_TESSERACT", raising=False)
    result = evaluate_print_turn(
        question="what feeds K17?",
        answer="...",
        vision_data={"classification": "ELECTRICAL_PRINT", "ocr_items": [], "ocr_source": "none"},
        branch="workspace_followup",
    )
    assert not any(f["rule"] == "ocr_floor_dead" for f in result["flags"])
```

(Adapt the call/return shape to `evaluate_print_turn`'s real signature at print_autoeval.py:82 and its flags container — read it first; severity key layout per the existing P0 rules at :121/:134/:205.)

- [ ] **Step 2:** Implement the rule next to the existing P0 rules — fire only when `classification == "ELECTRICAL_PRINT"`, `vision_data.get("ocr_source") == "none"`, and `os.environ.get("OCR_EXPECT_TESSERACT", "0") == "1"`. Absent `ocr_source` key (old rows/turns) must NOT fire (backward compatible).
- [ ] **Step 3:** Run the autoeval test file; then the two golden/persistence suites (they call `evaluate_print_turn` per turn — fixtures now carry `ocr_source: "precomputed"`? NO — fixtures lack the key, which by design does NOT fire. Assert no new flags in `test_print_workspace_golden.py` run).
- [ ] **Step 4: Commit** `feat(printsense): autoeval P0 — dead OCR floor pages through the live graded stream`.

### Task C2: Scheduled staging probe

**Files:**
- Modify: `.github/workflows/printsense-staging-e2e.yml` (add a job; scheduled trigger already exists at :24)

- [ ] **Step 1:** Read the workflow's existing jobs for its ssh/secret idiom, then add:

```yaml
  ocr-lane-health:
    runs-on: ubuntu-latest
    steps:
      - name: Probe OCR lanes in the staging bot container
        run: |
          ssh -o StrictHostKeyChecking=accept-new "$VPS_SSH" \
            "docker exec stg-mira-bot-telegram python -c 'import json; from shared.workers.vision_worker import ocr_lane_report as r; rep=r(); print(json.dumps(rep)); raise SystemExit(0 if rep[\"verdict\"]==\"ok\" else 1)'"
```

(Use the workflow's EXISTING secret names/ssh mechanism — do not invent new secrets; if it uses an action for ssh, mirror it. Failure of this job = red scheduled run = existing notification path.)

- [ ] **Step 2:** `actionlint .github/workflows/printsense-staging-e2e.yml` clean; commit `feat(ci): scheduled OCR-lane health probe on staging bot`.

### Task C3: Runbook + pointers

**Files:**
- Create: `docs/runbooks/ocr-regime.md`
- Modify: `wiki/hot.md` (one line), root `CLAUDE.md` Pointers (one line)

- [ ] **Step 1:** Write the runbook: the lane map table (floor/model/paid/docling), the four env vars, "how to check from the phone" (`/printsense_test ocr`), "how to check from a shell" (boot log grep + workflow job), failure modes + first moves (DEAD floor → image build dropped tesseract → check Dockerfile:3 + requirements; recall gate red → PSM/render drift), and the re-enable procedure for the model lane and the paid interpreter (PR-F pointer). One page, no duplication of this plan — link it.
- [ ] **Step 2:** Add the pointer lines; VERSION/CHANGELOG; PR; Mike merges.

---

## PR-D — Theory truncation fix (independent, small)

**Files:**
- Modify: `mira-bots/shared/engine.py:937` (`max_tokens=1200` in the theory/messages call)
- Modify: both VPS compose files + `docs/env-vars.md` (`PRINT_THEORY_MAX_TOKENS`)
- Test: the test file covering that reply path (locate via `grep -rln "max_tokens=1200\|build_theory_messages" mira-bots/tests/`)

- [ ] **Step 1:** `codegraph_impact` on the containing function of engine.py:937 (identify it by reading ±30 lines) — confirm the blast radius is the print-theory reply only.
- [ ] **Step 2: Failing test:** with `PRINT_THEORY_MAX_TOKENS=2222` monkeypatched, assert the router receives `max_tokens=2222`; unset → default `2000`.
- [ ] **Step 3: Implement:**

```python
            messages, max_tokens=int(os.environ.get("PRINT_THEORY_MAX_TOKENS") or "2000"), session_id=str(chat_id)
```

(The `or "2000"` guard is mandatory — compose `${VAR:-}` delivers empty strings; see Global Constraints.)

- [ ] **Step 4:** Compose rows `PRINT_THEORY_MAX_TOKENS: ${PRINT_THEORY_MAX_TOKENS:-2000}` + env-vars.md row. Default 2000 chosen against gemma's live truncation evidence at 1200; free-tier output caps tolerate it — verify with one $0 staging turn post-deploy.
- [ ] **Step 5:** Tests + ruff + VERSION/CHANGELOG + PR. Mike merges; phone-verify one theory answer no longer ends mid-sentence.

---

## PR-E — Docling KB-ingest OCR: reconcile the dead endpoint

**Decision task, then fix. Do not pre-assume the branch.**

- [ ] **Step 1: Inventory (read-only):** `grep -rn "docling\|:5001\|DOCLING" mira-core/mira-ingest/main.py mira-crawler/ --include="*.py" --include="*.yml"` + read `mira-ingest/main.py:900-960` (the OW→docling fallback) and `mira-crawler/ingest/converter.py:254-300` (`extract_from_pdf_with_fallback` = pdfplumber→Tika; `extract_from_docling` guarded import). Confirm from `docker-compose.saas.yml` whether `mira-docling` is still a service.
- [ ] **Step 2: Decision memo to Mike (stop point — his call):**
  - **Option 1 — Excise (recommended if kb_growth volume is the only caller):** make the docling call site availability-checked (one `httpx` HEAD with 2s timeout, or config flag `DOCLING_ENABLED=0` default) and fall through to the EXISTING `extract_from_pdf_with_fallback` chain. Zero new infra; ingest works tonight; quality delta measured on 3 sample manuals (chunk counts + spot-read).
  - **Option 2 — Restore:** re-add the `mira-docling` service (pinned image, 5001, mem-limited per ADR-0019's OOM history) to the prod compose. Better table extraction; +1 container to keep alive; the OOM history is why it left.
- [ ] **Step 3:** Implement the chosen option with a regression test at the caller seam (mock the docling endpoint down → assert fallback chain produces chunks, no exception). VERSION/CHANGELOG; PR; staged deploy per environments doctrine.

---

## PR-F — Paid interpreter re-enable (BLOCKED on Mike: credits + guarded-file sign-off)

- [ ] **Step 1 (needs explicit owner approval — `printsense/interpret.py` is never-calibrate guarded):** fix `_openai_effort`: pass through the five API-supported values (`none/low/medium/high/xhigh`), map `minimal→none`, unknown→`high` (removes both the `minimal` 400 and the silent `xhigh→high` downgrade). Hermetic test on the mapping function only.
- [ ] **Step 2:** After Mike tops up credits + sets the dashboard cap: one budget-declared acceptance run per the spend law (`PRINT_BENCH_BUDGET_USD` guard, existing Phase-2 sweep ≈ $1.20 @ medium), reported with per-call costs from the ZTA meter.
- [ ] **Step 3:** VERSION/CHANGELOG; PR with the sign-off noted in the body.

---

## Execution order & standing rules

1. **PR-A** (repair — everything else depends on its provenance keys) → 2. **PR-B** (locks the floor in CI) → 3. **PR-C** (keeps it alive in prod) → **PR-D**, **PR-E** any time after A; **PR-F** when Mike unblocks.
2. Every PR: green locally per Global Constraints → push → CI green → report → **Mike merges** → staging deploy + in-container/phone verify → prod via the normal gate.
3. If any golden/grader expectation would need weakening to pass, STOP and report — never calibrate truth away (program law).
4. `.planning/STATE.md` checkpoint after each PR lands.

## Self-review (performed at authoring)

- **Coverage:** every broken piece in the diagnosis table maps to a PR: dead `_call_ocr` → A3; starved `ocr_items`/missing `ocr_tokens` → A4/A8; album shape → A5; silence → A6/C1/C2 + B's CI gate; env-trap → A7; theory truncation → D; docling → E; paid interpreter → F. "Keep running" = A6 (boot), C1 (per-turn), C2 (scheduled), B (per-commit).
- **Type consistency:** `ocr_source` literals (`tesseract|tesseract+model|model|none`) identical in A4, A6 report semantics, C1 rule, A8 assertions. `line_items(tokens: list[dict]) -> list[str]` consistent A1→A4→B1. `ocr_lane_report()` shape identical A6↔C2 probe.
- **No placeholders:** every code step carries real code; the two "read the real signature first" notes (A8, C1) are deliberate — those signatures exist in-repo and tests must bind to the real ones, not to guesses frozen into this document.
