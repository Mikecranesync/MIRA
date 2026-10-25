# Docling 2.140.0 model-weight licensing — decision-ready summary

**Bottom line:** Docling's default `PdfPipeline` pins TableFormer weights to HF tag `v2.3.0`
(commit `fc0f2d4...`), whose **cached README/card metadata says CDLA-Permissive-2.0 only.**
Critically, the **underlying weight bytes have not changed** — the same LFS blobs (verified by
identical sha256) are now also offered under Apache-2.0 on the repo's current `main` branch
(commit `2199320...`, "Dual licensing," merged 2025-12-03), five months after the `v2.3.0` tag was
cut. So this is not "the weights are CDLA, full stop" — it is: **the specific snapshot Docling
2.140.0's pinned revision resolves to carries a CDLA-only license record; the identical bytes are
now ALSO available, from the same org, under a license record that includes Apache-2.0.** Whether
that is sufficient to treat the weights as Apache-licensed for policy purposes is a legal/policy
call, not a fact this investigation can settle — see §2 for the full chain of evidence and the
gap in it (no rationale was given for the relicensing). Either way, CDLA by itself is not on an
"Apache-2.0 or MIT only" allowlist. The layout model (Heron) is clean, single-license Apache-2.0
with no such ambiguity. Multiple Apache-only paths exist regardless (§6, including one — Option D
— that loses nothing).

## Summary table

| Component | Repo / file | Revision Docling pins | License (at pinned revision) | Evidence | On Apache/MIT allowlist? |
|---|---|---|---|---|---|
| **TableFormer weights, as Docling 2.140.0 actually pins them** | `docling-project/docling-models` → `model_artifacts/tableformer/{accurate,fast}/*.safetensors`, revision `v2.3.0` (commit `fc0f2d4...`), pinned in `docling/models/stages/table_structure/table_structure_model.py:107-108` | `v2.3.0` tag | **CDLA-Permissive-2.0 only**, per that commit's README (confirmed both via the HF API raw fetch AND the local `~/.cache/huggingface/hub/models--docling-project--docling-models/snapshots/fc0f2d4.../README.md` on this machine) | `https://huggingface.co/docling-project/docling-models/raw/v2.3.0/README.md` + local cache | ❌ NO, as currently pinned |
| **The identical weight bytes, same repo, current `main`** (same sha256 LFS blobs — confirmed `fd1dc0d8...`/`2a7d6c92...` accurate and `f6653fe5...`/`3119563a...` fast are byte-identical at both revisions) | same repo, `main` branch (commit `2199320...`, "Dual licensing (#22)", merged 2025-12-03, empty PR body, no rationale given — see §2) | n/a (Docling 2.140.0 does not pin this revision) | **Dual-offered**: `[cdla-permissive-2.0, apache-2.0]`, no per-file split, no LICENSE file in the repo at any revision | `https://huggingface.co/api/models/docling-project/docling-models` ; `.../discussions/22` ; commit history via `.../commits/main` | ⚠️ Same bytes, now also Apache-2.0-licensed by the same licensor — a policy/legal call, not resolved here (see §2, §6 Option D) |
| **Layout model (default = Heron)** | `docling-project/docling-layout-heron` (torch/base) and `docling-project/docling-layout-heron-onnx` (onnxruntime engine override) | `main` (floating — not tag-pinned), set in `docling/datamodel/stage_model_specs.py:1012-1021` | **Apache-2.0**, consistent card + README, single license, no ambiguity | `https://huggingface.co/api/models/docling-project/docling-layout-heron` and `-onnx` | ✅ YES |
| **Apache-only table-structure alternative** | `docling-project/TableFormerV2` (opt-in via `TableStructureV2Options`, kind `docling_tableformer_v2`) | `main`, pinned via `TableStructureModelV2._model_repo_id`, `docling/models/stages/table_structure/table_structure_model_v2.py:41,110-111` | **Apache-2.0**, clean, single license | `https://huggingface.co/docling-project/TableFormerV2/raw/main/README.md` | ✅ YES, but it's labeled "preview" — maturity/quality tradeoff |
| Docling / docling-ibm-models **source code** | GitHub `docling-project/docling`, `docling-project/docling-ibm-models` | — | **MIT** | `LICENSE` files fetched directly from both repos' raw GitHub; also `SPDX-License-Identifier: MIT` header in every docling `.py` file inspected | ✅ YES (code only — docling's own README explicitly says code≠model license, quoted below) |
| **OCR — RapidOCR, onnxruntime backend** (PP-OCRv6 det/rec small, legacy cls, all `.onnx`) | `rapidocr` PyPI package, `rapidocr/default_models.yaml`; upstream = PaddleOCR / Baidu, redistributed via ModelScope mirror | n/a — resolved by `rapidocr` package itself, not HF-pinned by Docling | **Apache-2.0**, explicitly SHA-documented (`MODEL_LICENSES.md` shipped in the `rapidocr` wheel) | `rapidocr-3.10.0.dist-info/licenses/MODEL_LICENSES.md` on local venv | ✅ YES |
| **OCR — RapidOCR, torch backend** (what THIS venv actually auto-selects, since `onnxruntime` isn't installed here — PP-OCRv4 `ch` det/rec + legacy cls, all `.pth`) | same package, `rapidocr/default_models.yaml` torch/PP-OCRv4 section, ModelScope `RapidAI/RapidOCR` | n/a | **Very likely Apache-2.0** (same upstream, same general attribution) but **NOT in `MODEL_LICENSES.md`'s SHA-documented table** — that table only covers the `.onnx` files | `rapidocr/default_models.yaml` lines ~1041-1112 ; `MODEL_LICENSES.md` §2's own disclaimer | ⚠️ Likely yes, but UNVERIFIED at the explicit-documentation level |
| **OCR — EasyOCR** (fallback if rapidocr unavailable) | `JaidedAI/EasyOCR` GitHub + its model-release assets | n/a | **Apache-2.0** per repo `LICENSE`; model weights are NOT separately documented the way RapidOCR does it (⚠️ UNVERIFIED for the weights specifically, verified only for the repo/code via the blanket badge) | `https://raw.githubusercontent.com/JaidedAI/EasyOCR/master/LICENSE` | ✅ (code) / ⚠️ UNVERIFIED (weights, no explicit model-license doc found) |
| **OCR — ocrmac** (actual default on this macOS venv, tried FIRST in `OcrAutoModel`, before rapidocr/easyocr) | Apple Vision framework via `ocrmac` wrapper — no model download at all | n/a | N/A — no third-party model weights involved; it's the OS's own Vision API | `docling/models/stages/ocr/auto_ocr_model.py:68-86` | ✅ N/A (nothing to clear) |

## 1. Exactly what Docling's default PdfPipeline fetches — code citations

Venv inspected: `/Users/charlienode/MIRA/.planning/evidence-runoff-data/venv-docling`
(python 3.12), `docling==2.140.0`, `docling-ibm-models==4.0.3`.

**TableFormer (table structure, default V1 engine):**
- `docling/models/stages/table_structure/table_structure_model.py:36-37` — class-level constants
  `_model_repo_folder = "docling-project--docling-models"`, `_model_path = "model_artifacts/tableformer"`.
- `docling/models/stages/table_structure/table_structure_model.py:102-112` (`download_models`
  staticmethod):
  ```python
  return download_hf_model(
      repo_id="docling-project/docling-models",
      revision="v2.3.0",
      local_dir=local_dir,
      force=force,
      progress=progress,
  )
  ```
  This is a **pinned tag**, not a floating branch.
- Default enablement: `docling/datamodel/pipeline_options.py:2149-2158` —
  `table_structure_options: ... = TableStructureOptions()` — i.e. the **V1 / classic TableFormer**
  engine (`kind = "docling_tableformer"`, `pipeline_options.py:154-166`) is the default, not
  `TableStructureV2Options`.
- `do_table_structure` defaults to `True` (`pipeline_options.py:2102-2109`).
- Download mechanism: `docling/models/utils/hf_model_download.py:17-39` wraps
  `huggingface_hub.snapshot_download(repo_id=..., revision=..., force_download=..., local_dir=...)`
  — pulls the **entire repo snapshot** at the pinned revision (not individual files), so whatever
  the repo's file set and metadata are AT THAT REVISION is what lands on disk.

**Layout model (default = Heron):**
- `docling/datamodel/stage_model_specs.py:1012-1021`:
  ```python
  OBJECT_DETECTION_LAYOUT_HERON = ObjectDetectionStagePreset(
      preset_id="layout_heron_default",
      ...
      model_spec=ObjectDetectionModelSpec(
          name="layout_heron",
          repo_id="docling-project/docling-layout-heron",
          revision="main",
          engine_overrides={
              ObjectDetectionEngineType.ONNXRUNTIME: EngineModelConfig(
                  repo_id="docling-project/docling-layout-heron-onnx",
                  extra_config={"model_filename": "model.onnx"},
              )
          },
      ),
  )
  ```
  Revision here is the **floating `main` branch** (not a tag) — a future upstream push to that
  branch changes what Docling downloads without any version bump on Docling's side. This is a
  reproducibility/supply-chain risk independent of licensing (flagged, not the user's direct
  question).
- `standard_pdf_pipeline.py:649-658` instantiates `self.layout_model` via
  `get_layout_factory(...).create_instance(options=self.pipeline_options.layout_options, ...)`,
  consuming the preset above by default.
- **Which repo actually gets downloaded (base vs. `-onnx`) depends on the *engine*, and the
  default engine is NOT onnxruntime.** `docling/models/inference_engines/object_detection/base.py:94-101`:
  ```python
  def _default_engine_options() -> BaseObjectDetectionEngineOptions:
      from docling.datamodel.object_detection_engine_options import (
          TransformersObjectDetectionEngineOptions,
      )
      return TransformersObjectDetectionEngineOptions()
  ```
  The default is the plain HF Transformers (torch) engine, which has no entry in
  `engine_overrides` and therefore uses the base `repo_id="docling-project/docling-layout-heron"`
  — NOT the onnxruntime override (`docling-layout-heron-onnx`) referenced in an earlier draft of
  this investigation. **Confirmed on disk:** this machine's local HF cache contains
  `models--docling-project--docling-layout-heron` (snapshot `8f39ad3c0b4c58e9c2d2c84a38465abf757272d8`,
  which matches the repo's current `main` sha exactly) but has **no**
  `models--docling-project--docling-layout-heron-onnx` directory at all, and `onnxruntime` is not
  installed in this venv (`find ... -iname "onnxruntime*"` returns nothing) — consistent with the
  base engine being what actually ran. Both repos carry the same Apache-2.0 license regardless
  (§3 below), so this correction doesn't change the licensing verdict, only the "what got fetched"
  narrative.

**TableFormerV2 (the opt-in Apache-only alternative):**
- `docling/models/stages/table_structure/table_structure_model_v2.py:41` —
  `_model_repo_id = "docling-project/TableFormerV2"`.
- `table_structure_model_v2.py:110-111` — `download_hf_model(repo_id=TableStructureModelV2._model_repo_id, ...)`.
- Reachable via `pipeline_options.table_structure_options = TableStructureV2Options()`
  (`kind = "docling_tableformer_v2"`, `pipeline_options.py:168-177`). **Not the default.**

**OCR (default = `OcrAutoOptions`, `pipeline_options.py:323-330` sets `kind = "auto"`):**
- `docling/models/stages/ocr/auto_ocr_model.py:67-86` — on `darwin`, tries `ocrmac` (Apple Vision,
  no weight download) FIRST.
- `auto_ocr_model.py:120-139` — next tries `rapidocr` + `onnxruntime` (confirmed Apache-2.0 below).
- `auto_ocr_model.py:148-167` — falls back to `easyocr` if `rapidocr`/`onnxruntime` is unavailable.
- `auto_ocr_model.py:171-...` — falls back to `rapidocr` + `torch` backend next.
- **On the inspected venv (corrected — the first pass used a zsh glob that aborted silently and
  under-reported what was installed):** `find "$SP" -maxdepth 1 -iname "<pkg>*"` confirms
  `ocrmac` is **not installed**, `onnxruntime` is **not installed**, `easyocr` is **not
  installed**, but **`torch` (2.14.1) and `torchvision` (0.29.1) ARE installed** (pulled in as a
  TableFormer dependency) alongside `rapidocr==3.10.0`. Walking the actual `auto_ocr_model.py`
  fallback chain on this venv: ocrmac → ImportError (not installed) → rapidocr+onnxruntime →
  ImportError (`onnxruntime` missing) → easyocr → ImportError (not installed) → **rapidocr+torch
  → succeeds** (both `rapidocr` and `torch` are present). So **the OCR engine this venv would
  actually select is RapidOCR on the torch backend** — not "no OCR available" as an earlier draft
  of this report stated, and not the onnxruntime path either. See §7 for the licensing
  implications of specifically the torch-backend weights (they differ from the onnxruntime
  weights RapidOCR's own license notice documents).

## 2. HF repo evidence — `docling-project/docling-models` (TableFormer)

**Current `main` (commit `2199320848bb9a8a519d22e4b528185a4f9a6f64`, "Dual licensing (#22)",
2025-12-03):**
```
---
license:
- cdla-permissive-2.0
- apache-2.0
---
```
(`https://huggingface.co/docling-project/docling-models/raw/main/README.md`)

No LICENSE file exists in the repo at any revision checked (tree listing via
`https://huggingface.co/api/models/docling-project/docling-models/tree/main?recursive=1` shows
only `.gitattributes`, `.gitignore`, `README.md`, `config.json`, and the four tableformer
artifact files — **no per-file license split, no LICENSE/NOTICE file**). The repo today contains
ONLY TableFormer weights (the layout model was deleted from this repo in commit
`fc0f2d4...`, "Delete layout model from shared model repo (#18)", 2025-07-23).

**The pinned revision and the dual-licensed revision carry byte-identical weights.** Docling
2.140.0 pins `revision="v2.3.0"`, and that git tag points at commit
`fc0f2d45e2218ea24bce5045f58a389aed16dc23` (confirmed via
`https://huggingface.co/api/models/docling-project/docling-models/refs`). Comparing the two file
trees fetched (`.../tree/v2.3.0?recursive=1` vs `.../tree/main?recursive=1`):

| File | LFS sha256 at `v2.3.0` | LFS sha256 at `main` (current) |
|---|---|---|
| `model_artifacts/tableformer/accurate/tableformer_accurate.safetensors` | `2a7d6c924b3cd12fb99a09280ca9c33a89c5d60b93253617d2e088c1a40374d9` | **identical** |
| `model_artifacts/tableformer/fast/tableformer_fast.safetensors` | `3119563aab5a7c96fda4d621119b63fd8806272b86c30936d15507616422f718` | **identical** |
| `model_artifacts/tableformer/{accurate,fast}/tm_config.json` | same oids both revisions | **identical** |

Only `README.md` differs between the two revisions (`887b06ff...` at `v2.3.0` vs `598f7fa8...` at
`main`). The layout model deletion (commit `fc0f2d4`, "#18") happened in the SAME commit that
`v2.3.0` tags, so by the time of that tag the repo already held only TableFormer weights — meaning
whichever license tag applies to this repo at any point in its history after `#18` can only be
referring to the TableFormer weights, never the (now-removed) layout model. This resolves the
original "no per-file attribution" ambiguity the user raised: there IS effectively only one file
family in this repo since mid-2025, so the repo-level license tag(s) do unambiguously apply to
TableFormer.

**What the README actually says differs by revision, and that is where the real finding is:**
- At `v2.3.0` (what Docling 2.140.0 pins, confirmed both via direct HF fetch of
  `https://huggingface.co/docling-project/docling-models/raw/v2.3.0/README.md` AND via this
  machine's own local cache, see below): `license: cdla-permissive-2.0` — **CDLA only.**
- At `main` (current, NOT what Docling 2.140.0 pins): `license: [cdla-permissive-2.0, apache-2.0]`
  — Apache-2.0 was added five months later, via HF discussion/PR **#22**, titled "Dual licensing,"
  merged 2025-12-03. **No rationale was given.** Fetched the discussion directly
  (`https://huggingface.co/api/models/docling-project/docling-models/discussions/22`): it was
  opened by Hugging Face staff (`julien-c`, Hugging Face's co-founder, `isHfAdmin: true`) with an
  **empty comment body** (`"raw": ""`), and merged by `dolfim-ibm` (an IBM/docling maintainer) with
  no explanatory text anywhere in the thread. There is no documented reason on the record for why
  Apache-2.0 was added, whether it supersedes CDLA or is offered as an alternative, or whether IBM
  Legal signed off on broadening the grant — it reads like a routine "please also tag Apache" PR
  that got merged without discussion.

**Local HF cache confirms Docling 2.140.0's own download, on this machine, resolved to the
CDLA-only commit — not the dual-licensed one:**
```
$ find ~/.cache/huggingface/hub/models--docling-project--docling-models -maxdepth 3
.../refs/v2.3.0                                        → contents: fc0f2d45e2218ea24bce5045f58a389aed16dc23
.../snapshots/fc0f2d45e2218ea24bce5045f58a389aed16dc23/README.md

$ cat .../snapshots/fc0f2d4.../README.md | head -3
---
license: cdla-permissive-2.0
---
```
This is the single most load-bearing piece of evidence in this report: it is not a hypothetical
about what `v2.3.0` "would" resolve to — it is literally what landed on disk on this machine when
Docling's pipeline ran.

**So the precise, non-overclaiming statement is:** the exact snapshot Docling 2.140.0 downloads
and runs is accompanied by a CDLA-Permissive-2.0-only license record, as pinned, cached, and
verified on disk. The identical weight bytes are also available, from the same publisher, under a
record that additionally lists Apache-2.0 — but (a) that is a different revision than the one
Docling pins, (b) no rationale for the addition is documented, and (c) with no LICENSE file or
clarifying text in the repo at any revision, the standard-but-unconfirmed reading of "pick either
license" for the `main`-branch dual-tag is itself UNVERIFIED as an explicit statement from the
rights holder (IBM/Docling team) — it's an HF-platform convention, not a stated grant. None of this
changes the hard-list answer: CDLA is not Apache-2.0 or MIT, so the snapshot as pinned fails the
policy regardless. What it DOES change is the remedy — see §6 Option D, which gets the exact same
weight bytes under the dual-licensed record without waiting for upstream to fix the pin.

## 3. HF repo evidence — `docling-project/docling-layout-heron` (+ `-onnx` variant)

Both clean, single-license, no ambiguity:
```
---
license: apache-2.0
---
```
Confirmed via API (`cardData.license: "apache-2.0"`, tag `license:apache-2.0`) for BOTH
`docling-project/docling-layout-heron` and `docling-project/docling-layout-heron-onnx` (the repo
actually fetched when the default `onnxruntime` object-detection engine is used — see code citation
above). No LICENSE file in the repo, but card metadata + README front-matter agree, and there is
only one model family here (no sibling content with a different license to create the HF
multi-tag ambiguity seen in `docling-models`).

## 4. GitHub evidence — `docling-project/docling` and `docling-project/docling-ibm-models`

```
$ curl -s https://raw.githubusercontent.com/docling-project/docling/main/LICENSE | head -2
MIT License
Copyright The Docling Contributors

$ curl -s https://raw.githubusercontent.com/docling-project/docling-ibm-models/main/LICENSE | head -2
MIT License
Copyright (c) 2024 International Business Machines
```

**Docling's own README explicitly disclaims that code license ≠ model license** (confirmed by
direct fetch of `https://raw.githubusercontent.com/docling-project/docling/main/README.md`,
lines 151-154):

> ## License
>
> The Docling codebase is under MIT license.
> For individual model usage, please refer to the model licenses found in the original packages.

This is the primary-source confirmation that the project itself does NOT claim the model weights
inherit its MIT code license — consistent with everything found above. (GitHub code search for
further "CDLA" mentions in the repo returned HTTP 401 — unauthenticated code search is blocked by
GitHub's API; not pursued further since the HF-side evidence above is already primary-source and
sufficient. Labeled UNVERIFIED only in the narrow sense that no additional GitHub issue/doc
discussion of the CDLA/Apache dual-license decision was located.)

## 5. CDLA-Permissive-2.0 — actual terms, and why "permissive" ≠ "on the list"

Full text fetched from `https://cdla.dev/permissive-2-0/` (stripped to text, reproduced
verbatim below — it is short, 5 sections):

> **1. Provision of the Data**
> 1.1. A Data Recipient may use, modify, and share the Data made available by Data Provider(s)
> under this agreement if that Data Recipient follows the terms of this agreement.
> 1.2. This agreement does not impose any restriction on a Data Recipient's use, modification, or
> sharing of any portions of the Data that are in the public domain or that may be used, modified,
> or shared under any other legal exception or limitation.
>
> **2. Conditions for Sharing Data**
> 2.1. A Data Recipient may share Data, with or without modifications, so long as the Data
> Recipient makes available the text of this agreement with the shared Data.
>
> **3. No Restrictions on Results**
> 3.1. This agreement does not impose any restriction or obligations with respect to the use,
> modification, or sharing of **Results**.
>
> **4. No Warranty; Limitation of Liability**
> 4.1. ... THE DATA IS PROVIDED ON AN "AS IS" BASIS, WITHOUT REPRESENTATIONS, WARRANTIES OR
> CONDITIONS OF ANY KIND ...
>
> **5. Definitions**
> 5.4. "Results" means any outcome obtained by computational analysis of Data, including for
> example machine learning models and models' insights.

**In substance, CDLA-Permissive-2.0 is arguably MORE permissive than Apache-2.0 for this use
case:** the only condition is passing along the license text when you redistribute the *Data*
itself (§2.1); there is NO condition at all on **Results** — and §5.4 explicitly defines "Results"
to include "machine learning models," meaning CDLA imposes zero restriction on the *output* of
running TableFormer (your extracted tables, your downstream models, anything derived
computationally). It has no copyleft, no patent clause (neither a grant nor a retaliation
clause — a mild weakness relative to Apache, not a strength), no trademark clause, and no
attribution-of-individual-authors requirement beyond carrying the license text forward with the
weights file itself.

**But the stated company policy is a hard allowlist ("Apache-2.0 or MIT only"), not a
permissiveness test.** CDLA-Permissive-2.0 is not Apache-2.0 and not MIT — it is a third, distinct
license with its own name and its own (different, data-specific) legal text, drafted by the Linux
Foundation specifically for datasets/models rather than software. Regardless of how benign its
terms are in practice, **it is categorically "not on the list,"** and a policy phrased as an
allowlist of exactly two named licenses does not have a "but this one is basically as permissive"
exception written into it. Whether to grant an exception is a business/legal decision for
whoever owns the policy — not a conclusion this investigation can reach on the company's behalf.

## 6. Apache-only alternative paths — what each one loses

Inspected `docling/datamodel/pipeline_options.py` (`PdfPipelineOptions`, `TableStructureOptions`,
`TableStructureV2Options`, `BaseTableStructureOptions`) and the two table-structure model
implementations.

**Option A — `pipeline_options.do_table_structure = False`**
(`pipeline_options.py:2102-2109`, docstring: *"Enable table structure extraction and
reconstruction. Detects table regions, extracts cell content with row/column relationships, and
reconstructs the logical table structure for downstream processing."*)
- **No HF download of any TableFormer weights at all** — fully clears the licensing question for
  tables.
- **Loses:** row/column structure, cell matching, and table reconstruction entirely. Tables still
  get a bounding region from the layout model (Heron, Apache-2.0, unaffected), but their text is
  emitted as unstructured text/paragraph content rather than a structured table — downstream
  consumers that expect `TableCell`/row-col data get nothing useful for tabular content.

**Option B — switch to `TableStructureV2Options()` (TableFormerV2, Apache-2.0)**
```python
from docling.datamodel.pipeline_options import PdfPipelineOptions, TableStructureV2Options
opts = PdfPipelineOptions(table_structure_options=TableStructureV2Options())
```
(Registered via `table_structure_model_v2.py`, `kind="docling_tableformer_v2"`,
`pipeline_options.py:168-177`.)
- Repo `docling-project/TableFormerV2` is clean single-license **Apache-2.0** (confirmed §1/table
  above) — fully clears the licensing question while **keeping** structured table extraction.
- **Loses/risks:** the HF model card tags it `preview` — i.e. upstream itself does not call this
  production-grade yet. Expect less field-testing than the V1 CDLA-licensed TableFormer that has
  been Docling's default since the project's earliest releases (the V1 weights lineage traces back
  to 2024 commits; TableFormerV2 is comparatively new — `lastModified: 2026-10-13` on the repo,
  i.e. actively changing). No independent benchmark was run as part of this investigation; treat
  any quality/latency claim as UNVERIFIED until tested against your own corpus.
- This repo is pinned to `main` (floating), not a tag — same reproducibility caveat as the layout
  model.

**Option D — keep TableFormer V1 (same quality, same weight bytes), source it from the
dual-licensed commit instead of letting Docling's hardcoded `v2.3.0` tag pin it.** This is the
only option that loses nothing. `table_structure_model.py:53-70` shows `TableStructureModel`
accepts an `artifacts_path` parameter: if it's set, Docling skips `download_models()` (the
hardcoded `v2.3.0` call) entirely and instead looks for
`<artifacts_path>/docling-project--docling-models/model_artifacts/tableformer`. So:
```python
from huggingface_hub import snapshot_download
# Pull the SAME weight bytes, but from the commit whose license record includes apache-2.0:
path = snapshot_download(
    repo_id="docling-project/docling-models",
    revision="2199320848bb9a8a519d22e4b528185a4f9a6f64",  # or "main", once stable
    local_dir="<some_root>/docling-project--docling-models",
)
```
then pass `artifacts_path=Path("<some_root>")` into `PdfPipelineOptions`/the pipeline (per the
`artifacts_path` plumbing already in `table_structure_model.py` and the standard pipeline
constructor). Since the LFS blobs are byte-identical to what `v2.3.0` ships (confirmed in §2),
**this changes nothing about model quality or behavior** — it only changes which license record
accompanies the download. **This still requires someone with authority over the policy to decide
whether relying on an undocumented, unexplained, five-months-later "dual licensing" PR from the
original rights holder is an acceptable basis for calling the weights Apache-2.0** — this
investigation surfaces the mechanism and the evidence, not a legal sign-off.

**Option C — `GraniteVisionTableStructureOptions` (VLM-based table structure)** exists in the same
file (`pipeline_options.py`, `kind="granite_vision_table"`) but was **not evaluated** for this
report — it pulls in a full vision-language model (`ibm-granite/granite-vision-*`, a much larger
weight footprint and separate license to check) and is out of scope unless specifically wanted;
flagged as UNVERIFIED/not investigated rather than silently omitted.

## 7. OCR model licensing detail

**RapidOCR (Apache-2.0, explicitly documented at the weight level)** — the installed
`rapidocr==3.10.0` wheel ships its own `MODEL_LICENSES.md`
(`rapidocr-3.10.0.dist-info/licenses/MODEL_LICENSES.md`), which states (quoted verbatim, key
passages):

> Copyright in the upstream model weights is held by Baidu and/or the applicable PaddleOCR rights
> holders. RapidOCR does not claim ownership of the upstream model weights. Both categories are
> distributed under the Apache License, Version 2.0, but their copyright ownership and provenance
> remain separate.
>
> Official PaddlePaddle model cards identify the PP-OCRv6 model weights and ONNX representations
> as `Apache-2.0`.
>
> | RapidOCR artifact | Upstream model | SHA-256 | RapidOCR source |
> | `PP-OCRv6_det_small.onnx` | `PP-OCRv6_small_det` | `090f04ab...` | ModelScope |
> | `PP-OCRv6_rec_small.onnx` | `PP-OCRv6_small_rec` | `6f327246...` | ModelScope |
> | `ch_ppocr_mobile_v2.0_cls_mobile.onnx` | `ch_ppocr_mobile_v2.0_cls` | `e47acedf...` | ModelScope |

This is the cleanest evidence in the whole investigation — RapidOCR goes out of its way to
separately document upstream copyright + license for the exact weight files it bundles, unlike
every HF-hosted model repo above (none of which ship a LICENSE/NOTICE file alongside the weights).

**⚠️ But that explicit coverage is for the ONNX files specifically — and this venv's auto-selected
engine is the TORCH backend, which is a different, undocumented set of files.** As corrected in
§1 above, this venv has no `onnxruntime` installed, so `OcrAutoModel` actually falls through to
`rapidocr` + `backend="torch"` with the default `lang=["ch"]`. Per the code comment in
`rapid_ocr_model.py` ("torch is limited to the PP-OCRv4 script models"), that resolves to the
**PP-OCRv4** backbone, not PP-OCRv6. Checked `rapidocr/default_models.yaml` directly
(lines ~1041-1112): the torch/PP-OCRv4 `ch` entries are:
```
ch_PP-OCRv4_det_mobile.pth   https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/torch/PP-OCRv4/det/ch_PP-OCRv4_det_mobile.pth
ch_PP-OCRv4_rec_mobile.pth   https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/torch/PP-OCRv4/rec/ch_PP-OCRv4_rec_mobile.pth
ch_ppocr_mobile_v2.0_cls_mobile.pth  https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/torch/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.pth
```
**These three `.pth` files are NOT in `MODEL_LICENSES.md` §6's table** — that table only lists the
three `.onnx` files (`PP-OCRv6_det_small.onnx`, `PP-OCRv6_rec_small.onnx`,
`ch_ppocr_mobile_v2.0_cls_mobile.onnx`). The notice's own §2 says exactly this: *"Other model
artifacts available through RapidOCR may have different upstream versions or terms and must be
reviewed against their own source records before being redistributed."* So for the `.pth`
cls model Docling would actually download by default on this machine, RapidOCR's own documented
Apache-2.0 grant **does not explicitly extend to it**, even though the same cls model (converted
to `.onnx` instead of `.pth`) IS covered. The honest conclusion: **very likely Apache-2.0** (same
upstream PaddleOCR project, same ModelScope `RapidAI/RapidOCR` source, same general attribution
in `MODEL_LICENSES.md` §3 that "the models...are released by, or derived from models released by,
the PaddleOCR project" under Apache-2.0) **but not explicitly SHA-documented the way the onnx
files are** — label this row UNVERIFIED-BUT-LIKELY rather than confirmed, and update the summary
table's RapidOCR row accordingly if this is the backend actually shipped to customers.

**EasyOCR** — repo `LICENSE` is Apache-2.0 (`JaidedAI/EasyOCR`, confirmed above), and the README
license badge covers the whole project. **No equivalent per-weight `MODEL_LICENSES.md` was found**
for EasyOCR's detector/recognizer checkpoints — UNVERIFIED whether the downloaded weight files
carry the same Apache-2.0 grant as the surrounding code, or (as with Docling's own TableFormer
repo) a separately-licensed asset bundled under a repo-level badge that doesn't actually govern it.
Not installed in the inspected venv, so not load-bearing for this specific install; flagged for
completeness since the question asked about it "if referenced."

**ocrmac** — no model weights at all; it shells out to Apple's on-device Vision framework. Not a
licensing question for third-party weights; it's the OS vendor's own API. Not installed in this
venv either, but would be tried first on macOS per the auto-selection code.

## Hazard ledger (per repo convention, carried over even though this is a read-only session)

- CDLA-Permissive-2.0-only license record on the exact TableFormer snapshot Docling 2.140.0 pins
  and this machine actually cached (`v2.3.0` / `fc0f2d4...`) — **filed as the primary finding of
  this report**, with a documented, no-quality-loss remedy (§6 Option D: re-source the identical
  bytes from the dual-licensed commit). Final disposition (accept CDLA, adopt Option D, or drop
  table structure/switch to TableFormerV2) is the user's/legal's call, not fixed here.
- `docling-layout-heron`, `docling-layout-heron-onnx`, and `TableFormerV2` are all pinned to the
  floating `main` branch, not an immutable tag/commit SHA — **explicitly accepted as out of scope**
  for this licensing question, but worth a separate reproducibility ticket if anyone cares about
  supply-chain pinning.
- RapidOCR **torch-backend** (PP-OCRv4 `.pth`) weights — the engine this specific venv would
  actually auto-select — are not in RapidOCR's own SHA-documented `MODEL_LICENSES.md` table
  (only the `.onnx` files are). **UNVERIFIED-BUT-LIKELY** Apache-2.0; flagged, not fixed — filing
  an upstream question to RapidOCR (or installing `onnxruntime` instead, which IS fully
  documented) are both reasonable next steps but weren't taken in this read-only investigation.
- EasyOCR per-weight license — **UNVERIFIED**, not fixed, not filed (EasyOCR isn't installed in
  this venv and would only be reached if both `onnxruntime` and `rapidocr`+`torch` were
  unavailable — it is not actually in this venv's live fallback path).
- `GraniteVisionTableStructureOptions` — **not investigated**, explicitly out of scope per §6
  Option C.
