"""Build the E6 review file (same shape for judge.ts and label_sheet.py) from the sealed runs.
Answer text = what the technician would see; excerpts = text of the pages that answer cites (bench DB, read-only)."""
import json, hashlib, sys
import psycopg2
H = sys.argv[1]
def uuid_of(s):
    h = hashlib.sha256(s.encode()).hexdigest()
    return f"{h[:8]}-{h[8:12]}-4{h[13:16]}-8{h[17:20]}-{h[20:32]}"
db = psycopg2.connect("postgresql://bench:bench@127.0.0.1:55450/bench"); cur = db.cursor()
def page_text(manual, page, tenant=None):
    q = "SELECT content FROM knowledge_entries WHERE doc_id=%s AND source_page=%s" + (" AND tenant_id=%s" if tenant else "") + " ORDER BY (metadata->>'chunk_index')::int LIMIT 2"
    cur.execute(q, (uuid_of(f"bench-doc-{manual}"), page) + ((tenant,) if tenant else ()))
    return " ".join(r[0] for r in cur.fetchall())[:700]
def answer(r):
    if r["arm"] == "H0":
        return r.get("hypothesis") or ""
    parts = [f"[{r.get('mode')}]"]
    if r.get("hypothesis"): parts.append(f"Hypothesis: {r['hypothesis']}")
    nc = r.get("next_check")
    if nc:
        parts.append(f"Next check: {nc.get('action')}")
        for e in nc.get("expected") or []: parts.append(f"  if {e.get('observation')} -> {e.get('implies')}")
    if r.get("follow_up"): parts.append(f"Asks: {r['follow_up']}")
    if r.get("mode") in ("stop_escalate", "safety_stop") and not nc: parts.append(f"Stops: {r.get('stop_reason')}")
    return "\n".join(parts)
cases = []
specs = [("fs4", json.load(open(f"{H}/sealed/forum/forum-sealed4-questions.json")), "question", uuid_of("hyb-tenant-forum-sealed4")),
         ("sc", json.load(open(f"{H}/sealed/scenarios/sealed-c-cases.json")), "message", None)]
for tag, items, field, tenant in specs:
    runs = {a: {json.loads(l)["id"]: json.loads(l) for l in open(f"{H}/sealed-runs/{tag}-{a}.jsonl")} for a in ("H0", "H1", "H2")}
    for it in items:
        if tag == "fs4" and not it.get("accepted"): continue
        manual = it.get("manual")
        ex, nc = {}, {}
        for a in ("H0", "H1", "H2"):
            r = runs[a][it["id"]]
            pages = [p for p in dict.fromkeys(r.get("cited_pages") or []) if p is not None][:3]
            ex[a] = [f"p.{p}: {page_text(manual, p, tenant)}" for p in pages] if manual else []
            nc[a] = answer(r)
        cases.append({"caseId": it["id"], "question": it[field], "evidenceExcerptsByArm": ex, "nextCheckByArm": nc})
json.dump(cases, open(f"{H}/results/review-cases.json", "w"), indent=1)
print("review cases:", len(cases), "| with no cited excerpt for any arm:", sum(1 for c in cases if not any(c["evidenceExcerptsByArm"].values())))
