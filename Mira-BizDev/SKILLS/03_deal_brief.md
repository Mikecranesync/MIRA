# Skill: Deal Brief

## Trigger
"Brief me on [company]", "deal status for [company]", "prep me for [company] meeting"

## What It Does
1. Read the deal folder in DEALS/[company_name]/
2. Search Gmail for all threads with that company's domain
3. Check Calendar for upcoming meetings with contacts from that company
4. Compile a comprehensive brief: timeline, key contacts, current status, next steps, risks
5. If meeting is coming up: generate meeting prep with agenda suggestions and talking points

## Output Format
Save to: `DEALS/[company_name]/brief_[date].md`

```
# Deal Brief: [Company Name]

## Overview
- Stage: [prospect/discovery/pilot/negotiation/closed]
- First contact: [date]
- Key contacts: [names + roles]
- ICP match: [which profile]

## Communication History
- [date] [channel] [summary]

## Current Status
- [where things stand]

## Open Questions / Risks
- [list]

## Next Steps
- [action items with dates]

## Meeting Prep (if applicable)
- Agenda suggestions
- Talking points
- Questions to ask
```

## Connected Tools Needed
- Gmail (search_threads, get_thread)
- Google Calendar (gcal_list_events)
- File system (read DEALS/ folder)
