# Skill: Morning Brief

## Trigger
Run daily at start of workday (or on demand: "morning brief", "what's on my plate")

## What It Does
1. Check Gmail for overnight replies, new inbound leads, and flagged threads
2. Check Google Calendar for today's meetings — flag any that need prep
3. Review DEALS/ folder for active deal status and upcoming milestones
4. Check for any prospect follow-ups that are overdue
5. Summarize competitive intel alerts if any

## Output Format
Save to: `CLAUDE_OUTPUTS/morning_brief_[YYYY-MM-DD].md`

```
# Morning Brief — [Date]

## Priority Actions (do these first)
- [action 1]
- [action 2]

## Today's Calendar
- [time] [meeting] — [prep status]

## Email Highlights
- [thread summary + recommended action]

## Deal Pipeline Status
- [deal updates]

## Overdue Follow-ups
- [who, when, what]
```

## Connected Tools Needed
- Gmail (search_threads)
- Google Calendar (gcal_list_events)
- File system (read DEALS/ folder)
