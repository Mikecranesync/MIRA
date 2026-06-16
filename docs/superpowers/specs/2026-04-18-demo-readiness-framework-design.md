# MIRA Demo-Readiness Scoring Framework

**Version:** 1.0  
**Created:** 2026-04-18  
**Audience:** Internal — guides session-start assessment of demo/customer readiness

---

## Overview

Seven pillars, each scored 0–10. Audience-weighted composite score per stakeholder type.
Hard blockers override scores — any major blocker flips a pillar to RED regardless of numeric score.

### Scoring Scale

| Score | Meaning |
|---|---|
| 0–3 | Not built or critically broken |
| 4–5 | Exists but has significant gaps |
| 6–7 | Functional, demo-able with caveats |
| 8–9 | Production-quality |
| 10 | Industry benchmark |

### Readiness Status

| Status | Criteria |
|---|---|
| GREEN | Composite ≥ 7.0, zero major blockers |
| YELLOW | Composite 5.0–6.9, minor blockers only |
| RED | Composite < 5.0, OR any major blocker present |

---

## Pillar 1 — Knowledge Quality

*Does the AI know what it's talking about?*

| Dimension | Measure | How |
|---|---|---|
| Eval pass rate | % of fixture scenarios passing | Automated — latest scorecard in `tests/eval/runs/` |
| KB coverage | Target equipment models covered ≥ 50 chunks each | Automated — NeonDB query |
| Honesty / hallucination rate | % of out-of-KB queries correctly refusing | Automated — `cp_honesty` grader checkpoint |
| Citation quality | Sources returned with answers, URLs are real | Manual — spot check 5 answers |
| Answer accuracy | Advice matches actual manual content | Manual — 5 random fault queries vs. ground truth |

---

## Pillar 2 — Usability

*Can a real technician use it without training?*

| Dimension | Measure | How |
|---|---|---|
| Time to first useful answer | Cold start → useful response, timed | Manual — timed walk |
| Error message clarity | No raw JSON/tracebacks exposed to user | Manual + log scan for unhandled exceptions |
| Conversation naturalness | FSM feels like dialogue, not interrogation | Manual — 3 real fault scenarios |
| Empty state handling | Useful response when KB has no answer | Manual |
| Mobile / web accessibility | Works on phone browser, no layout breaks | Manual |
| Onboarding without tutorial | New user gets value in < 5 min unaided | Manual — observation |
| WCAG 2.1 AA compliance | Web UI passes basic accessibility audit | Automated — axe-core or Lighthouse |

---

## Pillar 3 — Engineering Quality

*Is it stable, secure, and deployable?*

| Dimension | Measure | How |
|---|---|---|
| Container health | All core containers passing healthcheck | Automated — `docker compose ps` |
| Security posture | No secrets in logs, PII sanitization active, bearer auth on all endpoints | Automated — grep logs + code scan |
| Performance / latency | P50 < 5s, P95 < 15s end-to-end | Automated — Langfuse traces |
| Regression gate | No fixtures failing that passed 2 weeks ago | Automated — scorecard diff |
| Deployment friction | Fresh deploy completes in < 30 min from zero | Manual — timed run |
| Graceful degradation | Cascade fallback fires when primary LLM is down | Automated — kill Gemini, verify Groq fires |
| Test coverage | % of critical paths covered by eval + unit tests | Automated — pytest --cov |

---

## Pillar 4 — Operational Readiness

*Can you support it after you sell it?*

| Dimension | Measure | How |
|---|---|---|
| Observability | Langfuse tracing active, errors surfaced in dashboard | Automated — hit Langfuse |
| Documentation | User guide, API docs, admin runbook exist and are current | Manual — check `docs/` + `wiki/` |
| Backup / recovery | Documented restore procedure exists | Manual |
| Tenant isolation | One customer's data cannot leak to another | Manual — NeonDB tenant_id review |
| Alerting | Someone gets notified when system breaks | Manual — check monitoring setup |
| CD pipeline | Deploys are automated, not manual SSH | Manual |

---

## Pillar 5 — Business Value

*Can you tell the story and close the deal?*

| Dimension | Measure | How |
|---|---|---|
| Demo script coverage | % of standard 10-min demo working end-to-end today | Manual — walk the script |
| Metrics narrative | Can show a number proving value (response time, fault types, KB size) | Manual — data pull |
| Integration story | CMMS + bots + pipeline all connected and showable live | Manual — live run |
| Competitive differentiation | Clear articulation of what MIRA does that generic AI cannot | Manual — 60-sec pitch test |
| Pricing / tier story | Clear tier model to show a customer | Manual |

---

## Pillar 6 — Production Readiness

*Can you put it in front of a real customer and honor commitments?*

| Dimension | Measure | How |
|---|---|---|
| Availability / SLA | Uptime % over last 30 days defined and measured | Automated — uptime monitor |
| Incident response | Runbook exists, on-call defined, MTTR documented | Manual |
| Scalability tested | Load test run — known concurrent user limit | Manual — k6 or locust run |
| Legal / compliance | Terms of Service, Privacy Policy, data retention policy exist | Manual |
| Data portability | Customer can export their data and leave | Manual |
| GDPR / data privacy | PII handling documented, sanitization verified | Manual + code review |
| Secrets hygiene | All secrets in Doppler, none in git history | Automated — git-secrets scan |

---

## Pillar 7 — Industrial Standards Compliance

*Do you speak the language of industrial customers and integrators?*

| Standard | What It Is | Dimension Scored | How |
|---|---|---|---|
| **ISA-95** | L0–L4 hierarchy (field → control → SCADA → MES/CMMS → ERP) — MIRA fits at L3/L4 | Architecture documented in ISA-95 hierarchy | Manual — architecture doc review |
| **UNS (Unified Namespace)** | MQTT-based central data hub — modern IIoT backbone (HiveMQ, SparkplugB) | Published roadmap for UNS/MQTT input | Manual — docs check |
| **OPC UA (IEC 62541)** | Interoperability standard for PLC/SCADA data | Published roadmap for OPC UA client | Manual — docs check |
| **IEC 62443** | Industrial cybersecurity — zones, conduits, security levels SL1–SL4 | Security zone documentation + SL level defined | Manual |
| **ISO 55000** | International asset management standard | Atlas CMMS data model references standard | Manual |
| **ISO 13374** | Condition monitoring data presentation standard | Diagnostic output format documented | Manual — spot check responses |
| **NAMUR NE 107** | Field device diagnostic status (Good/Check/Offspec/Failed) | MIRA responses map to NE 107 categories | Manual — spot check |
| **IEC 61508 / ISO 13849** | Functional safety standards | Safety escalation docs reference these | Manual |

---

## Audience Weights

| Pillar | Customer (Plant Mgr) | Investor | Technical Eval | Internal |
|---|---|---|---|---|
| Knowledge Quality | 30% | 20% | 20% | 30% |
| Usability | 25% | 10% | 10% | 15% |
| Engineering Quality | 10% | 10% | 25% | 20% |
| Operational Readiness | 10% | 5% | 15% | 15% |
| Business Value | 15% | 35% | 5% | 5% |
| Production Readiness | 5% | 10% | 10% | 10% |
| Industrial Standards | 5% | 10% | 15% | 5% |
| **Total** | **100%** | **100%** | **100%** | **100%** |

**Composite score per audience** = sum of (pillar score × audience weight)

---

## Hard Blockers

### Major Blockers — Flip Pillar to RED Regardless of Score

| Blocker | Pillar Affected | Status (2026-04-18) |
|---|---|---|
| Citation gate not merged to main | Knowledge Quality | OPEN — PR #345 on feat/citation-gate |
| mira-web still calling sidecar `:5000/rag` | Engineering Quality | OPEN — mira-chat.ts line ~30 |
| OEM ChromaDB migration not completed | Knowledge + Operational Readiness | OPEN — script ready, not run |
| No HTTPS/TLS on public-facing endpoints | Production Readiness | PARTIAL — nginx template exists, VPS deploy incomplete |
| Secrets in git history not rotated | Production Readiness | PARTIAL — rotated in Doppler, old values still in history |
| No Terms of Service or Privacy Policy | Production Readiness | ✅ RESOLVED — terms.html + privacy.html live |
| Eval score below 60% | Knowledge Quality | PARTIAL — 62% on VPS (not a blocker), 30% offline (mode artifact) |

### Minor Blockers — Reduce Pillar Score by 2 Points

| Blocker | Pillar Affected | Status (2026-04-18) |
|---|---|---|
| Gemini API key blocked (403) | Engineering Quality | OPEN |
| Teams + WhatsApp not live | Business Value | OPEN — pending cloud account setup |
| No CD pipeline | Operational Readiness | OPEN |
| PLC unreachable at 192.168.1.100 | Industrial Standards | OPEN — physical check needed |
| Eval score 60–69% (below 70% target) | Knowledge Quality | OPEN — VPS at 62%, target 70% |
| No load test run | Production Readiness | OPEN |

---

## Current Score Estimate (2026-04-18)

| Pillar | Estimated Score | Notes |
|---|---|---|
| Knowledge Quality | 5/10 🔴 | Major blocker: citation gate + OEM migration |
| Usability | 5/10 🟡 | Not fully tested; mira-web broken (sidecar call) |
| Engineering Quality | 5/10 🔴 | Major blocker: sidecar call; Gemini blocked |
| Operational Readiness | 5/10 🟡 | No CD pipeline; docs partially current |
| Business Value | 6/10 🟡 | Demo script works partially; Teams/WA missing |
| Production Readiness | 4/10 🔴 | TLS incomplete; secrets in history |
| Industrial Standards | 3/10 🔴 | No ISA-95 doc; no UNS/OPC UA roadmap published |

| Audience | Estimated Composite | Status |
|---|---|---|
| Customer (Plant Mgr) | 4.9 | 🔴 RED |
| Investor | 4.9 | 🔴 RED |
| Technical Evaluator | 4.6 | 🔴 RED |
| Internal | 4.9 | 🔴 RED |

**Target:** All audiences GREEN (≥ 7.0) with zero major blockers.

---

## Running the Assessment

Until a scoring script is built, run manually:

```bash
# 1. Get latest eval score
ls -t tests/eval/runs/*.md | head -1 | xargs grep -E "passing|PASS"

# 2. Check container health
docker compose ps

# 3. Check latency (last 100 Langfuse traces)
# → Langfuse dashboard: us.cloud.langfuse.com

# 4. Check git secrets
git log --all -S "mira-secret-2026" --oneline | wc -l  # should be 0

# 5. Check sidecar call (should be removed)
grep -r "5000/rag" mira-web/src/
```

Fill in pillar scores manually from the dimension table, apply audience weights, compare to 7.0 threshold.
