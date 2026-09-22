# Gate 7 adversarial review — PR #3959

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, tenant scoping, security boundaries, cross-repository contract, production deployment, deletion/destructive, broad multi-module (5 top-level dirs)

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `48ec938cb6a86fb5aa1f0b17cbc8fb93dd790968`
- scope (--paths): full PR diff
- excluded by scope (0): none
- diff chars sent/total: 40,000/345,292 (cap 40,000)
- reviewed-diff sha256 (sent bytes): `329c41a0aae6fb49bd9d1a727cbca8ddd5216a8a700273e49e58945c0273c7e9`
- full scoped-diff sha256 (pre-cap): `6f14163d6f9c113e1ab3452dc9ea6ee053454a0ff28488a37cff452976bea013`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Global `MIRA_PERSONA_CONTRACT` flag bypasses evidence gating, exposing safety‑critical risk** — 
- **[high] Missing test coverage for `MIRA_PERSONA_CONTRACT` flag leads to false‑green regression risk** — 
- **[medium] Unverified claim that production behavior is byte‑identical when flag is off** — 
- **[medium] Inconsistent inclusion of the new flag across deployment configurations** — 
- **[low] Proof harness script contains hard‑coded absolute paths and an unchecked API key** — 

## Raw review

## VERDICT
**BLOCK**

## FINDINGS
- **[severity: high] Global `MIRA_PERSONA_CONTRACT` flag bypasses evidence gating, exposing safety‑critical risk**  
  *What breaks:* The newly added environment variable toggles the core “document gate” and mode routing that previously required explicit source‑only requests for grounded answers. When set to `"1"` the system will answer without citations (augmented mode), potentially providing unsafe or incorrect guidance for technicians. This change is global (applies to all tenants) and lacks per‑tenant scoping, violating the safety guarantees documented elsewhere.  
  *Evidence:*  
  ```diff
  +      - MIRA_PERSONA_CONTRACT=${MIRA_PERSONA_CONTRACT:-0}
  ```  
  (docker‑compose.saas.yml)  
  ```diff
  +      - MIRA_PERSONA_CONTRACT=${MIRA_PERSONA_CONTRACT:-0}
  ```  
  (docker‑compose.staging‑vps.yml)  
  ```diff
  +| `MIRA_PERSONA_CONTRACT` | unset / `0` (**off**) | Exact `"1"` serves the MIRA Intelligence Contract — one persona for every Hub chat surface — and, in the same flag, makes normal authenticated chat **augmented**: documents upgrade an answer and their absence no longer vetoes it. Strict cite-or-refuse becomes `mode:"source_only"`. Off, the route keeps BOTH the pre‑existing prompts and the pre‑existing document gate, byte‑identical. |
  ```  
  (docs/env-vars.md)  

- **[severity: high] Missing test coverage for `MIRA_PERSONA_CONTRACT` flag leads to false‑green regression risk**  
  *What breaks:* The PR introduces a behavior‑changing flag but does not add any unit or integration tests exercising the flag both on and off. The only reference to a test is a textual claim that the behavior is “asserted directly in `augmented‑default.test.ts`”, yet that test is not part of the diff. Without concrete test verification, regressions (e.g., the flag being unintentionally enabled in production) could pass unnoticed.  
  *Evidence:*  
  ```diff
  +No new APK needed
  +An old client's `mode:"general"` and a no‑mode request now produce the same persona, so the client's scope‑derived inference is inert and this ships server‑side. Asserted directly in `augmented‑default.test.ts`.
  ```  
  (PLAN.md)  

- **[severity: medium] Unverified claim that production behavior is byte‑identical when flag is off**  
  *What breaks:* The documentation asserts “Off, the route keeps BOTH the pre‑existing prompts and the pre‑existing document gate, byte‑identical.” This guarantee is not backed by any test or code diff showing that the flag’s presence does not alter request handling, ordering, or side‑effects (e.g., logging, telemetry). If the flag is read anywhere in the code path, even a no‑op check could change the runtime configuration, breaking the byte‑identical promise.  
  *Evidence:*  
  ```diff
  +| `MIRA_PERSONA_CONTRACT` | unset / `0` (**off**) | Exact `"1"` serves the MIRA Intelligence Contract — one persona for every Hub chat surface — and, in the same flag, makes normal authenticated chat **augmented**: documents upgrade an answer and their absence no longer vetoes it. Strict cite‑or‑refuse becomes `mode:"source_only"`. Off, the route keeps BOTH the pre‑existing prompts and the pre‑existing document gate, byte‑identical. |
  ```  
  (docs/env-vars.md)  

- **[severity: medium] Inconsistent inclusion of the new flag across deployment configurations**  
  *What breaks:* The flag is added only to `docker‑compose.saas.yml` and `docker‑compose.staging‑vps.yml`. Other compose files (e.g., dev, test, CI pipelines) are untouched, creating an environment‑drift risk where the flag could be unintentionally enabled in some environments but not others, leading to divergent behavior and hard‑to‑track bugs.  
  *Evidence:*  
  ```diff
  +      - MIRA_PERSONA_CONTRACT=${MIRA_PERSONA_CONTRACT:-0}
  ```  
  (both compose files as shown above)  

- **[severity: low] Proof harness script contains hard‑coded absolute paths and an unchecked API key**  
  *What breaks:* `docs/proofs/2026-09-22-mira-contract-ab-harness.py` uses a user‑specific absolute path (`/Users/charlienode/...`) to locate source files and reads the environment variable `GROQ_API_KEY`. If this script is inadvertently run in CI or by other developers without the expected directory structure, it will fail. Moreover, the script may cause unintended API calls and spend money if executed unintentionally.  
  *Evidence:*  
  ```diff
  +ROOT = "/Users/charlienode/MIRA-worktrees/mira-intelligence-contract/mira-hub/src/lib/mira-contract.ts"
  +KEY = os.environ["GROQ_API_KEY"]
  ```  
  (docs/proofs/2026-09-22-mira-contract-ab-harness.py)  

## NOT REVIEWED
- **Runtime impact of the flag** – The actual code that reads `MIRA_PERSONA_CONTRACT` (e.g., in `mira-contract.ts` or route handlers) is not part of the diff, so we cannot verify that the flag truly toggles only the intended behavior without side effects.  
- **Tenant isolation guarantees** – Whether the flag respects tenant‑level permissions or accidentally leaks data across tenants is unknown without inspecting the runtime code.  
- **Rollback correctness** – The PR claims a simple `unset` will revert all changes, but we cannot confirm that no persisted state (e.g., cached prompts, feature‑flag databases) retains the contract‑enabled configuration after a rollback.  
- **Observability and telemetry** – No changes to logging or tracing are visible, so we cannot assess whether enabling the contract introduces gaps in observability for safety‑critical decisions.  
- **Security boundary testing** – No security tests (e.g., attempts to inject the env var via container injection) are present, so the resistance of the system to malicious toggling of the flag is unverified.  

These items would require running the full test suite, inspecting the production code that consumes the flag, and performing integration/penetration testing to fully evaluate.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
