/**
 * PrintSense dispatch — **STUB. Dispatches nothing.** (2026-10-17 prod-test
 * item 8.)
 *
 * When `classifyPhoto` says a photo is an electrical print, the work belongs
 * to PrintSense: the deterministic designation decoder and cross-sheet
 * extractor in `printsense/` (`designations/`, `xref_extractor.py`), with its
 * paid-OpenAI vision interpreter as the perception layer. That runs as a
 * SEPARATE service, which is exactly why this file does not call it.
 *
 * Three reasons it stays a stub tonight, all of them owner decisions:
 *
 * 1. **Spend.** PrintSense's interpreter is the single owner-authorized paid
 *    vision carve-out (PR #2661, print photos only). Opening a new caller to
 *    it from the Hub is a new metered lane and needs a declared dollar budget
 *    before a single call — `.claude/rules/zero-token-architecture.md` Rule 1.
 * 2. **No transport exists.** `printsense/commercial_service.py` is a Python
 *    service with no Hub-reachable contract; there is no URL, no token, no
 *    response schema to code against. Inventing one here would be the
 *    parallel-framework mistake, not an integration.
 * 3. **Materialized Evidence.** A print interpretation is expensive and MUST
 *    be content-addressed and recalled, not re-inferred per turn
 *    (`printsense/cas.py` is the seed, and the inference-burn study is what
 *    happens without it). The dispatch contract has to carry the source hash
 *    from the start, so it is modelled below and left unimplemented.
 *
 * The flag therefore gates a decision that is *recorded*, never a call.
 */

import type { PhotoClass } from "./photo-class";

/** Default OFF. Even ON, nothing is dispatched — see `dispatchPrint`. */
export function printsenseDispatchEnabled(): boolean {
  return process.env.NOTEBOOK_PRINTSENSE_DISPATCH === "1";
}

export type PrintDispatchRequest = {
  tenantId: string;
  /** The stored photo this is about. */
  fileId: string;
  /** sha256 of the image bytes — the recall key, present from day one so the
   *  first real implementation cannot forget it (materialized-evidence r5–r7). */
  contentSha256: string;
  klass: PhotoClass;
};

export type PrintDispatchDecision =
  /** Not a print, or the flag is off: nothing to do, today's path continues. */
  | { dispatch: false; reason: "not_a_print" | "flag_off" }
  /** A print, the flag is on — and still not sent, because no transport or
   *  budget is authorized. This is the honest terminal state of the stub. */
  | { dispatch: false; reason: "not_wired"; request: PrintDispatchRequest };

let announced = false;

/**
 * Decide — and only decide — what should happen to a classified photo.
 *
 * Returns a value; performs no I/O, spends nothing, and never touches the
 * bots or the PrintSense workflow. The caller logs the decision. When the
 * transport and a budget are authorized, the `not_wired` branch is where the
 * call goes, with `request` already carrying its recall key.
 */
export function dispatchPrint(req: PrintDispatchRequest): PrintDispatchDecision {
  if (req.klass !== "electrical_print") return { dispatch: false, reason: "not_a_print" };
  if (!printsenseDispatchEnabled()) return { dispatch: false, reason: "flag_off" };
  if (!announced) {
    announced = true;
    console.warn(
      "[printsense-dispatch] NOTEBOOK_PRINTSENSE_DISPATCH is on, but no PrintSense transport or spend budget is authorized — print photos are recorded and left on the existing path",
    );
  }
  return { dispatch: false, reason: "not_wired", request: req };
}
