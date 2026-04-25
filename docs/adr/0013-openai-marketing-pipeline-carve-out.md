# ADR-0013: OpenAI Carve-Out for Marketing Pipelines (Images + TTS Only)

## Status
Accepted — 2026-04-25

**Related:** CLAUDE.md Hard Constraint #2 ("No cloud except: Anthropic Claude API + NeonDB"), ADR-0011 (No LangGraph migration — Constraint #3 enforcement).

---

## Context

`marketing/comic-pipeline/` (and its sibling `tools/seedance-video-gen.py`) generate
short explainer videos for top-of-funnel: a comic-style narration over animated panels,
output as YouTube-ready MP4. The pipeline already calls:

- **OpenAI `gpt-image-1`** (`pipeline/generate_panels.py`, `pipeline/v2/panels.py` planned) for comic panel generation.
- **OpenAI `tts-1-hd`** (`pipeline/v2/tts.py`) for narration voiceover.

Hard Constraint #2 (CLAUDE.md) reads: "No cloud except: Anthropic Claude API + NeonDB
(Doppler-managed secrets)." Read literally, calling OpenAI Images or OpenAI TTS
violates this. The constraint exists to bound the runtime attack surface, the data-residency
surface, and the vendor-lock-in surface for the *product* — the diagnostic platform that
ships to industrial customers.

That constraint is correct for the product. It is over-broad for marketing tooling.

Two factual observations forced an explicit decision:

**1. Anthropic does not ship an image generation model.** As of 2026-04, there is no
Claude equivalent of gpt-image-1 / DALL-E 3. Replacements (Stable Diffusion via Replicate,
Flux via fal.ai, Midjourney) are *also* cloud and *also* outside Constraint #2. There
is no on-prem Apache/MIT image model that produces magazine-quality comic panels at
1536×1024 in one call. The choice is "use a cloud image vendor" or "do not generate
panels at all."

**2. The comic-pipeline does not touch product runtime.** It is a build-time tool that
produces an MP4. The MP4 is uploaded to YouTube. The pipeline never runs on the VPS,
never appears in the chat path (`Open WebUI → mira-pipeline → GSDEngine → Anthropic`),
never sees customer PII, and is not part of any service users connect to. The blast
radius of an OpenAI outage on this code is "no new marketing video this week," not
"customer diagnostics down."

---

## Decision

**OpenAI is permitted in `marketing/` and `tools/` for image generation and TTS only.**
**OpenAI remains forbidden in any product runtime path.**

### What is allowed

| Path | Purpose | Models |
|------|---------|--------|
| `marketing/comic-pipeline/` | Comic explainer videos | `gpt-image-1`, `tts-1-hd` |
| `tools/seedance-video-gen.py` | Text-to-video marketing | (model TBD per Seedance ADR) |
| `tools/linkedin_drafter/` | Marketing copy assist | (allowed if scoped) |
| Future `marketing/*` pipelines | YouTube/LinkedIn/X content | image, audio, video models only |

### What is not allowed

| Path | Reason |
|------|--------|
| `mira-pipeline/` | Active VPS chat path; Anthropic-only per constraint |
| `mira-bots/` | Customer-facing diagnostic adapters |
| `mira-mcp/` | NeonDB recall + equipment tools |
| `mira-web/` | PLG funnel; user-PII path |
| `mira-core/` | Open WebUI host |
| `mira-cmms/` | Atlas CMMS, work orders |
| `mira-bridge/` | Node-RED orchestration |
| `mira-ingest/` | Document ingest path |
| Anything else under `mira-*/` | Product runtime — covered by Constraint #2 |

### Boundary enforcement

1. The marketing pipeline imports `from openai import OpenAI`. Any non-marketing module
   that does the same is a constraint violation and should fail code review.
2. Add a CI check (`scripts/check-openai-import.sh`) that greps non-marketing paths
   for `import openai` / `from openai`. Fail the build on hits outside the allowlist.
3. The marketing pipeline reads `OPENAI_API_KEY` from Doppler `factorylm/prd`. The
   key is restricted by OpenAI's project-level usage limits to a marketing budget cap.

### Data flow

The marketing pipeline never receives:

- Customer queries, fault data, or any data from `mira-pipeline` / `mira-bots`.
- NeonDB rows.
- Doppler secrets other than `OPENAI_API_KEY`.

It reads from:

- `marketing/comic-pipeline/scripts/storyboard_v2.yaml` (committed in repo, no PII).
- `marketing/comic-pipeline/reference/*.png` (committed in repo, no PII).
- `marketing/references/*.png` (cross-pipeline reference assets).

It writes to:

- `marketing/comic-pipeline/output/` (gitignored, build artefacts).
- `marketing/videos/` (final MP4s, gitignored).
- `marketing/videos/spend.json` (cost log).

---

## Rationale

| Criterion | Allow OpenAI in marketing | Force on-prem image model |
|-----------|---------------------------|---------------------------|
| Quality at 1536×1024 comic panels | gpt-image-1 produces shippable output | SDXL / Flux: usable for stills, struggles on multi-character scenes with consistent style |
| Engineering cost | Existing pipeline already integrates OpenAI; ~0 changes | Stand up GPU host, fine-tune LoRA, retrain when characters change |
| Recurring run cost | ~$0.10 per panel at high quality, 5–10 panels per video | Fixed GPU host cost (~$200–500/mo) regardless of usage |
| Throughput | Bottlenecked by OpenAI rate limit (≥50 RPM) | Bottlenecked by single GPU |
| Aligns with Constraint #2 (literal) | ✗ requires this carve-out ADR | ✓ |
| Aligns with Constraint #2 *intent* (product attack surface) | ✓ marketing is not the product | ✓ |
| Reversibility | Swap module if Anthropic ships image model in 2026 | Hard reversal — model artefacts, training pipeline |

The constraint's intent is to keep customer diagnostic data inside Anthropic + NeonDB.
Marketing pipelines do not touch customer diagnostic data. The carve-out preserves
intent while admitting the practical reality that no equivalent on-prem model exists
in 2026 for the comic-panel use case.

---

## Consequences

**Positive:**

- Marketing pipeline ships without architectural contortion.
- Constraint #2 is preserved for the runtime path, where it actually matters.
- New marketing pipelines in `marketing/` inherit a clear, audited approval.

**Negative / risks:**

- Constraint #2 is now nuanced. New contributors may apply it inconsistently. Mitigation:
  the CI grep check (item 2 above) makes the boundary mechanical, not judgmental.
- OpenAI rate limits or API outages can stall a marketing release. Acceptable — marketing
  is not on the customer critical path.
- OpenAI usage cost can drift if storyboard length grows. Mitigation: existing dry-run
  cost report in `run_pipeline.py --dry-run` already exposes the $ before each build.

**Deferred:**

- If Anthropic ships an image model in 2026, revisit this ADR — first action would be
  swapping `pipeline/generate_panels.py` to a thin Anthropic adapter; same prompt schema.
- Migration to Replicate / fal.ai (Flux, SDXL) is a fallback option if OpenAI raises
  prices significantly. The carve-out covers any non-Anthropic image vendor; not
  OpenAI-specific.

---

## References

- CLAUDE.md Hard Constraint #2: cloud-vendor allowlist
- CLAUDE.md Hard Constraint #3: no frameworks that abstract the Claude API call
- `marketing/comic-pipeline/README.md` — pipeline overview
- `marketing/comic-pipeline/pipeline/generate_panels.py` — current OpenAI integration
- `marketing/comic-pipeline/pipeline/v2/tts.py` — current OpenAI TTS integration
- ADR-0011 — precedent for explicit "no framework" decisions tied to Constraint #3
