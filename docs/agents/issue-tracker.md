# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Failure records: the `incident` label (SDLC v1 §10.3)

One production failure = one issue labelled `incident`, with these fixed fields **in the issue body**,
one per line, exactly these keys (a reader and `tools/dora.py` parse the body, never the comments; free
prose goes below the fields):

```
first_seen: <ISO-8601 UTC>
deploy_run: <deploy-vps.yml run id + attempt, or "none">
deploy_sha: <40-hex approved_rc_sha, or "none">
services: <comma-separated services deployed, or "none">
impact: <one line: what users or operators could not do>
restored_at: <ISO-8601 UTC, or "open">
restoring_action: <deploy | config | provider recovery | none>
```

- Canary-opened `*-incident` issues (`provider-incident`, `oauth-incident`) carry the `incident`
  label as well; the canaries add it on creation and on every update. On creation the canary
  writes the seven keys at the top of the body with what it can know (`first_seen`, `services`,
  `impact`; `deploy_run`/`deploy_sha` are `none` because a canary cannot attribute a deploy;
  `restored_at: open`; `restoring_action: none`). Whoever triages the issue **edits the body**
  to complete them (`gh issue edit <number> --body-file …`); recurrences are comments and do
  not touch the fields. Fields placed only in a comment are not part of the record and are not
  parsed. An issue opened before this convention has no field block until a human adds one.
- Closing an `incident` requires a **regression disposition** comment using one of:
  `new-test:<path>` (docstring cites the issue), `existing-coverage:<path>`, `guard:<workflow or hook>`,
  `eval-fixture:<path>`, or `external-cause:<reason>`. **This is doctrine, not a mechanical guard**: GitHub
  will let anyone with write access close the issue without one. An incident closed without a
  disposition is a process violation to reopen; `tools/dora.py` (SDLC v1 step 12) reports such closures
  as missing data rather than counting them as resolved.
- Narrative root-cause write-ups live in `docs/incidents/`; the issue is the record of truth for the
  fields above.
- The owning change (the PR or issue whose deployment failed) links the incident and stays
  `FAILED_OBSERVED` until the disposition lands; it does not inherit the fix's success.

## Hotfixes: the `hotfix` label (SDLC v1 §10.1)

A hotfix is the normal path with the queue cleared, never a gate bypass (`deploy-vps.yml` has none).
Open the `incident` issue first, then the fix PR titled `fix(hotfix): …`, labelled `hotfix`, classified
`Risk: R3 — production-control`. Cheap lane one round; Codex may be deferred post-merge only when the
PR touches no guarded control-plane path and Mike says so on the PR, completing within 24 h. Required
contexts, staging, acceptance and the production receipt gates apply unchanged.

Full rules: `docs/architecture/mira-sdlc-v1.md` §9 (observation window), §10 (failure, hotfix,
rollback) and §12.3 (how the fields feed the metrics).
