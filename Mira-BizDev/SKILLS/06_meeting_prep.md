# Skill: Meeting Prep

## Trigger
"Prep me for my call with [company]", "meeting prep", "I'm meeting with [person]"

## What It Does
1. Check Calendar for the meeting details (attendees, time, description)
2. Research each attendee (LinkedIn, company website, web search)
3. Pull deal context from DEALS/ folder if it exists
4. Search Gmail for prior communication with attendees
5. Generate a one-page prep doc with agenda, talking points, and questions

## Output Format
Save to: `MEETING_PREP/[company]_[date].md`

```
# Meeting Prep: [Company] — [Date/Time]

## Attendees
| Name | Title | Background | Notes |
|------|-------|-----------|-------|

## Context
- How we connected: [source]
- Previous interactions: [summary]
- Their likely pain points: [based on ICP + research]

## Agenda (suggested)
1. [topic — N minutes]
2. [topic — N minutes]
3. [topic — N minutes]

## Talking Points
- [point 1 — with supporting detail]
- [point 2]

## Questions to Ask
- [question 1 — why it matters]
- [question 2]

## Demo Plan (if applicable)
- Show: [specific feature/scenario relevant to their pain]
- Skip: [what NOT to demo based on their profile]

## Desired Outcome
- [what does success look like for this meeting]
```

## Connected Tools Needed
- Google Calendar (gcal_get_event)
- Web search (attendee research)
- Gmail (search_threads)
- File system (DEALS/, ICP_PROFILES.md)
