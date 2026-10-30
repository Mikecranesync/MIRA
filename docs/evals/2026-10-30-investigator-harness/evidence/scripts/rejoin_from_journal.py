"""Rebuild candidates-checked.json from the workflow journal (the seal-f:write agent's heredoc corrupted the file).
Prints COUNTS ONLY — never candidate content (sealed set)."""
import json, re, sys, glob, collections
W, OUT = sys.argv[1], sys.argv[2]
lines = [json.loads(l) for l in open(W + '/journal.jsonl') if l.strip()]
label = {l['agentId']: l['label'] for l in lines if l.get('type') == 'started'}
results = {l['agentId']: l['result'] for l in lines if l.get('type') == 'result'}
def prompt_of(aid):
    for f in glob.glob(f"{W}/agent-{aid}.jsonl"):
        for l in open(f):
            d = json.loads(l)
            m = d.get('message', d)
            if isinstance(m, dict) and m.get('role') == 'user':
                c = m.get('content'); t = c if isinstance(c, str) else ''.join(x.get('text', '') for x in c if isinstance(x, dict))
                if 'A) SOURCE: fetch' in t:  # the task prompt; some transcripts open with a short preamble message first
                    return t
    return ''
cands = []
for aid, lab in label.items():
    if lab.startswith('collect:') and aid in results and results[aid]:
        for c in results[aid].get('candidates', []):
            cands.append({**c, 'manual': lab.split(':', 1)[1]})
checks = []
for aid, lab in label.items():
    if lab.startswith('check:') and aid in results and results[aid]:
        p = prompt_of(aid)
        url = re.search(r'A\) SOURCE: fetch (\S+)', p); pages = re.search(r'proposal: pages (\[[^\]]*\])', p)
        checks.append({'manual': lab.split(':', 1)[1], 'url': url.group(1) if url else None,
                       'pages': json.loads(pages.group(1)) if pages else None, 'check': results[aid]})
joined, unmatched = [], 0
used = set()
for c in cands:
    hit = next((k for i, k in enumerate(checks) if i not in used and k['manual'] == c['manual'] and k['url'] == c['url'] and k['pages'] == c['expected_pages']), None)
    if hit is None:
        unmatched += 1; continue
    used.add(checks.index(hit)); joined.append({**c, 'check': hit['check']})
json.dump(joined, open(OUT, 'w'), indent=1)
print(f"collect agents={sum(1 for l in label.values() if l.startswith('collect:'))} candidates={len(cands)} check agents={len(checks)} joined={len(joined)} unmatched_candidates={unmatched} unused_checks={len(checks)-len(used)}")
print('per manual:', dict(collections.Counter(j['manual'] for j in joined)))
