# Exact Questions Asked — Print Translator Campaign

Two captions are used across the campaign, both real matches of
`print_translator.THEORY_INTENT_PHRASES` (`mira-bots/shared/print_translator.py`):

- `"Explain this print."`
- `"Describe the theory of operation."`

**Caption note (important):** the caption governs ONLY
`print_translator.is_theory_request(caption)` — the trigger check that decides
whether the print-translator path runs at all. It is **not** passed into
`build_theory_messages()`, so it has **no effect on the explanation text
itself** — the same image + vision_data produces the same kind of prompt
regardless of which of the two captions triggered it. Both captions are
exercised here (5 of each, across the first-10) purely to prove both real
trigger phrases work, not because they change the answer.

## Full handler run (`results/<id>.json`) — always `"Explain this print."`

Every one of the 11 fetchable corpus entries was run through the real handler
with the same caption, `"Explain this print."`, to measure the classifier
gate consistently (one caption held constant across the trigger-rate
measurement — see `RANKED_REPORT.md`).

## Gate-bypassed explanation (`results/<id>.gate_bypassed.json`) — per first-10 entry

| id | OEM | Category | Caption submitted |
|---|---|---|---|
| 3 | ABB Star-Delta | European/IEC | Explain this print. |
| 5 | Rockwell Bulletin 509 | NEMA Starters | Explain this print. |
| 7 | AutomationDirect SR44 Soft Starter | NEMA Starters | Describe the theory of operation. |
| 9 | Rockwell Guardmaster 440R | Safety Relays | Explain this print. |
| 13 | AutomationDirect CLICK PLC | PLC I/O | Describe the theory of operation. |
| 14 | AutomationDirect D0–06 PLC | PLC I/O | Describe the theory of operation. |
| 17 | AutomationDirect GS20 VFD | VFD | Explain this print. |
| 18 | ABB ACS355 VFD | VFD | Explain this print. |
| 20 | WEG CFW-11W VFD | VFD | Describe the theory of operation. |
| 25 | Yaskawa V1000 F/R | Reversing/Braking | Describe the theory of operation. |

Each row's `caption_submitted` field in the matching `results/<id>.gate_bypassed.json`
is the ground truth for this table (regenerate this file from those records if the
campaign is ever re-run with different captions).
