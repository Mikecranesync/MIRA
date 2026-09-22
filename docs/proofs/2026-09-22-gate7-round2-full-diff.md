# Gate 7 adversarial review — PR #3959

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, tenant scoping, cross-repository contract, production deployment, deletion/destructive, broad multi-module (5 top-level dirs)

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `1ead1fa5da19e18445a817766bb710c55ac9bd83`
- scope (--paths): mira-hub/src
- excluded by scope (13): PLAN.md, docker-compose.saas.yml, docker-compose.staging-vps.yml, docs/audits/2026-09-22-mira-persona-inventory.md, docs/env-vars.md, docs/proofs/2026-09-22-mira-contract-ab-harness.py, docs/proofs/2026-09-22-mira-contract-ab-raw.json, docs/proofs/2026-09-22-mira-contract-ab2-before-fix.json, docs/proofs/2026-09-22-mira-contract-ab2-final.json, docs/proofs/2026-09-22-mira-contract-ab2-harness.py, docs/proofs/2026-09-22-mira-intelligence-contract-acceptance.md, docs/proofs/2026-09-22-parameter-speculation-fix.md, docs/specs/mira-intelligence-contract.md
- diff chars sent/total: 78,759/78,759 (cap 120,000)
- reviewed-diff sha256 (sent bytes): `7cf3682b30883d4ed07e9a9643b2f1c028bedc98560314ebceebdb9924a7197c`
- full scoped-diff sha256 (pre-cap): `7cf3682b30883d4ed07e9a9643b2f1c028bedc98560314ebceebdb9924a7197c`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Stale allow‑list entries break the drift‑guard test** — 
- **[high] Database schema incompatibility for new turn‑mode values** — 
- **[medium] Observability pipeline may reject the new `system_prompt_kind` values** — 
- **[medium] “general” mode is silently remapped to the augmented persona** — 

## Raw review

## VERDICT
**BLOCK** – the change introduces high‑severity regressions that will break CI and can cause runtime failures in production.

## FINDINGS

- **[severity: high] Stale allow‑list entries break the drift‑guard test**  
  *What breaks*: `mira-contract-drift.test.ts` expects every route that contains the literal **“You are MIRA”** to appear in `REMAINING_FORKS`. After the migration the two listed routes no longer contain that literal, so the “allow‑list has no stale entries” assertion fails and the CI test suite will abort.  
  *Diff evidence* (excerpt from `src/lib/__tests__/mira-contract-drift.test.ts`):  

  ```diff
   const REMAINING_FORKS: ReadonlySet<string> = new Set([
     // Migrated but retaining the legacy constants as the flag-off fallback until
     // MIRA_PERSONA_CONTRACT=1 is the proven default. These two DO call the
     // canonical builder; the literals below them are the rollback path.
     "app/api/equipment-notebooks/[id]/chat/route.ts",
     "app/api/hub/ask/route.ts",
     // Not yet migrated — recommended order in the audit §8.
     "app/api/assets/[id]/chat/route.ts",
  ...
   ]);
  ```

- **[severity: high] Database schema incompatibility for new turn‑mode values**  
  *What breaks*: The turn‑recording payload now writes the values `"augmented"` and `"source_only"` to the column `mira.turn.mode`. If the underlying PostgreSQL column (or any downstream storage) is defined as an enum or CHECK constraint limited to `"general"`/`"grounded"`, the INSERT will be rejected, causing a 500 error and loss of turn data. No migration is provided in this PR, and the unit tests use a mocked DB, so the defect is invisible to the test suite.  
  *Diff evidence* (`src/capabilities/observability/turn-recorder.ts` and `src/lib/__tests__/mira-contract-drift.test.ts`):  

  ```diff
  export type TurnRecorderInit = {
    ...
  -  mode?: "general" | "grounded";
  +  mode?: "general" | "grounded" | "augmented" | "source_only";
    ...
  };
  ```

  ```diff
  export type TurnEvidencePacketRequest = {
  -  mode: "general" | "grounded";
  +  mode: "general" | "grounded" | "augmented" | "source_only";
  ```

  ```diff
  export type TurnEvidencePacketContext = {
    ...
  -  system_prompt_kind: "general" | "grounded" | "machine" | null;
  +  system_prompt_kind: "general" | "grounded" | "machine" | "augmented" | "source_only" | null;
  ```

- **[severity: medium] Observability pipeline may reject the new `system_prompt_kind` values**  
  *What breaks*: Down‑stream services that consume `TurnEvidencePacketContext` (e.g. analytics dashboards, alerting scripts) are currently typed to accept only `"general" | "grounded" | "machine"`. Introducing `"augmented"` and `"source_only"` without updating those consumers can cause runtime type errors, malformed metrics, or lost telemetry.  
  *Diff evidence*: Same as above – the enum for `system_prompt_kind` is expanded.

- **[severity: medium] “general” mode is silently remapped to the augmented persona**  
  *What breaks*: The contract defines a distinct **general** persona (no citations, no source‑based reasoning). In `src/app/api/equipment-notebooks/[id]/chat/route.ts` the request flag `mode:"general"` is ignored when the contract is enabled; the code always selects the augmented prompt:  

  ```diff
   const promptMode: MiraMode = sourceOnly ? "grounded" : "augmented";
   const basePrompt = miraContractEnabled()
       ? buildMiraSystemPrompt(promptMode)
       : docGrounded
         ? BASE_SYSTEM_PROMPT
         : GENERAL_SYSTEM_PROMPT;
  ```

  Consequently a client that deliberately sends `mode:"general"` will receive the **augmented** persona, contradicting the contract specification (§3). Existing clients that rely on the old “general” behaviour may see unexpected citations or different answer style when the flag is turned on.

## NOT REVIEWED
- **Database migration** – the actual schema definition for the `turn` table (or any other table that stores `mira.turn.mode` or `system_prompt_kind`) was not examined; we cannot confirm whether the new enum values are already permitted.
- **Production‑grade token limits** – the concatenated system prompt (`MIRA_CORE + evidence + optional extension`) is longer than the previous prompts. We did not verify that the combined prompt stays within the LLM provider’s input‑token limits under real‑world workloads.
- **Down‑stream observability consumers** – we did not run integration tests against the telemetry pipelines that ingest `TurnEvidencePacket*` payloads, so any breakage there remains unvalidated.
- **Security of extensions** – while current extensions are hard‑coded, we did not audit future code paths that might pass user‑controlled strings to `buildMiraSystemPrompt`. If such a path appears, prompt injection could become possible.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
