# HyperFrames — Installed Version

**Installed:** 2026-05-11
**Branch:** `claude/determined-maxwell-a934fd` (intent: `feat/marketing-hyperframes-v1`)
**Node:** v25.8.0 (system: `/opt/homebrew/bin/node`)

## Pinned versions

| Package | Version | Source |
|---|---|---|
| `hyperframes` (CLI) | `0.5.7` | npm |
| `@hyperframes/core` | `0.5.7` | npm |
| `@hyperframes/player` | `0.5.7` | npm |

All invocations use `npx --yes hyperframes@0.5.7 ...` — version explicit at the call site (see `demo-project/package.json` scripts). `devDependencies` block also pins for `npm install` correctness.

## Verification

```bash
npx -y hyperframes@0.5.7 --version
# expected: 0.5.7
```

## Provenance

```
npm view hyperframes@0.5.7
# Published: 2026-05-10 by GitHub Actions
# Maintainers: jrusso1020 vancejs
# Registry: https://npm.im/hyperframes
```

## Scaffold command used

```bash
mkdir -p marketing/hyperframes
cd marketing/hyperframes
npx -y hyperframes@0.5.7 init demo-project --yes
```

Generated tree:
```
marketing/hyperframes/demo-project/
├── AGENTS.md
├── CLAUDE.md
├── hyperframes.json
├── index.html
├── meta.json
└── package.json
```

## Upgrade policy

- Pin to exact patch version. Do not use `^` or `~` ranges.
- Before bumping: render the POC composition on the current version, save the MP4 to `output/baseline-<version>.mp4`, then upgrade and diff.
- Major version bumps require a new BENCHMARK.md row.
