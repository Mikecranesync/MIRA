#!/bin/bash
set -euo pipefail

# Self-fix loop: read PR review comments, extract IMPORTANT flags, feed to Claude, commit fixes
# Usage: ./scripts/pr_self_fix.sh [PR_NUMBER]

PR_NUM="${1:-$(gh pr view --json number -q .number)}"
MAX_ITERATIONS=3
ITERATION=0

echo "=== PR Self-Fix Script ==="
echo "PR: #$PR_NUM"

while [ $ITERATION -lt $MAX_ITERATIONS ]; do
    ITERATION=$((ITERATION + 1))
    echo ""
    echo "--- Iteration $ITERATION of $MAX_ITERATIONS ---"

    # Get review comments with IMPORTANT flags
    ISSUES=$(gh pr view "$PR_NUM" --json reviews,comments -q '
        [.reviews[].body, .comments[].body] | flatten | map(select(. != null)) | join("\n")
    ' | grep -E "🔴 IMPORTANT|IMPORTANT:" || true)

    if [ -z "$ISSUES" ]; then
        echo "✅ No critical issues found. Done."
        break
    fi

    echo "Found critical issues:"
    echo "$ISSUES"
    echo ""

    # Feed to Claude for fixing
    echo "$ISSUES" | python3 -c "
import sys, anthropic, os

issues = sys.stdin.read()
if not issues.strip():
    print('No issues to fix')
    sys.exit(0)

api_key = os.getenv('ANTHROPIC_API_KEY', '')
if not api_key:
    print('ANTHROPIC_API_KEY not set — cannot auto-fix')
    sys.exit(1)

client = anthropic.Anthropic(api_key=api_key)
response = client.messages.create(
    model='claude-sonnet-4-5',
    max_tokens=4000,
    messages=[{
        'role': 'user',
        'content': f'''These code review issues were flagged as IMPORTANT in a MIRA PR.
For each one, output the exact file path and the corrected code snippet.
Output only the changes, not explanations. Format as:

FILE: path/to/file.py
CHANGE: <what to change>
CORRECTED CODE:
\`\`\`python
<corrected snippet>
\`\`\`

Issues:
{issues}'''
    }]
)
print(response.content[0].text)
"

    # Stage and commit any fixes applied
    git add -A
    if git diff --cached --quiet; then
        echo "No changes to commit on iteration $ITERATION."
        break
    fi

    git commit -m "fix: auto-resolve PR review issues (iteration $ITERATION)"
    git push

    echo "Pushed fixes. Waiting 30s for CI to re-run..."
    sleep 30
done

echo ""
echo "=== Self-fix complete after $ITERATION iteration(s) ==="
