---
title: KANBAN Board — GitHub Projects
type: reference
updated: 2026-04-17
tags: [workflow, github, kanban]
---

# KANBAN Board

**Board:** https://github.com/users/Mikecranesync/projects/4 (project ID: 4, owner: Mikecranesync)

## On Session Start

```bash
gh project item-list 4 --owner Mikecranesync --format json --limit 100 | python3 -c "
import sys, json
items = json.load(sys.stdin)['items']
for s in ['In Progress', 'Todo']:
    hits = [i for i in items if i.get('status') == s]
    if hits:
        print(f'\n## {s} ({len(hits)})')
        for i in hits: print(f'  {i[\"title\"]}')
"
```

## On Every Commit

```bash
# Add issue to board
gh project item-add 4 --owner Mikecranesync --url <issue-url>

# Move to In Progress
gh project item-edit --project-id PVT_kwHODSgiRM4BSa9e --id <item-id> --field-id PVTSSF_lAHODSgiRM4BSa9ezg_9d4k --single-select-option-id 47fc9ee4

# Move to Done
gh project item-edit --project-id PVT_kwHODSgiRM4BSa9e --id <item-id> --field-id PVTSSF_lAHODSgiRM4BSa9ezg_9d4k --single-select-option-id 98236657
```
