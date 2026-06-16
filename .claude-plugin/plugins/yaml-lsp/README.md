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
