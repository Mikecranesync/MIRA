# MIRA MVP Manual Acceptance Checklist

**Version:** v3.6.0  
**Last updated:** 2026-04-21  
**Run before:** Any release cut, customer demo, or major deployment

---

## How to Use

Work through each section top-to-bottom. Mark each item ✅ pass, ❌ fail, or ⏭ skip (with reason).
A release is **NOT ready** if any item is marked ❌ in sections 1–5.

---

## 1. Web Entry Points

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 1.1 | Browse `https://app.factorylm.com` | Open WebUI loads, no blank screen | |
| 1.2 | Browse `https://app.factorylm.com/m/VFD-07` | QR scan page loads OR redirects to chat (no 500) | |
| 1.3 | Browse `https://app.factorylm.com/qr-test` | Branded QR display page renders | |
| 1.4 | Browse `https://cmms.factorylm.com` | Atlas CMMS login page or dashboard loads | |
| 1.5 | Check browser console on each page | No unhandled JS errors | |

---

## 2. Service Health

| # | Check | Command | Expected |
|---|-------|---------|----------|
| 2.1 | Pipeline health | `curl http://localhost:9099/health` | `{"status":"ok"}` |
| 2.2 | Ingest health | `curl http://localhost:8002/health` | `{"status":"ok"}` |
| 2.3 | MCP health | `curl http://localhost:8001/health` | HTTP 200 |
| 2.4 | Open WebUI health | `curl http://localhost:3000/health` | HTTP 200 |
| 2.5 | All containers up | `docker ps --format 'table {{.Names}}\t{{.Status}}'` | All `Up`, no `Restarting` |

---

## 3. Diagnostic Chat — Core Flows

Log in to Open WebUI as a test user and run each prompt. Select **MIRA Diagnostic** model.

| # | Prompt | Expected behavior | Result |
|---|--------|-------------------|--------|
| 3.1 | `Hello!` | Greeting response, not a full diagnostic | |
| 3.2 | `The VFD on motor 7 shows E.OC.3 fault. What does this mean?` | Explains overcurrent fault with troubleshooting steps | |
| 3.3 | `How do I wire a 3-phase motor to a GS10 VFD?` | Wiring instructions, references terminals | |
| 3.4 | `Show me the maintenance schedule for the GS10 VFD.` | Maintenance intervals listed | |
| 3.5 | `We were working on the panel while live and someone got shocked.` | **STOP** response + safety escalation, no normal diagnostic | |
| 3.6 | Follow-up after 3.2: `What are the common causes of that fault?` | Context-aware answer referencing the VFD/fault from turn 1 | |

**Quality checks (apply to all responses above):**
- [ ] No raw JSON blobs appear in any response
- [ ] No `{"error":...}` or `{"choices":...}` visible to user
- [ ] Response language is professional and concise
- [ ] No hallucinated product names or invented part numbers

---

## 4. QR Scan → Chat Flow

| # | Step | Expected | Result |
|---|------|----------|--------|
| 4.1 | Scan or visit `https://app.factorylm.com/m/VFD-07` on mobile | Page loads with asset info | |
| 4.2 | Submit a question via the QR chat form | Response renders in page | |
| 4.3 | Channel chooser appears (if multiple channels configured) | Correct channels shown | |
| 4.4 | Guest form shown for unauthenticated user | Name/company fields visible | |

---

## 5. CMMS — Work Orders

| # | Step | Expected | Result |
|---|------|----------|--------|
| 5.1 | Log in to `https://cmms.factorylm.com` | Dashboard loads with asset list | |
| 5.2 | Create a work order for asset `VFD-07` | WO created, appears in list | |
| 5.3 | Assign WO to a technician | Assignee saved correctly | |
| 5.4 | Mark WO as complete | Status updates, timestamp recorded | |
| 5.5 | Check MCP REST: `GET /api/cmms/work_orders` with Bearer token | WO from 5.2 appears in response | |

---

## 6. Ingest & Knowledge Base

| # | Step | Expected | Result |
|---|------|----------|--------|
| 6.1 | Upload a PDF via Open WebUI Knowledge tool | Upload completes, appears in collection | |
| 6.2 | Ask MIRA a question that requires the uploaded content | Answer cites or references the document | |
| 6.3 | Check ingest health/db: `curl http://localhost:8002/health/db` | NeonDB connection `ok` | |

---

## 7. Multi-Tenant Isolation

| # | Step | Expected | Result |
|---|------|----------|--------|
| 7.1 | Chat as tenant A, then query as tenant B with same session | Responses are scoped to each tenant | |
| 7.2 | Briefing API: `GET /api/briefing/profiles/{tenant_a_id}` as tenant B | 404 or 401, not tenant A's data | |

---

## 8. Performance Baselines

| # | Metric | Target | Actual | Result |
|---|--------|--------|--------|--------|
| 8.1 | Pipeline `/v1/chat/completions` (text only) | < 8 s p95 | | |
| 8.2 | Pipeline response with RAG retrieval | < 12 s p95 | | |
| 8.3 | Open WebUI page load (cold) | < 3 s | | |
| 8.4 | CMMS dashboard load | < 4 s | | |

---

## 9. Error Handling

| # | Scenario | Expected | Result |
|---|----------|----------|--------|
| 9.1 | Send gibberish: `asdf jkl qwerty` | Polite "I didn't understand" — no crash | |
| 9.2 | Send empty message | Pipeline returns error or empty-handled response | |
| 9.3 | Send message > 4000 chars | Handled gracefully, not 500 | |
| 9.4 | Upload unsupported file type to ingest | Error message returned, service stays up | |

---

## 10. Smoke After Deployment

Run immediately after any `docker compose up -d --build`:

```bash
# All containers healthy?
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -v Up

# Health endpoints
curl -sf http://localhost:9099/health | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ok'"
curl -sf http://localhost:8002/health | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ok'"
curl -sf http://localhost:8001/health -o /dev/null -w "%{http_code}"

# Quick chat smoke
curl -sf -X POST http://localhost:9099/v1/chat/completions \
  -H "Authorization: Bearer $PIPELINE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"mira-diagnostic","messages":[{"role":"user","content":"Hello"}],"stream":false}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['choices'][0]['message']['content'][:80])"
```

Expected output: a short greeting in plain text. Any Python exception = deployment problem.

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Engineer | | | |
| Product | | | |

**Release gate:** All sections 1–5 ✅ before shipping to customers.
