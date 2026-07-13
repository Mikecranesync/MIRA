# PrintSense test harness

Three layers over the **existing saved document corpus**, each a different cost/fidelity
tradeoff. The interpreter, preprocessing, confidence gates, and grader are unchanged —
this harness only *exercises and measures* them.

| Layer | Cost | When | What it proves |
|---|---|---|---|
| **1 — deterministic render** (`tests/printsense/test_render_corpus.py`) | free (no model) | every PR (CI) | Replays the frozen structured interpretations through the technician renderer: completeness (≥ min signals), plain-English default (not a tag wall), exact-map preservation, uncertainty surfaced (never hidden), routing recorded, measurement-specific safety wording, **no invented voltage**, **no vague "external" destination**, no cross-case hallucination. |
| **2 — metamorphic image** (`tests/printsense/test_metamorphic.py`) | paid | nightly | Applies realistic capture degradations (rotate / downscale / jpeg / blur / crop / perspective / shadow / document-clean) to each pinned image, interprets it for real, and asserts against the frozen golden graph: **nothing invented** (no new wire / terminal / voltage) and facts **materially equivalent or less confident**. Free part (transforms valid + comparator catches invention, incl. Hypothesis) runs in CI. |
| **3 — live staging E2E** (`tests/printsense/test_staging_e2e.py`) | paid + live | pre-release (manual/scheduled) | Drives the **real deployed `@Mira_stagong_bot`** via a Telethon USER account, **route-aware**: an electrical print awaits the reply → validates → sends `map` → validates the map; a **nameplate** awaits the nameplate/Drive-Commander reply, asserts it did **not** route as a print, and sends **no** `map`. Render-quality on the LIVE text + the grader on graded cases. Distinguishes a routing failure from a reply-detection (timeout) failure. The autopilot workflow pins the **exact PR-head SHA**. |

## Corpus

`printsense/benchmarks/corpus_manifest.json` is the **immutable** manifest: each case pins a
frozen `graph` (committed) and an image `file` + `sha256_prefix`. The committed graphs drive
Layer 1 (no images needed).

**The source photos are proprietary customer prints and are NEVER committed to git.** They are
fetched at **runtime** from controlled staging storage — `tools/printsense_corpus_sync.py` reads
a **Doppler-injected** source (`PRINTSENSE_CORPUS_DIR` or `PRINTSENSE_CORPUS_URL`) into the dir
named by `$PRINTSENSE_CORPUS_IMAGES`, and every image is verified against its pinned sha256 on
read (`corpus.image_bytes_verified()`), **failing closed** on a mismatch. With no source configured,
`corpus.image_path()` returns `None`, so the paid/live layers skip cleanly and free Layer 1 still runs.
Run the fetch with `--require` (as the workflows do) to fail closed on a missing source or empty corpus.

## Running

```bash
# Layer 1 — free, no creds (what CI runs on every PR)
py -3 -m pytest tests/printsense/ -q

# Fetch the protected corpus (from the Doppler-injected source) before paid/live layers
PRINTSENSE_CORPUS_IMAGES=/tmp/corpus \
  doppler run -p factorylm -c stg -- py -3 tools/printsense_corpus_sync.py --require

# Layer 2 — paid metamorphic matrix (needs the fetched corpus + ANTHROPIC_API_KEY)
PRINTSENSE_PAID=1 PRINTSENSE_CORPUS_IMAGES=/tmp/corpus \
  doppler run -p factorylm -c stg -- py -3 -m pytest tests/printsense/test_metamorphic.py -q

# Full staging acceptance suite + Markdown/HTML report
doppler run -p factorylm -c stg -- py -3 tools/printsense_acceptance.py
```

The acceptance command runs Layer 1 always, Layer 2 when `PRINTSENSE_PAID=1`, Layer 3 when the
Telethon creds are present, and writes `printsense/benchmarks/_acceptance_out/acceptance_report.{md,html}`.

## Credentials (Layer 3) — loaded from env, never committed, never logged

| Var | Meaning |
|---|---|
| `TELEGRAM_TEST_API_ID`, `TELEGRAM_TEST_API_HASH` | Telegram API app creds |
| `TELEGRAM_TEST_SESSION` | a `StringSession` for a **dedicated test USER account** (never a bot — a bot cannot message another bot) |
| `PRINTSENSE_STAGING_BOT` | bot under test (default `@Mira_stagong_bot`) |

All are read from the environment (Doppler `factorylm/stg`), never printed, never written to git.
The client asserts the session is a user (`not me.bot`) before sending.

`TELEGRAM_TEST_SESSION` is generated **once** by an interactive login:
`doppler run -p factorylm -c stg -- py -3 tools/printsense_make_test_session.py` prints a
`StringSession` — store it with `doppler secrets set TELEGRAM_TEST_SESSION=… -p factorylm -c stg`.
Until it exists, `creds_available()` is false and Layer 3 skips.

## CI

- **`ci.yml`** → the `PrintSense … harness gate` step runs `tests/printsense/` on every PR
  (Layer 1 + Layer 2's free part; Layer 2 paid + Layer 3 auto-skip — no `PRINTSENSE_PAID`,
  no `telethon`, no creds). Hermetic — the Anthropic SDK is not installed, so the paid API
  cannot be called from PR CI.
- **`printsense-nightly.yml`** → Layer 2 paid metamorphic matrix, scheduled (installs tesseract).
- **`printsense-staging-e2e.yml`** → the Layer 3 **autopilot**: `workflow_dispatch` + `schedule`
  only (**no `release` trigger**). While PR #2665 is open it polls Doppler stg for
  `TELEGRAM_TEST_SESSION` and the corpus source; it **skips cleanly** while either is absent, and
  once the PR is closed/merged it self-stops. When both are present it checks out the **exact
  PR-head SHA** (not the branch), fetches + verifies the protected corpus, installs tesseract, runs
  the route-aware 7-check E2E, uploads the report + evidence, posts the result (with the tested SHA)
  to #2665, and — if the E2E is green and the head is unchanged — enables **normal GitHub auto-merge**
  (head-guarded, **no admin override**, branch protection never bypassed). If auto-merge is unavailable it
  posts the green report and asks for a normal human merge.

All workflows are gated on `DOPPLER_TOKEN`, load every credential through Doppler, deploy nothing,
and touch no production secret. `TELEGRAM_TEST_SESSION` is used in-process only — never printed,
logged, uploaded, posted, or passed as a CLI argument.
