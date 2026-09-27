# Answer Radar on STAGING (the product path): 2026-09-27

**Target:** the deployed staging Hub chat route, `https://app-staging.factorylm.com`,
gitSha `772dc292721feb23f445037371aba29b92126f9c`. That is the same build production
serves. This is the route both the Hub web app and the phone app post to, with the same body
(`{message, sourceDocIds: [], mode: "general"}`; see `hub-host-logic.ts::chatBodyFor` and
`mira-mobile/src/api/resources.ts`). So one run grades the answers on both surfaces.

The account was a throwaway staging stranger (`provision-beta-gate.ts`), swept afterwards.
There were two conditions:

| Condition | Meaning | VCAD | Citations | Manual search |
|---|---|---|---|---|
| `new_chat` | tech opens a chat and types | **0 / 6** | 0 / 6 | **skipped** (`skipped_general_mode`) on all 6 |
| `machine_selected` | chat bound (user-confirmed) to the question's make + model | **0 / 6** | 0 / 6 | searched, **0 candidates** on all 6 |

Two fresh independent graders (verifier and adversary, Sonnet, `DIFFERENT_MODEL_SAME_PROVIDER`)
FAIL all 12 answers. They agree on every verdict. Scorecards: `SCORECARD-hub-new_chat.txt`,
`SCORECARD-hub-machine_selected.txt`. Grades: `grades/` (per condition in `grades-<condition>/`).

## What is wrong (root causes, with evidence)

1. **A typed question never looks anything up.** With no attached source, both clients send
   `mode: "general"`, and the route skips retrieval entirely. Every `new_chat` answer comes
   from model knowledge (`basis=general_reasoning`), with zero citations, even though the
   staging library holds the relevant manuals.
2. **Selecting the machine finds nothing either.** When the identity carries a model, the
   search is scoped to that exact model with no manufacturer fallback
   (`manual-rag.ts::scopeCascade`, `identityBound`; #3970 did this deliberately to stop
   citing wrong-family manuals). No chunk is tagged "SLC 5/03", so 0 candidates. The staging
   corpus has ~36.9k Rockwell/Allen-Bradley public chunks, 7 of which name the
   1761-NET-AIC (the correct seed-001 fix). The DH-485 material is tagged
   CompactLogix/ControlLogix. The data exists; the scope excludes it.
3. **The code says "refuse to cite"; the route answers anyway.** The `scopeCascade` comment
   intends "empty model-scoped results become an honest refuse-to-cite". But 5 of 6
   machine-selected turns returned `status=answered, basis=general_reasoning`: an uncited
   answer, not a refusal. Two of those invent asset-specific procedures:
   - a USB/serial firmware recovery for the AUMA AC 01.2 (graders: the documented paths are
     Bluetooth CDT or SD card);
   - WinPISA as the SPC-100 tool (graders: WinPISA is SPC200-only).
4. **~~An empty answer reached the client.~~ CORRECTED — that was a harness bug.** A declined
   turn carries its text in the SSE `status` frame's `message`, not in `content`, and the first
   runner read only `content`. Fixed in `hub_runner.py` (test proven red-then-green). Seed 004 was
   re-asked. The real reply is a fixed decline: "I couldn't find that in the Mitsubishi FX5U manual
   pages I have, so I won't guess a documented value. Upload the manual…"
   (`rerun-FIELD-SEED-004-machine_selected.json`). Two fresh graders re-graded it: 64 and 70, FAIL.
   It is safe and honest but asks for the **wrong** manual: the register map is in the Baykon
   BX11-EN indicator's manual, and the search only ever looked at the bound Mitsubishi identity.
   (`score.py` labels the row `correct_abstention` from its status; the verdict is still FAIL.)
5. **A bare refusal.** Seed 006 `new_chat`: "I'm sorry, but I can't help with that." — no
   reason given and no next step (`unhelpful_refusal`).

The best-scoring replies were honest abstentions (003 new_chat 74/70; 006 machine_selected
73/67). They were the closest to correct, which is the right direction.

## Caveats
- The ground truth is reconstructed from the 09-05 grade notes; the PRS's written key was never
  committed. Record the key in the repo before the next run.
- This is n=1 per question per condition. Treat it as 12 graded cases, not a percentage.
- Two conditions only. It does not cover an attached-manual chat (the acceptance suite's
  scenario 3 does, and passes).

## How to run it again (pre-promotion)
```bash
PYTHON=/path/to/python3.12 bash tools/qa/answer_radar_staging.sh answer_radar/runs/staging-<date>
# then grade out of process (two independent graders), then:
python -m answer_radar.score --batch <batch-hub-*.json> --grades <grades dir> --out <scorecard>
```
