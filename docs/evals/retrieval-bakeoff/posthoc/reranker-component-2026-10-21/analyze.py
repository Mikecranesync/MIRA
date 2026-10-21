import json,glob,sys,math,statistics as st
pref=sys.argv[1]
runs=[(f,json.load(open(f))) for f in sorted(glob.glob(f"{pref}-run*.json"))]
def pct(xs,p): xs=sorted(xs); return xs[max(0,math.ceil(p*len(xs))-1)]
print("| run | variant | onnx sha256 | app sha256 | ort | machine | load ms | cold first ms | pool | n | p50 ms | p95 ms | max ms | failures |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for f,d in runs:
  for N in (24,50):
    rows=[r for r in d["rows"] if r["pool"]==N]; ok=[r["ms"] for r in rows if "ms" in r]
    print(f"| {f.split('-run')[1][:1]} | {d['variant']} | {d['onnx_sha256'][:12]} | {d['app_sha256'][:12]} | {d['ort']} | {d['machine']} | {d['load_ms']:.0f} | {d['cold_first_ms']:.0f} | {N} | {len(ok)} | {st.median(ok):.0f} | {pct(ok,.95):.0f} | {max(ok):.0f} | {len(rows)-len(ok)} |")
# ranking diffs: first fp32 run vs first int8 run
fp=[d for _,d in runs if d["variant"]=="fp32"][0]; i8=[d for _,d in runs if d["variant"]!="fp32"][0]
def rank(s): return sorted(range(len(s)),key=lambda i:-s[i])
def spear(a,b):
  ra={i:k for k,i in enumerate(rank(a))}; rb={i:k for k,i in enumerate(rank(b))}; n=len(a)
  return 1-6*sum((ra[i]-rb[i])**2 for i in range(n))/(n*(n*n-1))
I={r["rid"]:r for r in i8["rows"] if "scores" in r}
for N in (24,50):
  same=0;ov=[];sp=[];n=0;maxd=0
  for r in fp["rows"]:
    if r["pool"]!=N or r["rid"] not in I: continue
    a,b=r["scores"],I[r["rid"]]["scores"]; n+=1
    same+= rank(a)[:6]==rank(b)[:6]; ov.append(len(set(rank(a)[:6])&set(rank(b)[:6]))/6); sp.append(spear(a,b))
    maxd=max(maxd,max(abs(x-y) for x,y in zip(a,b)))
  print(f"\npool {N}: top-6 identical order {same}/{n}; mean top-6 set overlap {st.mean(ov):.3f} (min {min(ov):.3f}); mean Spearman {st.mean(sp):.4f} (min {min(sp):.4f}); max |score diff| {maxd:.3f}")
# determinism check: same variant across its two runs
for v in ("fp32","int8-avx2"):
  ds=[d for _,d in runs if d["variant"]==v]
  if len(ds)==2:
    A={r["rid"]:r["scores"] for r in ds[0]["rows"] if "scores" in r}
    dif=max(max(abs(x-y) for x,y in zip(A[r["rid"]],r["scores"])) for r in ds[1]["rows"] if "scores" in r)
    print(f"{v}: run-to-run max |score diff| {dif:.2e}")
