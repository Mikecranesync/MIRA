# IMIB validation roadmap (Phase C) — design only, nothing here is built

Every number below is a **planning target, not an existing asset.**

## 1. Expansion to about 200 expert-reviewed cases

| Slice | Target | Where it can come from | Today (v0.1) |
|---|---|---|---|
| Manual / fault-code lookup | 60 | t4-77 after expert review, plus new OEM manuals | 77 AI-written, unverified |
| Real technician wording | 40 | forum-new style collection (pre-registered, quote-verified), CMMS work-order text with consent | 19 answerable forum questions, AI-labelled |
| Multi-device | 30 | Notebooks with 2+ manuals; the S7-1200 + TP700 class | 1 (batch2 F2) |
| Safety / refusal | 30 | Real hazard phrasings from forum threads and incident reviews, plus unanswerable questions | 28 gate cases (AI-authored), 15 unanswerable |
| Multi-step diagnosis | 25 | The simulations below | 0 |
| Visual / prints | 15 | PrintSense frozen corpus, nameplate benchmark | 0 in IMIB (separate benchmarks exist) |

**Coverage rules:**
- no manual contributes more than 10% of a slice;
- at least 6 vendors;
- at least 30% of cases from people, not AI.

## 2. Expert review workflow

- **Reviewers:** at least two qualified maintenance technicians or controls engineers per case, at least one
  of them outside FactoryLM. Record each reviewer's credentials and any conflict of interest.
- **Workflow:**
  1. Each reviewer labels the pages, acceptable answers and critical safety conditions independently, blinded
     to the AI labels and to MIRA's output.
  2. If they disagree, a third reviewer adjudicates. The adjudication note is stored with the case.
- **Agreement:** Cohen's κ per capability. Proceed when κ ≥ 0.7 for pages and ≥ 0.8 for safety conditions.
  Below that, refine the guidelines and re-label; don't drop the hard cases.
- **Cost:** about 200 cases × 2 reviewers × ~6 min ≈ 40 reviewer-hours, plus adjudication of about 15%.

## 3. Holdout and versioning

- **Splits:** `dev` (tuning allowed), `test` (reported, not tuned on), and `sealed_holdout`: about 25% of each
  slice, published only as a sha256 commitment. The owner holds the plaintext outside the repo. It's run
  only by a reviewer who doesn't tune MIRA, at most once per release candidate.
- **Versioning:** dataset versions are semver.
  - A label change is a minor version.
  - A schema change is a major version.
  - Scores are only compared within one dataset version.
  - Every report names the version.
- **Contamination:**
  - no case text in prompts, retrieval synonyms or eval-specific code paths;
  - a near-duplicate check across splits;
  - when a fix is driven by a case, that case moves to `dev`.

## 4. Interactive diagnostic simulations (5–10 planned)

**Shape:**
- A hidden fault state and a technician persona that only reveals what is asked.
- Safe, read-only tool interfaces: read a tag, read the fault log, ask the technician to measure something.
  **No write tools.**
- Several acceptable diagnostic paths.
- Scored on:
  - did it reach the fault;
  - the number of steps;
  - did it ask the right next question;
  - safety violations, where any violation fails the run.

**Framework:** Inspect AI (see `TOOLS.md`). Each simulation has a deterministic fault script, so it's
repeatable.

| # | Scenario | Hidden fault | Bench validation |
|---|---|---|---|
| 1 | GS10 trips on accel | accel time too short vs load (ocA) | Micro820 + GS10 bench |
| 2 | Conveyor stops, no fault on VFD | E-stop chain open at one station | bench |
| 3 | GS10 comm fault CE10 | RS-485 two-master contention | bench (bus master offline per fieldbus rule) |
| 4 | Micro820 won't connect | DHCP default vs expected fixed IP | bench |
| 5 | PowerFlex 525 won't run | S1/S2 safe-torque-off jumper missing | none; needs field validation |
| 6 | Soft starter line-loss fault | phase loss upstream | SimLab |
| 7 | Overload trips repeatedly | wrong trip class / FLA setting | SimLab |
| 8 | Intermittent sensor | failing prox on a flexing cable | SimLab |

**Graduation:** each simulation is validated against a real bench reproduction (1–4) or a verified field case
before it counts.

## 5. From internal benchmark to independently validated, then public

1. **Internal engineering benchmark** (now). The method is published in the repo; labels are AI-made;
   exact-SHA Codex review.
2. **Expert-validated internal benchmark.**
   - At least 150 cases at `expert_reviewed` or above, κ targets met, and a sealed holdout in use.
   - Answer-level and safety-answer capabilities run with a declared budget.
   - Results reproduced by someone who is not the author, from the manifest alone.
3. **Externally validated.**
   - An independent party (university lab, standards-adjacent body or customer engineering team) reruns the
     sealed holdout.
   - Correlation with verified technician diagnoses and repairs: target 100+ field cases with known root
     cause.
   - Conflicts of interest disclosed: FactoryLM builds both the benchmark and the system under test.
4. **Public industry benchmark.**
   - Only redistributable documents (OEM manuals whose license permits it, or links plus hashes).
   - Customer data never included.
   - A license for the case set (CC-BY-4.0 for cases, Apache-2.0 for code).
   - An independent maintainer or steering group, a leaderboard rule that excludes the holdout from tuning,
     and a versioned changelog.
   - Map the risk documentation to NIST AI RMF Measure and Manage functions.

The evidence needed at each step is cumulative. No step is claimed until its evidence is in the repo or with
the named independent party.
