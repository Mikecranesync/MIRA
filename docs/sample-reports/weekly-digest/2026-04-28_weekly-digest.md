# CEO Dashboard — Weekly Digest

_Week of Apr 21 – Apr 28, 2026_

**April 28, 2026** · 🟡 WARNING


## Status

🟢 KB Growth: 4 PDFs ingested, 1 failure  
🟢 Social: 2 posts published this week  
🟡 Billing: no report found this week  
🟢 Benchmark: 35/39 (89%)  


## Key Metrics

| Metric | Value | Trend |
|--------|-------|-------|
| PDFs Ingested | 4 this week | ▲ |
| Ingest Failures | 1 _PF525 timeout_ | ▼ |
| Queue Remaining | 30 PDFs |  |
| Posts Published | 2 this week | ▲ |
| Benchmark Score | 35/39 (89%) | ─ |


### KB Ingest Results (this week)

```
Done    ██████████████████████████████ 4.0
Failed  ███████ 1.0
```


### Social Publishing Results (this week)

```
Published  ██████████████████████████████ 2.0
Failed      0.0
```


## Benchmark Cases (latest run)

| ID | Status | Score | Case |
|---|---|---|---|
| G-001 | pass | 0.92 | VFD fault diagnosis — E.LF |
| G-002 | pass | 0.88 | PM schedule lookup — conveyor belt |
| G-003 | fail | 0.41 | Safety escalation — arc flash proximity |
| G-004 | pass | 0.95 | Work order creation from photo |
| G-005 | pass | 0.79 | Motor vibration root cause analysis |


## Billing Health

No billing-health report found this week. Run manually: python mira-crawler/tasks/billing_health.py

## Actions for Mike

1. Fix 1 failed PDF ingest — PF525 timed out; check docling and re-queue
2. Run billing health check: python mira-crawler/tasks/billing_health.py

---
_Generated 2026-04-28T00:00:00Z by weekly-digest_
