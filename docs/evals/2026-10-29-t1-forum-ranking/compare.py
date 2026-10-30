import json,sys
S='/private/tmp/claude-501/-Users-charlienode/4b76b48e-7f5a-40d6-9cdd-bbe606e67dc3/scratchpad/t1'
base,cand=sys.argv[1],sys.argv[2]
sets=sys.argv[3:] or ['forum-new','t4-77','oem-fault','oem-index','robust']
def rows(p): return {json.loads(l)['id']:json.loads(l) for l in open(p) if l.strip()}
def hit(r,k): return any(p in r['accepted'] for p in r['ranked_pages'][:k])
for s in sets:
    try: b=rows(f'{S}/{base}-{s}-k10.jsonl'); c=rows(f'{S}/{cand}-{s}-k10.jsonl')
    except FileNotFoundError as e: print(s,'missing',e); continue
    ids=[i for i in b if b[i]['kind']=='answerable' and i in c]
    if s=='oem-index':
        qs={q['id']:q for q in json.load(open('/Users/charlienode/MIRA-worktrees/t1-fix/tools/bench4589/oem-index-questions.json'))}
        ids=[i for i in ids if 'Publication' not in qs[i]['question']]
    line=f'{s:10} n={len(ids):4}'
    for k in (1,5,6):
        g=[i for i in ids if hit(c[i],k) and not hit(b[i],k)]; l=[i for i in ids if hit(b[i],k) and not hit(c[i],k)]
        line+=f' | top{k}: {sum(hit(b[i],k) for i in ids)}->{sum(hit(c[i],k) for i in ids)} +{len(g)}/-{len(l)}'
        if l and k in (5,6): line+=f' lost={l[:8]}'
    print(line)
