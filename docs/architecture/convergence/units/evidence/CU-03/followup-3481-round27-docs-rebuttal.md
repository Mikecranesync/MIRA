# #3481 round AC (scope A: docs + `.claude/` + `PLAN.md` + `HANDOFF.md`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round27-gate7-docs.md` — head `156b8484452a7fc717dd9e2cf2128412848b9234`,
**260,672/260,672** chars, 13 files excluded by scope (all code / tests / tools / CI config —
covered by scopes B, C and D of this round). Every quoted line below is a line of this PR's diff
with its `-`/`+` marker.

## F1 — "Documentation contradicts itself: claims a lane defect remains unfixed after stating it was fixed" (high)

The finding quotes the sentence with a leading `-`: that is the diff marker of a **removed**
line. The standalone claim was removed by this PR:

```diff
-> **The lane defect recorded above stands unfixed.** Adjudicator verdict instability on
-> materially identical inputs was routed around, not repaired; a future unit still owes it.
```

and replaced by a block whose first line labels everything under it as superseded history:

```diff
+> ⛔ **Superseded — kept for the audit trail; corrected 2026-08-29.** Group A was the last open
```

The sentence reappears **inside that superseded block** — deliberately, because the doctrine
preserves the record verbatim rather than rewriting history — prefixed by the same banner:

```diff
+> (next section). **The lane defect recorded above stands unfixed.** Adjudicator verdict instability
+> on materially identical inputs was routed around, not repaired; a future unit still owes it.
```

A statement that the record itself marks "⛔ Superseded — kept for the audit trail" is not a
present-tense claim and cannot contradict the later, current disposition; the record says in
the same breath which of the two is current. The same reading was raised in round O (O-D1) and
answered the same way; this round's diff adds nothing that reopens it.
