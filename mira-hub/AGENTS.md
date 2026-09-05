<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

> **Repository authority:** `../AGENTS.md` and `../docs/ENGINEERING_GUARDRAILS.md` govern git,
> versioning, review, merge, and release. The local framework rule above may narrow implementation
> mechanics but cannot authorize a direct push, tag, merge, or release.

## Release versioning

The monorepo version is derived from git tags; `/VERSION` no longer exists and PRs must not recreate
or bump it. `mira-hub/package.json` and namespaced `mira-hub/vMAJOR.MINOR.PATCH` tags describe the
Hub component release line. A component-version change is a separate, reviewed release action.

- `package.json` version is the source of truth (for the hub component line).
- Every meaningful change (feature, schema migration, provider addition, UI overhaul) bumps the minor — patch bumps are reserved for hotfixes on a released line.
- Release preparation occurs on a scoped branch and PR. Tagging, merging, and release publication
  require explicit human authorization; never push directly to `main`.
- First tagged release: `mira-hub/v1.1.0` (2026-04-24) — OAuth persistence + full platform build.
- Tag format is `mira-hub/vMAJOR.MINOR.PATCH`, matching the monorepo convention of subpath-scoped tags.
