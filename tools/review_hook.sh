#!/usr/bin/env bash
# MIRA PostToolUse code review hook — lightweight anti-pattern checker.
# Runs after every Edit/Write. Advisory only (exit 0 always).
# ~100ms, zero API calls.

set -uo pipefail
# Note: no -e — grep returns 1 on no match, which is expected

FILE="${1:-}"
[[ -z "$FILE" ]] && exit 0
[[ ! -f "$FILE" ]] && exit 0

# Only check Python and Dockerfiles
case "$FILE" in
    *.py) ;;
    */Dockerfile|Dockerfile) ;;
    *) exit 0 ;;
esac

ERRORS=0
WARNS=0

check_error() {
    echo "[review] ERROR: $1 — $FILE:$2" >&2
    ERRORS=$((ERRORS + 1))
}

check_warn() {
    echo "[review] WARN: $1 — $FILE:$2" >&2
    WARNS=$((WARNS + 1))
}

# Skip test files and scripts for some checks
IS_TEST=0
IS_CLI=0
case "$FILE" in
    */tests/*|*/test_*|test_*) IS_TEST=1 ;;
    */cli.py|*/main.py|*/evaluator.py|*/feedback_sync.py|*/few_shot_trainer.py) IS_CLI=1 ;;
    */scripts/*|scripts/*) IS_CLI=1 ;;
esac

# --- Python checks ---
if [[ "$FILE" == *.py ]]; then

    # 1. asyncio.run() inside async function (never in async context)
    LINE=$(grep -n 'asyncio\.run(' "$FILE" 2>/dev/null | head -1 | cut -d: -f1)
    [[ -n "$LINE" ]] && check_error "asyncio.run() — use 'await' in async functions, asyncio.run() only at entry points" "$LINE"

    # 2. yaml.load without SafeLoader
    LINE=$(grep -n 'yaml\.load(' "$FILE" 2>/dev/null | grep -v 'safe_load' | grep -v 'SafeLoader' | head -1 | cut -d: -f1)
    [[ -n "$LINE" ]] && check_error "Use yaml.safe_load(), never yaml.load()" "$LINE"

    # 3. import requests (must use httpx)
    LINE=$(grep -n -E '^\s*import requests\s*$|^\s*from requests ' "$FILE" 2>/dev/null | head -1 | cut -d: -f1)
    [[ -n "$LINE" ]] && check_error "Use httpx, not requests (python-standards.md)" "$LINE"

    # 4. pickle.load / pickle.loads
    LINE=$(grep -n 'pickle\.loads\?\b' "$FILE" 2>/dev/null | head -1 | cut -d: -f1)
    [[ -n "$LINE" ]] && check_error "Never deserialize untrusted pickle (security-boundaries.md)" "$LINE"

    # 5. NeonDB connection pooling (must use NullPool)
    LINE=$(grep -n 'pool_size\|create_engine.*poolclass' "$FILE" 2>/dev/null | grep -v 'NullPool' | head -1 | cut -d: -f1)
    [[ -n "$LINE" ]] && check_error "NeonDB must use NullPool — no application-side pooling" "$LINE"

    # 6. shell=True in subprocess (warn, not error — sometimes intentional in scripts)
    if [[ "$IS_CLI" -eq 0 ]]; then
        LINE=$(grep -n 'shell=True' "$FILE" 2>/dev/null | head -1 | cut -d: -f1)
        [[ -n "$LINE" ]] && check_warn "subprocess shell=True — prefer shell=False to avoid injection" "$LINE"
    fi

    # 7. print() in production code (not tests, not CLI)
    if [[ "$IS_TEST" -eq 0 && "$IS_CLI" -eq 0 ]]; then
        COUNT=$(grep -c '^\s*print(' "$FILE" 2>/dev/null || true)
        if [[ "$COUNT" -gt 0 ]]; then
            LINE=$(grep -n '^\s*print(' "$FILE" 2>/dev/null | head -1 | cut -d: -f1)
            check_warn "Use logging.getLogger(), not print() in production code ($COUNT occurrences)" "$LINE"
        fi
    fi

    # 8. .env file reads (should use Doppler)
    LINE=$(grep -n 'load_dotenv\|dotenv' "$FILE" 2>/dev/null | head -1 | cut -d: -f1)
    [[ -n "$LINE" ]] && check_warn "Use Doppler for secrets, not .env files (security-boundaries.md)" "$LINE"

    # 9. TODO without issue number
    LINE=$(grep -n 'TODO\|FIXME\|HACK\|XXX' "$FILE" 2>/dev/null | grep -v '#[0-9]' | head -1 | cut -d: -f1)
    [[ -n "$LINE" ]] && check_warn "TODO/FIXME without issue number — link to a GitHub issue" "$LINE"

fi

# --- Dockerfile checks ---
if [[ "$FILE" == *Dockerfile* ]]; then

    # 10. :latest or :main tags
    LINE=$(grep -n ':latest\|:main' "$FILE" 2>/dev/null | grep -v '^#' | head -1 | cut -d: -f1)
    [[ -n "$LINE" ]] && check_error "Pin Docker image versions — no :latest or :main tags (security-boundaries.md)" "$LINE"

fi

# Summary (only if findings)
if [[ $ERRORS -gt 0 || $WARNS -gt 0 ]]; then
    echo "[review] $ERRORS error(s), $WARNS warning(s)" >&2
fi

exit 0
