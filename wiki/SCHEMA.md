# MIRA Ops Wiki — Schema

> Adapted from [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).
> This file tells the LLM how to operate the wiki. You and the LLM co-evolve it over time.

## Architecture

```
wiki/
├── SCHEMA.md       # This file — operating instructions for the LLM
├── index.md        # Content catalog — every page, one-line summary, by category
├── log.md          # Append-only chronological record of operations
├── hot.md          # Session continuity — cross-machine hot cache
├── raw/            # Source material drop zone (immutable, LLM reads only)
├── nodes/          # Infrastructure pages — one per machine
├── services/       # Container/service pages — one per service
└── gotchas/        # Operational gotchas — living documents that compound
```

**Three layers:**

| Layer | Who writes | Who reads | Purpose |
|-------|-----------|-----------|---------|
| `raw/` | Human | LLM | Paste incident logs, deploy outputs, error dumps, session notes |
| `wiki/` (everything else) | LLM | Human + LLM | Compiled, structured, cross-linked operational knowledge |
| `SCHEMA.md` | Human + LLM | LLM | Operating instructions — how to maintain the wiki |

## Session Protocol

### Session Start (EVERY session, ANY machine)

1. Read `wiki/hot.md` first — this tells you where the last session left off
2. Read `wiki/index.md` to understand what pages exist
3. Note which machine you're on (check hostname or ask the user)

### Session End (EVERY session, ANY machine)

1. Update `wiki/hot.md` with:
   - Machine name and timestamp
   - What was accomplished this session
   - Current state of each machine (if changed)
   - What's blocked
   - What should happen next (on any machine)
2. Append a log entry to `wiki/log.md`
3. Remind the user to `git add wiki/ && git commit -m "wiki: update session state" && git push`

## Operations

### Ingest

When new operational knowledge arrives (incident resolved, deploy completed, config changed, gotcha discovered):

1. Read the relevant existing wiki page(s)
2. Update them with the new information
3. If no relevant page exists, create one in the appropriate directory
4. Update `wiki/index.md` with any new pages
5. Append to `wiki/log.md`
6. Cross-link: if a gotcha references a node, link to it. If a service runs on a node, link to it.

**Drop-folder ingest into `raw/`:** drop generated `.md` files (eval reports, deploy outputs, transcripts) into `~/MiraDrop/` on whichever node you're working on. A launchd watcher (`tools/wiki_raw_ingest.py`) moves the file into `wiki/raw/<YYYY-MM-DD>/`, dedupes by SHA-256, and commits — no auto-push. See [[nodes/wiki-sync]].

### Query

When the user asks an operational question:

1. Read `wiki/index.md` to find relevant pages
2. Read those pages
3. Synthesize an answer with `[[page]]` citations
4. If the answer reveals new knowledge worth preserving, offer to file it as a wiki update

### Lint

Periodically (or when asked), health-check the wiki:

- Pages that reference machines or services that may have changed
- Gotchas that may have been resolved
- Missing cross-links between related pages
- Nodes or services mentioned in CLAUDE.md but lacking wiki pages
- Stale timestamps (pages not updated in 30+ days)

## Page Conventions

### Frontmatter

Every wiki page (except SCHEMA.md, index.md, log.md, hot.md) uses YAML frontmatter:

```yaml
---
title: Page Title
type: node | service | gotcha | decision | reference
updated: 2026-04-08
tags: [bravo, docker, ssh]
---
```

### Cross-links

Use Obsidian wiki-link syntax: `[[nodes/bravo|Bravo]]`, `[[gotchas/ssh-keychain|SSH keychain gotcha]]`

### Secrets

**NEVER put secrets, API keys, tokens, or passwords in the wiki.** The wiki is git-tracked. Reference Doppler or env vars instead:

```markdown
# Wrong
API key: sk-ant-abc123...

# Right
API key: in Doppler (`factorylm/prd` → `ANTHROPIC_API_KEY`)
```

### File Naming

- Lowercase, hyphenated: `ssh-keychain.md`, `mira-core.md`
- Nodes: named after the machine hostname/alias
- Services: named after the Docker service name
- Gotchas: named after the problem, not the solution

## log.md Format

Each entry starts with a consistent prefix for grep-ability:

```markdown
## [2026-04-08] deploy | mira-web to VPS
## [2026-04-08] incident | Telegram bot down — competing poller
## [2026-04-08] config | Updated Bravo Doppler token
## [2026-04-08] session | Windows dev — blog crawler work
```

## hot.md Format

```markdown
# Hot Cache — {timestamp} — {machine name}

## Just Finished
- Bullet list of what was done this session

## Machine State
- **Bravo:** ...
- **Charlie:** ...
- **VPS:** ...

## Blocked
- Items that can't proceed and why

## Next (any machine)
- Prioritized list of what should happen next
```

## Growth Path

As the wiki grows:
- Add `decisions/` for architecture decisions (supplement `docs/adr/`)
- Add `deploys/` for deploy-specific runbooks
- Add `pipelines/` for knowledge ingest, photo pipeline docs
- Consider [qmd](https://github.com/tobi/qmd) for search if index.md becomes insufficient
