import { expect, it } from "vitest";
import { citationReadingOrder } from "./citation-reading-order";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
const citations: EvidenceCitation[] = [1,2,3].map(n => ({ citationId: String(n), docId: `doc${n}`, fileId: `file${n}`, sourceTitle: `Manual ${n}`, page: n, quote: "Inspect the drive" }));
it("follows rendered answer order and ignores markers in code and ordinary links", () => {
  const text = 'First statement [2].\n\n`[3]` and [link [3]](https://example.com).\n\nSecond statement **[1]**. Again [2].\n\n```\n[3]\n```';
  const result = citationReadingOrder(text, citations);
  expect(result.map(r => r.citation.citationId)).toEqual(["2", "1"]);
  expect(result[0].statement).toBe("First statement [2].");
});
it("reads table markers and leaves unknown citations alone", () => {
  expect(citationReadingOrder('| Name | Source |\n| --- | --- |\n| Drive | [3] [99] |', citations).map(r => r.citation.citationId)).toEqual(["3"]);
});
