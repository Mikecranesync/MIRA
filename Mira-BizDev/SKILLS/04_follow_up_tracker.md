# Skill: Follow-Up Tracker

## Trigger
"Check follow-ups", "what's overdue", "who haven't I replied to"

## What It Does
1. Scan Gmail for threads where the last message is FROM a prospect/contact (awaiting Mike's reply)
2. Cross-reference with DEALS/ and PROSPECTS/ folders for context
3. Flag threads by urgency: overdue (>48h), due today, upcoming
4. For each overdue thread, draft a suggested reply or follow-up

## Output Format
Save to: `CLAUDE_OUTPUTS/followup_check_[date].md`

```
# Follow-Up Tracker — [Date]

## Overdue (>48 hours)
| Contact | Company | Last Message | Days Waiting | Suggested Action |
|---------|---------|-------------|--------------|-----------------|
| [name]  | [co]    | [summary]   | [N]          | [action]         |

## Due Today
| Contact | Company | Context | Suggested Action |
|---------|---------|---------|-----------------|

## Coming Up (next 7 days)
| Contact | Company | Scheduled Follow-Up | Notes |
|---------|---------|-------------------|-------|
```

## Connected Tools Needed
- Gmail (search_threads)
- File system (read DEALS/, PROSPECTS/)
