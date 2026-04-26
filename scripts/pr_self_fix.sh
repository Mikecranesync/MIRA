#!/usr/bin/env bash
# pr_self_fix.sh — reads PR review comments, extracts 🔴 IMPORTANT flags,
# feeds them to the LLM cascade for fixes, commits + pushes. Loops up to 3 times.
#
# Usage: bash scripts/pr_self_fix.sh <PR_NUMBER>
# Requires: gh CLI authenticated, plus at least one of GROQ_API_KEY /
# CEREBRAS_API_KEY / GEMINI_API_KEY (Doppler factorylm/prd in CI).
# Anthropic was removed from MIRA permanently (PR #610) — never reintroduce.

set -euo pipefail

PR_NUMBER="${1:-}"
if [ -z "$PR_NUMBER" ]; then
  echo "Usage: $0 <PR_NUMBER>"
  exit 1
fi

MAX_LOOPS=3
LOOP=0

log() { echo "[pr_self_fix] $*" >&2; }

extract_important_issues() {
  local pr="$1"
  # Pull all comments, extract lines with 🔴 IMPORTANT
  gh pr view "$pr" --json comments \
    | python3 -c "
import json, sys, re
data = json.load(sys.stdin)
comments = data.get('comments', [])
issues = []
for c in comments:
    body = c.get('body', '')
    for line in body.splitlines():
        if '🔴' in line or 'IMPORTANT' in line:
            issues.append(line.strip())
print('\n'.join(issues))
"
}

apply_cascade_fixes() {
  local issues="$1"
  local diff
  diff=$(git diff HEAD~1..HEAD 2>/dev/null || git diff --cached 2>/dev/null || echo "")

  log "Sending issues to LLM cascade (Groq → Cerebras → Gemini) for fix suggestions..."
  python3 - "$issues" "${diff:0:8000}" << 'PYEOF'
"""Cascade-based fix proposer. Tries Groq → Cerebras → Gemini in order;
returns the first non-empty response. No Anthropic — removed PR #610."""
import os, sys, json
import urllib.request, urllib.error

issues = sys.argv[1]
diff = sys.argv[2]

PROMPT = f"""You are a code fixer for the MIRA project (Python/FastAPI, industrial maintenance AI).

The following IMPORTANT issues were found in a code review:

{issues}

Recent diff context:
```diff
{diff}
```

For each 🔴 IMPORTANT issue:
1. Identify the specific file and line where the issue is
2. Provide the EXACT fix as a unified diff or clear instruction
3. Explain why this fix resolves the issue

Format each fix as:
### Fix N: <issue summary>
**File:** <path>
**Change:**
```diff
<unified diff>
```
**Why:** <one sentence>

Focus only on 🔴 IMPORTANT issues. Skip suggestions and warnings.
Keep fixes minimal and targeted — no refactoring beyond the issue."""

PROVIDERS = [
    ("groq", "https://api.groq.com/openai/v1/chat/completions",
     os.environ.get("GROQ_API_KEY", ""),
     os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")),
    ("cerebras", "https://api.cerebras.ai/v1/chat/completions",
     os.environ.get("CEREBRAS_API_KEY", ""),
     os.environ.get("CEREBRAS_MODEL", "llama3.1-8b")),
    ("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
     os.environ.get("GEMINI_API_KEY", ""),
     os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")),
]

def call(provider, url, key, model):
    if not key:
        return None
    payload = json.dumps({
        "model": model,
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": PROMPT}],
        "temperature": 0.1,
    }).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        return data["choices"][0]["message"]["content"]
    except (urllib.error.URLError, KeyError, json.JSONDecodeError) as e:
        print(f"[cascade] {provider} failed: {e}", file=sys.stderr)
        return None

for name, url, key, model in PROVIDERS:
    out = call(name, url, key, model)
    if out:
        print(f"[cascade] used {name}/{model}", file=sys.stderr)
        print(out)
        sys.exit(0)

print("ERROR: all cascade providers failed (set at least one of GROQ_API_KEY / "
      "CEREBRAS_API_KEY / GEMINI_API_KEY)", file=sys.stderr)
sys.exit(1)
PYEOF
}

commit_and_push() {
  local loop="$1"
  local branch
  branch=$(git rev-parse --abbrev-ref HEAD)

  if git diff --quiet && git diff --cached --quiet; then
    log "No changes to commit on loop $loop."
    return 1
  fi

  git add -p  # interactive — but in CI, use git add -A
  # In automated context, stage all changed tracked files
  git diff --name-only | xargs -r git add
  git commit -m "fix(auto-review): loop ${loop} — address 🔴 IMPORTANT review findings

Applied by pr_self_fix.sh from PR #${PR_NUMBER} review comments,
using the LLM cascade (Groq → Cerebras → Gemini)."
  git push origin "$branch"
  log "Pushed fix loop $loop to $branch"
  return 0
}

# Main loop
while [ $LOOP -lt $MAX_LOOPS ]; do
  LOOP=$((LOOP + 1))
  log "=== Self-fix loop $LOOP / $MAX_LOOPS ==="

  ISSUES=$(extract_important_issues "$PR_NUMBER")
  if [ -z "$ISSUES" ]; then
    log "No 🔴 IMPORTANT issues found in PR #$PR_NUMBER — done."
    exit 0
  fi

  log "Found issues:"
  echo "$ISSUES"

  # Apply fixes (cascade outputs instructions; human/CI applies them)
  FIXES=$(apply_cascade_fixes "$ISSUES")
  log "Cascade fix suggestions:"
  echo "$FIXES"

  # Write fix suggestions to a temp file for reference
  echo "$FIXES" > /tmp/pr_self_fix_loop${LOOP}.md
  log "Fix suggestions written to /tmp/pr_self_fix_loop${LOOP}.md"

  # Check if the cascade's output contains actual diffs we can apply
  if echo "$FIXES" | grep -q '```diff'; then
    log "Attempting to extract and apply diffs..."
    echo "$FIXES" > /tmp/pr_fixes_raw.txt
    python3 /dev/stdin /tmp/pr_fixes_raw.txt << 'APPLY_PY'
import sys, re, subprocess, tempfile, os

content_file = sys.argv[1] if len(sys.argv) > 1 else "/tmp/pr_fixes_raw.txt"
with open(content_file) as f:
    content = f.read()

diffs = re.findall(r'```diff\n(.*?)```', content, re.DOTALL)
applied = 0
for diff in diffs:
    with tempfile.NamedTemporaryFile(mode='w', suffix='.patch', delete=False) as pf:
        pf.write(diff)
        patch_file = pf.name
    result = subprocess.run(
        ['git', 'apply', '--check', patch_file],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        subprocess.run(['git', 'apply', patch_file], check=False)
        applied += 1
        print(f"Applied patch {applied}", file=sys.stderr)
    else:
        print(f"Patch check failed: {result.stderr[:200]}", file=sys.stderr)
    os.unlink(patch_file)
print(f"Applied {applied} patches")
APPLY_PY
  fi

  # Commit whatever changes exist
  if ! commit_and_push "$LOOP"; then
    log "Nothing committed on loop $LOOP — stopping."
    break
  fi

  # Re-check for remaining issues after push
  log "Waiting 10s for CI to pick up push..."
  sleep 10
done

log "Self-fix complete after $LOOP loop(s). Check PR #$PR_NUMBER for results."
