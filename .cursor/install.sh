#!/usr/bin/env bash
# Cloud Agent install phase for the MIRA monorepo.
#
# Idempotent: installs the offline, secret-free Python dependency slice used by
# SimLab (the deterministic simulated-factory benchmark) and its test suite.
# Safe to re-run; pip is a no-op when everything is already satisfied.
set -euo pipefail

cd "$(dirname "$0")/.."

REQ=".cursor/requirements-dev.txt"

echo "[install] python: $(python3 --version)"
echo "[install] installing dev dependencies from ${REQ}"

# System interpreter is externally managed (PEP 668); --break-system-packages
# installs into it so `python3 -m simlab`, `pytest`, and `ruff` work from any
# shell without activating a venv.
python3 -m pip install --break-system-packages --disable-pip-version-check -q -r "${REQ}"

# Fail fast if the core offline surface cannot be imported.
python3 - <<'PY'
import importlib
for mod in ("fastapi", "uvicorn", "httpx", "yaml", "pytest", "ruff",
            "simlab", "simlab.api", "simlab.engine", "simlab.scenarios"):
    importlib.import_module(mod)
import simlab
print(f"[install] SimLab import OK (v{simlab.__version__})")
PY

echo "[install] done"
