# `tests/beta/` — the beta release gate

One question decides beta readiness:

> **Can a stranger upload their own equipment manual, ask a real troubleshooting question, and get
> a grounded answer with citations from that manual — without Mike manually fixing anything?**

## Files

| File | Role |
|---|---|
| `beta_ready_upload_retrieval_citation.py` | **The RELEASE GATE.** Run explicitly (name isn't `test_*` on purpose — it hits live dev/staging endpoints). `xfail(strict)` until the gap closes. |
| `test_upload_retrieval_citation.py` | Lane-2 twin: a runnable anchor (`test_retrieval_reads_only_knowledge_entries`, passes now) + the same end-to-end gate (`xfail`). Collected by normal `pytest`. |
| `_gate.py` | The one real flow both files call: upload the fixture → poll → ask → judge citation. Never seeds `knowledge_entries` directly (that would hide the gap). |
| `fixtures/gs10_fault_codes.pdf` | The manual under test (GS10 fault `oC` = overcurrent). Regenerate: `python3 fixtures/_make_gs10_pdf.py`. |

## Run

```bash
# Anchor + xfail (no env needed — proves the suite is wired):
pytest tests/beta/test_upload_retrieval_citation.py -v

# The real gate (DEV/STAGING only — NEVER point at prod):
BETA_GATE_UPLOAD_URL=https://<staging>/api/uploads/folder \
BETA_GATE_CHAT_URL=https://<staging>/api/namespace/node/<id>/chat \
BETA_GATE_TENANT=<demo-tenant-uuid> \
BETA_GATE_API_KEY=<token> \
pytest tests/beta/beta_ready_upload_retrieval_citation.py -v
```

Today: anchor **passes**, gates **xfail** (gap open — PR #1592). When the gate passes,
`xfail(strict=True)` turns the run **red** — that's the signal to remove the marker and declare
the gate met. See `docs/research/2026-06-07-upload-retrieval-gap-and-beta-path.md`.
