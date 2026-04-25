# LSP Servers for Claude Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire 9 LSP servers into Claude Code so it gets inline type/lint feedback while editing MIRA's Python, TypeScript, YAML, SQL, Dockerfile, TOML, shell, and Markdown files — and bump pyright from `basic` to `standard` mode for stronger type checking.

**Architecture:** Phase 0 lands the pyright config bump first (highest immediate value, smallest blast radius). Tier 1 enables two LSPs from the official Claude Code marketplace (`pyright-lsp`, `typescript-lsp`) plus Ruff's built-in `ruff server`. Tiers 2 and 3 ship a local marketplace at `.claude-plugin/marketplace.json` so the remaining LSPs are version-controlled with the repo. One LSP per commit so any flaky integration can be reverted independently.

**Tech Stack:** Claude Code plugin system (`enabledPlugins` in `.claude/settings.json`, `lspServers` schema in marketplace JSON), pyright, typescript-language-server, ruff, yaml-language-server, sqls, dockerfile-language-server-nodejs, taplo, bash-language-server, marksman.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `pyrightconfig.json` | Pyright type-check config (bump to standard) | modify |
| `.claude/settings.json` | Enable LSP plugins via `enabledPlugins` | modify |
| `.claude-plugin/marketplace.json` | Local Claude Code marketplace declaring custom LSP plugins (Tiers 2 & 3 + ruff) | create |
| `.claude-plugin/plugins/ruff-lsp/README.md` | Ruff LSP plugin readme (the one ruff plugin Claude marketplace doesn't ship) | create |
| `.claude-plugin/plugins/yaml-lsp/README.md` | YAML LSP plugin readme | create |
| `.claude-plugin/plugins/sql-lsp/README.md` | SQL LSP plugin readme | create |
| `.claude-plugin/plugins/dockerfile-lsp/README.md` | Dockerfile LSP plugin readme | create |
| `.claude-plugin/plugins/toml-lsp/README.md` | TOML LSP plugin readme | create |
| `.claude-plugin/plugins/shell-lsp/README.md` | Shell LSP plugin readme | create |
| `.claude-plugin/plugins/markdown-lsp/README.md` | Markdown LSP plugin readme | create |
| `docs/known-issues.md` | Document any LSP that fails to load + workaround | modify (only if needed) |

**Why local marketplace and not just inline `lspServers` in settings.json:** Claude Code's plugin system reads `lspServers` from marketplace JSON, not from `.claude/settings.json` directly. A local marketplace also makes the LSP setup reproducible across the team — anyone cloning the repo gets the same LSP coverage by enabling the plugins.

---

## Phase 0: Pyright Standard Mode (THE FIX)

This is decoupled from LSP installation — it's a pure type-checker config change. The PostToolUse hook in `.claude/settings.json:39` already runs `pyright "$CLAUDE_FILE_PATH"` after every Edit/Write, so this change immediately tightens feedback on every file Claude edits.

### Task 0.1: Bump pyrightconfig to standard mode

**Files:**
- Modify: `pyrightconfig.json:16`

- [ ] **Step 1: Edit pyrightconfig.json**

Change line 16 from:
```json
"typeCheckingMode": "basic",
```
to:
```json
"typeCheckingMode": "standard",
```

Leave `reportArgumentType` and `reportReturnType` at `"warning"` for now (they'll surface from standard mode but as warnings, not errors).

- [ ] **Step 2: Install pyright locally so we can run it**

Run: `npm install -g pyright`
Expected: `pyright@1.1.x` installed; `which pyright` resolves.

- [ ] **Step 3: Run pyright on the included paths to see new diagnostics**

Run:
```bash
cd /Users/bravonode/Mira && pyright 2>&1 | tail -50
```
Expected: A summary line like `N errors, M warnings, 0 informations`. Note the counts before triage.

- [ ] **Step 4: Triage diagnostics**

For each new error in `mira-bots/shared`, `mira-core/mira-ingest`, `mira-mcp`:

If the error is a **real bug** (wrong type passed, missing None check on a value that can be None) — fix the source file.

If the error is a **third-party library with no stubs** (e.g. `langfuse`, `apify-client`) — add the module name to `pyrightconfig.json` `ignore` block:
```json
"ignore": [
  "**/langfuse_*.py"
]
```

If the error is a **legitimate dynamic pattern** (e.g. SQLAlchemy magic) — add a per-line `# pyright: ignore[reportArgumentType]` with a one-line comment explaining why.

DO NOT mass-suppress with `reportXxx: false` in pyrightconfig.json — that defeats the purpose of bumping the mode.

- [ ] **Step 5: Re-run pyright, confirm error count is acceptable**

Run: `pyright 2>&1 | tail -3`
Expected: error count is either 0 or only consists of items the engineer consciously chose to leave. Document any leftover count in commit message.

- [ ] **Step 6: Commit**

```bash
git add pyrightconfig.json
# Plus any source files modified during triage
git add mira-bots/shared mira-core/mira-ingest mira-mcp
git commit -m "chore(types): bump pyright to standard mode

Tightens type checking on the three included packages.
Triaged $N new diagnostics: $X fixed in source, $Y suppressed
with per-line comments, $Z legitimate gaps documented."
```

---

## Tier 1: Critical LSPs (catch real bugs immediately)

### Task 1.1: Install Pyright LSP binary

**Files:** none (system-wide install)

- [ ] **Step 1: Install pyright-langserver**

Run: `npm install -g pyright`
Expected: `pyright-langserver` resolvable via `which pyright-langserver`.

(Already installed in Phase 0 Step 2; verify it's still there.)

- [ ] **Step 2: Verify**

Run: `pyright-langserver --version`
Expected: prints version string, no error.

### Task 1.2: Enable pyright-lsp plugin in Claude Code

**Files:**
- Modify: `.claude/settings.json:66-75` (add to `enabledPlugins`)

- [ ] **Step 1: Edit settings.json**

Add after the last entry in `enabledPlugins` (currently line 74, `"data-engineering@claude-plugins-official": true`):

```json
"pyright-lsp@claude-plugins-official": true,
```

Final block should look like:
```json
"enabledPlugins": {
  "superpowers@claude-plugins-official": true,
  "code-simplifier@claude-plugins-official": true,
  "context7@claude-plugins-official": true,
  "feature-dev@claude-plugins-official": true,
  "codex@openai-codex": true,
  "skill-creator@claude-plugins-official": true,
  "stripe@claude-plugins-official": true,
  "data-engineering@claude-plugins-official": true,
  "pyright-lsp@claude-plugins-official": true
}
```

Watch the trailing comma — last entry gets no comma.

- [ ] **Step 2: Reload plugins**

In Claude Code, run: `/reload-plugins`
Expected: output now shows `... 1 plugin LSP servers ...` (was `0` before).

- [ ] **Step 3: Verify pyright LSP attached**

In Claude Code, run: `/doctor`
Expected: `pyright` listed under LSP servers, status = `running`.

If status is `error`: check `which pyright-langserver` resolves and is on `$PATH` for the shell Claude Code launches subprocesses with.

- [ ] **Step 4: Commit**

```bash
git add .claude/settings.json
git commit -m "feat(lsp): enable pyright-lsp plugin

Wires Pyright as an LSP server in Claude Code so type errors
surface inline while editing Python files. Pairs with the
pyright PostToolUse hook in settings.json:39."
```

### Task 1.3: Install TypeScript LSP binary

**Files:** none

- [ ] **Step 1: Install typescript-language-server + typescript**

Run: `npm install -g typescript-language-server typescript`
Expected: both binaries resolvable; `typescript-language-server --version` prints version.

- [ ] **Step 2: Verify**

Run: `typescript-language-server --version && tsc --version`
Expected: two version strings, no error.

### Task 1.4: Enable typescript-lsp plugin in Claude Code

**Files:**
- Modify: `.claude/settings.json` (extend `enabledPlugins`)

- [ ] **Step 1: Add to enabledPlugins**

Append:
```json
"typescript-lsp@claude-plugins-official": true
```

Move comma so the new last entry has no trailing comma.

- [ ] **Step 2: Reload and verify**

Run: `/reload-plugins`
Expected: `... 2 plugin LSP servers ...`

Run: `/doctor`
Expected: `typescript` LSP listed, status = `running`.

- [ ] **Step 3: Smoke test**

Open `mira-web/src/index.ts` (or any `.ts` file) via `Read`, then have Claude make a trivial edit (e.g. add an unused import). The PostToolUse review should now include TS-language-server diagnostics.

- [ ] **Step 4: Commit**

```bash
git add .claude/settings.json
git commit -m "feat(lsp): enable typescript-lsp plugin

Wires typescript-language-server for mira-web's Hono+Bun
TypeScript code so type errors surface inline."
```

### Task 1.5: Create local marketplace skeleton (foundation for Ruff + Tiers 2/3)

**Files:**
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Create directory and marketplace.json**

Run: `mkdir -p /Users/bravonode/Mira/.claude-plugin`

Then create `/Users/bravonode/Mira/.claude-plugin/marketplace.json` with:

```json
{
  "name": "mira-local",
  "owner": {
    "name": "MIRA",
    "email": "harperhousebuyers@gmail.com"
  },
  "plugins": []
}
```

- [ ] **Step 2: Register the marketplace with Claude Code**

In Claude Code, run: `/plugin marketplace add /Users/bravonode/Mira/.claude-plugin`
Expected: marketplace appears in `/plugin marketplace list` as `mira-local`.

If `/plugin` slash command isn't available, manually add to `/Users/bravonode/.claude/plugins/known_marketplaces.json` — but prefer the slash command path.

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "chore(lsp): scaffold local plugin marketplace

Holds custom LSP plugin definitions (ruff, yaml, sql, dockerfile,
toml, shell, markdown) that aren't in the official Claude Code
marketplace. Versioned with the repo so the team gets a uniform
LSP setup."
```

### Task 1.6: Add Ruff LSP via local marketplace

Ruff has a built-in LSP server (`ruff server`) since 0.4.5. The system has ruff 0.15.5, so no extra install needed.

**Files:**
- Modify: `.claude-plugin/marketplace.json` (append plugin)
- Create: `.claude-plugin/plugins/ruff-lsp/README.md`
- Modify: `.claude/settings.json`

- [ ] **Step 1: Add ruff plugin to marketplace.json**

Replace the `"plugins": []` line with:

```json
"plugins": [
  {
    "name": "ruff-lsp",
    "description": "Ruff linter + formatter as an LSP server (uses `ruff server`).",
    "source": "./plugins/ruff-lsp",
    "lspServers": {
      "ruff": {
        "command": "ruff",
        "args": ["server"],
        "extensionToLanguage": {
          ".py": "python",
          ".pyi": "python"
        }
      }
    }
  }
]
```

- [ ] **Step 2: Create plugin README**

Create `/Users/bravonode/Mira/.claude-plugin/plugins/ruff-lsp/README.md` with:

```markdown
# ruff-lsp

Wires `ruff server` (Ruff's built-in LSP, since ruff 0.4.5) into Claude Code.

## Install
ruff is already installed via Homebrew (or `pip install ruff`).
Verify: `ruff --version` (need >= 0.4.5).

## What it surfaces
- Lint diagnostics from rules enabled in `pyproject.toml [tool.ruff.lint]`
- Format-on-edit hints (matches `ruff format`)

## Why not pip's `ruff-lsp` package?
That package is deprecated. `ruff server` is the maintained LSP.
```

- [ ] **Step 3: Reload marketplace**

In Claude Code: `/plugin marketplace update mira-local`
Then: `/plugin install ruff-lsp@mira-local` (or enable via settings.json — see step 4)

- [ ] **Step 4: Enable in settings.json**

Add to `enabledPlugins`:
```json
"ruff-lsp@mira-local": true
```

- [ ] **Step 5: Reload and verify**

Run: `/reload-plugins`
Expected: `... 3 plugin LSP servers ...`
Run: `/doctor` — `ruff` LSP, status `running`.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/ .claude/settings.json
git commit -m "feat(lsp): add ruff LSP via local marketplace

Uses ruff's built-in 'ruff server' command. Inline lint + format
diagnostics on Python files complement the existing PostToolUse
ruff hook (which runs after edits, vs LSP which runs during)."
```

---

## Tier 2: High-ROI LSPs (heavy file count, common bug class)

Each task follows the same pattern: install binary → add to marketplace.json → create plugin README → enable → verify → commit.

### Task 2.1: YAML Language Server

**Why:** 130+ YAML files (Docker Compose, GitHub Actions, prompt definitions, `sources.yaml`). Schema validation catches misindented `depends_on`, wrong `healthcheck` keys, invalid Compose properties before docker even starts.

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Create: `.claude-plugin/plugins/yaml-lsp/README.md`
- Modify: `.claude/settings.json`

- [ ] **Step 1: Install yaml-language-server**

Run: `npm install -g yaml-language-server`
Expected: `which yaml-language-server` resolves.

- [ ] **Step 2: Append to marketplace.json plugins array**

```json
{
  "name": "yaml-lsp",
  "description": "yaml-language-server with schema validation for Compose, GitHub Actions, and Doppler configs.",
  "source": "./plugins/yaml-lsp",
  "lspServers": {
    "yaml": {
      "command": "yaml-language-server",
      "args": ["--stdio"],
      "extensionToLanguage": {
        ".yml": "yaml",
        ".yaml": "yaml"
      }
    }
  }
}
```

- [ ] **Step 3: Create plugin README**

Create `/Users/bravonode/Mira/.claude-plugin/plugins/yaml-lsp/README.md` with:

```markdown
# yaml-lsp

Wires yaml-language-server into Claude Code for the 130+ YAML files in MIRA.

## Install
`npm install -g yaml-language-server`

## Schema associations
yaml-language-server auto-detects schemas for:
- `docker-compose*.yml` → Compose schema
- `.github/workflows/*.yml` → GitHub Actions schema

For MIRA-specific schemas (e.g. `mira_copy/prompts/*.yaml`), add
`# yaml-language-server: $schema=...` directive at top of file.
```

- [ ] **Step 4: Enable in settings.json**

```json
"yaml-lsp@mira-local": true
```

- [ ] **Step 5: Reload + verify**

Run: `/reload-plugins` — expect LSP count = 4.
Run: `/doctor` — `yaml` LSP `running`.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/ .claude/settings.json
git commit -m "feat(lsp): add yaml-language-server

Surfaces schema validation on Compose, GitHub Actions, and
prompt YAML files. 130+ YAML files in the repo, one of the
highest-leverage LSP integrations."
```

### Task 2.2: SQL Language Server (sqls)

**Why:** 16 SQL files including HNSW index migrations, fault code schema, NeonDB migrations. Catches Postgres syntax errors before hitting the DB.

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Create: `.claude-plugin/plugins/sql-lsp/README.md`
- Modify: `.claude/settings.json`

- [ ] **Step 1: Install sqls**

Sqls is a Go binary. Install via Homebrew:
```bash
brew install sqls
```

If brew formula not available, fall back to:
```bash
go install github.com/sqls-server/sqls@latest
```
(Then ensure `~/go/bin` is on `$PATH`.)

Verify: `which sqls` resolves.

- [ ] **Step 2: Append to marketplace.json plugins array**

```json
{
  "name": "sql-lsp",
  "description": "sqls SQL language server (PostgreSQL dialect for NeonDB).",
  "source": "./plugins/sql-lsp",
  "lspServers": {
    "sqls": {
      "command": "sqls",
      "extensionToLanguage": {
        ".sql": "sql"
      }
    }
  }
}
```

- [ ] **Step 3: Create plugin README**

Create `/Users/bravonode/Mira/.claude-plugin/plugins/sql-lsp/README.md` with:

```markdown
# sql-lsp

Wires sqls into Claude Code for the 16 SQL files in MIRA
(NeonDB migrations, HNSW index, fault codes, lead-hunter schema).

## Install
`brew install sqls`  (or `go install github.com/sqls-server/sqls@latest`)

## DB connection (optional)
sqls offers richer completions if connected to a live DB. To enable,
create `~/.config/sqls/config.yml` with a connection block — but
DO NOT commit any prod connection strings. Use a local Neon dev
branch only.
```

- [ ] **Step 4: Enable in settings.json**

```json
"sql-lsp@mira-local": true
```

- [ ] **Step 5: Reload + verify**

Run: `/reload-plugins` — expect LSP count = 5.
Run: `/doctor` — `sqls` LSP `running`.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/ .claude/settings.json
git commit -m "feat(lsp): add sqls SQL language server

Postgres syntax checking on the 16 .sql files including
NeonDB migrations and HNSW index. Prevents whole class of
'syntax error at or near' bugs caught only at apply time."
```

### Task 2.3: Dockerfile Language Server

**Why:** 16 Dockerfiles. Catches `COPY` path errors, wrong `HEALTHCHECK` syntax, `CMD`/`ENTRYPOINT` conflicts.

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Create: `.claude-plugin/plugins/dockerfile-lsp/README.md`
- Modify: `.claude/settings.json`

- [ ] **Step 1: Install dockerfile-language-server-nodejs**

Run: `npm install -g dockerfile-language-server-nodejs`
Verify: `which docker-langserver` resolves.

- [ ] **Step 2: Append to marketplace.json**

```json
{
  "name": "dockerfile-lsp",
  "description": "dockerfile-language-server-nodejs for the 16 Dockerfiles in MIRA.",
  "source": "./plugins/dockerfile-lsp",
  "lspServers": {
    "dockerfile": {
      "command": "docker-langserver",
      "args": ["--stdio"],
      "extensionToLanguage": {
        "Dockerfile": "dockerfile",
        ".dockerfile": "dockerfile"
      }
    }
  }
}
```

Note: `Dockerfile` (no extension) — `extensionToLanguage` matches by trailing path component too in Claude Code's matcher; if it doesn't, fall back to suffix `.Dockerfile` only and rename pattern in plugin update.

- [ ] **Step 3: Create plugin README**

Create `/Users/bravonode/Mira/.claude-plugin/plugins/dockerfile-lsp/README.md` with:

```markdown
# dockerfile-lsp

Wires dockerfile-language-server-nodejs for the 16 Dockerfiles
in MIRA.

## Install
`npm install -g dockerfile-language-server-nodejs`

## Pairs well with
hadolint (security/style lint) — invoke separately via PostToolUse
hook on `Dockerfile*` matcher if desired.
```

- [ ] **Step 4: Enable in settings.json**

```json
"dockerfile-lsp@mira-local": true
```

- [ ] **Step 5: Reload + verify**

Run: `/reload-plugins` — expect LSP count = 6.
Run: `/doctor` — `dockerfile` LSP `running`.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/ .claude/settings.json
git commit -m "feat(lsp): add Dockerfile language server

Inline diagnostics on the 16 Dockerfiles. Catches COPY path
errors and HEALTHCHECK syntax bugs that previously only
surfaced at 'docker compose build' time."
```

---

## Tier 3: Nice-to-have LSPs (lower file count or narrower benefit)

### Task 3.1: TOML Language Server (taplo)

**Why:** Validates `pyproject.toml` ruff config keys, pytest options, and `.gitleaks.toml` patterns. Catches typos that silently disable rules.

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Create: `.claude-plugin/plugins/toml-lsp/README.md`
- Modify: `.claude/settings.json`

- [ ] **Step 1: Install taplo**

Run: `brew install taplo`
Verify: `taplo --version` prints version.

- [ ] **Step 2: Append to marketplace.json**

```json
{
  "name": "toml-lsp",
  "description": "Taplo TOML language server for pyproject.toml and .gitleaks.toml.",
  "source": "./plugins/toml-lsp",
  "lspServers": {
    "taplo": {
      "command": "taplo",
      "args": ["lsp", "stdio"],
      "extensionToLanguage": {
        ".toml": "toml"
      }
    }
  }
}
```

- [ ] **Step 3: Create README**

Create `/Users/bravonode/Mira/.claude-plugin/plugins/toml-lsp/README.md` with:

```markdown
# toml-lsp

Taplo TOML LSP — validates pyproject.toml, .gitleaks.toml,
and any other TOML configs.

## Install
`brew install taplo`
```

- [ ] **Step 4: Enable in settings.json**

```json
"toml-lsp@mira-local": true
```

- [ ] **Step 5: Reload + verify**

Run: `/reload-plugins` — expect LSP count = 7.
Run: `/doctor` — `taplo` LSP `running`.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/ .claude/settings.json
git commit -m "feat(lsp): add taplo TOML language server"
```

### Task 3.2: Bash Language Server

**Why:** 26 shell scripts (install, deploy, smoke tests). Uses ShellCheck under the hood for quoting bugs and unset variable references.

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Create: `.claude-plugin/plugins/shell-lsp/README.md`
- Modify: `.claude/settings.json`

- [ ] **Step 1: Install bash-language-server + shellcheck**

Run:
```bash
npm install -g bash-language-server
brew install shellcheck
```
Verify: `which bash-language-server shellcheck` both resolve.

- [ ] **Step 2: Append to marketplace.json**

```json
{
  "name": "shell-lsp",
  "description": "bash-language-server (uses shellcheck) for the 26 shell scripts in MIRA.",
  "source": "./plugins/shell-lsp",
  "lspServers": {
    "bash": {
      "command": "bash-language-server",
      "args": ["start"],
      "extensionToLanguage": {
        ".sh": "shellscript",
        ".bash": "shellscript"
      }
    }
  }
}
```

- [ ] **Step 3: Create README**

Create `/Users/bravonode/Mira/.claude-plugin/plugins/shell-lsp/README.md` with:

```markdown
# shell-lsp

bash-language-server with shellcheck integration for MIRA's
26 install/deploy/smoke shell scripts.

## Install
`npm install -g bash-language-server && brew install shellcheck`
```

- [ ] **Step 4: Enable in settings.json**

```json
"shell-lsp@mira-local": true
```

- [ ] **Step 5: Reload + verify**

Run: `/reload-plugins` — expect LSP count = 8.
Run: `/doctor` — `bash` LSP `running`.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/ .claude/settings.json
git commit -m "feat(lsp): add bash-language-server (shellcheck-backed)"
```

### Task 3.3: Markdown Language Server (marksman)

**Why:** The `wiki/` Obsidian vault is LLM-maintained with cross-links. Marksman validates internal `[[wikilink]]` and broken relative links.

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Create: `.claude-plugin/plugins/markdown-lsp/README.md`
- Modify: `.claude/settings.json`

- [ ] **Step 1: Install marksman**

Run: `brew install marksman`
Verify: `marksman --version` prints version.

- [ ] **Step 2: Append to marketplace.json**

```json
{
  "name": "markdown-lsp",
  "description": "Marksman markdown LSP for the wiki/ Obsidian vault.",
  "source": "./plugins/markdown-lsp",
  "lspServers": {
    "marksman": {
      "command": "marksman",
      "args": ["server"],
      "extensionToLanguage": {
        ".md": "markdown",
        ".markdown": "markdown"
      }
    }
  }
}
```

- [ ] **Step 3: Create README**

Create `/Users/bravonode/Mira/.claude-plugin/plugins/markdown-lsp/README.md` with:

```markdown
# markdown-lsp

Marksman LSP for MIRA's wiki/ Obsidian vault and docs/ tree.
Validates `[[wikilinks]]` and relative link targets.

## Install
`brew install marksman`
```

- [ ] **Step 4: Enable in settings.json**

```json
"markdown-lsp@mira-local": true
```

- [ ] **Step 5: Reload + verify**

Run: `/reload-plugins` — expect LSP count = 9.
Run: `/doctor` — `marksman` LSP `running`.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/ .claude/settings.json
git commit -m "feat(lsp): add marksman markdown language server

Validates wikilinks and relative paths in the wiki/ Obsidian
vault and docs/ tree."
```

---

## End-to-End Verification

After all tasks complete, verify the full LSP stack:

- [ ] **Step 1: Confirm 9 LSP servers loaded**

In Claude Code: `/reload-plugins`
Expected: `... 9 plugin LSP servers ...`

- [ ] **Step 2: Confirm all `running`**

`/doctor`
Expected output includes 9 LSPs all in `running` state:
- pyright (Python)
- typescript (TS/JS)
- ruff (Python)
- yaml (YAML)
- sqls (SQL)
- dockerfile (Dockerfile)
- taplo (TOML)
- bash (Shell)
- marksman (Markdown)

- [ ] **Step 3: Smoke test each LSP via deliberate edits**

For each language, have Claude make a trivial intentional bug and confirm the LSP reports it before committing:
- Python: assign wrong type to a variable in `mira-bots/shared/engine.py` — pyright + ruff should flag.
- TS: import unused symbol in `mira-web/src/index.ts` — typescript LSP should flag.
- YAML: misspell `depends_on` as `depends-on` in a compose file — yaml-language-server should flag.
- SQL: `SELCT *` typo in a `.sql` file — sqls should flag.
- Dockerfile: `COPYY` typo — dockerfile LSP should flag.
- TOML: invalid key in a `pyproject.toml` `[tool.ruff]` section — taplo should flag.
- Shell: unquoted `$var` with spaces — shellcheck via bash LSP should flag.
- Markdown: `[broken](nonexistent.md)` link — marksman should flag.

Revert all probe edits after verification — DO NOT commit them.

- [ ] **Step 4: Confirm pyright standard mode is active in Phase 0 Step 1**

Run: `pyright --verifytypes mira-bots.shared 2>&1 | head -5` (or the simpler `pyright | head -3`).
Expected: type checking mode shown as `standard`.

- [ ] **Step 5: Document any LSP that needed special workaround**

If any LSP failed to load on first attempt and required PATH/config changes, append to `docs/known-issues.md` so the next person doesn't trip over it.

---

## Rollback Procedure

If any LSP causes Claude Code to hang or produce noisy false positives, disable it without rolling back the install:

1. Edit `.claude/settings.json` — set the offending plugin to `false` (e.g. `"sql-lsp@mira-local": false`).
2. `/reload-plugins`.

The LSP binary stays installed for future use; only the Claude Code wiring is severed.

For full rollback of a tier, revert the corresponding commit (`git revert <sha>`).

---

## Self-Review Notes

**Spec coverage:** Phase 0 covers the pyright config bump explicitly proposed. Tiers 1–3 cover all 9 LSPs in the original suggestion (pyright, ruff, typescript, yaml, sql, dockerfile, taplo, shellcheck-backed bash, marksman).

**Type/name consistency:** Plugin slug `mira-local` used uniformly. `enabledPlugins` keys all use `name@mira-local` format (matches official `name@claude-plugins-official` convention).

**Known unknown:** The exact behavior of `extensionToLanguage` for the Dockerfile LSP (matching files with no extension) — Task 2.3 Step 2 has a fallback note. Verifier should confirm at Step 5 that `Dockerfile` files actually trigger the LSP, and if not, file an issue or adjust the matcher.

**Commit cadence:** 12 commits total — one per LSP plus Phase 0 plus marketplace scaffold. Any individual integration can be reverted without disturbing the others.
