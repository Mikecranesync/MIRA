// ARCHIVED 2026-04-26 — DO NOT USE
//
// This file is the legacy Node/Express entry point for mira-web. It is no
// longer the active runtime — the live entry point is `src/server.ts`
// (Bun + Hono), invoked via `bun run src/server.ts` per package.json.
//
// The original file (366 lines) imported the @anthropic-ai/sdk and called
// the Claude Messages API directly for chat + vision. Both code paths were
// dead before this archival (the Bun/Hono entry point proxies AI chat to
// mira-pipeline:9099 instead — see src/lib/mira-chat.ts).
//
// Anthropic was removed from MIRA permanently in PR #610 (2026-04-25).
// Stripping this file's contents removes the last 13 anthropic references
// outside the legacy mira-sidecar.
//
// Original content lives in git history. To recover:
//   git show <sha-before-this-commit>:mira-web/server.js
//
// Do NOT reintroduce @anthropic-ai/sdk or any Anthropic API call here or
// elsewhere in MIRA — see CLAUDE.md Hard Constraint #2.

throw new Error(
  "mira-web/server.js is archived. Use 'bun run src/server.ts' (Bun/Hono) instead. " +
  "See file header for context.",
);
