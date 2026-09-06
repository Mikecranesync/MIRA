export const meta = {
  name: 'flm-ui-slice',
  description:
    'Claim-gated single-writer FactoryLM Unified UI Cutover implementation slice + parallel read-only review',
  phases: [{ title: 'Preflight' }, { title: 'Implement' }, { title: 'Review' }, { title: 'Synthesize' }],
}

// FACTORYLM-UNIFIED-UI-CUTOVER-001. Charter:
// docs/architecture/convergence/UNIFIED_UI_CUTOVER.md §6 "/flm-ui-slice".
// One writer, one approved claim, followed by parallel read-only contract/
// safety/test review. Writer uses an isolated worktree, may open a draft PR,
// may NOT merge or deploy. Fails before dispatch unless args includes
// mission, issue, claimUrl, baseSha, lane, branch, allowedPaths, and
// verificationCommand.

const SHA_RE = /^[0-9a-f]{40}$/

if (!args || typeof args !== 'object') {
  throw new Error(
    'flm-ui-slice requires structured args: { mission, issue, claimUrl, baseSha, lane, branch, allowedPaths, verificationCommand }'
  )
}
const { mission, issue, claimUrl, baseSha, lane, branch, allowedPaths, verificationCommand } = args
if (!mission || typeof mission !== 'string') {
  throw new Error('flm-ui-slice requires args.mission')
}
if (issue === undefined || issue === null || issue === '') {
  throw new Error('flm-ui-slice requires args.issue (the mission coordination issue number)')
}
if (!claimUrl || typeof claimUrl !== 'string') {
  throw new Error('flm-ui-slice requires args.claimUrl (the winning [WORK-CLAIM] comment/PR URL)')
}
if (typeof baseSha !== 'string' || !SHA_RE.test(baseSha)) {
  throw new Error('flm-ui-slice requires args.baseSha as a full 40-character lowercase hex SHA')
}
if (!lane || typeof lane !== 'string') {
  throw new Error('flm-ui-slice requires args.lane (shared-core | hub | mobile | public | verification)')
}
if (!branch || typeof branch !== 'string') {
  throw new Error('flm-ui-slice requires args.branch')
}
if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
  throw new Error('flm-ui-slice requires args.allowedPaths as a non-empty array of path globs')
}
if (!verificationCommand || typeof verificationCommand !== 'string') {
  throw new Error('flm-ui-slice requires args.verificationCommand')
}

const CHARTER = 'docs/architecture/convergence/UNIFIED_UI_CUTOVER.md'
const RULE = '.claude/rules/factorylm-unified-ui-cutover.md'
const PROTOCOL = '.claude/rules/multi-session-protocol.md'

log(`Preflighting claim ${claimUrl} for ${mission} lane=${lane} at base ${baseSha}.`)

phase('Preflight')
const PREFLIGHT_SCHEMA = {
  type: 'object',
  properties: {
    claimStatus: {
      type: 'string',
      enum: ['WON', 'MISSING', 'LOST', 'BLOCKED', 'STALE', 'MALFORMED', 'UNVERIFIABLE'],
    },
    matchedClaimUrl: { type: 'string' },
    earliestActiveClaimUrl: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['claimStatus', 'reason'],
}

const preflight = await agent(
  `Read-only claim-verification preflight for ${mission}, issue #${issue}, lane ${lane}, base SHA ${baseSha}. ` +
    `Read ${PROTOCOL} and charter §5/§7 (${CHARTER}). Reread ALL open issues, pull requests, and [WORK-CLAIM] ` +
    `markers overlapping this slice — search issue #${issue}'s comments, any open PR touching paths in ` +
    `${JSON.stringify(allowedPaths)}, and any other [WORK-CLAIM] posts for the same lane/paths. The claim under ` +
    `review is: ${claimUrl}. Determine whether it is the EARLIEST overlapping ACTIVE claim per the ` +
    `multi-session protocol's check-then-act reread rule. Return claimStatus "WON" ONLY if this exact claim is ` +
    `ACTIVE, unambiguous, and earliest. Return MISSING if you cannot find it, LOST if a different claim is ` +
    `earlier/ACTIVE, BLOCKED if it depends on unmerged/unresolved work, STALE if idle 24h+ with no takeover ` +
    `note, MALFORMED if the claim text doesn't match the protocol template, UNVERIFIABLE if you cannot reach ` +
    `GitHub or the evidence is inconclusive. Do not edit anything.`,
  { label: 'claim-preflight', phase: 'Preflight', schema: PREFLIGHT_SCHEMA }
)

if (!preflight || preflight.claimStatus !== 'WON') {
  return {
    mission,
    issue,
    claimUrl,
    stopped: true,
    reason: preflight
      ? `claimStatus=${preflight.claimStatus}: ${preflight.reason}`
      : 'preflight agent returned no result',
    preflight,
  }
}

log(`Claim WON. Dispatching one writer for lane=${lane} branch=${branch}.`)

phase('Implement')
const WRITER_SCHEMA = {
  type: 'object',
  properties: {
    headSha: { type: 'string' },
    worktreePath: { type: 'string' },
    prUrl: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsRun: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['headSha', 'summary'],
}

const writer = await agent(
  `You are the SOLE writer for FactoryLM Unified UI Cutover slice "${claimUrl}" (${mission}, issue #${issue}, ` +
    `lane ${lane}). Read ${CHARTER} and ${RULE} first. Create or enter an isolated git worktree at base SHA ` +
    `${baseSha} on branch ${branch}. Touch ONLY these allowed paths — nothing else: ` +
    `${JSON.stringify(allowedPaths)}. Follow test-driven development: write a failing test first, confirm it is ` +
    `RED, then write the minimal implementation to turn it GREEN. Do NOT add a feature to a guarded legacy ` +
    `presentation path or a lifecycle-guard control-plane file (${RULE}) — that requires a human-approved ` +
    `legacy-ui-exception label + PR-body section, which you cannot grant yourself. Run ` +
    `${JSON.stringify(verificationCommand)} and confirm it passes. Commit with a Conventional Commit message, ` +
    `push the branch, and open a DRAFT pull request linked to issue #${issue}. Do NOT merge, deploy, or touch ` +
    `production state. Return the full 40-character committed head SHA as headSha, the worktree path, the PR ` +
    `URL if one was opened, the files you changed, what you ran to verify, and a summary.`,
  { label: 'writer', phase: 'Implement', schema: WRITER_SCHEMA, isolation: 'worktree' }
)

if (!writer || typeof writer.headSha !== 'string' || !SHA_RE.test(writer.headSha)) {
  return {
    mission,
    issue,
    claimUrl,
    stopped: true,
    reason: `writer did not return a valid full 40-character headSha (got: ${
      writer ? JSON.stringify(writer.headSha) : 'no result'
    })`,
    writer,
  }
}

const headSha = writer.headSha
log(`Writer committed ${headSha}. Dispatching read-only reviewers.`)

phase('Review')
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'CONCERNS', 'FAIL'] },
    findings: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'findings'],
}

const REVIEWERS = [
  {
    key: 'contract',
    prompt:
      `Read-only contract review of commit ${headSha} — this EXACT head SHA, never any other commit — for ` +
      `FactoryLM Unified UI Cutover slice "${claimUrl}" (${mission}, issue #${issue}). Confirm the diff touches ` +
      `ONLY ${JSON.stringify(allowedPaths)}, does not create a second chat/evidence/safety/provider/identity/ ` +
      `capability registry (charter §1, ${CHARTER}), and does not add a feature to a guarded legacy path ` +
      `without an audited legacy-ui-exception. Return verdict PASS/CONCERNS/FAIL with findings.`,
  },
  {
    key: 'safety',
    prompt:
      `Read-only safety review of commit ${headSha} — this EXACT head SHA — for slice "${claimUrl}" (${mission}, ` +
      `issue #${issue}). Confirm no PLC/OT write path was added (.claude/rules/fieldbus-readonly.md), no ` +
      `safety-keyword handling was weakened, and no production/deployment state was touched. Return verdict ` +
      `PASS/CONCERNS/FAIL with findings.`,
  },
  {
    key: 'tests',
    prompt:
      `Read-only test review of commit ${headSha} — this EXACT head SHA — for slice "${claimUrl}" (${mission}, ` +
      `issue #${issue}). Confirm tests were added test-first (red-before-green is evidenced in the commit ` +
      `history or writer's own account), the stated verification command ` +
      `${JSON.stringify(verificationCommand)} actually passes at this exact SHA, and no test was weakened or ` +
      `deleted to make it pass. Return verdict PASS/CONCERNS/FAIL with findings.`,
  },
]

const reviews = await parallel(
  REVIEWERS.map((r) => () => agent(r.prompt, { label: `review:${r.key}`, phase: 'Review', schema: REVIEW_SCHEMA }))
)

phase('Synthesize')
const reviewResults = REVIEWERS.map((r, i) => ({ reviewer: r.key, result: reviews[i] })).filter((r) => r.result)

const missingReviewers = REVIEWERS.filter((r, i) => !reviews[i]).map((r) => r.key)
const anyFail = reviewResults.some((r) => r.result.verdict === 'FAIL')
const anyConcern = reviewResults.some((r) => r.result.verdict === 'CONCERNS')
const synthesizedVerdict = missingReviewers.length || anyFail ? 'BLOCKED' : anyConcern ? 'PARTIAL' : 'GREEN'

return {
  mission,
  issue,
  claimUrl,
  lane,
  branch,
  baseSha,
  headSha,
  prUrl: writer.prUrl || null,
  worktreePath: writer.worktreePath || null,
  writerSummary: writer.summary,
  reviews: reviewResults,
  missingReviewers,
  verdict: synthesizedVerdict,
  note: 'Draft PR only — no merge, no deploy. Merge/deploy remain human-gated per multi-session-protocol.md §7.',
}
