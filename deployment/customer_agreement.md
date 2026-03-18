# MIRA — Data Sharing Agreement

## MARA (Maintenance AI Research Alliance) Opt-In

---

### What is MARA?

MARA is an optional program that allows MIRA installations across different sites to share anonymized fault data. When a problem is diagnosed at one site, the solution can help technicians at other sites encountering the same issue.

Participation is completely voluntary. MIRA works fully without MARA.

---

### What IS shared (if you opt in)

| Data | Example |
|------|---------|
| Component type | "Variable Frequency Drive" |
| Fault code | "F-42" |
| Symptom description | "Communication loss between PLC and VFD" |
| Diagnosis | "RS-485 termination resistor missing" |
| Resolution steps | "Install 120-ohm termination at last device" |
| Exchanges to resolution | 5 |
| Resolution time | 15 minutes |

All records are hashed (SHA-256) to prevent duplicates.

---

### What is NEVER shared

| Data | Why |
|------|-----|
| Customer name | Identifying information |
| Site location | Identifying information |
| Equipment serial numbers | Could identify specific installations |
| IP addresses | Network security |
| GPS coordinates | Physical security |
| Operator/technician names | Personal privacy |
| Raw photos | May contain proprietary equipment layouts |
| Conversation transcripts | May contain sensitive operational details |

---

### How it works

1. Each night at 2:00 AM, MIRA reviews completed diagnostic sessions from the past 24 hours
2. All identifying information is stripped (see "NEVER shared" list above)
3. Only the technical pattern remains: what broke, how it was diagnosed, how it was fixed
4. The anonymized record is sent to a secure MARA server
5. Weekly, the MARA server compiles all contributed records into a "knowledge pack"
6. Each participating MIRA installation downloads the latest knowledge pack on startup
7. The knowledge pack is ingested into the local knowledge base

---

### Your rights

- **Opt out at any time.** Set `MARA_ENABLED=false` in your configuration. No further data will be sent. Previously contributed data cannot be individually recalled (it has been anonymized and merged).
- **Audit what is sent.** All outgoing records are logged locally at `data/anonymized_diagnostics.jsonl`. You can review this file at any time.
- **No cost.** MARA participation is included with your MIRA deployment at no additional charge.

---

### Agreement

By signing below, you agree to participate in the MARA program under the terms described above.

**Customer name:** _______________________________________________

**Site location:** _______________________________________________

**Authorized representative:** _______________________________________________

**Title:** _______________________________________________

**Date:** _______________________________________________

**Signature:** _______________________________________________

---

- [ ] **I agree** to share anonymized fault data with the MARA network as described above.
- [ ] **I decline** participation at this time. I understand I can opt in later by contacting my MIRA administrator.

---

*MIRA — Maintenance Intelligence & Remote Assistant*
*MARA — Maintenance AI Research Alliance*
*All data processing occurs locally. No cloud services are used.*
