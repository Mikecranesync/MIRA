#!/usr/bin/env bash
# pr_self_fix.sh — reads PR review comments, extracts 🔴 IMPORTANT flags,
# feeds them to Claude for fixes, commits + pushes. Loops up to 3 times.
#
# Usage: bash scripts/pr_self_fix.sh <PR_NUMBER>
# Requires: gh CLI authenticated, ANTHROPIC_API_KEY set (or in Doppler)

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

apply_claude_fixes() {
  local issues="$1"
  local diff
  diff=$(git diff HEAD~1..HEAD 2>/dev/null || git diff --cached 2>/dev/null || echo "")

  log "Sending issues to Claude for fix suggestions..."
  python3 - << PYEOF
import anthropic, os, sys, subprocess, json

api_key = os.environ.get("ANTHROPIC_API_KEY", "")
if not api_key:
    print("ERROR: ANTHROPIC_API_KEY not set", file=sys.stderr)
    sys.exit(1)

issues = """$issues"""
diff = """${diff:0:8000}"""

client = anthropic.Anthropic(api_key=api_key)

prompt = f"""You are a code fixer for the MIRA project (Python/FastAPI, industrial maintenance AI).

The following IMPORTANT issues were found in a code review:

{issues}

Recent diff context:
\`\`\`diff
{diff}
\`\`\`

For each 🔴 IMPORTANT issue:
1. Identify the specific file and line where the issue is
2. Provide the EXACT fix as a unified diff or clear instruction
3. Explain why this fix resolves the issue

Format each fix as:
### Fix N: <issue summary>
**File:** <path>
**Change:**
\`\`\`diff
<unified diff>
\`\`\`
**Why:** <one sentence>

Focus only on 🔴 IMPORTANT issues. Skip suggestions and warnings.
Keep fixes minimal and targeted — no refactoring beyond the issue."""

message = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=4096,
    messages=[{"role": "user", "content": prompt}],
)

print(message.content[0].text)
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

Applied by pr_self_fix.sh from PR #${PR_NUMBER} review comments.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
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

  # Apply fixes (Claude outputs instructions; human/CI applies them)
  FIXES=$(apply_claude_fixes "$ISSUES")
  log "Claude fix suggestions:"
  echo "$FIXES"

  # Write fix suggestions to a temp file for reference
  echo "$FIXES" > /tmp/pr_self_fix_loop${LOOP}.md
  log "Fix suggestions written to /tmp/pr_self_fix_loop${LOOP}.md"

  # Check if Claude's output contains actual diffs we can apply
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
