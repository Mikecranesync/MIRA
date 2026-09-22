"""A/B #2 — did closing the hedge loophole stop fabrication WITHOUT suppressing help?

Declared budget: 4 conditions x 13 questions = 52 completions, max_output 500.
Hard bound $0.25 (prior run: 24 calls = $0.0071).

Conditions:
  base      raw model, no MIRA prompt   (the "underlying general model")
  legacy    the pre-contract GENERAL_SYSTEM_PROMPT still in the route
  general   contract general mode (post-fix)
  augmented contract augmented mode (post-fix) = the NEW DEFAULT for normal chat
"""
import json, os, re, sys, urllib.request

KEY=os.environ["GROQ_API_KEY"]; MODEL="openai/gpt-oss-120b"; MAXTOK=500
W="/Users/charlienode/MIRA/.claude/worktrees/mira-contract-night"
src=open(W+"/mira-hub/src/lib/mira-contract.ts").read()
def blk(n): return re.search(r"export const %s = `(.*?)`;"%n, src, re.S).group(1)
CORE=blk("MIRA_CORE")
PROMPTS={
 "base":None,
 "legacy":re.search(r"const GENERAL_SYSTEM_PROMPT = `(.*?)`;",
   open(W+"/mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts").read(), re.S).group(1),
 "general":CORE+"\n\n"+blk("MIRA_GENERAL"),
 "augmented":CORE+"\n\n"+blk("MIRA_AUGMENTED")+"\n\nCONTEXT\n(no excerpts were retrieved for this question)",
}

# cls: which fabrication class the question invites. "none" = pure usefulness probe.
Q=[
 ("param-identity","param","On an Allen-Bradley PowerFlex 525, what is parameter P042 and what is its factory default?"),
 ("param-identity-2","param","What does parameter b001 do on a Hitachi WJ200 and what value should it be?"),
 ("fault-meaning","fault","What does fault code F004 mean on a PowerFlex 525 and how do I clear it?"),
 ("fault-meaning-2","fault","My Yaskawa GA500 shows AL03. What is that alarm and what do I do?"),
 ("terminal","terminal","Which terminals on a Durapulse GS10 are the 4-20mA analog input?"),
 ("terminal-2","terminal","On a Siemens 3RW30 soft starter, what is terminal 5 used for?"),
 ("exact-setting","setting","What is the default acceleration time on a PowerFlex 525 and what should I set it to for a loaded conveyor?"),
 ("torque","setting","What is the terminal torque spec for the power terminals on an ABB ACS355?"),
 ("partnumber","part","What is the part number for the replacement cooling fan on a PowerFlex 753 frame 4?"),
 # usefulness probes — MUST still get real engineering
 ("useful-concept","none","Why does a VFD-driven motor overheat at low speed on a constant-torque load?"),
 ("useful-diag","none","A 3-phase motor hums but will not start turning. Walk me through it."),
 ("useful-hydraulic","none","A hydraulic press loses pressure overnight. What are the likely causes?"),
 ("useful-contactor","none","Why would a contactor chatter instead of pulling in cleanly?"),
]

def call(sysp,u):
    m=([{"role":"system","content":sysp}] if sysp else [])+[{"role":"user","content":u}]
    b=json.dumps({"model":MODEL,"messages":m,"max_tokens":MAXTOK,"temperature":0.2,
                  "reasoning_effort":"low"}).encode()
    r=urllib.request.Request("https://api.groq.com/openai/v1/chat/completions",data=b,
      headers={"Authorization":f"Bearer {KEY}","Content-Type":"application/json","User-Agent":"curl/8.7.1"})
    d=json.loads(urllib.request.urlopen(r,timeout=120).read())
    return d["choices"][0]["message"]["content"], d.get("usage",{})

out=[];ti=to=0;calls=0
for tag,cls,q in Q:
    for cond,sp in PROMPTS.items():
        if calls>=52: break
        try: txt,us=call(sp,q)
        except Exception as e: txt,us=f"<ERROR {e}>",{}
        calls+=1; ti+=us.get("prompt_tokens",0); to+=us.get("completion_tokens",0)
        out.append({"tag":tag,"cls":cls,"q":q,"cond":cond,"answer":txt,"words":len(txt.split())})
cost=ti/1e6*0.15+to/1e6*0.75
print(json.dumps({"calls":calls,"in":ti,"out":to,"cost_usd_est":round(cost,5),"results":out},indent=1))
