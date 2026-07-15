# PrintSense cost-vs-quality benchmark — model × effort on the shipped prompt path (2026-07-14)

**Question:** what does one print read cost per model/effort config, and which configs hold the
A-band? Feeds the pricing story for MIRA Print Pack and the PrintSense run-cost budget.

**Method:** five live paid calls through the **shipped prompt path** (`printsense.interpret._SYSTEM`
+ `_user_prompt` + `preprocess.prepare_print_image`) — identical request bytes per config, only
`model` / `output_config.effort` / thinking vary. Case: `01_sheet20_upright.jpg` (SCU2 sheet 20,
photo path). Exact API `usage` + wall time captured per call; graded deterministically with
`grade_case` against the frozen `scu2_sheet20` rubric. **n = 1 per config** — single run each;
see Caveats. Total bench spend ≈ $1.15 (stg Doppler, owner-authorized Anthropic surface).

Pricing verified 2026-07-14 via the `claude-api` skill: opus-4-8 **$5/$25** per MTok ·
sonnet-5 **$2/$10 intro through 2026-08-31** ($3/$15 list) · haiku-4-5 **$1/$5**. Thinking
bills as output tokens.

## Results

| config | in tok | out tok | $/print | wall | score | verdict | dF1 | wF1 | xF1 |
|---|---|---|---|---|---|---|---|---|---|
| opus-4-8 · **xhigh** (prod default) | 11,003 | 14,637 | **$0.421** | 149 s | 93.0/A | PASS | 0.8 | 1.0 | 0.8 |
| opus-4-8 · **high** | 11,003 | 7,060 | **$0.232** | 73 s | 96.0/A | PASS | 0.8 | 1.0 | 1.0 |
| opus-4-8 · **medium** | 11,003 | 7,163 | **$0.234** | 70 s | 96.0/A | PASS | 0.8 | 1.0 | 1.0 |
| sonnet-5 · xhigh | 11,003 | 21,040 | **$0.232** | 188 s | 86.9/B | PASS | 0.8 | 1.0 | 0.615 |
| haiku-4-5 (floor) | 5,895 | 5,849 | **$0.035** | 43 s | 72.3/C | FAIL | 0.8 | 0.667 | 0.2 |

All configs: 0 confident misreads. Input breakdown (opus tokenizer): **6,260 tokens are static
text** (system + schema + prompt template) riding every call; the image is the remaining ~4,743.
(Haiku's input differs — different tokenizer/vision scaling on the 200K-context model.)

## Findings

1. **Effort is the dominant cost lever.** `effort=high` cut the per-print cost 45 % ($0.421 →
   $0.232) and halved wall time (149 s → 73 s) versus the shipped `xhigh` default, purely by
   thinking less (14.6k → 7.1k output tokens). It also *scored higher* (96.0 vs 93.0), but that
   delta is entirely xref F1 (0.8 vs 1.0), the metric with documented run-to-run variance
   0.36–1.0 (see `.planning/STATE.md` R2, `feat/printsense-iterate`) — treat the quality
   comparison as "high holds the A-band", not "high beats xhigh". The cost/latency cut is
   structural, not noise.
2. **`medium` buys nothing over `high`** — same score, same cost (±1 %), same speed. `high` is
   the step-down candidate.
3. **Sonnet 5 is dominated for the primary read.** Its intro rate is 2.5× cheaper per token, but
   it thought 3× longer (21k output tokens), landing at the *same* dollar cost as opus-high,
   2.6× slower, one letter grade lower (86.9/B, xref 0.615). No reason to tier the primary read
   down to Sonnet; revisit only for `--enhance`/`--verify` secondary passes with a dedicated A/B.
4. **Haiku 4.5 fails the gate** (72.3/C, wire F1 0.667, xref 0.2) at $0.035. Useful only as a
   floor reference; the two-axis gates correctly keep it out of AUTO_IMPORT.
5. **device F1 = 0.8 across all five configs, including Haiku.** A model-independent constant
   miss is truth-set convention, not perception — consistent with the known `ITS.LWL-K-01.2`
   catalog-code-as-tag-vs-`type`-attribute rubric question (Mike's call, STATE.md R2). Whatever
   rubric convention is chosen, it moves every config's ceiling equally.

## Cost levers, quantified

| lever | saving | applies to | effort to adopt |
|---|---|---|---|
| **Batches API** (−50 % on all tokens) | $0.232 → **$0.116**/print at high; 25-case eval ≈ **$2.90 vs $5.79** (vs $10.52 at interactive xhigh) | eval re-runs, corpus jobs, anything not latency-bound (batches usually complete <1 h) | low — wrap existing requests in `messages.batches.create` |
| **effort=high** (−45 % vs xhigh) | $0.421 → $0.232/print, 2× faster | primary read default | needs a variance study first (below) |
| **Prompt caching** (reads ≈ 0.1×) | ~**$0.028/call** ≈ 12 % of an opus-high call (6,260 static tokens × $5/MTok × 0.9) | bursts within the 5-min TTL: eval runs, enhance/verify multi-pass, batch warm-up | low — one `cache_control` breakpoint on the system block. Opus min cacheable prefix is 4,096 tokens; our 6,260 qualifies. Write premium 1.25× → pays from the 2nd call in a burst. To also cache the user-prompt template, order it **before** the image block in `content` (today the image is first, so only the system block can ride the prefix). |
| Sonnet 5 tiering | none on this evidence | — | rejected for the primary read (finding 3) |

## Recommendations

1. **Adopt Batches for eval/corpus re-runs now** — pure −50 %, no quality question attached.
2. **Run a variance study before flipping the prod default to `effort=high`:** ≥5 runs per config
   on 2–3 cases (upright, lowres, one dense sheet), compare score distributions not single runs.
   The xref-F1 noise (0.36–1.0) makes any n=1 quality ranking unsafe; the −45 % cost and −50 %
   latency are certain, so the study is worth it. If high holds the A-band across runs, switch.
3. **Add the system-block cache breakpoint** alongside whichever default wins — ~12 % off every
   marginal call in a burst, one-line change; reorder prompt-text-before-image if we want the
   full 6,260-token prefix cached.
4. **Keep Opus for the primary read.** Sonnet's intro pricing is eaten by thinking volume;
   Haiku fails the gate.

## Caveats

- **n = 1 per config** — cost and wall-time are stable per config (token counts are
  deterministic-ish for identical inputs), but score comparisons within the A-band are inside
  the known xref variance. Don't cite "96 > 93" as a quality ranking.
- Single case, photo path only. The raw-PDF path (F5 client-side rendering) and dense
  multi-variant sheets (ATV340) are not covered; their token profile is larger.
- `PRINT_AUTOROTATE_SKIP (osd_failed)` — Tesseract isn't installed on the bench host, so
  auto-rotate was skipped. Input was upright; no impact here. (Known: auto-rotate is
  container-only.)
- Grades are against the frozen `scu2_sheet20` rubric; the device-F1 ceiling (finding 5) is a
  rubric-convention question, not a model one.
- Sonnet 5 pricing is the intro rate; at list ($3/$15) its per-print cost rises ~50 % to
  ≈ $0.35, making it strictly worse than opus-high on every axis.

## Reproduce

Requires the printsense package (repo checkout) + stg Doppler (`ANTHROPIC_API_KEY`):

```bash
doppler run -p factorylm -c stg -- py -3 bench_cost.py
```

<details><summary>bench_cost.py (as run, 2026-07-14)</summary>

```python
"""PrintSense cost-vs-quality benchmark — REAL usage from the API, graded.

Reuses the SHIPPED prompt path (interpret._SYSTEM/_user_prompt + preprocess) so
every config sees the identical request; only model/effort vary. Captures exact
usage (input/output/cache tokens) + wall time, grades with grade_case + rubric,
prices per the current table (claude-api skill, 2026-07-14).

Run: doppler run -p factorylm -c stg -- py -3 bench_cost.py
"""

import json
import pathlib
import sys
import time

REPO = pathlib.Path(r"C:/wt-printsense")
sys.path.insert(0, str(REPO))

from printsense import interpret  # noqa: E402
from printsense import preprocess as pp  # noqa: E402
from printsense.grade_case import grade_case  # noqa: E402

IMG = REPO / "printsense/benchmarks/_eval_inputs/01_sheet20_upright.jpg"
RUBRIC = str(REPO / "printsense/benchmarks/scu2_sheet20/rubric.json")
OUT = pathlib.Path(__file__).parent / "bench_out"
OUT.mkdir(exist_ok=True)

# $/MTok (in, out). Sonnet 5 intro pricing through 2026-08-31 shown as effective.
PRICE = {
    "claude-opus-4-8": (5.00, 25.00),
    "claude-sonnet-5": (2.00, 10.00),   # intro; list 3.00/15.00
    "claude-haiku-4-5": (1.00, 5.00),
}

CONFIGS = [
    # (label, model, effort or None, thinking?)
    ("opus-xhigh (prod default)", "claude-opus-4-8", "xhigh", True),
    ("opus-high", "claude-opus-4-8", "high", True),
    ("opus-medium", "claude-opus-4-8", "medium", True),
    ("sonnet5-xhigh", "claude-sonnet-5", "xhigh", True),
    ("haiku45 (floor)", "claude-haiku-4-5", None, False),
]

# One shared, preprocessed page (identical bytes for every config).
pages = [pp.prepare_print_image(IMG.read_bytes(), "image/jpeg")]
data_b64_block = interpret._source_block(*pages[0])
prompt = interpret._user_prompt(None, None)
content = [data_b64_block, {"type": "text", "text": prompt}]

client = interpret._client()

# Free breakdown: how many input tokens are PROMPT (system+schema) vs IMAGE?
ct_text_only = client.messages.count_tokens(
    model="claude-opus-4-8", system=interpret._SYSTEM,
    messages=[{"role": "user", "content": prompt}],
).input_tokens
print(f"[breakdown] system+schema+prompt tokens (opus tokenizer): {ct_text_only}", flush=True)

rows = []
for label, model, effort, thinking in CONFIGS:
    kwargs = dict(model=model, max_tokens=interpret.MAX_TOKENS,
                  system=interpret._SYSTEM,
                  messages=[{"role": "user", "content": content}])
    if model == "claude-haiku-4-5":
        kwargs["max_tokens"] = min(kwargs["max_tokens"], 60000)
    if thinking:
        kwargs["thinking"] = {"type": "adaptive"}
    if effort:
        kwargs["output_config"] = {"effort": effort}
    t0 = time.time()
    try:
        with client.messages.stream(**kwargs) as stream:
            msg = stream.get_final_message()
        dt = time.time() - t0
        raw = interpret._first_text(msg)
        graph = interpret._apply_confidence_gate(
            interpret.PrintSynthGraph.model_validate(json.loads(interpret._strip_fences(raw)))
        )
        slug = label.split()[0].replace("(", "").replace(")", "")
        gpath = OUT / f"{slug}.graph.json"
        gpath.write_text(graph.model_dump_json(indent=2), encoding="utf-8")
        g = grade_case(str(gpath), RUBRIC)
        u = msg.usage
        pin, pout = PRICE[model]
        cost = (u.input_tokens * pin + u.output_tokens * pout) / 1e6
        rows.append({
            "config": label, "model": model, "effort": effort or "-",
            "in_tok": u.input_tokens, "out_tok": u.output_tokens,
            "cost_usd": round(cost, 4), "secs": round(dt, 1),
            "score": g["score"], "letter": g["letter"],
            "verdict": g["import_verdict"],
            "misreads": len(g["confident_misreads"]),
            "device_f1": g["metric_results"].get("device_f1"),
            "wire_f1": g["metric_results"].get("wire_f1"),
            "xref_f1": g["metric_results"].get("xref_f1"),
        })
        print(f"[done] {label}: {u.input_tokens}in/{u.output_tokens}out "
              f"${cost:.3f} {dt:.0f}s -> {g['score']}/{g['letter']} {g['import_verdict']} "
              f"misreads={len(g['confident_misreads'])}", flush=True)
    except Exception as exc:  # noqa: BLE001 — one config failing must not kill the bench
        rows.append({"config": label, "model": model, "effort": effort or "-",
                     "error": str(exc)[:180]})
        print(f"[FAIL] {label}: {exc}", flush=True)

(OUT / "bench_results.json").write_text(
    json.dumps({"prompt_tokens_text_only": ct_text_only, "rows": rows}, indent=2),
    encoding="utf-8",
)
print("\n===== SUMMARY =====")
for r in rows:
    if "error" in r:
        print(f"{r['config']:26s} ERROR {r['error'][:80]}")
    else:
        print(f"{r['config']:26s} ${r['cost_usd']:.3f} {r['secs']:6.0f}s "
              f"{r['score']}/{r['letter']} {r['verdict']} mis={r['misreads']} "
              f"dF1={r['device_f1']} wF1={r['wire_f1']} xF1={r['xref_f1']}")
```

</details>

## Provenance

- Run 2026-07-14 ~20:04–20:12 EDT, background job on the dev laptop, stg Doppler key.
- Raw outputs: `bench_results.json` + five `*.graph.json` (session scratchpad, ephemeral —
  the results table above is the durable copy).
- Related: `printsense/PATH_TO_A.md` (roadmap), `docs/plans/2026-07-13-print-eval-gold-standard.md`
  (grader program), PRs #2698–#2701 (tonight's merge queue).
