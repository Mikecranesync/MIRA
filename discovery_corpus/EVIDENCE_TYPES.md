# Evidence Types — what may be committed, and what may never be

FactoryLM reconstructs context from a plant's existing evidence. That evidence arrives in several
forms with **different commit rules**. Getting this wrong either leaks a customer's licensed data or
leaves a "discovery" as un-reproducible prose. Every Phase 0 (and later) artifact falls into exactly
one of these five classes.

| Class | What it is | Committed? | Where it lives | Example |
|---|---|---|---|---|
| **1. Raw licensed evidence** | The customer's actual export/manual/photo/DB as delivered. | **NEVER** | Outside the repo (`../proveit-factory/`), local only. | `Enterprise B/tags.json` (the real Cappy export) |
| **2. Derived structural observation** | Counts, hierarchy shape, layer/archetype findings *about* the raw evidence — no raw values. | **Yes** (as notes) | `sessions/` records | "4 areas / 15 lines / 43 assets; `data_type` empty on all; MES-OEE UDT model" |
| **3. Synthetic fixture** | A hand-built stand-in that mirrors the *structural shape* of the raw evidence with fictional names/values. | **Yes** | `fixtures/` | `synthetic_factory_export.json` |
| **4. Reusable workflow code** | The deterministic interrogators/classifiers distilled from a discovery. | **Yes** | `scripts/` | `interrogate_ignition_export.py` |
| **5. Claims reproduced by tests/reports** | Falsifiable claims re-derived by code from a committed fixture, plus the generated report. | **Yes, verified** | `tests/`, `reports/` | `test_claim_C1_mes_not_plc`, `reports/phase0_synthetic.md` |

## The rules

1. **Class 1 is radioactive.** No raw licensed file, tag value, or copy ever enters the repo or a
   `discovery_corpus/fixtures/` file. Inspect it locally; record only Class-2 observations.
2. **Class 2 captures shape, not content.** "Three filling lines, each CapLoader+Washer+Filler,
   `data_type` empty" is fine. A dump of real tag values is not.
3. **Class 3 must not impersonate Class 1.** Synthetic fixtures use obviously-fictional names
   (`Synthetic Beverage Co`, `Demo Site`, `Tank01`) so they can never be mistaken for, or leak, the
   real plant.
4. **Class 4 is the point.** A discovery that stays in chat or a doc is *not done*. It lands as a
   function in `scripts/` with a test (Class 5).
5. **Class 5 is the proof.** Any important claim ("this is MES not PLC", "no ladder logic") is backed
   by an executable check (`assess_claims`) and a test that re-runs it on a Class-3 fixture. Prose
   without a check does not count.

## The North Star loop

```
Claude discovers once  →  deterministic Python (Class 4)  →  synthetic fixture (Class 3)
        →  test + report (Class 5)  →  future datasets interrogated by code first, AI second
```
