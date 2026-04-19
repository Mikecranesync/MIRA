#!/usr/bin/env bash
# Install MIRA's pre-commit hooks. Idempotent — safe to re-run.
#
# Usage:  bash tools/setup_precommit.sh
# Bypass: git commit --no-verify
#
# Spec: docs/superpowers/specs/2026-04-19-velocity-3-precommit-smoke-design.md

set -e

# Pick a Python invocation that exists
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "ERROR: no python found in PATH (tried python3, python)" >&2
  exit 1
fi

# Prefer uv if available (per repo's package-manager preference); fall back to pip
if command -v uv >/dev/null 2>&1; then
  echo "→ Installing pre-commit + watchdog via uv..."
  uv pip install pre-commit watchdog
else
  echo "→ Installing pre-commit + watchdog via pip..."
  "$PY" -m pip install pre-commit watchdog
fi

echo "→ Registering git hook..."
"$PY" -m pre_commit install --install-hooks

cat <<EOF

Pre-commit installed. Hooks that fire on every commit:
  ruff check --fix      lint + auto-fix
  ruff format           format
  pyright               types
  bandit                security (high severity, .bandit.yml)
  gitleaks              secrets (.gitleaks.toml)
  fsm-smoke             ~50 FSM/Q-trap/guardrails unit tests (~5-30s)

Watcher (opt-in, manual): python tools/eval_watch.py
Bypass any hook: git commit --no-verify

Re-run this script anytime — it's idempotent.
EOF
