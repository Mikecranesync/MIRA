"""Final #4122 A/B: origin/main prompt vs the exact shipped worktree prompt, Groq gpt-oss-120b, route params."""
import hashlib, json, os, re, subprocess, sys, time, httpx
S = "/private/tmp/claude-501/-Users-charlienode-MIRA/4bc72a80-eeb7-4922-bfa9-bb68e2f334f0/scratchpad/ab4122"
W = "/Users/charlienode/MIRA/.claude/worktrees/fix4122"
ROUTE = "mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts"
arm = sys.argv[1]
src = subprocess.run(["git", "-C", W, "show", f"origin/main:{ROUTE}"], capture_output=True, text=True).stdout if arm == "main" else open(f"{W}/{ROUTE}").read()
GENERAL = re.search(r"const GENERAL_SYSTEM_PROMPT = `(.*?)`;", src, re.S).group(1)
system = json.load(open(f"{S}/wrap_{'main' if arm == 'main' else 'shipped'}.json")).replace("@@GENERAL@@", GENERAL)
QS = json.load(open(f"{S}/questions.json"))
key = os.environ["GROQ_API_KEY"]; out = []
with httpx.Client(timeout=90) as c:
    for cid, q in QS.items():
        for rep in range(int(os.environ.get("REPS", "5"))):
            for _ in range(5):
                r = c.post("https://api.groq.com/openai/v1/chat/completions", headers={"Authorization": f"Bearer {key}"},
                           json={"model": "openai/gpt-oss-120b", "messages": [{"role": "system", "content": system}, {"role": "user", "content": q}],
                                 "max_tokens": 800, "temperature": 0.3, "reasoning_effort": "low"})
                if r.status_code == 429: time.sleep(10); continue
                break
            out.append({"arm": arm, "case": cid, "rep": rep, "q": q, "answer": r.json()["choices"][0]["message"]["content"] if r.status_code == 200 else f"HTTP {r.status_code}"})
            time.sleep(1.2)
json.dump({"system_sha256": hashlib.sha256(system.encode()).hexdigest(), "rows": out}, open(f"{S}/final_{arm}.json", "w"), indent=1)
print(arm, len(out), sum(x["answer"].startswith("HTTP") for x in out), "errors")
