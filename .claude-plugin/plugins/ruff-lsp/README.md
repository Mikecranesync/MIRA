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
