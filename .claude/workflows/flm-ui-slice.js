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

// Codex remediation finding #6: hardcode the mission + issue this workflow
// exists for -- never trust a caller-supplied value.
const MISSION = 'FACTORYLM-UNIFIED-UI-CUTOVER-001'
const ISSUE = 3626
const CANONICAL_LANES = ['shared-core', 'hub', 'mobile', 'public', 'verification']
const SHA_RE = /^[0-9a-f]{40}$/
// A safe git branch-name shape: no leading/trailing slash, no '..', no '//',
// no trailing '.lock', no control/space characters (finding #8).
const BRANCH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9]$/

// Guarded legacy + control-plane path prefixes a claimed slice may NEVER
// touch (finding #8) -- mirrors tools/ui_surface_lifecycle_guard.py's
// CONTROL_PATTERNS and the registry's guarded legacy roots. The Python guard
// remains the actual enforcement authority; this is a workflow-level
// pre-dispatch backstop, kept in sync by hand.
const FORBIDDEN_PATH_PREFIXES = [
  'docs/architecture/convergence/REGISTRY.yaml',
  'docs/architecture/convergence/UNIFIED_UI_CUTOVER.md',
  'tools/ui_surface_lifecycle_guard.py',
  'tests/test_ui_surface_lifecycle_guard.py',
  '.claude/rules/factorylm-unified-ui-cutover.md',
  '.claude/workflows/flm-ui-map.js',
  '.claude/workflows/flm-ui-slice.js',
  '.claude/workflows/flm-ui-verify.js',
  '.github/workflows/ui-lifecycle-guard.yml',
  '.github/pull_request_template.md',
  'mira-web/src/views/',
  'mira-hub/src/app/(hub)/',
  'mira-hub/src/components/layout/',
  'mira-hub/src/components/equipment/',
  'mira-mobile/src/App.tsx',
  'mira-mobile/src/nav.ts',
  'mira-mobile/src/screens/',
]

// The bounded adapter roots each lane is allowed to touch (charter §2.2's
// "new bounded presentation adapters" + the shared-core packages). A claimed
// slice's allowedPaths must live entirely inside its lane's roots -- an
// arbitrary repo path is not an "allowed path" just because someone typed it.
const LANE_ALLOWED_ROOTS = {
  'shared-core': [
    'packages/factorylm-theme/',
    'packages/factorylm-interaction/',
    'packages/factorylm-ui/',
    'apps/factorylm-ui-lab/',
  ],
  hub: ['mira-hub/src/factorylm-ui/'],
  mobile: ['mira-mobile/src/factorylm-ui/'],
  public: ['mira-web/src/factorylm-ui/'],
  verification: ['tests/', 'docs/', '.claude/workflows/', 'tools/'],
}

function validateAllowedPath(raw, lane, laneRoots) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`flm-ui-slice: allowedPaths entry is not a non-empty string: ${JSON.stringify(raw)}`)
  }
  const p = raw.trim()
  if (p.startsWith('/')) {
    throw new Error(`flm-ui-slice: allowedPaths entry is absolute: ${JSON.stringify(raw)}`)
  }
  if (p.includes('\\')) {
    throw new Error(`flm-ui-slice: allowedPaths entry contains a backslash: ${JSON.stringify(raw)}`)
  }
  if (p.split('/').includes('..')) {
    throw new Error(`flm-ui-slice: allowedPaths entry contains a traversal segment: ${JSON.stringify(raw)}`)
  }
  if (p === '**' || p === '*' || p === '.git' || p.startsWith('.git/')) {
    throw new Error(`flm-ui-slice: allowedPaths entry is a root-wide glob or a .git path: ${JSON.stringify(raw)}`)
  }
  for (const forbidden of FORBIDDEN_PATH_PREFIXES) {
    if (p === forbidden || p.startsWith(forbidden)) {
      throw new Error(
        `flm-ui-slice: allowedPaths entry ${JSON.stringify(raw)} matches a guarded legacy or ` +
          `control-plane path (${forbidden}) -- a slice may never claim authority over a guarded path`
      )
    }
  }
  if (!laneRoots.some((root) => p.startsWith(root))) {
    throw new Error(
      `flm-ui-slice: allowedPaths entry ${JSON.stringify(raw)} is outside lane ${JSON.stringify(lane)}'s ` +
        `allowed roots (${JSON.stringify(laneRoots)})`
    )
  }
  return p
}

if (!args || typeof args !== 'object') {
  throw new Error(
    'flm-ui-slice requires structured args: { mission, issue, claimUrl, baseSha, lane, branch, allowedPaths, verificationCommand }'
  )
}
const { mission, issue, claimUrl, baseSha, lane, branch, allowedPaths, verificationCommand } = args
if (mission !== MISSION) {
  throw new Error(`flm-ui-slice requires args.mission === ${JSON.stringify(MISSION)} (got: ${JSON.stringify(mission)})`)
}
if (issue !== ISSUE) {
  throw new Error(`flm-ui-slice requires args.issue === ${ISSUE} (got: ${JSON.stringify(issue)})`)
}
if (!claimUrl || typeof claimUrl !== 'string') {
  throw new Error('flm-ui-slice requires args.claimUrl (the winning [WORK-CLAIM] comment/PR URL)')
}
if (typeof baseSha !== 'string' || !SHA_RE.test(baseSha)) {
  throw new Error('flm-ui-slice requires args.baseSha as a full 40-character lowercase hex SHA')
}
if (!CANONICAL_LANES.includes(lane)) {
  throw new Error(`flm-ui-slice requires args.lane to be one of ${JSON.stringify(CANONICAL_LANES)} (got: ${JSON.stringify(lane)})`)
}
if (
  typeof branch !== 'string' ||
  !BRANCH_NAME_RE.test(branch) ||
  branch.includes('..') ||
  branch.includes('//') ||
  branch.endsWith('.lock')
) {
  throw new Error(`flm-ui-slice requires args.branch to be a safe git branch name (got: ${JSON.stringify(branch)})`)
}
if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
  throw new Error('flm-ui-slice requires args.allowedPaths as a non-empty array of path globs')
}
const laneRoots = LANE_ALLOWED_ROOTS[lane]
for (const rawPath of allowedPaths) {
  validateAllowedPath(rawPath, lane, laneRoots)
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
// Codex remediation finding #12: prUrl/worktreePath/filesChanged/testsRun
// are now REQUIRED, not optional -- a writer that can't account for what it
// changed, where, and how it verified it is not a trustworthy WON claim.
// cleanupOutcome is new: the writer owns removing its OWN isolated worktree
// once work is pushed (subagent-worktree-isolation.md's "creating a worktree
// is an obligation to remove it"), and must report what it did -- but must
// NEVER remove a worktree it did not itself create for this run.
const WRITER_SCHEMA = {
  type: 'object',
  properties: {
    headSha: { type: 'string' },
    worktreePath: { type: 'string' },
    prUrl: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsRun: { type: 'string' },
    cleanupOutcome: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['headSha', 'worktreePath', 'prUrl', 'filesChanged', 'testsRun', 'cleanupOutcome', 'summary'],
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
    `production state. After pushing, remove YOUR OWN isolated worktree ` +
    `(the one this run created for you) per .claude/rules/subagent-worktree-isolation.md -- creating a ` +
    `worktree is an obligation to remove it. Never remove a worktree you did not create for this run; if you ` +
    `are unsure whether a worktree at a given path belongs to this run, do NOT remove it and report that in ` +
    `cleanupOutcome instead of guessing. Return the full 40-character committed head SHA as headSha, the ` +
    `worktree path, the PR URL, the files you changed, what you ran to verify, what happened when you tried to ` +
    `clean up the worktree (removed | left in place with a stated reason | cleanup failed with an error) as ` +
    `cleanupOutcome, and a summary.`,
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
// Codex remediation finding #13: a reviewer must echo the EXACT SHA it
// reviewed. Workflow code (not the reviewer's self-report) verifies
// reviewedSha === headSha before trusting any verdict -- a stale or
// mismatched review must never count toward PASS.
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'CONCERNS', 'FAIL'] },
    reviewedSha: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'reviewedSha', 'findings'],
}

const REVIEWERS = [
  {
    key: 'contract',
    prompt:
      `Read-only contract review of commit ${headSha} — this EXACT head SHA, never any other commit — for ` +
      `FactoryLM Unified UI Cutover slice "${claimUrl}" (${mission}, issue #${issue}). Confirm the diff touches ` +
      `ONLY ${JSON.stringify(allowedPaths)}, does not create a second chat/evidence/safety/provider/identity/ ` +
      `capability registry (charter §1, ${CHARTER}), and does not add a feature to a guarded legacy path ` +
      `without an audited legacy-ui-exception. Return verdict PASS/CONCERNS/FAIL, reviewedSha (the exact commit SHA you reviewed), and findings.`,
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
      `deleted to make it pass. Return verdict PASS/CONCERNS/FAIL, reviewedSha (the exact commit SHA you reviewed), and findings.`,
  },
]

const reviews = await parallel(
  REVIEWERS.map((r) => () => agent(r.prompt, { label: `review:${r.key}`, phase: 'Review', schema: REVIEW_SCHEMA }))
)

phase('Synthesize')
// Codex remediation findings #9/#13: a reviewer result that doesn't echo the
// EXACT headSha is treated as if the reviewer never returned -- it cannot
// contribute a PASS toward GREEN. A missing OR mismatched-SHA reviewer
// always blocks. A PASS with any nonempty findings is also demoted -- a
// reviewer that lists concerns cannot still count as a clean PASS.
const rawResults = REVIEWERS.map((r, i) => ({ reviewer: r.key, result: reviews[i] }))
const shaMismatches = rawResults.filter((r) => r.result && r.result.reviewedSha !== headSha)
const reviewResults = rawResults.filter((r) => r.result && r.result.reviewedSha === headSha)
const missingReviewers = rawResults
  .filter((r) => !r.result || r.result.reviewedSha !== headSha)
  .map((r) => r.reviewer)

const anyFail = reviewResults.some((r) => r.result.verdict === 'FAIL')
const anyConcernOrNonemptyFindings = reviewResults.some(
  (r) => r.result.verdict !== 'PASS' || (r.result.findings && r.result.findings.length > 0)
)
const synthesizedVerdict =
  missingReviewers.length || anyFail ? 'BLOCKED' : anyConcernOrNonemptyFindings ? 'PARTIAL' : 'GREEN'

return {
  mission,
  issue,
  claimUrl,
  lane,
  branch,
  baseSha,
  headSha,
  prUrl: writer.prUrl,
  worktreePath: writer.worktreePath,
  cleanupOutcome: writer.cleanupOutcome,
  writerSummary: writer.summary,
  reviews: reviewResults,
  missingReviewers,
  shaMismatches,
  verdict: synthesizedVerdict,
  note: 'Draft PR only — no merge, no deploy. Merge/deploy remain human-gated per multi-session-protocol.md §7.',
}
