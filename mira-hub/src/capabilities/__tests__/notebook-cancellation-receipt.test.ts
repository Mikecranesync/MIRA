import { describe, expect, it } from "vitest";
import { cancellationReceiptEvidence, currentCancellationReceipt, publicNotebookEvidence } from "@/lib/notebook-cancellation-receipt";
import { splitEvidence } from "@/components/equipment/notebook-chat-utils";

const attempt = "cf100000-0000-4000-8000-000000000001";
const request = "cf200000-0000-4000-8000-000000000001";
const receipt = () => cancellationReceiptEvidence(attempt, request)[0];
describe("current notebook cancellation completion evidence", () => {
  it("is reference-only and matches either UUID spelling", () => {
    expect(currentCancellationReceipt([receipt()], request.toUpperCase())).toEqual(receipt());
    expect(cancellationReceiptEvidence(attempt.toUpperCase(), request.toUpperCase())).toEqual([receipt()]);
    expect(Object.keys(receipt()).sort()).toEqual(["attemptId", "clientRequestId", "kind", "version"]);
  });
  it.each([null, "bad"])("invalid producer metadata cannot interrupt the domain stop (%s)", (id) => {
    expect(cancellationReceiptEvidence(attempt, id)).toEqual([]);
    expect(cancellationReceiptEvidence("bad", request)).toEqual([]);
  });
  it("never treats missing, conflicting, malformed, foreign or content-bearing entries as proof", () => {
    for (const entries of [[], [null], [receipt(), receipt()], [{ ...receipt(), version: 2 }],
      [{ ...receipt(), attemptId: "bad" }], [{ ...receipt(), clientRequestId: attempt }],
      [{ ...receipt(), text: "untrusted content" }], [{ ...receipt(), kind: "citation" }]]) {
      expect(currentCancellationReceipt(entries, request)).toBeNull();
    }
  });
  it("is ignored by the existing citation/hydration classifier", () => {
    expect(splitEvidence([receipt()])).toMatchObject({ citations: [], machineEvidence: [], visualEvidence: [], safetyNotice: null, safetyStop: null });
  });
  it("keeps completion proof private without dropping other public or unknown evidence", () => {
    const citation = { docId: attempt, citationId: "1" }; const unknown = { kind: "future_public_entry" };
    const original = [citation, receipt(), unknown, { kind: receipt().kind, version: 9 }];
    expect(publicNotebookEvidence(original)).toEqual([citation, unknown]);
    expect(original).toHaveLength(4);
    expect(currentCancellationReceipt([receipt()], request)).toEqual(receipt());
  });
});
