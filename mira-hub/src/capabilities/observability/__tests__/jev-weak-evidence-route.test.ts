/**
 * Source-level contract for the weak-evidence badge's placement in the chat
 * route — the same style as jev-route-invariant.test.ts, for the same reason:
 * the properties are about WHERE the code sits and WHAT it may touch, and
 * nothing at runtime would notice if either drifted.
 *
 *  1. The badge is decided AFTER the sufficiency shadow is awaited and AFTER
 *     the evidence frame (hence the basis) exists. Deciding it earlier would
 *     either read a pending promise or guess the basis.
 *  2. It is flag-gated by `jevWeakEvidenceBadgeEnabled()` in the same
 *     expression — a build without the flag cannot badge anything.
 *  3. It changes the caption and the status marker only. `answerStatus` is
 *     never assigned after the decision, so the answer is delivered as it was.
 *  4. The marker is persisted with the turn and replay reads THAT marker, so
 *     a reload shows the caption the live stream showed.
 *  5. The status frame carries `evidence: "weak"` only through the decision.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { WEAK_EVIDENCE_LABEL } from "../jev-weak-evidence";

const ROUTE = join(process.cwd(), "src/app/api/equipment-notebooks/[id]/chat/route.ts");
const src = readFileSync(ROUTE, "utf8");
const lines = src.split("\n");
const linesOf = (re: RegExp) =>
  lines.map((l, i) => (re.test(l) ? i + 1 : 0)).filter((n) => n > 0);
const only = (re: RegExp, what: string) => {
  const found = linesOf(re);
  expect(found, `${what}: expected exactly one site, found ${found.join(",")}`).toHaveLength(1);
  return found[0];
};

describe("weak-evidence badge — placement in the chat route", () => {
  const decision = only(/^\s*const weakEvidence =\s*$/, "the live decision");
  const jevAwait = only(/const jev = await jevShadow;/, "the shadow await");
  const evidenceFrameDecl = only(/const evidenceFrame: NotebookBasisEvidenceFrame =/, "the evidence frame");
  const statusFrameDecl = only(/const statusFrame: NotebookStatusFrame =/, "the live status frame");

  it("is decided after the sufficiency shadow has been awaited", () => {
    expect(decision).toBeGreaterThan(jevAwait);
  });

  it("is decided after the evidence frame (the basis) exists, and before the status frame", () => {
    expect(decision).toBeGreaterThan(evidenceFrameDecl);
    expect(decision).toBeLessThan(statusFrameDecl);
  });

  it("is gated by the flag inside the decision expression", () => {
    const window = lines.slice(decision - 1, decision + 4).join("\n");
    expect(window).toMatch(/jevWeakEvidenceBadgeEnabled\(\)\s*&&/);
  });

  it("never reassigns answerStatus after the decision (the answer is delivered as it was)", () => {
    const after = lines.slice(decision).join("\n");
    expect(after).not.toMatch(/^\s*answerStatus\s*=[^=]/m);
    expect(src).toMatch(/const answerStatus: "answered" \| "insufficient_evidence" \| "error" =/);
  });

  it("changes the caption to the weak-evidence label, and nothing else about the evidence frame's basis", () => {
    only(/evidenceFrame\.label = WEAK_EVIDENCE_LABEL;/, "the caption swap");
    expect(src).not.toMatch(/evidenceFrame\.basis\s*=/);
  });

  it("marks the live answered status frame only through the decision", () => {
    const statusWindow = lines.slice(statusFrameDecl - 1, statusFrameDecl + 3).join("\n");
    expect(statusWindow).toMatch(/status: "answered", \.\.\.\(weakEvidence \? \{ evidence: "weak" as const \} : \{\}\)/);
    // No other site writes evidence: "weak" on the live path.
    const liveSites = linesOf(/evidence: "weak" as const/).filter((n) => n > jevAwait);
    expect(liveSites).toHaveLength(1);
  });

  it("records the badge on the packet when it fires", () => {
    only(/rec\.stage\("answer_gate", \{ weak_evidence_badge: true \}\);/, "the packet record");
  });

  it("persists the marker with the served, non-replaced turn's evidence", () => {
    const persist = only(/\.\.\.\(weakEntry \? \[weakEntry\] : \[\]\)\]/, "the persisted marker");
    expect(persist).toBeGreaterThan(decision);
    expect(persist).toBeLessThan(statusFrameDecl);
  });
});

describe("weak-evidence badge — replay", () => {
  it("replays from the persisted marker, on the OEM-documentation basis only", () => {
    only(
      /const weakEvidence = basis === "oem_documentation" && turn\.evidence\.some\(isWeakEvidenceEntry\);/,
      "the replay decision",
    );
  });

  it("replays the same caption the live stream showed", () => {
    only(/label: weakEvidence \? WEAK_EVIDENCE_LABEL : replayBasisLabel\(basis\),/, "the replay caption");
    expect(WEAK_EVIDENCE_LABEL.length).toBeGreaterThan(0);
  });

  it("replays the status marker", () => {
    const sites = linesOf(/evidence: "weak" as const/);
    expect(sites).toHaveLength(2);
  });
});
