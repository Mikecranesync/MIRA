# Grounding-Verification Architecture Documentation Plan

> **For agentic workers:** This is a documentation-only plan. Do not implement runtime, schema, prompt, model, deployment, or configuration changes from this plan. Later implementation requires a new, separately approved plan after the detailed catalog schema and runbooks are accepted.

**Goal:** Produce a current-truth visual architecture reference for FactoryLM and MIRA grounding-verification work, with clear links to canonical decisions and clear separation between shipped structure and target seams.

**Architecture:** A single master Markdown document in `docs/architecture/` is the navigable hub. It links to the current contract, ADRs, program PRD, evidence inventory, C4 references, runtime documents, and historical plans; it does not rewrite them. Mermaid diagrams show both the desired architecture and whether each boundary is current or target.

**Tech Stack:** Markdown, Mermaid, repository-relative links, Node.js link validation, Mermaid CLI rendering.

## Global Constraints

- This work modifies planning documentation only.
- Do not modify an existing ADR, C4 document, runtime source file, test, schema, prompt, model, compose file, or deployment configuration.
- The master plan must preserve ADR-0029's hash-stable `EvidenceManifest` boundary and ADR-0033's one-policy rule.
- Historical documents remain linked references and are not silently promoted to current deploy truth.
- Diagrams must distinguish existing interfaces from target integrations.

---

### Task 1: Record the approved documentation design

**Files:**

- Create: `docs/superpowers/specs/2026-07-30-grounding-verification-architecture-design.md`

**Interfaces:**

- Consumes: the approved scope: a current-truth hub, historical C4 references preserved, and no code change.
- Produces: the scope, decisions, diagram set, acceptance criteria, and rejected redraw-everything approach.

- [ ] **Step 1: State the authority model**

Record that ADR-0027/0028/0029/0032/0033, the 2026-07-30 unification PRD, and `materialized_evidence/context_contract.py` provide the current governing inputs; older C4 and prior master plans are historical/reference sources.

- [ ] **Step 2: State the diagram conventions**

Record solid arrows as verified present interfaces, dashed arrows as target integrations, and amber nodes as known gaps requiring a later PR.

- [ ] **Step 3: State the documentation-only boundary**

Record that no code, schema, prompt, model, deployment, or existing architecture document changes are authorized by this slice.

- [ ] **Step 4: Review the design record for ambiguity**

Run:

```bash
rg -n 'TBD|TODO|placeholder' docs/superpowers/specs/2026-07-30-grounding-verification-architecture-design.md
```

Expected: exit code 1 because the document contains no unresolved placeholders.

### Task 2: Create the visual master architecture hub

**Files:**

- Create: `docs/architecture/grounding-verification-master-plan.md`

**Interfaces:**

- Consumes: ADRs, the unification PRD, materialized-evidence documents, the current context contract, ontology, trace paths, C4 references, and historical plans.
- Produces: a navigable source-authority ledger and seven Mermaid diagrams.

- [ ] **Step 1: Add the source-authority navigation map**

Link and classify these inputs:

- ADR-0027, ADR-0028, ADR-0029, ADR-0032, ADR-0033;
- the 2026-07-30 MIRA unification PRD;
- `materialized_evidence/context_contract.py`;
- Materialized Evidence architecture and inventory;
- ontology, unified inventory, and evaluation manifest;
- system/runtime/ingest/edge architecture references;
- C4, June master, July integration, and unification-assessment historical snapshots.

- [ ] **Step 2: Add the required layered diagram**

Diagram the verified source systems and producer library feeding `TechnicianContext`, with `EvidenceManifest` as the hash-stable evidence layer, one-policy task modes, and trace/review feedback. Mark policy adoption as target until an answer path consumes the contract.

- [ ] **Step 3: Add the required print-photo data-flow diagram**

Diagram: technician photo and question → capture/OCR/vision → PrintSynth graph and VisualSession → `evidence_from_printsense_graph` → `print_observation` citations in `TechnicianContext` → one technician policy → audit target → grounded reply.

- [ ] **Step 4: Add the remaining visual views**

Add product-surface/evidence-plane topology, two-layer read-only enforcement, current-versus-target trace adoption, and verification/learning feedback diagrams. Do not draw a write-capable path.

- [ ] **Step 5: Add the catalog and gap tables**

Include all six `TaskMode` values, all ten `EvidenceKind` values, the actual producer function or live-tag gap for each kind, and the adoption order/proof table.

### Task 3: Add a bounded future-work roadmap without implementation

**Files:**

- Create: `docs/superpowers/plans/2026-07-30-grounding-verification-unification.md`
- Modify: `docs/architecture/grounding-verification-master-plan.md`

**Interfaces:**

- Consumes: the documented gaps: strict action allowlisting, citable live-tag evidence, answer-path adoption, and trace unification.
- Produces: a sequence and proof gates for later work, with no implementation prescription beyond the approved architecture.

- [ ] **Step 1: Record the four bounded future increments**

1. Enforce `ALLOWED_ACTION_VOCAB` as a strict allowlist while retaining the write-substring lockstep defense.
2. Represent selected live tags as citable `LIVE_TAG` evidence while retaining the bounded live-state overlay.
3. Adopt validated `TechnicianContext` on one answer path at a time, beginning with a single shared bot-engine path.
4. Additively make the trace payload equal the context supplied to the answer, preserving tenant boundaries and non-blocking trace behavior.

- [ ] **Step 2: Record the proof gates**

- strict action gate: unknown non-write verbs are rejected;
- live-tag coverage: a cited tag preserves path, value, quality, freshness, and observed time;
- runtime adoption: prompt and trace fixtures cite the same selected evidence;
- trace unification: a valid tenant reads the stored payload and another tenant cannot.

- [ ] **Step 3: Preserve the design boundary**

Record that producer ownership, required source fields, freshness/retention rules, correction/review workflow, and per-surface operating procedures are inputs to the next design revision, not implicit implementation authority.

### Task 4: Verify the documentation artifact

**Files:**

- Verify: `docs/architecture/grounding-verification-master-plan.md`
- Verify: `docs/superpowers/specs/2026-07-30-grounding-verification-architecture-design.md`
- Verify: `docs/superpowers/plans/2026-07-30-grounding-verification-unification.md`

**Interfaces:**

- Consumes: the three new documentation files.
- Produces: evidence that local links resolve, seven Mermaid blocks render, and the documentation-only diff is clean.

- [ ] **Step 1: Check repository-relative links**

Run:

```bash
node <<'NODE'
const fs = require('fs');
const path = require('path');
const source = 'docs/architecture/grounding-verification-master-plan.md';
const text = fs.readFileSync(source, 'utf8');
const links = [...text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]);
const missing = links.filter((link) => !/^(https?:|mailto:)/.test(link) && !fs.existsSync(path.resolve(path.dirname(source), link)));
if (missing.length) throw new Error(`missing local links: ${missing.join(', ')}`);
console.log(`local_links=${links.length}; all_resolve`);
NODE
```

Expected: `local_links=44; all_resolve` or a higher count if source references are added.

- [ ] **Step 2: Check Mermaid block count and render each block**

Run:

```bash
set -e
master=docs/architecture/grounding-verification-master-plan.md
test "$(rg -c '^```mermaid$' "$master")" = 7
work=$(mktemp -d)
awk -v dir="$work" '/^```mermaid$/ {inside=1; n++; next} inside && /^```$/ {inside=0; next} inside {print > (dir "/diagram-" n ".mmd")}' "$master"
for diagram in "$work"/*.mmd; do
  npx --yes --package @mermaid-js/mermaid-cli mmdc -i "$diagram" -o "${diagram%.mmd}.svg"
done
test "$(find "$work" -name '*.svg' | wc -l | tr -d ' ')" = 7
```

Expected: exit code 0 and seven generated SVG files.

- [ ] **Step 3: Check diff hygiene and scope**

Run:

```bash
git diff --check
git status --short
```

Expected: only the three new documentation files are untracked or staged; `git diff --check` prints no errors.

## Plan Self-Review

- **Coverage:** Tasks 1-3 produce the approved visual hub, catalog/gap account, and bounded future roadmap; Task 4 supplies concrete link, render, and hygiene verification.
- **Scope:** The plan contains no implementation task and does not authorize a code change.
- **Source consistency:** The plan preserves the established `EvidenceManifest`/`TechnicianContext` distinction and treats existing historical C4 documents as references rather than current-state evidence.
