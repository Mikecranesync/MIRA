# FactoryLM Technician Beta Recovery PRD

**Status:** Approved for implementation planning  
**Owner:** Mike Crane  
**Implementation agent:** Claude Code  
**Written:** 2026-08-29  
**Target:** Synthetic design-partner gate within 30 days  
**Deploy truth reviewed:** `origin/main` at `89adee90b3ebb31b5117a5cfa23341ce90ff239e`  
**Primary product contract:** `docs/specs/mira-technician-app-dogfood-system.md`  
**Sensor contract:** `docs/prd/2026-08-28-sensor-v0-contract.md`  
**Recovery issues:** #3437, #3468, #3469, #3470, #3453, #3353  

---

## 1. Executive decision

FactoryLM will spend the next 30 days making the existing technician app dependable before adding
new sensing or conversation features.

The recovery train is stabilization-first:

1. make tenant-private, explicitly confirmed documents retrievable under the production approval
   gate;
2. make the beta gate exercise production-equivalent approval behavior;
3. make Machine Memory truthful and operational on CV-101;
4. make Android capture and response behavior honest; and
5. prove the complete workflow with five isolated synthetic technician personas using unfamiliar
   manuals.

The milestone is named **synthetic design-partner gate passed**. It does not mean that a human design
partner has validated usability, willingness to pay, or field outcomes. Human technician validation
is the next gate and is outside this PRD.

Claude owns merge-ready code, migrations, tests, documentation, workflows, and dry-run operational
tools. Mike owns production secrets, production migration approval, production deployment, physical
bench actions, APK installation on the Pixel, and merges.

---

## 2. Problem statement

FactoryLM's architecture is stronger than its production experience. The product has page-linked
citations, an explicit evidence ladder, provider-free refusal, read-only equipment boundaries, and a
bounded Machine Memory replay model. The primary technician workflow nevertheless fails in deployed
truth:

- fresh PDF, text, and OCR uploads can be indexed but excluded from retrieval because
  `MIRA_ENFORCE_APPROVED_RETRIEVAL=true` filters `knowledge_entries.verified=true`, while the v2
  tenant upload path does not set that column (#3437);
- sources confirmed before the nameplate-specific verification fix can be refused on every question
  even though the source remains visible and was previously citable (#3468);
- the staging beta gate can be green without reproducing the production approval flag;
- an empty CV-101 replay window offers `Ask MIRA what happened`, then fails the approved-context gate
  (#3469);
- replay can display current cache freshness as `Live` beside an empty historical window and can leak
  `_stale_s` into technician copy (#3470);
- the run-diff historian is disabled by default and the differentiating Machine Memory faculty is not
  yet proven as a continuously running production capability;
- Android image actions use a gallery picker where the interface promises a camera (#3353); and
- Android receives a buffered response while presenting token streaming and Stop behavior the native
  transport cannot guarantee (#3453).

These are coherence and operationalization failures, not a reason to replace the existing product
model. This PRD preserves the Notebook, evidence, inference, safety, tenant, and Machine Memory seams.

---

## 3. Product outcome

At day 30, a synthetic technician unfamiliar with FactoryLM must be able to:

1. start in a fresh isolated tenant;
2. create or open an equipment notebook without pre-seeded equipment knowledge;
3. upload a previously unseen equipment manual;
4. explicitly confirm that manual for the notebook;
5. ask a question whose answer exists only in that manual;
6. receive a grounded answer with a citation to the correct document and passage;
7. open the cited passage or source target;
8. ask an unsupported machine-specific question and receive an honest provider-free refusal;
9. pass a separate synthetic CV-101 observer that verifies Machine Memory without an empty window
   being labelled or actionable as live evidence; and
10. use the Android capture/chat surface without a gallery action masquerading as camera capture or a
    buffered request masquerading as cancellable streaming.

The final automated gate uses five synthetic technician personas. At least four must complete the
supported manual-to-citation journey within ten minutes of measured wall-clock time. Security,
tenant-isolation, false-grounding, wrong-citation, and misleading-live failures are hard failures and
cannot be hidden inside the one allowed persona miss.

---

## 4. Success metrics

### 4.1 Release-blocking metrics

| ID | Metric | Required result |
|---|---|---|
| M1 | Fresh private upload retrieval under the approval gate | 100% for PDF, text, and OCR/nameplate fixtures |
| M2 | Previously confirmed source retrieval | 100% for eligible pre-fix fixtures |
| M3 | Cross-tenant retrieval and citation | 0 occurrences |
| M4 | Supported synthetic technician journeys | At least 4 of 5 pass |
| M5 | Hard-trust synthetic failures | 0 across all 5 personas |
| M6 | Supported answer provenance | `answered`, non-null provider/model usage, correct source identity, usable citation target |
| M7 | Unsupported grounded ask | `insufficient_evidence`, zero citations, no provider/model call |
| M8 | Empty/unavailable replay CTA | Never rendered |
| M9 | Empty historical window labelled `Live` | 0 occurrences |
| M10 | CV-101 operational Machine Memory | Writer heartbeat healthy for 7 consecutive days and at least one real, non-seeded recorded fault window contains rows |
| M11 | Android camera action | Opens the native capture intent/plugin; gallery remains a separate explicit choice |
| M12 | Android response honesty | Buffered native UI has no Stop or streaming claim; true native streaming remains outside this recovery scope unless Mike approves a separate cookie/CORS ADR |

### 4.2 Non-blocking observations

Record but do not gate the release on:

- median and p95 upload-to-ready duration;
- median and p95 question-to-first-visible-result duration;
- provider latency and token usage;
- OCR quality and number of extracted nameplate fields;
- synthetic persona retries;
- screenshot or copy-quality findings classified P3; and
- one persona's non-trust failure when the other four pass.

No metric may silently discard a failure as a timeout placeholder. Infrastructure timeouts and
product failures must be counted separately.

---

## 5. Non-goals

This PRD does not authorize:

- LISTEN, VIBRATION, calibrated phone measurements, live video, or external instruments;
- thread titles, chat search, export, regenerate, reactions, or a second conversation store;
- pricing, billing, public launch, legal readiness, or a claim of human design-partner validation;
- a new evidence database, a new provider cascade, a new safety classifier, or a second chat route;
- automatic promotion of arbitrary uploads or KG relationships to globally verified truth;
- PLC, VFD, robot, alarm-acknowledgement, reset, setpoint, or any other equipment write;
- a direct mobile-to-PLC, mobile-to-Ignition, or cloud-to-fieldbus connection;
- replacing the CMMS, historian, SCADA, or existing synthetic-dogfood runner;
- production SQL, production Doppler changes, direct VPS container restarts, or production deploys by
  Claude; or
- work in `mira-hud`, `mira-prototype`, or `mira-connect`.

---

## 6. Product and architecture invariants

The implementation must preserve all of the following:

1. **Universal Technician Rule:** configuration improves specificity but never unlocks the right to
   ask a general question.
2. **One Notebook conversation:** phone and web use the existing equipment-notebook turn store and
   chat route.
3. **One evidence model:** document citations, visual observations, and machine evidence use the
   existing turn evidence contracts.
4. **Server-owned admission:** the client may request source IDs, but only the server may derive the
   tenant-owned, notebook-linked, enabled, confirmed source set used for retrieval.
5. **No global trust promotion by upload:** tenant-private retrieval admission is not the same thing
   as promoting a document or KG relationship to globally verified truth.
6. **Provider-free abstention:** no admissible evidence means no provider call, no citations, and no
   invented answer.
7. **Read-only toward equipment:** all existing fieldbus and one-pipeline guards remain green.
8. **Two clocks and two freshness questions:** `live now?` and `what was recorded in this historical
   window?` are distinct facts and must never be collapsed into one label.
9. **One ingest route:** synthetic tests upload through the real application route. They may not
   insert retrieval rows directly or seed SQL to manufacture a pass.
10. **Deployment truth:** beta readiness is judged from production-equivalent configuration and
    deployed behavior, not a convenient working tree or flag-disabled staging build.

---

## 7. Workstream A — coherent private-source retrieval

### 7.1 Objective

Restore the promise that an authorized tenant user can attach and explicitly confirm a private
manual, then receive grounded citations from it while production approval enforcement remains on.

### 7.2 Required admission model

Claude must implement one server-owned retrieval-scope decision with these semantics:

- a shared or OEM corpus chunk remains subject to the canonical global verification rule;
- a tenant-private chunk is eligible only when it belongs to the signed-in tenant and its document is
  in the server-derived source scope for the current notebook or canonical node-chat relationship;
- a notebook source is in scope only when its relationship is enabled and in an explicitly confirmed
  state such as `user_confirmed` or `verified`;
- client-supplied source IDs are an intersection request, never authority;
- a candidate, disabled, foreign-tenant, deleted, failed-ingest, zero-chunk, or unrelated source is
  never eligible;
- admission of a private notebook source must not set a KG relationship to `verified` or make the
  document globally shared; and
- the meaning of `namespace_direct_uploads.verified`, `knowledge_entries.verified`, and notebook
  confirmation must be documented at their owning seams so a future change cannot silently conflate
  retention governance, global corpus trust, and tenant-private retrieval admission again.

Preferred shape: derive `approvedSourceDocIds` in the Notebook/server relationship layer, pass only
that server-authorized set into retrieval, and allow tenant-private rows for those IDs while retaining
`verified=true` for shared corpus rows. Claude may choose an equivalent implementation only if the PR
documents why it has the same or stronger isolation and governance properties.

### 7.3 Historical repair

Claude must provide a dry-run repair tool or migration query for historical sources affected by
#3468. It must:

- enumerate affected tenant, notebook, source document, relationship state, chunk count, and current
  retrieval-admission result;
- restrict eligibility to already explicit confirmation evidence;
- be idempotent;
- produce counts before and after;
- refuse broad execution without a tenant predicate or an approved migration workflow; and
- never blanket-set every `is_private=true` chunk to globally verified.

If the corrected retrieval query makes historical rows eligible without mutation, the tool should
report that no data rewrite is required. Do not create a migration merely to appear active.

Mike must approve any production migration through `apply-migrations.yml` dry-run then apply. Claude
must not run raw SQL against production.

### 7.4 Required tests

Tests must fail before the fix and pass after it for:

1. fresh tenant-private PDF upload, confirmed and selected;
2. fresh tenant-private text upload, confirmed and selected;
3. confirmed OCR/nameplate-derived document;
4. confirmed pre-fix source with `knowledge_entries.verified=false`;
5. shared OEM source with `verified=false` remaining excluded;
6. private candidate source remaining excluded;
7. private disabled source remaining excluded;
8. same document ID requested from another tenant remaining excluded;
9. forged client source ID not linked to the notebook remaining excluded;
10. admin namespace verification retaining its documented governance behavior; and
11. Hub NodeChat beta behavior remaining green.

### 7.5 Exit gate

Workstream A exits only when all retrieval-isolation tests pass and a disposable dev/staging tenant
completes upload -> confirmation -> supported question -> correct citation with the approval gate on.

---

## 8. Workstream B — production-equivalent beta gate

### 8.1 Objective

Make green CI mean the behavior production depends on is actually exercised.

### 8.2 CI requirements

Update the beta workflow so it:

- explicitly starts the Hub with `MIRA_ENFORCE_APPROVED_RETRIEVAL=true`, rather than inheriting an
  ambiguous staging value;
- prints a non-secret startup assertion that the effective gate is enabled;
- provisions a fresh tenant and fresh credentials for every run;
- creates a fresh notebook/node relationship through the real application surface;
- generates or uploads a previously unseen manual with a run-unique sentinel fact;
- waits for the actual ingestion readiness contract rather than sleeping a fixed interval;
- explicitly confirms the source through the product contract;
- asks a question answerable only from the sentinel fact;
- asserts `answered`, correct citation document, correct cited passage/page identity, non-null
  provider/model usage, and no other-tenant citation;
- asks an unsupported grounded question and asserts provider-free `insufficient_evidence`;
- cleans up only the run-owned tenant records; and
- uploads redacted Hub logs, Playwright/API artifacts, and timings on failure.

The gate must fail if it passes only because the source is already present in shared corpus. Before
upload, it must ask for the run-unique sentinel in grounded mode and receive provider-free
`insufficient_evidence`; after upload and confirmation, the same sentinel must become answerable only
from the run-owned document. Staging may additionally verify absence through an approved inspection
workflow, but the production probe must not require raw database access.

### 8.3 Post-deploy probe

Claude must add a manually dispatched, production-targeted version of the same probe or a reusable
script invoked by the deploy workflow. It must default to dry-run/no-op unless all QA-tenant inputs are
present. It may create and clean isolated QA records through public application APIs, but it must not
use raw production SQL.

Mike owns dispatch authorization and production credentials. A merge may be green without Mike
dispatching the probe; a design-partner-readiness claim may not.

### 8.4 Exit gate

Workstream B exits when the staging CI gate fails under a deliberately reintroduced `verified=false`
regression and passes with the fix, using the same effective approval flag as production.

---

## 9. Workstream C — Machine Memory truth and operation

### 9.1 Objective

Make REPLAY either useful or explicitly unavailable. It must never offer an answer from zero recorded
observations or combine current-cache freshness with historical-window coverage as though they were
the same fact.

### 9.2 UI and API requirements

- `Ask MIRA what happened` renders only when the served historical window contains at least one
  admissible recorded observation and `reason != unavailable`.
- An empty served window renders: `Nothing was recorded in this window. Widen the window or check the
  gateway.` It sends no `machineEvidence`.
- Missing Machine Memory tables remain different from a valid window with zero rows.
- Current signal freshness is labelled separately as `Current connection` or equivalent.
- Historical coverage is labelled from the returned window: recorded observation count, bounds, and
  whether the history source was available.
- No UI string may call an empty historical window `Live`.
- `_stale_s`, raw tag suffixes, and internal UNS fragments do not appear as fault titles. Use the
  canonical anomaly/fault summary mapping; do not solve this with a one-off string replacement in the
  component.
- Both event and ingest clocks remain visible when they materially diverge.
- A failed or empty replay ask does not persist a fabricated answered turn.

### 9.3 Operational preparation

Claude must provide a read-only preflight that reports, without printing secrets:

- whether `MIRA_RUN_DIFF_ENABLED` is effectively enabled;
- whether configured Machine Memory UNS paths include CV-101;
- whether fault-trigger tags are configured;
- latest ingest heartbeat and age;
- latest historian/run-diff execution and age;
- latest CV-101 fault window and its row count;
- whether rows are physical, simulated, stale, or unknown; and
- a GO/NO-GO result with stable reason codes.

The preflight may inspect dev/staging through approved application or inspection workflows. Claude may
prepare the production command, but Mike runs it and changes Doppler.

### 9.4 Seven-day synthetic observation gate

Extend the existing scheduled synthetic-dogfood runner with a CV-101 Machine Memory observer. It is a
read-only observer, not a fault generator and never controls equipment.

For seven consecutive scheduled days it records:

- runner timestamp and deployed version;
- current connection freshness;
- historian heartbeat;
- latest recorded fault-window identity;
- row count and window bounds;
- quality and physical/simulated classification; and
- whether the UI/API state matches the underlying response.

To declare Machine Memory operational, the seven-day series must have no misleading-live or
unavailable-as-empty defects, and at least one real non-seeded CV-101 fault window in the period must
contain recorded rows. If no physical fault occurs, Mike may create one using the bench's existing
physical controls. Claude and the synthetic agents may not operate the machine or seed SQL.

### 9.5 Exit gate

Workstream C exits when deterministic tests cover empty, unavailable, stale, simulated, current-live,
and non-empty historical cases, and Mike has attached the seven-day production artifact satisfying
the operational criteria.

---

## 10. Workstream D — Android credibility

### 10.1 Camera behavior

The Android actions labelled as photography must open a native camera capture flow. Gallery/file
selection remains available as a separate, honestly labelled action.

Requirements:

- use a dependency compatible with the repository's Apache-2.0/MIT license constraint;
- preserve the existing file-parking, hashing, MIME validation, size limit, tenant ownership, and
  evidence-association paths after capture;
- cancellation returns to the prior screen without creating an upload or error toast;
- permission denied, no camera, capture failure, and user cancellation have distinct states;
- captured timestamps describe the observation action, not merely the first time deduplicated bytes
  were parked;
- QR scanning behavior remains unchanged; and
- the native dependency/fingerprint change is documented as requiring an APK release rather than OTA.

### 10.2 Response behavior decision

This PRD chooses **honest buffered Android responses** as the default recovery path. Claude must not
silently merge the held CORS/cookie-store design from #3454 or move authentication cookies across the
WebView boundary without a separate Mike-approved ADR.

On native Android while the Capacitor HTTP patch buffers the response:

- show an indeterminate `MIRA is answering...` state;
- do not paint a token-streaming affordance;
- do not render Stop when the underlying request cannot be cancelled end-to-end;
- preserve Retry with the byte-identical question on failure;
- persist only the server's final canonical turn; and
- keep real web streaming and web cancellation unchanged.

If Mike supplies a separate written authorization for the cookie/CORS trust boundary before this
workstream starts, Claude may instead complete true native streaming, but the acceptance gate must
prove multiple content frames and server-side cancellation on an Android build. A visual animation
or client-only abort is not proof.

### 10.3 Synthetic Android tests

The synthetic mobile lane must prove on an Android emulator or equivalent native test build:

- camera action invokes the capture plugin/intent rather than the gallery picker;
- a synthetic camera image returns through the real upload and LOOK/nameplate path;
- gallery remains separately reachable;
- cancellation creates no file;
- buffered transport shows no Stop or streaming claim;
- failure restores the question for Retry; and
- the captured evidence opens from the resulting turn/source association.

Mike performs the final physical Pixel installation and camera smoke. Claude prepares the APK,
checksums, signer/version evidence, installation command, rollback command, and test script but does
not install or distribute the build without Mike.

### 10.4 Exit gate

Workstream D exits after emulator-native evidence is green and Mike attaches a physical Pixel smoke
showing camera capture, cancellation, upload, citation/evidence viewing, and honest buffered response.

---

## 11. Workstream E — synthetic technician design-partner gate

### 11.1 Reuse requirement

Extend these existing seams:

- `mira-hub/tests/e2e/synthetic-day.spec.ts` or a focused sibling spec;
- `mira-crawler/agents/synthetic_dogfood.py`;
- `mira-crawler/tasks/synthetic_dogfood.py`;
- `mira-crawler/tests/test_synthetic_dogfood.py`; and
- `docs/runbooks/synthetic-dogfood-agents.md`.

Do not create a second scheduler, issue reporter, artifact root, credential system, or finding schema.
The existing four seeded business-role journeys remain intact. The five new personas are a separate
technician recovery battery because they require fresh tenants, dynamic manuals, real grounded chat,
and destructive cleanup scoped to their own run.

### 11.2 Synthetic technicians

Each persona receives a unique fresh tenant, credentials, notebook, and dynamically generated manual.
Manual content uses fictional equipment and a run-unique sentinel so no answer can come from shared
corpus or model memory.

| Persona | Working style | Manual fixture | Supported task | Deliberate pressure |
|---|---|---|---|---|
| Elena Ruiz | Apprentice electrical technician; literal, short prompts | Zephyr ZX-9000 drive | Find the sentinel fault code and first permitted check | Needs clear next step and exact citation |
| Marcus Lee | Senior mechanical technician; terse field language | Northstar CV-42 conveyor | Find sentinel belt-tension inspection interval | Uses colloquial wording not copied from the manual |
| Priya Shah | Controls technician; precise and skeptical | RelayWorks IO-88 remote I/O | Decode sentinel LED sequence and communication check | Challenges whether the answer came from her source |
| Devon Brooks | Night-shift generalist; incomplete context | Meridian PX-210 pump | Find sentinel seal-flush requirement after one clarifier | Begins vague, then supplies model/context |
| Sam Ortega | Lead technician; actively tests refusal | Apex TH-500 process oven | Find one supported limit, then request an absent torque value | Must receive one cited answer and one provider-free refusal |

The manuals may be generated from deterministic Markdown/HTML fixtures and rendered to PDF during the
test. Each contains:

- a run-unique equipment identifier;
- a run-unique answer sentinel;
- at least three pages so page targeting is meaningful;
- one supported fact phrased differently from the persona's question;
- one explicitly absent fact used for refusal;
- no real vendor trademarks, confidential documents, or customer data; and
- a manifest containing expected document hash, page, passage, answer terms, and absent terms.

### 11.3 Journey contract

Every persona must execute through product/API boundaries in this order:

1. provision or register a fresh isolated tenant and user;
2. authenticate through the supported session path;
3. create a notebook;
4. upload the run-owned manual through the real file-intake route;
5. observe explicit queued/uploading/indexing/ready or API-equivalent state transitions;
6. explicitly confirm/enable the source;
7. ask the supported question in grounded mode;
8. receive `answered` with non-null usage/provider evidence;
9. assert the answer contains the required sentinel meaning without demanding exact prose;
10. assert every citation belongs to that tenant, notebook, and uploaded document;
11. open or fetch the citation target and verify the expected page/passage;
12. ask the unsupported machine-specific question with the source still selected;
13. receive provider-free `insufficient_evidence` with zero citations;
14. record timing, traces, screenshots, answer basis, citations, and refusal evidence; and
15. delete only resources carrying the run ID, then verify cleanup.

At least the upload, confirmation, supported ask, citation opening, and unsupported refusal must be
driven through Playwright user-visible controls. API helpers may provision isolated accounts and
verify server-side evidence, but they may not bypass the product journey under test.

### 11.4 Pass rules

A persona passes when the whole supported journey completes within ten minutes of wall-clock time and
the unsupported ask refuses correctly.

The battery passes when:

- at least four of five personas pass;
- all five maintain tenant isolation;
- all answered turns cite only their own manual;
- all unsupported turns abstain without provider usage;
- no persona sees fabricated live or historical evidence;
- cleanup succeeds or produces an isolated cleanup artifact requiring manual review; and
- no P0/P1 finding remains open from the final run.

The allowed one-persona miss may be caused by a clearly classified usability, transient provider, or
timing failure. It may not be caused by cross-tenant access, false citations, ungrounded answer status,
unsafe advice, incorrect read-only behavior, or misleading live-state claims. Any such hard-trust
failure fails the whole battery.

### 11.5 Findings and artifacts

Extend the current finding schema with stable recovery scenarios and reason codes without breaking old
parsers. Required artifact fields:

- run ID, persona ID, tenant ID hash, deployed commit/version, and target environment;
- fixture document hash and expected citation manifest;
- step timings and final status;
- answer status, basis, model/provider presence, and provider-call evidence;
- citation document ID hash, page, target status, and passage match;
- unsupported-question refusal evidence;
- screenshots and Playwright trace paths;
- cleanup status;
- redacted failure details; and
- stable `DOGFOOD-FINGERPRINT` for issue dedupe.

Credentials, cookies, raw tenant IDs in public issues, tokens, customer data, and full uploaded manuals
must be redacted. P0/P1/P2 findings reuse the existing deduplicated GitHub issue reporter. Runs begin in
dry-run issue mode.

### 11.6 Exit gate

Workstream E exits after two consecutive complete battery runs against the release candidate pass the
rules above. A single lucky run is insufficient.

---

## 12. Delivery sequence and PR boundaries

Claude must not implement this PRD as one large branch or PR.

| Order | PR | Scope | Dependency |
|---:|---|---|---|
| 1 | Retrieval admission and regression tests | Workstream A code and focused tests | None |
| 2 | Approval backfill/preflight and beta-gate parity | Workstream A repair tool + Workstream B | PR 1 |
| 3A | REPLAY truth UI/API | Workstream C deterministic code/tests | PR 2 |
| 3B | Android camera and buffered-honesty behavior | Workstream D | PR 2; may run parallel with 3A |
| 4 | Synthetic technician battery | Workstream E runner, fixtures, artifacts, runbook | PRs 1-2; may develop alongside 3A/3B but final gate waits |
| 5 | Operational proof documentation | Seven-day Machine Memory artifact + two final battery runs + release decision | PRs 3A, 3B, 4 and Mike gates |

Each PR must be independently reversible and preserve the prior public contract when its feature flag
or operational switch is off. No PR may include unrelated refactors.

---

## 13. Thirty-day schedule

| Days | Outcome |
|---|---|
| 1-2 | Freshness/coordination audit, failing regression fixtures, final retrieval-admission design recorded in PR 1 |
| 3-6 | PR 1 implementation and focused integration proof |
| 5-8 | PR 2 repair preflight, production-equivalent gate, staging proof |
| 9-14 | PR 3A REPLAY truth and PR 3B Android credibility in parallel |
| 10-17 | PR 4 synthetic technician fixtures, personas, Playwright journeys, and artifact schema |
| 15-23 | Mike enables approved production configuration/deploys; seven-day observer runs; Claude fixes code-only findings through separate PRs |
| 24-27 | First complete five-persona release-candidate battery; resolve P0/P1 findings |
| 28-29 | Second consecutive complete battery; physical Pixel smoke by Mike |
| 30 | Release decision and evidence packet: synthetic gate PASS or explicit NO-GO with unresolved reasons |

If Workstream A is not green by day 6, freeze C/D/E feature implementation and keep only test-fixture
preparation moving. Do not polish a workflow whose primary retrieval path is still broken.

---

## 14. Claude execution contract

Before touching code, Claude must:

1. read root `AGENTS.md`, relevant module `AGENTS.md` files, `wiki/hot.md`, this PRD, the technician
   dogfood system, and the Sensor v0 contract;
2. fetch `origin/main` and run `wiki/orchestrator/freshness-guard.sh` for every audited path;
3. run the coordination checks required by the active MVP plan;
4. work from fresh branches/worktrees based on current `origin/main`, never from the stale checkout
   that was 651 commits behind when this PRD was written;
5. inspect open PRs/issues touching the same files and stop for coordination on overlap; and
6. write failing tests before changing implementation behavior.

During execution, Claude must:

- use only Apache-2.0 or MIT dependencies;
- use Doppler references without reading or copying production secrets;
- never run `psql` or raw SQL against production;
- never restart/rebuild VPS containers directly;
- never send traffic that controls equipment;
- never merge or push to `main`;
- use conventional commits;
- preserve unrelated user changes and untracked files;
- include exact test commands and artifacts in every PR;
- keep issue mode dry-run until Mike reviews the first artifact; and
- stop for Mike whenever a step requires production config, deployment, physical bench action,
  physical-device installation, or a security-boundary decision.

Claude may autonomously:

- create fresh feature worktrees/branches;
- edit code, tests, migrations, workflows, and documentation within an approved workstream;
- run offline, dev, disposable-database, staging, Playwright, and emulator tests that comply with
  environment doctrine;
- open merge-ready PRs; and
- comment evidence on existing issues when the PR/workstream explicitly calls for it.

Claude must not close #3437, #3468, #3469, #3470, #3453, or #3353 merely because unit tests pass.
Closure requires the corresponding deployed or device acceptance evidence named in this PRD.
Choosing the buffered-honesty fallback does **not** satisfy #3453's true-streaming acceptance gate;
that issue remains open or is explicitly deferred with a link to the separate ADR decision.

---

## 15. Verification commands and evidence expectations

Claude must discover the exact current package commands rather than blindly copy stale commands. At a
minimum, each affected lane must produce:

- focused unit tests for changed pure logic;
- focused integration tests against a disposable or approved dev/staging database;
- TypeScript lint/type checks for changed Hub/mobile files;
- Python `ruff` and pytest for changed crawler/agent files;
- Playwright results for web journeys;
- Android emulator-native results for mobile behavior;
- `git diff --check`;
- read-only and one-pipeline guard results; and
- a PR-specific evidence manifest.

The final evidence packet must link:

1. PRs and deployed commit/version;
2. Workstream A retrieval matrix;
3. production-equivalent beta-gate run;
4. seven-day CV-101 Machine Memory artifact;
5. Android emulator proof and Mike's physical Pixel smoke;
6. two consecutive synthetic technician battery reports;
7. open/closed recovery issues; and
8. unresolved deviations and explicit owner.

No screenshot alone proves backend retrieval, provider cancellation, tenant isolation, or Machine
Memory operation. No API response alone proves the technician UI journey. The evidence packet needs
both where the requirement crosses both layers.

---

## 16. Failure handling and stop conditions

Claude must stop the affected workstream and report rather than improvise when:

- the current production schema differs from the migration assumptions;
- two active PRs modify the same retrieval or chat seam incompatibly;
- a fix would require weakening tenant isolation or global approval semantics;
- an Android streaming solution requires moving session cookies or opening CORS beyond the approved
  trust boundary;
- a test needs raw production SQL, production secrets, or direct VPS mutation;
- Machine Memory proof would require seeded history to look operational;
- a synthetic persona can pass using shared corpus rather than its uploaded sentinel manual;
- a dependency license is not Apache-2.0 or MIT;
- a safety or equipment-write guard fails; or
- a hard-trust failure appears in any synthetic persona.

When blocked, Claude records the exact condition, completed safe checks, smallest decision Mike must
make, and which acceptance gate remains red.

---

## 17. Release decision

The final decision is binary:

### PASS — synthetic design-partner gate passed

All release-blocking metrics pass, Mike's production/device gates are attached, and two consecutive
five-persona battery runs meet the pass rules. Product language may say:

> FactoryLM has passed its synthetic technician beta-recovery gate for manual-grounded answers,
> evidence honesty, and read-only Machine Memory behavior.

It may not say that technicians validated it, customers want it, or the product is paid-beta-ready.

### NO-GO

Any release-blocking metric remains red, any hard-trust failure occurs, Machine Memory lacks real
recorded rows, or production/device evidence is missing. The evidence packet must name the smallest
remaining blocker and preserve the honest current score.

---

## 18. Traceability

| Requirement | Primary proof |
|---|---|
| Private confirmed source retrieves | Workstream A integration matrix + beta gate |
| Historical confirmed source retrieves | #3468 regression fixture |
| Approval gate matches production | Workflow effective-config assertion |
| Cross-tenant denial | Integration test + five-persona citation ownership checks |
| Honest refusal | Provider/model-null assertion on unsupported asks |
| Empty REPLAY honesty | Mobile component/API tests + synthetic observer |
| Real Machine Memory | Seven-day artifact with non-seeded CV-101 rows |
| Native camera | Emulator proof + Mike Pixel smoke |
| Buffered-response honesty | Android native test; Stop absent on buffered transport |
| Synthetic design-partner gate | Two consecutive five-persona reports |
| Read-only equipment posture | Existing fieldbus/one-pipeline guard suites |

---

## 19. First task for Claude

Claude begins with Workstream A only.

The first deliverable is a short implementation design in the PR body or linked plan that identifies:

1. the current server authority that derives notebook source scope;
2. every call site that supplies client-requested document IDs;
3. the exact SQL behavior for shared verified corpus versus confirmed tenant-private sources;
4. the historical #3468 case and whether it needs data mutation after the query fix;
5. failing tests for the eleven cases in section 7.4; and
6. the smallest independently mergeable diff.

Claude must not begin Machine Memory, Android, or synthetic-runner implementation until Workstream A's
design is reviewed and its failing tests demonstrate the production defect.
