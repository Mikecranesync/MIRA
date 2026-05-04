# Skill: Weekly Pipeline Review

## Trigger
"Pipeline review", "weekly review", "how's the pipeline", run weekly (Fridays)

## What It Does
1. Read all DEALS/ subfolders and compile current status
2. Search Gmail for deal-related activity in the past week
3. Identify stalled deals (no activity >14 days)
4. Calculate pipeline metrics (total deals, by stage, by ICP)
5. Flag risks and recommend actions for the coming week
6. Update DEALS/ files with any new information found

## Output Format
Save to: `CLAUDE_OUTPUTS/pipeline_review_[date].md`

```
# Pipeline Review — Week of [Date]

## Summary
- Total active deals: [N]
- By stage: [Prospect: N | Discovery: N | Pilot: N | Negotiation: N]
- New this week: [N]
- Moved forward: [N]
- Stalled: [N]

## Deal-by-Deal Status
### [Company Name] — [Stage]
- Last activity: [date] — [what happened]
- Next step: [action + date]
- Risk level: [low/medium/high] — [why]

## This Week's Wins
- [positive developments]

## Risks & Stalled Deals
- [company] — stalled since [date] — recommended action: [action]

## Next Week's Priorities
1. [priority action]
2. [priority action]
3. [priority action]

## Outreach Targets
- [new companies to pursue based on ICP fit + trigger events]
```

## Connected Tools Needed
- Gmail (search_threads)
- File system (DEALS/)
- Web search (for trigger events on prospects)
