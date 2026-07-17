# PrintSense inference burn study — where the $10 went (2026-07-16 → 07-17)

**Trigger:** Mike funded ~$10 of OpenAI credit on the evening of 2026-07-16 (the gpt-5.5
interpreter swap, PR #2757/#2758). By late 2026-07-17 the account returned
`429 insufficient_quota`. This study reconstructs the burn, prices the program going
forward, and ranks the controls that keep it from happening again.

**Method + honesty note:** the org usage API needs `api.usage.read` (admin key — dashboard
is owner-only), and the per-call `PRINT_OPENAI_USAGE` log lines lived on a since-recreated
container / a closed local terminal. So this is a *reconstruction*: hard anchors are the
known ~$10 total, the measured request payloads, the documented run counts (STATE.md +
PR #2751–#2767 evidence tables), and published pricing. Per-call output tokens are
back-solved and banded, not observed. The #1 recommendation exists precisely so the next
study is observation, not reconstruction.

## Hard facts

| Fact | Value | Source |
|---|---|---|
| gpt-5.5 pricing | **$5.00/M input · $30.00/M output · $0.50/M cached input** | developers.openai.com pricing (fetched 2026-07-17) |
| Reasoning tokens | **bill as output tokens** (`usage.output_tokens` includes them) | OpenAI Responses API documented behavior |
| Per-call output cap | `PRINT_VISION_MAX_TOKENS` default **32,000** → **~$0.96/call worst-case** | `printsense/interpret.py:39` |
| Input payload, measured | system 3,296 chars + user prompt 11,775 chars (**11,475 = the embedded JSON schema, 97%**) ≈ ~3.8k text tokens | measured hermetically in wt-ps3 |
| Image input | 1400×900 bench PNG ≈ ~1–2.5k tokens at `detail: high` (formula unpublished; banded) | `interpret.py:196` |
| ≈ input cost/call | ~5.5–6.5k tokens ≈ **$0.03** | computed |
| Cache status | **$0 cached** — images precede the text block, so the identical schema prefix never hits the prompt cache; system prompt alone (~825 tok) is under the 1,024-token cache minimum | `interpret.py:205` |

**Conclusion up front: ~90% of the burn was output-side reasoning tokens at $30/M.**
Input was roughly $2 of the $10.

## What ran (call inventory, from STATE.md + PR bodies)

| Activity | Paid calls | Effort | Est. cost |
|---|---|---|---|
| Effort ladder (#2764): ≥2×8 high, 2×8 medium, 1×8 low | 40–48 | mixed, high-skewed | **~$5–6.5** |
| Swap-era phase-2 sweeps (pre-calib 6/8, in-container 7/8, spot re-runs) | 16–24 | high | ~$2.5–3.5 |
| Phase 3 dev iterations + live proof (incl. 2-page package @293.9s) | 4–9 | high | ~$1–2 |
| Messy-English live spots (#2760) | 2–4 | high | ~$0.3–0.6 |
| Phase 4 dev probes (Lane R itself was free-cascade) | 0–2 | medium | ~$0–0.4 |
| **Total** | **~62–87** | | **~$9–12 ✓ matches ~$10** |

Back-solved: (~$10 − ~$2 input) / $30 ≈ **265k output tokens** across ~75 calls ≈ 3.5k
avg/call — consistent with observed latencies (medium ≤94s, high 141–294s) and a 1–3k-token
JSON graph per answer.

**Was it wasted?** Partly no: the ladder was build-time inference that bought a permanent
artifact — `PRINT_VISION_EFFORT=medium` at 8/8 quality is a ~3× output-cost and latency cut
on every future call (the ZTA "infer once, export config" move). The fixable part is the
*shape*: five full sweeps with no live dollar meter (`_COST_PER_MTOK` has no `openai` entry,
so envelopes printed est-$0 — known trap #8), no per-run budget stop, no caching of repeat
interpretations, and a 32k output ceiling nobody chose deliberately.

## Price list going forward (medium effort, per the calibrated config)

| Unit | Paid calls | Est. cost (band) |
|---|---|---|
| One interpreter call (single photo) | 1 | **~$0.15** ($0.08–0.30; hard cap $0.99) |
| Phase-2 sweep | 8 | ~$1.20 ($0.6–2.4) |
| Phase-3 live (2 sessions) | ~3 (package-heavy) | ~$0.7–1.5 |
| Phase-4 Lane A matrix | ≤16 | ~$2.50 ($1.3–5) |
| One Telegram tap from Mike | 1 | ~$0.15 |
| Phase-5 weekly paid qualification | 8/week | ~$1.2/week ≈ $5/month — **or ~$0** with free-cascade default + paid-on-invalidation |

A $10 top-up with the controls below comfortably covers the remaining program (Lane A
~$2.5 + phase-2/3 re-verifies ~$3) with ~$4 headroom.

## Controls, ranked

1. **Mike, OpenAI dashboard (human-only, ~2 min):** set a hard monthly budget limit +
   usage alert emails on the project. No code path can then exceed it.
2. **Cost meter (small PR — kills trap #8):** add `"openai": (5.0, 30.0)` to
   `_COST_PER_MTOK`, thread real `PRINT_OPENAI_USAGE` counts into bench envelopes, print a
   running $ total during every paid lane. The ladder would have shown "$5.40 spent" live.
3. **Budget guard + sane cap (small PR):** paid lanes take `--budget-usd` (default ~$2)
   and hard-stop before exceeding it; drop `PRINT_VISION_MAX_TOKENS` default 32000 → ~12000
   (medium's 8/8 runs fit; truncation is grader-visible, never silent).
4. **CAS interpretation cache (the ZTA flagship):** key = (image-set sha256, model, effort,
   prompt/schema version) → re-verifies and repeat sheets cost $0; invalidation = any key
   component changes. `printsense/cas.py` already exists.
5. **Phase-5 design decision:** scheduled regression defaults to the free calibrated
   cascade (proven 8/8); gpt-5.5 runs only on invalidation events or a weekly
   qualification slot.
6. **Cache-friendly prompt order (micro):** move the static schema ahead of the images (or
   into `instructions`) so the ~3.7k-token prefix hits the $0.50/M cache — ~70% off the
   input side at product scale.
7. **Bench-gated cheaper tier (optional, never silent):** gpt-5.4 is half price, 5.4-mini
   ~15% — run them through `provider_qualification.py`; adopt only if the frozen bar holds.

## Cross-references

- `docs/research/2026-07-16-kelsey-hightower-zero-token-architecture.md` — the ZTA lens
  this study instantiates (runtime spend → build-time artifacts + invalidation rules)
- `printsense/interpret.py` — the single paid seam (MAX_TOKENS, EFFORT, prompt builder)
- `printsense/benchmarks/single_photo_grader.py` — `_COST_PER_MTOK` (missing `openai` row)
- PR #2764 — effort-ladder evidence table; PR #2762 — Phase-3 latencies
- `C:\wt-printsense\.planning\STATE.md` — the append-only run log the inventory came from
