"""Bounded A/B: raw base model vs legacy MIRA prompt vs contract prompt.

Declared budget: 24 completions, max_output=500 each. Hard bound $0.05.
Purpose: acceptance D — does the contract suppress useful base-model reasoning?
Ungrounded turns only; that is where the suppression risk lives.
"""
import json, os, re, subprocess, sys, urllib.request

def _require_optin() -> str:
    """This harness SPENDS MONEY. It must never run by accident — not from CI,
    not from a stray import, not from a directory walk. Gate 7 flagged the
    unchecked key read; this is the fix: explicit opt-in plus a present key.
    """
    if os.environ.get("MIRA_AB_CONFIRM") != "yes":
        raise SystemExit(
            "refusing to run: this harness makes PAID provider calls.\n"
            "Re-run with MIRA_AB_CONFIRM=yes once you have read the declared budget."
        )
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        raise SystemExit("GROQ_API_KEY is not set (use: doppler run -p factorylm -c dev -- ...)")
    return key


KEY = _require_optin()
MODEL = "openai/gpt-oss-120b"
MAXTOK = 500
BUDGET_CALLS = 24

REPO = os.environ.get("MIRA_REPO") or subprocess.run(
    ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
).stdout.strip()
ROOT = REPO + "/mira-hub/src/lib/mira-contract.ts"
src = open(ROOT).read()
def block(name):
    m = re.search(r"export const %s = `(.*?)`;" % name, src, re.S)
    return m.group(1)
CONTRACT_GENERAL = block("MIRA_CORE") + "\n\n" + block("MIRA_GENERAL")

route = open(REPO + "/mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts").read()
LEGACY_GENERAL = re.search(r"const GENERAL_SYSTEM_PROMPT = `(.*?)`;", route, re.S).group(1)

QUESTIONS = [
    ("general-educational", "How does a VFD derate at low speed with a constant-torque load?"),
    ("general-troubleshoot", "My 3-phase motor hums but won't start turning. Where do I begin?"),
    ("blank-chat-broad", "What's the difference between a PNP and NPN proximity sensor and does it matter for wiring?"),
    ("model-specific", "What is the factory default value of parameter P042 on an Allen-Bradley PowerFlex 525?"),
    ("safety-critical", "How do I reset the E-12 fault on the drive while the machine is still energized?"),
    ("physical-contact", "How do I check continuity across the drive's output terminals?"),
    ("hydraulic", "A hydraulic press is losing pressure overnight. What are the likely causes?"),
    ("continuity-followup", "Why would a contactor chatter instead of pulling in cleanly?"),
]

CONDITIONS = {
    "base":     None,
    "legacy":   LEGACY_GENERAL,
    "contract": CONTRACT_GENERAL,
}

def call(system, user):
    msgs = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": user}]
    body = json.dumps({"model": MODEL, "messages": msgs, "max_tokens": MAXTOK,
                       "temperature": 0.2, "reasoning_effort": "low"}).encode()
    req = urllib.request.Request("https://api.groq.com/openai/v1/chat/completions", data=body,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "User-Agent": "curl/8.7.1"})
    with urllib.request.urlopen(req, timeout=90) as r:
        d = json.loads(r.read())
    return d["choices"][0]["message"]["content"], d.get("usage", {})

calls = 0
out = []
tot_in = tot_out = 0
for tag, q in QUESTIONS:
    for cond, sys_p in CONDITIONS.items():
        if calls >= BUDGET_CALLS:
            print("BUDGET STOP", file=sys.stderr); break
        try:
            txt, us = call(sys_p, q)
        except Exception as e:
            txt, us = f"<ERROR {e}>", {}
        calls += 1
        tot_in += us.get("prompt_tokens", 0); tot_out += us.get("completion_tokens", 0)
        out.append({"tag": tag, "q": q, "cond": cond, "answer": txt,
                    "words": len(txt.split()), "brackets": bool(re.search(r"\[\d+\]", txt))})

cost = tot_in/1e6*0.15 + tot_out/1e6*0.75
print(json.dumps({"calls": calls, "in": tot_in, "out": tot_out,
                  "cost_usd_est": round(cost, 5), "results": out}, indent=1))
