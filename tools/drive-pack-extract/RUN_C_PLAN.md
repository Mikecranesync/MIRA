# Run C — string-identifier fault schema + approved-record conversion (scope lock)

Follows Run A (PR #2690, 0/0 baseline, frozen under
`candidates/magnetek_impulse_g_plus_mini/runA/`) and Run B (PR #2695, merged
v3.144.0: Magnetek dialect, 0→77 mnemonic faults / 0→468 dotted params, 100%
cited, NOT PROMOTED). Run B's locked scope deliberately deferred the schema
decision — this plan is that decision's scope. Tracking: #2691 (Magnetek,
items 3–5) and #2685 (GS20 — same schema class; one shared fix).

## Preconditions (human-gated — do not start implementation before these)

1. **C5 approval of the 10 restored parameter records** from Run B rev2
   (adversarial round-1 REJECT → dash page-refs + p.173 legend-bridge fix).
   Owner: Mike. Status: **pending** as of 2026-07-14.
2. **Technician confirmations recorded** for crane-application semantics.
   Status: LL1/LL2 axis-dependent semantics **confirmed 2026-07-14**
   (`candidates/magnetek_impulse_g_plus_mini/TECHNICIAN_CONFIRMATIONS.json`);
   UL1–UL3 symmetry is **proposed only** — needs explicit confirmation before
   any answer surface asserts it.

## In scope (Run C, sequenced as three PRs)

### PR C1 — string-identifier fault schema (code; unblocks #2685 too)
1. Extend `mira-bots/shared/drive_packs/schema.py` so mnemonic fault
   identifiers are first-class. Direction locked by Run B evidence
   (`runA/COMPARISON_CONTRACT.json` → `delta.schema_direction_evidence`):
   promote the candidate-layer `fault_entries[]` shape (string `fault_id`,
   `name`, `action`, `source_citation`, optional `wire_value: int | None`)
   into the runtime schema rather than widening
   `LiveDecode.fault_codes: dict[int, str]` key types. G+ Mini is
   mnemonic-only — `wire_value` can never be non-null for this family;
   GS10/GS20 mnemonics get the same representation.
2. Loader support in `mira-bots/shared/drive_packs/loader.py` (today
   `_int_keyed` hard-rejects non-int fault keys; `fault_entries` passes only
   because it is ignored). Round-trip test: Run B `pack.json` loads with all
   77 fault entries addressable by string id.
3. Grading updates in `grading/domain_rules.py` + `GRADING_SPEC.md` for the
   new surface — **no threshold manipulation**; the crane fault-integrity
   hard-fail (BE*/LL*/UL*/LC/STO/PG must carry a cited corrective action)
   extends to the runtime surface.
4. Regression: GS10 / PF40 / PF525 / GS20 extraction + grading + existing
   `gold/` fixtures unchanged (must-not from the comparison contract).

### PR C2 — approved-record conversion + gold fixture (gated on precondition 1)
5. Convert the C5-approved records into the deterministic pack; add
   `gold/magnetek_impulse_g_plus_mini` fixture + regression test (#2691
   item 4).
6. **Technician-confirmation overlay mechanism**: add `technician_confirmed`
   to the grading provenance vocabulary (`_VALID_PROVENANCE` +
   `GRADING_SPEC.md` §D) and merge `TECHNICIAN_CONFIRMATIONS.json` sidecars
   at pack-build time — hand edits to `pack.json` remain forbidden (it is
   deterministic extractor output). Confirmed entries (LL1/LL2) carry the
   tier; `status: "proposed"` entries (UL*) must NOT be merged — proposed →
   confirmed is an explicit human action, never automatic (same doctrine as
   kg `proposed` → `verified`).
7. Broader fault coverage verification beyond Run B's 12-token adversarial
   probe (~50+ real codes in the manual) before promotion.

### PR C3 — crane-safety answer judge + Q&A coverage (#2691 item 5)
8. Answer-judge rule set for crane packs: answers touching LL*/UL*/BE*/LC
   must (a) establish or ask which motion the drive controls (hoist vs
   traverse) before asserting what a limit means — per the LL1/LL2
   confirmation, the same mnemonic reads "hoist lower limit" on a hoist and
   "travel limit" on a traverse; (b) never advise bypassing/jumpering a limit
   input; (c) stay within cited corrective actions (check switch position,
   condition, H01.XX input config).
9. Crane Q&A coverage cases exercising the judge, including at least one
   hoist-context and one traverse-context LL1 question.

## Explicitly OUT of scope
- Any GS20/GS10 *extractor dialect* work (extraction gap tracked in #2685;
  C1 only fixes the schema class they share).
- Runtime deployment / flag changes; anything touching the live kiosk or
  engine paths beyond the pack loader.
- Yaskawa-relabel confirmation (stays `strongly_inferred`,
  `MAGNETEK_YASKAWA_MATRIX.md`).
- Mnemonic→integer mapping (Run B must-not; stands permanently for
  mnemonic-only families).
- Republishing copyrighted PDFs (provenance + SHA-256 + citations only).

## Must-nots (carried from the Run A/B comparison contract)
- No invented integer fault keys.
- No grading-threshold manipulation.
- No regression of GS10 / PF40 / PF525 / GS20 extraction or grading.
- No promotion without the human gates above.

## Verify steps
- `/Users/charlienode/MIRA/.venv/bin/python -m pytest tools/drive-pack-extract/{tests,grading/tests,registry/tests} -q` green.
- Loader round-trip: Run B pack loads; 77 string fault ids addressable;
  existing int-keyed packs load unchanged.
- Grading fixture proving `technician_confirmed` accepted + unknown tiers
  still hard-fail.
- Gold regression suite green including the new
  `gold/magnetek_impulse_g_plus_mini` fixture (C2).
