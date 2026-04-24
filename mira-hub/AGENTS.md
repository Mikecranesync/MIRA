<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Release versioning

`mira-hub` is versioned independently of the rest of the MIRA monorepo using namespaced git tags.

- `package.json` version is the source of truth.
- Every meaningful change (feature, schema migration, provider addition, UI overhaul) bumps the minor — patch bumps are reserved for hotfixes on a released line.
- Ship sequence: bump `version` in `package.json` → `git commit -m "chore(hub): release vX.Y.Z"` → `git tag -a mira-hub/vX.Y.Z -m "..."` → `git push origin main --follow-tags`.
- First tagged release: `mira-hub/v1.1.0` (2026-04-24) — OAuth persistence + full platform build.
- Tag format is `mira-hub/vMAJOR.MINOR.PATCH`, matching the monorepo convention of subpath-scoped tags.
