# P0004G — Hub canonical inference seam + per-turn cost telemetry

**Slice:** the smallest end-to-end step toward one canonical MIRA runtime.
**Status:** implemented, flag-gated **default OFF**, proven against real providers and on an emulator.
**Depends on:** nothing unmerged. Deliberately built on `main`, not on the MIRA-1000 stack — see §5.

---

## 1. What this removes

The P0004 map (§1) found **two MIRA runtimes**, and technicians reach the TypeScript one. Inside
that path there was a second, smaller duplication that mattered more immediately:
`equipment-notebooks/[id]/chat/route.ts` defined its **own provider cascade inline**, which had
drifted from the canonical Python cascade (`mira-bots/shared/inference/router.py`) in two ways:

| | Legacy inline cascade | Canonical seam |
|---|---|---|
| Providers | Groq → Cerebras → **Gemini** | Groq → Cerebras → **Together** |
| Hard Constraint #2 | violated (map §10 Q4) | honoured |
| `stream_options.include_usage` | absent | present |
| Per-turn tokens / cost | **none at all** | provider, tokens, cached tokens, cost estimate |
| Fallback chain recorded | no | `routeReason` |
| Per-turn cost ceiling | none | `MIRA_TURN_MAX_OUTPUT_TOKENS` |

The second row is the substantive one: because `include_usage` was never requested, **no turn on the
technician path had any token or cost telemetry**, while ADR-0037 gates Cloud Gold on exactly that.
Cost telemetry was not "on the other runtime" — for these turns it did not exist anywhere.

This slice does **not** create a third chat implementation. It adds no prompt building, no
retrieval, no citation logic, and no persistence. It replaces one inline list with one shared
module and reports what the turn cost.

## 2. Request path — old and new

```
BOTH paths (unchanged):
  mira-mobile / Hub web
    → POST /api/equipment-notebooks/{id}/chat        (NextAuth session; tenant from session)
    → validateChatSources(tenant ∧ notebook ∧ not-rejected)   ← retrieval boundary, before retrieval
    → retrieveNodeChunks(client, tenantId, query, {docIds})   ← SQL-level doc-set enforcement
    → prompt + numbered excerpts
    → provider (streamed deltas)
    → frames: sources → content… → status → [DONE]
    → recordTurn → equipment_notebook_turns

OLD (flag off — still the production path):
    provider selection  = route-local providers()  [Groq, Cerebras, Gemini]
    usage               = never requested, never reported

NEW (MIRA_CANONICAL_SEAM=1):
    provider selection  = @/lib/inference/canonical-cascade  [Groq, Cerebras, Together]
    request             = + stream_options.include_usage, max_tokens ≤ cost ceiling
    frames              = sources → content… → **usage** → status → [DONE]
    telemetry           = usage frame + one structured `turn.usage` log line
```

Everything before and after the provider call is byte-identical between the two paths.

## 3. The usage record

Field names mirror **migration 078** (`decision_traces.provider / route_reason / input_tokens /
cached_input_tokens / output_tokens / cost_usd_estimate / status`) so the next slice can persist it
without reshaping anything.

```json
{"kind":"usage","provider":"Groq","model":"openai/gpt-oss-120b","routeReason":"primary",
 "inputTokens":1351,"cachedInputTokens":null,"outputTokens":134,
 "costUsdEstimate":0.000303,"status":"ok"}
```

Deliberate choices:

- **`costUsdEstimate` is `null`, never `0`, for an unpriced provider.** `0` renders as "this turn
  was free", which is a lie rather than an estimate.
- **Missing usage yields `null` tokens, not `0`.** A provider that omits the block leaves the cost
  unknown; zero would understate spend.
- **`routeReason`** records the fallback chain (`primary`, `fallback:Groq`,
  `exhausted:Groq,Cerebras,Together`), so a degraded cascade is visible in the ledger.
- **The log line carries no question, answer, or excerpt.** It is a spend record, not a transcript.

## 4. Feature flag and rollback

| | |
|---|---|
| Flag | `MIRA_CANONICAL_SEAM` |
| Default | **OFF** (only the exact string `"1"` enables it) |
| Off behaviour | the pre-existing inline cascade, no `usage` frame, no spend log, original request body |
| Rollback | unset the variable and restart — no migration, no data, no client change |
| Cost ceiling | `MIRA_TURN_MAX_OUTPUT_TOKENS` (default 4000); garbage/non-positive values fall back to the default rather than disabling the cap |

Rollback is proven, not asserted: with the flag off the same question against the same server
returned **0 usage frames, 0 spend logs**, and the identical grounded answer citing p.3.

## 5. Why this is not built on P0002/P0003

The map recommends routing the TS path at the canonical seam. That seam is **Python and unmerged** —
#3339 → #3340 → #3341 → #3342 is a four-deep stack, and stacked PRs in this repo run **only
actionlint**, so none of it has ever seen full CI. Building slice five on top would have inherited
that gap and made this change unverifiable.

This slice instead brings the seam's *contract* to the runtime technicians actually use, on `main`,
with full CI. It is compatible with either resolution of map §10 Q1:

- if the TS path stays, this is the seam;
- if mobile is later routed at the Python runtime, the usage record already matches 078, so the
  ledger does not change shape.

**It does not resolve Q1.** It removes the "no telemetry anywhere" problem that made Q1 urgent.

## 6. Evidence

Real providers, real Hub route, `factorylm/dev` (never prod):

- upload → `indexed: true, chunkCount: 24` through `/api/namespace/node/{id}/files/`
- ask → streamed deltas → answer citing **p.3**, quote *"Step 1 — Stand up the MQTT broker
  (Mosquitto)"* — the page was read out of the PDF beforehand, so this checks the answer rather
  than trusting it
- `usage` frame with real tokens (1351 in / 134 out, $0.000303)
- Android emulator, full technician loop through the app: `PASS`, notebook `c9d89a94…`, served by
  the seam (Groq, 1359 in / 152 out, $0.000318)
- 38 tests: 24 contract + 14 integration through the real `POST` handler

## 7. Next smallest slice

**Persist the usage record into `decision_traces` via migration 078.** The record already matches
the columns; what is missing is the migration, which is a schema change and therefore an explicit
authorization step. That closes the ADR-0037 telemetry gate for the technician path.

After that, in order: turn the flag on in staging → default-on → delete the legacy `providers()`
list (the Gemini divergence disappears with it).
