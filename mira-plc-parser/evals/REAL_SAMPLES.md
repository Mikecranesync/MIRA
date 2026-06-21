# Real PLC export samples — where to get them, how to validate

The committed tests use **synthetic** fixtures (plus the real CCW `.st` under `plc/`). To prove the
parser **generalizes**, validate it against **real vendor exports**. This file lists vetted public
sources, how to fetch them, the **license caveat** (most are GPL/vendor — usable locally, *not*
committable to this Apache/MIT repo), and the results of the last run.

> **License rule (repo constraint #1: Apache-2.0 / MIT only):** do **not** commit any sample below
> into the repo. Fetch them into `evals/real_samples/` (gitignored) and run the validator. The only
> committable real export is **one you exported yourself** from your own TIA/Studio project.

## Quick start

```bash
mkdir -p mira-plc-parser/evals/real_samples
# fetch a few real Siemens TIA Openness V16 exports (GPL-3.0 source repo — local use only):
B=https://raw.githubusercontent.com/mking2203/CodeGeneratorOpenness/master
curl -s "$B/CodeGeneratorOpenness/bin/Debug/TestFC1.xml"     -o mira-plc-parser/evals/real_samples/TestFC1.xml
curl -s "$B/Sample/LAD_Valve_V0.1.xml"                        -o mira-plc-parser/evals/real_samples/LAD_Valve.xml
curl -s "$B/Sample/GraphBranch.xml"                           -o mira-plc-parser/evals/real_samples/GraphBranch.xml
# validate:
python mira-plc-parser/evals/validate_real_exports.py
```

## Vetted sources

### Siemens TIA Openness XML (SimaticML)
| Source | What's there | License | Use |
|---|---|---|---|
| [mking2203/CodeGeneratorOpenness](https://github.com/mking2203/CodeGeneratorOpenness) | **Real TIA V16 exports**: `bin/Debug/TestFC1.xml` (FC/LAD), `Sample/LAD_*.xml` (LAD), `Sample/Graph*.xml` + `XML/V14SP1.xml` (GRAPH/SFC). Genuine `<Document>` with `DocumentInfo` + export timestamps. | **GPL-3.0** | Local validation only — do not commit |
| [Parozzz/TiaUtilities](https://github.com/Parozzz/TiaUtilities) | SimaticML model code + Openness API XML metadata (not block exports). | — | Reference for schema |
| [Repsay/tia-portal-xml-generator](https://github.com/Repsay/tia-portal-xml-generator) | MIT XML **generator** (DB/FB/OB) — no real exports committed, but can synthesize importable XML. | **MIT** | Could generate committable fixtures |
| [caprican/SimaticML](https://github.com/caprican/SimaticML) | C# SimaticML interface library + the **SimaticML XSD schemas** (authoritative shape per TIA version). | (unspecified) | Schema reference |

**Gap:** every real public sample found is **LAD/GRAPH** (graphical) — none are **SCL**. So the
tokenized-SCL reconstruction (criterion 6.3) is still only proven on the synthetic fixture. To close
it: export an **SCL** block from your own TIA project (own work → committable) into
`evals/real_samples/` and re-run the scorer.

### Rockwell L5X / other (for later phases)
| Source | License | Notes |
|---|---|---|
| [cmseaton42/L5XJS](https://github.com/cmseaton42/L5XJS) | MIT | L5X build/parse lib with example L5X output |
| [lagarcia38/l5x2ST](https://github.com/lagarcia38/l5x2ST) | check | L5X project fixtures for an L5X→ST compiler |

## Last validation run (real Siemens V16 exports, mking2203, GPL — local only)

| File | Detected | Handled | Tags | Routines (lang) | Rungs | Notes |
|---|---|---|---|---|---|---|
| `TestFC1.xml` | siemens_tia_xml (high) | ✅ | 4 | 6 (RLL/LAD) | 0 | graphical body correctly NOT faked into rungs |
| `LAD_Valve_V0.1.xml` | siemens_tia_xml (high) | ✅ | 5 | 3 (RLL/LAD) | 0 | clean, no warnings |
| `GraphBranch.xml` | siemens_tia_xml (high) | ✅ | 109 | 1 (SFC/GRAPH) | 0 | large 57 KB real interface parsed |
| `plcBlock_LAD_Block_Logic.xml` | siemens_tia_xml (high) | ✅ | 3 | 3 (RLL/LAD) | 0 | — |

**Verdict:** the parser **generalizes** to real V16 Openness exports — detection, interface/tag
extraction, language identification, and honest graphical-degrade all work on real data it never saw,
with no crashes or warnings. **Still owed:** a real **SCL** export to prove the SCL body
reconstruction (6.3) on real data. Drop one in `evals/real_samples/` and `score_phases.py` 6.4 closes.
