# MIRA vs ChatGPT comparative test (Baseline Standard §9)

Blind A/B preference review over suitable Golden Set cases. This directory holds the
reference answers and the blinded review packets; the KPI is the **Technician
Preference Rate** (initial target > 60%).

## Protocol

1. `reference-answers.yaml` — for each suitable case id, the answer the SAME question
   got from ChatGPT (captured manually from chatgpt.com, model + date recorded). These
   are fixtures: capture once, refresh deliberately (§18 — never silently).
2. After a technician run, build the blinded packet: for each case with a reference
   answer, emit A/B pair with product identity randomized and hidden (mapping kept in
   a separate key file the reviewer must not open first).
3. The human reviewer (a technician — not the implementing agent) answers §9's question
   per pair: *Which answer would you rather have while standing in front of the
   machine?* — Strongly A / Slightly A / Tie / Slightly B / Strongly B.
4. Preference rate = (Strongly+Slightly MIRA) / total non-tie, reported in the §13
   report's Technician Gate block.

## Format

```yaml
# reference-answers.yaml
- id: tech-05
  captured: 2026-09-13
  source_model: "ChatGPT (GPT-5.x, chatgpt.com free tier)"
  answer: |
    ...verbatim answer text...
```

Pairs and votes land in `evals/results/<sha>/preference/` (pairs.json, votes.json —
votes recorded by the human reviewer, never by the agent that ran the eval).

## Status

Harness format defined; reference answers not yet captured (human step — §9 hides
product identity "when practical", and capture requires a ChatGPT session the agent
does not operate). The §13 report prints `MIRA vs ChatGPT: NOT RUN` until votes exist.
