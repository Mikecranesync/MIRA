import json,math,os,sys
S=os.path.dirname(os.path.abspath(__file__)); D=S+"/b/docs/evals/benchmark-4791"
cand=sys.argv[1] if len(sys.argv)>1 else "cand"
def L(p): return {json.loads(l)["id"]:json.loads(l) for l in open(p) if l.strip()}
def qf(s):
    p=f"{D}/{s}/{s}-questions.json"; return p if os.path.exists(p) else f"{D}/{s}-questions.json"
def mc(w,l):
    n=w+l; k=min(w,l); return min(1.0,2*sum(math.comb(n,i) for i in range(k+1))/2**n) if n else 1.0
res={}
for s,n in (("t4-77",6),("oem-fault",5),("robust",5),("oem-index",5)):
    qs={q["id"]:q for q in json.load(open(qf(s)))}
    ids=[i for i in qs if qs[i]["accepted"]]
    if s=="oem-index": ids=[i for i in ids if "Publication" not in qs[i]["question"]]
    r={a:{lab:L(f"{S}/runs/{lab}-{s}-{a}.jsonl") for lab in ("main",cand)} for a in ("off","on")}
    f0=all(r["off"]["main"][i]["ranked_pages"]==r["off"][cand][i]["ranked_pages"] for i in qs)
    h=lambda rows,i,k: any(p in qs[i]["accepted"] for p in rows[i]["ranked_pages"][:k])
    out={"F0_off_identical":f0,"n":len(ids)}
    for k in (1,n):
        m=r["on"]["main"]; c=r["on"][cand]
        g=[i for i in ids if h(c,i,k) and not h(m,i,k)]; l=[i for i in ids if h(m,i,k) and not h(c,i,k)]
        out[f"top{k}"]={"off":sum(h(r["off"]["main"],i,k) for i in ids),"main_on":sum(h(m,i,k) for i in ids),"cand_on":sum(h(c,i,k) for i in ids),"gained":len(g),"lost":len(l),"net":len(g)-len(l),"p":round(mc(len(g),len(l)),4),"lost_ids":l[:20],"gained_ids":g[:20]}
    res[s]=out
print(json.dumps(res,indent=1))
t=res["t4-77"]
v={"F0":all(res[s]["F0_off_identical"] for s in res),"G1":t["top6"]["net"]>=0 and t["top1"]["net"]>=0,"G2":res["oem-fault"]["top5"]["net"]>=0,"G3":res["robust"]["top5"]["net"]>=0,"T1_index_top1":res["oem-index"]["top1"]["cand_on"]}
print("VERDICT",v,"PASS" if all(v[x] for x in ("F0","G1","G2","G3")) else "FAIL")
