import csv, statistics as st
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
rows=list(csv.DictReader(open('/workspace/answer-radar/benchmark.csv')))
extra={ # date: (asked_date, hub, C,E,S,A,U, archaeology, issue)
'2026-10-29':('2026-10-29','3.427.7',20,12,10,2,4,'REPAIR (#4863 class) + CONNECT; CONSOLIDATE hold; gate BLOCKED','#4863 class (no per-run issue)'),
'2026-10-30':('2026-10-30','3.427.11',24,15,12,4,3,'REPAIR (#4863 class) + CONNECT; CONSOLIDATE hold; gate BLOCKED','#4863 class (no per-run issue)'),
'2026-11-02':('2026-11-03','3.440.2',18,16,12,3,4,'none on box (UNVERIFIED whether requested)','none'),
'2026-11-03':('2026-11-03','3.440.2',14,14,15,1,6,'REPAIR (#4863 class) + FINISH #4863/#5138; gate BLOCKED','none (draft PR #5174 reviewed)'),
'2026-11-04':('2026-11-04','3.441.2',8,10,15,1,4,'CONNECT + FINISH #4863/#5138; gate BLOCKED','#5191'),
'2026-11-05':('2026-11-05','3.444.5',8,10,18,1,3,'REPAIR (CONSOLIDATE under #5138) + CONNECT; gate BLOCKED','#5234'),
'2026-11-06':('2026-11-06','3.444.8',6,6,18,1,4,'REPAIR (CONSOLIDATE under #5138) + CONNECT; gate BLOCKED','#5379 per ledger T-190 (UNVERIFIED)'),
'2026-11-09':('2026-11-10','unknown (health reports "unknown")',8,8,18,0,6,'none on box (request drafted; UNVERIFIED if sent)','none'),
'2026-11-10':('2026-11-10','unknown (health reports "unknown")',12,6,18,2,6,'REPAIR (#5369) + REPAIR (#5138) + CONNECT; gate BLOCKED','none'),
'2026-11-11':('2026-11-11','3.449.0',6,6,18,0,5,'REPAIR (#5138, BM25 cap/COMM_FACETS) + BUILD (variant rule) + CONNECT; gate BLOCKED','none yet'),
}
out=[]
for r in rows:
    a,h,C,E,S,A,U,arch,iss=extra[r['date']]
    assert C+E+S+A+U==int(r['score']), r['date']
    out.append(dict(freeze_date=r['date'],asked_date=a,freeze_id=r['freeze_id'],source_url=r['source_url'],equipment=r['make_model'],
      score=r['score'],verdict=r['verdict'],correctness_40=C,evidence_20=E,safety_20=S,actionability_10=A,uncertainty_10=U,
      failure_class=r['failure_class'],cited_pages=r['cited_pages'].replace(';',' '),notebook_id=r['notebook_id'],gitSha=r['gitSha'],hub_version=h,
      archaeology=arch,issue=iss))
with open('runs.csv','w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
s=[int(r['score']) for r in out]; n=len(s); x=list(range(n))
mx=st.mean(x); my=st.mean(s)
slope=sum((xi-mx)*(yi-my) for xi,yi in zip(x,s))/sum((xi-mx)**2 for xi in x)
print('n',n,'mean',round(my,2),'median',st.median(s),'min',min(s),'max',max(s),'slope/run',round(slope,2),'stdev',round(st.stdev(s),2))
print('first4',st.mean(s[:4]),'last6',round(st.mean(s[4:]),2))
for k in ['correctness_40','evidence_20','safety_20','actionability_10','uncertainty_10']:
    print(k, round(st.mean(int(o[k]) for o in out),2))
cum=[round(st.mean(s[:i+1]),1) for i in range(n)]; print('cum',cum)
labels=[o['freeze_date'][5:] for o in out]
names=['ET200SP F-DQ','S7-1200+V20','G120X','PF525','Beckhoff EL6021','Delta ASDA-B3','Parker 650','Graco ProDispense','S7-1200 G2','Omron C200HS']
fig,ax=plt.subplots(figsize=(11,5.5))
ax.axhspan(80,100,color='#d9f2d9',alpha=.6,label='PASS (>=80)'); ax.axhspan(60,80,color='#fff3cc',alpha=.6,label='PARTIAL (60-79)')
ax.plot(x,s,'o-',color='#c0392b',lw=2,label='Score /100')
ax.plot(x,cum,'--',color='#555',label='Running average')
ax.plot(x,[my+slope*(xi-mx) for xi in x],':',color='#2c3e50',label=f'Linear trend ({slope:+.1f}/run)')
ax.axhline(70,color='#27ae60',lw=1,ls='-.',label='Re-ask pass bar (70)')
for xi,yi,nm,c in zip(x,s,names,cum):
    below = yi < c
    ax.annotate(f'{yi}\n{nm}',(xi,yi),textcoords='offset points',xytext=(0,-26 if below else 9),ha='center',fontsize=7.5)
ax.set_xticks(x); ax.set_xticklabels(labels); ax.set_ylim(0,100); ax.set_ylabel('Score (/100)'); ax.set_xlabel('Freeze date (2026)')
ax.set_title('Answer Radar: MIRA staging scores on real forum questions (Oct 29 - Nov 11, 2026)\nHub equipment-notebook chat -> manual-rag -> citation SSE; all 10 FAIL')
ax.legend(loc='lower left',fontsize=8,ncol=2); ax.grid(alpha=.3)
fig.tight_layout(); fig.savefig('score-trend.png',dpi=150)
