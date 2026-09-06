export const meta = {
  name: 'flm-ui-verify',
  description: 'Read-only exact-SHA verification fan-out for a FactoryLM Unified UI Cutover slice',
  phases: [{ title: 'Identity preflight' }, { title: 'Verify' }, { title: 'Synthesize' }],
}

// FACTORYLM-UNIFIED-UI-CUTOVER-001. Charter:
// docs/architecture/convergence/UNIFIED_UI_CUTOVER.md §6 "/flm-ui-verify".
// Read-only exact-SHA fan-out across interaction parity, safety/identity/
// evidence, tenant authorization, mobile/accessibility, transport honesty,
// performance/licenses, and rollback. One synthesis returns GREEN, PARTIAL,
// or BLOCKED for the reviewed SHA. Fails before dispatch unless args
// includes mission, issue, and a full 40-character headSha.

// Codex remediation finding #6: hardcode the mission + issue this workflow
// exists for -- never trust a caller-supplied value.
const MISSION = 'FACTORYLM-UNIFIED-UI-CUTOVER-001'
const ISSUE = 3626
const SHA_RE = /^[0-9a-f]{40}$/

if (!args || typeof args !== 'object') {
  throw new Error('flm-ui-verify requires structured args: { mission, issue, headSha, prUrl? }')
}
const { mission, issue, headSha, prUrl } = args
if (mission !== MISSION) {
  throw new Error(`flm-ui-verify requires args.mission === ${JSON.stringify(MISSION)} (got: ${JSON.stringify(mission)})`)
}
if (issue !== ISSUE) {
  throw new Error(`flm-ui-verify requires args.issue === ${ISSUE} (got: ${JSON.stringify(issue)})`)
}
if (typeof headSha !== 'string' || !SHA_RE.test(headSha)) {
  throw new Error('flm-ui-verify requires args.headSha as a full 40-character lowercase hex SHA')
}
if (prUrl !== undefined && (typeof prUrl !== 'string' || prUrl.trim() === '')) {
  throw new Error('flm-ui-verify: args.prUrl, if given, must be a non-empty string')
}

const CHARTER = 'docs/architecture/convergence/UNIFIED_UI_CUTOVER.md'

log(`Read-only verification of ${mission} issue #${issue} at exact head ${headSha}.`)

// Codex remediation finding #10: every dimension reviewer must echo the
// EXACT SHA it reviewed; workflow code verifies reviewedSha === headSha
// before trusting any verdict.
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['GREEN', 'PARTIAL', 'BLOCKED'] },
    reviewedSha: { type: 'string' },
    unverifiedClaims: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'reviewedSha', 'findings', 'unverifiedClaims'],
}

// Codex remediation finding #10: an "immutable-head" identity preflight.
// When a prUrl is supplied, verify it actually identifies a PR whose head
// commit IS headSha (not a moved/force-pushed head) before trusting any
// downstream dimension review. When no prUrl is supplied, this workflow has
// no way to independently prove headSha's provenance beyond git's own
// commit-object existence -- that limitation is made EXPLICIT in the return
// value (shaProvenanceNote) rather than silently assumed away.
phase('Identity preflight')
const IDENTITY_SCHEMA = {
  type: 'object',
  properties: {
    commitExists: { type: 'boolean' },
    prMatchesHeadSha: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['commitExists', 'notes'],
}

const identityPreflight = prUrl
  ? await agent(
      `Read-only identity preflight for ${mission}, issue #${issue}. Confirm commit ${headSha} exists in the ` +
        `repository, and that ${prUrl} is a canonical pull request whose CURRENT head commit is EXACTLY ${headSha} ` +
        `(not a since-force-pushed or moved head). Return commitExists (boolean), prMatchesHeadSha (boolean), and ` +
        `notes explaining what you found. Do not edit anything.`,
      { label: 'identity-preflight', phase: 'Identity preflight', schema: IDENTITY_SCHEMA }
    )
  : null

if (prUrl && (!identityPreflight || !identityPreflight.commitExists || !identityPreflight.prMatchesHeadSha)) {
  return {
    mission,
    issue,
    headSha,
    prUrl,
    verdict: 'BLOCKED',
    stopped: true,
    reason: identityPreflight
      ? `identity preflight failed: commitExists=${identityPreflight.commitExists}, ` +
        `prMatchesHeadSha=${identityPreflight.prMatchesHeadSha}: ${identityPreflight.notes}`
      : 'identity preflight agent returned no result',
    identityPreflight,
  }
}

const shaProvenanceNote = prUrl
  ? `Verified: ${prUrl}'s current head commit matches headSha exactly (identity preflight passed).`
  : 'No prUrl was supplied to this run -- headSha provenance beyond git commit-object existence ' +
    '(i.e. that this exact SHA is genuinely the reviewed PR head, not a stale or substituted value) ' +
    'was NOT independently verified. Supply prUrl for a stronger guarantee.'

phase('Verify')
const DIMENSIONS = [
  {
    key: 'interaction-parity',
    prompt:
      `Read-only review of EXACT commit ${headSha} — never any other commit, never the working tree — for ` +
      `${mission}, issue #${issue}. Verify interaction/shell parity against the packages/factorylm-interaction ` +
      `and packages/factorylm-ui contracts (fixture-exact where applicable). Name every claim you could NOT ` +
      `directly verify under unverifiedClaims. Return verdict GREEN/PARTIAL/BLOCKED and reviewedSha (the exact commit SHA you reviewed).`,
  },
  {
    key: 'safety-identity-evidence',
    prompt:
      `Read-only review of EXACT commit ${headSha} for ${mission}, issue #${issue}. Verify safety, identity ` +
      `confirmation, and evidence/citation behavior is preserved (${CHARTER} §2.3 preserved capability seams; ` +
      `.claude/rules/uns-confirmation-gate.md; .claude/rules/direct-connection-uns-certified.md). Name ` +
      `unverified claims. Return verdict GREEN/PARTIAL/BLOCKED and reviewedSha (the exact commit SHA you reviewed).`,
  },
  {
    key: 'tenant-authorization',
    prompt:
      `Read-only review of EXACT commit ${headSha} for ${mission}, issue #${issue}. Verify tenant/session ` +
      `authorization boundaries are unchanged or correctly extended (no new IDOR, no bypass of Hub session/ ` +
      `capability checks). Name unverified claims. Return verdict GREEN/PARTIAL/BLOCKED and reviewedSha (the exact commit SHA you reviewed).`,
  },
  {
    key: 'mobile-accessibility',
    prompt:
      `Read-only review of EXACT commit ${headSha} for ${mission}, issue #${issue}. Verify mobile/accessibility ` +
      `behavior (touch targets, screen-reader labels, native platform-adapter contracts per ` +
      `.claude/rules/commodity-before-custom.md). Name unverified claims. Return verdict GREEN/PARTIAL/BLOCKED and reviewedSha (the exact commit SHA you reviewed).`,
  },
  {
    key: 'transport-honesty',
    prompt:
      `Read-only review of EXACT commit ${headSha} for ${mission}, issue #${issue}. Verify no fabricated ` +
      `network/data claim (a fixture or fake response presented as live), and that the one-pipeline-ingest and ` +
      `materialized-evidence rules are respected where relevant. Name unverified claims. Return verdict ` +
      `GREEN/PARTIAL/BLOCKED and reviewedSha (the exact commit SHA you reviewed).`,
  },
  {
    key: 'performance-licenses',
    prompt:
      `Read-only review of EXACT commit ${headSha} for ${mission}, issue #${issue}. Verify no Apache-2.0/MIT ` +
      `license violation was introduced (root CLAUDE.md hard constraint) and no obvious performance/bundle-` +
      `budget regression in packages/factorylm-* or apps/factorylm-ui-lab. Name unverified claims. Return ` +
      `verdict GREEN/PARTIAL/BLOCKED and reviewedSha (the exact commit SHA you reviewed).`,
  },
  {
    key: 'rollback',
    prompt:
      `Read-only review of EXACT commit ${headSha} for ${mission}, issue #${issue}. Verify the legacy runtime ` +
      `remains reachable and rollback-capable per ${CHARTER} §8 gates (nothing at this commit deletes or breaks ` +
      `a guarded legacy presentation path without an audited legacy-ui-exception). Name unverified claims. ` +
      `Return verdict GREEN/PARTIAL/BLOCKED and reviewedSha (the exact commit SHA you reviewed).`,
  },
]

const reviews = await parallel(
  DIMENSIONS.map((d) => () => agent(d.prompt, { label: `verify:${d.key}`, phase: 'Verify', schema: REVIEW_SCHEMA }))
)

phase('Synthesize')
// Codex remediation findings #9/#10/#13: a dimension result that doesn't
// echo the EXACT headSha never counts (missing-or-mismatched is the same
// failure mode -- always contributes to BLOCKED, never silently ignored).
const rawResults = DIMENSIONS.map((d, i) => ({ dimension: d.key, result: reviews[i] }))
const shaMismatches = rawResults.filter((r) => r.result && r.result.reviewedSha !== headSha)
const dimensionResults = rawResults.filter((r) => r.result && r.result.reviewedSha === headSha)
const missingDimensions = rawResults
  .filter((r) => !r.result || r.result.reviewedSha !== headSha)
  .map((r) => r.dimension)

const allUnverified = dimensionResults.flatMap((r) => r.result.unverifiedClaims || [])
const anyBlocked = dimensionResults.some((r) => r.result.verdict === 'BLOCKED')
// Finding #13: GREEN requires EVERY dimension to be GREEN with EMPTY
// findings/unverifiedClaims -- a GREEN verdict sitting next to nonempty
// findings or an unverified claim is not actually clean.
const anyPartialOrNonempty = dimensionResults.some(
  (r) =>
    r.result.verdict !== 'GREEN' ||
    (r.result.findings && r.result.findings.length > 0) ||
    (r.result.unverifiedClaims && r.result.unverifiedClaims.length > 0)
)
// Mechanical ceiling: computed from the dimension results alone, independent
// of any narrative synthesis agent below. Ordering worst-to-best:
// BLOCKED < PARTIAL < GREEN.
const VERDICT_RANK = { BLOCKED: 0, PARTIAL: 1, GREEN: 2 }
const mechanicalCeiling =
  missingDimensions.length || anyBlocked ? 'BLOCKED' : anyPartialOrNonempty ? 'PARTIAL' : 'GREEN'

if (missingDimensions.length) {
  log(`Warning: ${missingDimensions.length} reviewer(s) returned no result or a mismatched reviewedSha: ${missingDimensions.join(', ')}`)
}

// Codex remediation finding #10: the promised synthesis agent -- it
// deduplicates findings/unverified claims into one narrative, but its
// verdict is MECHANICALLY CLAMPED to mechanicalCeiling below: it can explain
// and dedupe, it can never make the outcome look greener than the raw
// dimension evidence actually supports.
const SYNTHESIS_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['GREEN', 'PARTIAL', 'BLOCKED'] },
    dedupedFindings: { type: 'array', items: { type: 'string' } },
    dedupedUnverifiedClaims: { type: 'array', items: { type: 'string' } },
    narrative: { type: 'string' },
  },
  required: ['verdict', 'dedupedFindings', 'dedupedUnverifiedClaims', 'narrative'],
}

const synthesis =
  dimensionResults.length > 0
    ? await agent(
        `Deduplicate the findings and unverifiedClaims below (from ${dimensionResults.length} read-only ` +
          `dimension reviews of exact commit ${headSha}, ${mission} issue #${issue}) into one narrative. Merge ` +
          `near-duplicate wording, keep every distinct concern, drop nothing substantive. Propose your own ` +
          `verdict from GREEN/PARTIAL/BLOCKED based on the evidence -- but note that this workflow will clamp ` +
          `your verdict to no better than the mechanically-computed ceiling from the raw dimension verdicts, so ` +
          `optimism beyond the evidence has no effect.\n\n` + JSON.stringify(dimensionResults),
        { label: 'synthesis', phase: 'Synthesize', schema: SYNTHESIS_SCHEMA }
      )
    : null

const synthesisVerdict = synthesis && VERDICT_RANK[synthesis.verdict] !== undefined ? synthesis.verdict : mechanicalCeiling
const finalVerdict =
  VERDICT_RANK[synthesisVerdict] < VERDICT_RANK[mechanicalCeiling] ? synthesisVerdict : mechanicalCeiling

return {
  mission,
  issue,
  headSha,
  prUrl: prUrl || null,
  shaProvenanceNote,
  verdict: finalVerdict,
  mechanicalCeiling,
  synthesis,
  dimensions: dimensionResults,
  missingDimensions,
  shaMismatches,
  unverifiedClaims: synthesis ? synthesis.dedupedUnverifiedClaims : allUnverified,
}
