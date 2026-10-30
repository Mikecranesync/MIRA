import json,sys,math
def wilson(k,n,z=1.96):
    if n==0: return (0,0)
    p=k/n; d=1+z*z/n; c=p+z*z/(2*n); m=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))
    return ((c-m)/d,(c+m)/d)
for f in sys.argv[1:]:
    rows=[json.loads(l) for l in open(f) if l.strip()]
    ans=[r for r in rows if r['kind']=='answerable']
    hits=[];miss=[]
    for r in ans:
        acc=set(r['accepted']); rp=r['ranked_pages']
        rank=next((i+1 for i,p in enumerate(rp) if p in acc),None)
        (hits if rank and rank<=5 else miss).append((r['id'],rank))
    lo,hi=wilson(len(hits),len(ans))
    print(f"{f.split('/')[-1]}: {len(hits)}/{len(ans)} top5  wilson {lo:.1%}-{hi:.1%}")
    print("  miss:",miss)
