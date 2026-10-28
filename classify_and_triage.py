#!/usr/bin/env python3
import json
import re
from typing import Tuple

data_json = '''[
  {
    "pr": 4819,
    "title": "chore(deps): bump actions/download-artifact from 4.3.0 to 8.0.2",
    "pass": 42,
    "fail": 1,
    "pending": 2
  },
  {
    "pr": 4818,
    "title": "chore(deps): bump actions/setup-node from 4 to 7",
    "pass": 47,
    "fail": 3,
    "pending": 2
  },
  {
    "pr": 4817,
    "title": "chore(deps): update anthropic requirement from >=0.116.0 to >=2.2.0 in /mira-bots/telegram",
    "pass": 42,
    "fail": 2,
    "pending": 2
  },
  {
    "pr": 4815,
    "title": "chore(deps): update openai requirement from >=1.66.0 to >=3.37.0 in /mira-bots/telegram",
    "pass": 43,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4814,
    "title": "chore(deps): update sqlalchemy requirement from <2.1,>=2.0.50 to >=2.1.6,<2.2 in /mira-core/mira-ingest",
    "pass": 43,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4813,
    "title": "chore(deps): update fastapi requirement from ==0.136.* to ==0.162.* in /mira-core/mira-ingest",
    "pass": 43,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4812,
    "title": "chore(deps): update sqlalchemy requirement from <2.1,>=2.0.50 to >=2.1.6,<2.2 in /mira-bots/telegram",
    "pass": 42,
    "fail": 2,
    "pending": 2
  },
  {
    "pr": 4811,
    "title": "chore(deps): bump starlette from 1.3.1 to 1.10.0 in /mira-mcp",
    "pass": 43,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4810,
    "title": "chore(deps): update sqlalchemy requirement from <2.1,>=2.0.50 to >=2.1.6,<2.2 in /mira-crawler",
    "pass": 43,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4807,
    "title": "chore(deps): update langfuse requirement from <3.0.0,>=2.50.0 to >=5.0.4,<6.0.0 in /mira-bots/telegram",
    "pass": 44,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4806,
    "title": "chore(deps): bump android-actions/setup-android from 3.2.2 to 4.0.4",
    "pass": 42,
    "fail": 1,
    "pending": 2
  },
  {
    "pr": 4805,
    "title": "chore(deps): update fastmcp requirement from ==3.3.* to ==4.1.* in /mira-mcp",
    "pass": 43,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4283,
    "title": "chore(deps): update langfuse requirement from <3.0.0,>=2.50.0 to >=5.0.4,<6.0.0 in /mira-bots/telegram",
    "pass": 42,
    "fail": 2,
    "pending": 2
  },
  {
    "pr": 4282,
    "title": "chore(deps): Bump @neondatabase/serverless from 1.1.0 to 1.2.0 in /mira-web",
    "pass": 40,
    "fail": 3,
    "pending": 2
  },
  {
    "pr": 4281,
    "title": "chore(deps): Bump hono from 4.12.23 to 4.13.12 in /mira-web",
    "pass": 40,
    "fail": 3,
    "pending": 2
  },
  {
    "pr": 4280,
    "title": "chore(deps): Update anthropic requirement from >=0.116.0 to >=1.11.0 in /mira-bots/telegram",
    "pass": 44,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4279,
    "title": "chore(deps): Bump jose from 6.2.3 to 6.2.12 in /mira-web",
    "pass": 40,
    "fail": 3,
    "pending": 2
  },
  {
    "pr": 4278,
    "title": "chore(deps): update sqlalchemy requirement from <2.1,>=2.0.50 to >=2.1.6,<2.2 in /mira-bots/telegram",
    "pass": 42,
    "fail": 2,
    "pending": 2
  },
  {
    "pr": 4277,
    "title": "chore(deps-dev): Bump @types/bun from 1.3.14 to 1.4.2 in /mira-web",
    "pass": 40,
    "fail": 3,
    "pending": 2
  },
  {
    "pr": 4276,
    "title": "chore(deps): Bump stripe from 22.2.0 to 23.0.0 in /mira-web",
    "pass": 40,
    "fail": 3,
    "pending": 2
  },
  {
    "pr": 4275,
    "title": "chore(deps): Update openai requirement from >=1.66.0 to >=3.23.0 in /mira-bots/telegram",
    "pass": 44,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4272,
    "title": "chore(deps): bump uvicorn from 0.48.0 to 0.54.0 in /mira-mcp",
    "pass": 43,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4269,
    "title": "chore(deps): bump starlette from 1.3.1 to 1.10.0 in /mira-mcp",
    "pass": 43,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4267,
    "title": "chore(deps): update sqlalchemy requirement from <2.1,>=2.0.50 to >=2.1.6,<2.2 in /mira-crawler",
    "pass": 42,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4266,
    "title": "chore(deps): Update fastmcp requirement from ==3.3.* to ==4.0.* in /mira-mcp",
    "pass": 43,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4260,
    "title": "chore(deps): update sqlalchemy requirement from <2.1,>=2.0.50 to >=2.1.6,<2.2 in /mira-core/mira-ingest",
    "pass": 43,
    "fail": 0,
    "pending": 2
  },
  {
    "pr": 4259,
    "title": "chore(deps): update uvicorn requirement from ==0.48.* to ==0.54.* in /mira-core/mira-ingest",
    "pass": 43,
    "fail": 0,
    "pending": 2
  }
]'''

def parse_versions(title: str) -> Tuple[str, str, str, str]:
    """Extract package, directory, from_version, to_version from title"""
    package = None
    directory = None
    from_v = None
    to_v = None

    # Handle "bump" pattern
    if ' bump ' in title:
        match = re.search(r'bump ([\w\-/@\.]+) from ([\d.]+) to ([\d.]+)', title)
        if match:
            package = match.group(1)
            from_v = match.group(2)
            to_v = match.group(3)
    # Handle "update" pattern
    elif ' update ' in title:
        match = re.search(r'update ([\w\-]+) requirement from[^t]*to (.+) in (.+)', title)
        if match:
            package = match.group(1)
            to_spec = match.group(2)
            directory = match.group(3)
            # Extract version from specs like ">=2.2.0" or ">=3.37.0"
            m2 = re.search(r'from.*>=?([\d.]+).*to.*>=?([\d.]+)', title)
            if m2:
                from_v = m2.group(1)
                to_v = m2.group(2)
    # Handle "Bump" pattern (npm)
    elif ' Bump ' in title:
        match = re.search(r'Bump ([\w\-/@\.]+) from ([\d.]+) to ([\d.]+)', title)
        if match:
            package = match.group(1)
            from_v = match.group(2)
            to_v = match.group(3)

    # Extract directory if not already done
    if directory is None and ' in ' in title:
        directory = title.split(' in ')[-1]

    return package, directory, from_v, to_v

def classify_semver(from_v: str, to_v: str, package: str) -> str:
    """Classify as patch, minor, or major"""
    if not from_v or not to_v:
        return 'unknown'

    try:
        from_parts = from_v.split('.')
        to_parts = to_v.split('.')

        from_major = int(from_parts[0])
        from_minor = int(from_parts[1]) if len(from_parts) > 1 else 0

        to_major = int(to_parts[0])
        to_minor = int(to_parts[1]) if len(to_parts) > 1 else 0

        # Special case for 0.x versions: minor bump in 0.x is considered major-like
        if from_major == 0 and from_major != to_major:
            return 'major'  # 0.x to 1.x is major
        elif from_major == 0 and from_minor != to_minor:
            return 'major'  # 0.1 to 0.2 is major for 0.x
        elif to_major != from_major:
            return 'major'
        elif to_minor != from_minor:
            return 'minor'
        else:
            return 'patch'
    except:
        return 'unknown'

prs = json.loads(data_json)

# Analyze each PR
analysis = []
for pr in prs:
    pkg, directory, from_v, to_v = parse_versions(pr['title'])
    semver = classify_semver(from_v, to_v, pkg)
    ci_green = pr['fail'] == 0

    analysis.append({
        'pr': pr['pr'],
        'package': pkg,
        'directory': directory,
        'from': from_v,
        'to': to_v,
        'semver': semver,
        'pass': pr['pass'],
        'fail': pr['fail'],
        'pending': pr['pending'],
        'ci_green': ci_green,
        'title': pr['title'][:60]
    })

# Find duplicates (same package + directory)
dup_keys = {}
for a in analysis:
    key = (a['package'], a['directory'])
    if key not in dup_keys:
        dup_keys[key] = []
    dup_keys[key].append(a['pr'])

# Mark duplicates
for a in analysis:
    key = (a['package'], a['directory'])
    dups = dup_keys[key]
    if len(dups) > 1:
        a['duplicate'] = True
        a['dupe_of_pr'] = max(dups)  # newest PR number
    else:
        a['duplicate'] = False
        a['dupe_of_pr'] = None

# Print analysis
print("PR\tPackage\t\tDir\t\t\tFrom\tTo\tSemver\tCI\tFail\tDupe")
print("=" * 120)
for a in sorted(analysis, key=lambda x: -x['pr']):
    dupe_str = f"of #{a['dupe_of_pr']}" if a['duplicate'] else ""
    print(f"{a['pr']}\t{a['package']}\t{a['directory']}\t{a['from']}\t{a['to']}\t{a['semver']}\t{a['ci_green']}\t{a['fail']}\t{dupe_str}")

# Group by action
merge_list = []
close_list = []  # (pr, dupe_of)
defer_list = []

for a in analysis:
    if a['duplicate']:
        if a['pr'] != a['dupe_of_pr']:
            close_list.append((a['pr'], a['dupe_of_pr']))
    elif a['semver'] in ['patch', 'minor']:
        if a['ci_green']:
            merge_list.append(a['pr'])
        else:
            defer_list.append(a['pr'])
    else:  # major
        defer_list.append(a['pr'])

print("\n\n=== TRIAGE SUMMARY ===")
print(f"\nMERGE ({len(merge_list)}):")
for pr in sorted(merge_list):
    print(f"  gh pr merge {pr}")

print(f"\nCLOSE duplicates ({len(close_list)}):")
for pr, dupe_of in sorted(close_list):
    print(f"  gh pr close {pr} -c 'Duplicate of #{dupe_of}'")

print(f"\nDEFER (failures or major) ({len(defer_list)}):")
for pr in sorted(defer_list):
    for a in analysis:
        if a['pr'] == pr:
            print(f"  #{pr}: {a['package']} {a['from']}->{a['to']} ({a['semver']}, fail={a['fail']})")
