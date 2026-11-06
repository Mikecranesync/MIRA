# Fresh whole-branch review and correction record

Reviewer: fresh-context `cv101_final_review` (read-only).
Range: `211e5c78e..70e6d4aaf`. No Critical; two Important findings.

1. Stored optional resolution metadata could pass the parser without matching
   events, hide an unresolved issue or crash the record renderer.
2. Existing shell Back calls native `dialog.close()` and bypassed the nested
   source Escape handler, closing the whole guide.

Both findings were accepted and reproduced before correction. One fix pass:
three model tests failed before the parser change, then16/16passed including
a legitimate resolved issue; external direct-close browser behavior failed
before the dialog correction, then preserved the guide, opener focus and same
finished job. Second direct close exited to the launcher.
[Browser RED/GREEN receipt](review-fix-browser.json).

The final complete Hub suite was rerun after correction. This document records
the initial fresh review and test-based remediation; it is not a second review
or an authoritative exact-head/body GitHub attestation.

Declined-to-judge dispositions:

- Parent implementation/#5245 are outside this delta and remain preserved.
- Real authentication, equipment, server durability and tenant authorization
  remain blocked; practice claims never substitute for them.
- Full build remains unverified and existing typecheck failures remain visible.
- Full-suite counts were supplied by the implementer; reviewer checked artifacts,
  not an independent rerun. Logs are included for review.
- Actual hardware/browser Back remains untested. The corrected external native
  close contract is separately demonstrated in the component harness.

No deferred minor findings from this review. Final exact-head/body review and
CI status belong to the dependent PR's GitHub ledger.
