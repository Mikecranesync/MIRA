#!/usr/bin/env python3
import subprocess
import json
import re
import sys

def get_pr_info(pr_num):
    """Get PR details including CI status"""
    try:
        result = subprocess.run(
            ['gh', 'pr', 'view', str(pr_num), '--json', 'title,headRefName,statusCheckRollup'],
            capture_output=True,
            text=True,
            cwd='/Users/bravonode/Mira'
        )
        if result.returncode != 0:
            print(f"Error fetching PR {pr_num}: {result.stderr}", file=sys.stderr)
            return None

        data = json.loads(result.stdout)
        title = data['title']
        branch = data['headRefName']

        checks = data.get('statusCheckRollup', [])
        pass_count = sum(1 for c in checks if c.get('conclusion') == 'SUCCESS')
        fail_count = sum(1 for c in checks if c.get('conclusion') == 'FAILURE')
        pending_count = sum(1 for c in checks if c.get('conclusion') is None)

        return {
            'pr': pr_num,
            'title': title,
            'branch': branch,
            'pass': pass_count,
            'fail': fail_count,
            'pending': pending_count
        }
    except Exception as e:
        print(f"Error processing PR {pr_num}: {e}", file=sys.stderr)
        return None

# Get all open dependabot PRs
result = subprocess.run(
    ['gh', 'pr', 'list', '--author', 'app/dependabot', '--state', 'open', '-L', '100',
     '--json', 'number', '--jq', '.[].number'],
    capture_output=True,
    text=True,
    cwd='/Users/bravonode/Mira'
)

pr_nums = [int(x) for x in result.stdout.strip().split('\n') if x]
prs = []

for pr_num in sorted(pr_nums, reverse=True):
    info = get_pr_info(pr_num)
    if info:
        prs.append(info)

# Output as JSON
print(json.dumps(prs, indent=2))
