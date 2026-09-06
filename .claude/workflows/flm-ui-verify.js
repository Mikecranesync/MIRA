export const meta = {
  name: 'flm-ui-verify',
  description: 'Read-only exact-SHA verification fan-out for a FactoryLM Unified UI Cutover slice',
  phases: [{ title: 'Verify' }, { title: 'Synthesize' }],
}

// FACTORYLM-UNIFIED-UI-CUTOVER-001. Charter:
// docs/architecture/convergence/UNIFIED_UI_CUTOVER.md §6 "/flm-ui-verify".
// Read-only exact-SHA fan-out across interaction parity, safety/identity/
// evidence, tenant authorization, mobile/accessibility, transport honesty,
// performance/licenses, and rollback. One synthesis returns GREEN, PARTIAL,
// or BLOCKED for the reviewed SHA. Fails before dispatch unless args
// includes mission, issue, and a full 40-character headSha.

const SHA_RE = /^[0-9a-f]{40}$/

if (!args || typeof args !== 'object') {
  throw new Error('flm-ui-verify requires structured args: { mission, issue, headSha }')
}
const { mission, issue, headSha } = args
if (!mission || typeof mission !== 'string') {
  throw new Error('flm-ui-verify requires args.mission')
}
if (issue === undefined || issue === null || issue === '') {
  throw new Error('flm-ui-verify requires args.issue (the mission coordination issue number)')
}
if (typeof headSha !== 'string' || !SHA_RE.test(headSha)) {
  throw new Error('flm-ui-verify requires args.headSha as a full 40-character lowercase hex SHA')
}

const CHARTER = 'docs/architecture/convergence/UNIFIED_UI_CUTOVER.md'

log(`Read-only verification of ${mission} issue #${issue} at exact head ${headSha}.`)

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['GREEN', 'PARTIAL', 'BLOCKED'] },
    unverifiedClaims: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'findings', 'unverifiedClaims'],
}

phase('Verify')
const DIMENSIONS = [
  {
    key: 'interaction-parity',
    prompt:
      `Read-only review of EXACT commit ${headSha} — never any other commit, never the working tree — for ` +
      `${mission}, issue #${issue}. Verify interaction/shell parity against the packages/factorylm-interaction ` +
      `and packages/factorylm-ui contracts (fixture-exact where applicable). Name every claim you could NOT ` +
      `directly verify under unverifiedClaims. Return verdict GREEN/PARTIAL/BLOCKED.`,
  },
  {
    key: 'safety-identity-evidence',
    prompt:
      `Read-only review of EXACT commit ${headSha} for ${mission}, issue #${issue}. Verify safety, identity ` +
      `confirmation, and evidence/citation behavior is preserved (${CHARTER} §2.3 preserved capability seams; ` +
      `.claude/rules/uns-confirmation-gate.md; .claude/rules/direct-connection-uns-certified.md). Name ` +
      `unverified claims. Return verdict GREEN/PARTIAL/BLOCKED.`,
  },
  {
    key: 'tenant-authorization',
    prompt:
      `Read-only review of EXACT commit ${headSha} for ${mission}, issue #${issue}. Verify tenant/session ` +
      `authorization boundaries are unchanged or correctly extended (no new IDOR, no bypass of Hub session/ ` +
      `capability checks). Name unverified claims. Return verdict GREEN/PARTIAL/BLOCKED.`,
  },
  {
    key: 'mobile-accessibility',
    prompt:
      `Read-only review of EXACT commit ${headSha} for ${mission}, issue #${issue}. Verify mobile/accessibility ` +
      `behavior (touch targets, screen-reader labels, native platform-adapter contracts per ` +
      `.claude/rules/commodity-before-custom.md). Name unverified claims. Return verdict GREEN/PARTIAL/BLOCKED.`,
  },
  {
    key: 'transport-honesty',
    prompt:
      `Read-only review of EXACT commit ${headSha} for ${mission}, issue #${issue}. Verify no fabricated ` +
      `network/data claim (a fixture or fake response presented as live), and that the one-pipeline-ingest and ` +
      `materialized-evidence rules are respected where relevant. Name unverified claims. Return verdict ` +
      `GREEN/PARTIAL/BLOCKED.`,
  },
  {
    key: 'performance-licenses',
    prompt:
      `Read-only review of EXACT commit ${headSha} for ${mission}, issue #${issue}. Verify no Apache-2.0/MIT ` +
      `license violation was introduced (root CLAUDE.md hard constraint) and no obvious performance/bundle-` +
      `budget regression in packages/factorylm-* or apps/factorylm-ui-lab. Name unverified claims. Return ` +
      `verdict GREEN/PARTIAL/BLOCKED.`,
  },
  {
    key: 'rollback',
    prompt:
      `Read-only review of EXACT commit ${headSha} for ${mission}, issue #${issue}. Verify the legacy runtime ` +
      `remains reachable and rollback-capable per ${CHARTER} §8 gates (nothing at this commit deletes or breaks ` +
      `a guarded legacy presentation path without an audited legacy-ui-exception). Name unverified claims. ` +
      `Return verdict GREEN/PARTIAL/BLOCKED.`,
  },
]

const reviews = await parallel(
  DIMENSIONS.map((d) => () => agent(d.prompt, { label: `verify:${d.key}`, phase: 'Verify', schema: REVIEW_SCHEMA }))
)

phase('Synthesize')
const dimensionResults = DIMENSIONS.map((d, i) => ({ dimension: d.key, result: reviews[i] })).filter(
  (r) => r.result
)
const missingDimensions = DIMENSIONS.filter((d, i) => !reviews[i]).map((d) => d.key)

const allUnverified = dimensionResults.flatMap((r) => r.result.unverifiedClaims || [])
const anyBlocked = dimensionResults.some((r) => r.result.verdict === 'BLOCKED')
const anyPartial = dimensionResults.some((r) => r.result.verdict === 'PARTIAL')
const finalVerdict = missingDimensions.length || anyBlocked ? 'BLOCKED' : anyPartial ? 'PARTIAL' : 'GREEN'

if (missingDimensions.length) {
  log(`Warning: ${missingDimensions.length} reviewer(s) returned no result: ${missingDimensions.join(', ')}`)
}

return {
  mission,
  issue,
  headSha,
  verdict: finalVerdict,
  dimensions: dimensionResults,
  missingDimensions,
  unverifiedClaims: allUnverified,
}
