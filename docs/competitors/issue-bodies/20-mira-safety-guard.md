## Why
Factory AI's T&Cs clause 14 disclaims AI safety as the user's problem. MIRA enforces it in code via `SAFETY_KEYWORDS` → STOP escalation. Publish it as OSS so it becomes the reference implementation — thought leadership win.

## Source
- `docs/competitors/factory-ai-leapfrog-plan.md` #3
- Current code: `mira-bots/shared/guardrails.py`

## Acceptance criteria
- [ ] New package `mira-safety-guard` on PyPI — MIT license
- [ ] Public GitHub repo `Mikecranesync/mira-safety-guard`
- [ ] API: `from mira_safety_guard import classify_intent, SAFETY_KEYWORDS, strip_mentions`
- [ ] Docs: README with example integrations (langchain wrapper, FastAPI middleware, OpenAI tool-use gate)
- [ ] Blog post announcing release linking back to factorylm.com
