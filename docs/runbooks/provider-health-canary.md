# Provider Health Canary — runbook

**What:** a scheduled probe that checks every LLM cascade provider
(Groq → Cerebras → Together) **independently** and pages when coverage degrades.

> **2026-09-29: Cerebras archived.** HTTP 402 (quota) on every call since 2026-09-07. The key was moved to `CEREBRAS_API_KEY_ARCHIVED` in Doppler dev/stg/prd and removed from GitHub Actions secrets; the canary now expects Groq + Together only. To restore: rename the Doppler key back, re-add the GitHub secret, and add `"cerebras"` to `EXPECTED` in `tools/provider_health_check.py`.

**Why it exists:** the cascade is resilient by design — if one provider dies the
next answers. That resilience also *hides* a dead provider. Two real incidents
went unnoticed for a while because Groq kept answering:

- **Gemini** key 403-blocked in Doppler → silently dead → eventually replaced by Together.
- **Cerebras** model `llama3.1-8b` retired → 404 on every call → only caught by a manual benchmark.

By the time a human noticed, coverage had quietly dropped from 3 providers to 1.
This canary catches that within an hour instead of at the next demo.

## Pieces

| Piece | Path |
|---|---|
| Probe script | `tools/provider_health_check.py` |
| Workflow | `.github/workflows/provider-health-canary.yml` |
| Cascade config (source of truth) | `mira-bots/shared/inference/router.py` (`_build_providers`) |

The probe **imports `_build_providers()`** so it always tests the exact
url/model/key the runtime cascade uses — no duplicated defaults to drift out of
sync (drift is precisely what hid the Cerebras death).

## How it runs

- **Schedule:** hourly (`cron: 23 * * * *`; every 6h until 2026-10-19) + manual `workflow_dispatch` +
  on push to `router.py` / `docker-compose.saas.yml` / the probe / the workflow.
- **Keys:** Doppler `factorylm/stg` via the shared `DOPPLER_TOKEN`. Provider keys
  are account-global, so stg validates the same Groq/Cerebras/Together accounts
  prod uses.
- **Reasoning-model safety:** probe uses `max_tokens=2048`, a trivial prompt, and
  **one retry** so a reasoning model (Cerebras `gpt-oss-120b`) that occasionally
  returns empty content does NOT false-page.

## Exit codes / alerting

| Exit | Meaning | Run status | Pages? |
|---|---|---|---|
| 0 | all providers UP | green | no |
| 1 | ≥1 provider DOWN (coverage degraded) | red | **yes** — opens/updates a dedup'd `provider-incident` issue |
| 2 | probe could not run (no keys / import error) | red | no (infra, not a provider death) |

Issue severity wording: 1 down = `DEGRADED`, ≥2 down = `CRITICAL`. The issue is
deduplicated by the title marker `LLM provider coverage`, so a multi-cycle outage
updates one issue instead of spawning one every run.

## When the canary pages — what to do

1. Open the failing run; the per-provider log line names the DOWN provider and
   the reason (e.g. `HTTP 404: Model … does not exist`, `auth`, `empty content`).
2. **Retired/renamed model** (404 / `model_not_found`): list the provider's live
   catalog and pick a current model:
   - Groq: `curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"`
   - Cerebras: `curl https://api.cerebras.ai/v1/models -H "Authorization: Bearer $CEREBRAS_API_KEY"`
   - Together: `curl https://api.together.xyz/v1/models -H "Authorization: Bearer $TOGETHERAI_API_KEY"`
   Update the default in `router.py` `_build_providers()` **and** the compose
   `*_MODEL` env, then ship + deploy (`mira-pipeline mira-bot-telegram mira-bot-slack`).
3. **Revoked / 403 key** (`auth`): rotate the key in Doppler `factorylm/prd`
   (and `stg`), redeploy. If the provider is permanently dead, replace it in the
   cascade (as Gemini → Together).
4. **Empty content only** (reasoning model): not a death — the cascade skips it
   (logged as `EMPTY_RESPONSE` in `router.py`). If it's frequent, raise the
   provider's effective token budget or reconsider the model.
5. Re-run the canary (`workflow_dispatch`) to confirm green, then close the issue.

## Run it locally

```bash
doppler run --project factorylm --config prd -- \
  env INFERENCE_BACKEND=cloud PYTHONPATH=mira-bots \
  python tools/provider_health_check.py
```

Exit 0 + `N/N providers UP` = healthy. The probe never prints key values.

## Related

- `mira-bots/shared/inference/router.py` — the cascade + `EMPTY_RESPONSE` log.
- `.claude/rules/...` / memory `feedback_llm_cascade_default.md` — current models/keys.
- Other canaries this is modeled on: `.github/workflows/oauth-redirect-canary.yml`,
  `proposal-state-canary.yml`.

## OpenAI has its own alarm (2026-10-19)

OpenAI leads the cascade and is the one provider the staging acceptance gate and the photo
"look" route depend on. When the probe finds it DOWN, the canary opens (or comments on) a
separate `provider-incident` issue titled **"OpenAI DOWN (lead provider + deploy gate
dependency)"**, in addition to the coverage incident. It is deduplicated on the body line
`canary_marker: openai-down`, not the title, so retitling the issue does not create a duplicate;
keep that line in the body. The likeliest cause is an exhausted
prepaid balance (`insufficient_quota` / `credit_balance_exhausted`) — the 2026-10-18 outage
(#4519) ran 20:59Z–22:40Z, entirely between two 6-hourly runs, so the canary now runs hourly.
The issue is not closed automatically: close it by hand once billing is restored and the next
hourly run shows `openai UP`.
