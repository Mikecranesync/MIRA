import { test, expect } from "bun:test";
import { getDocumentProxy } from "unpdf";
import { SAMPLE_PDF_BASE64 } from "../evidence-sample-pdf";

test("the prototype renders a real two-page PDF containing the cited passages", async () => {
  const doc = await getDocumentProxy(Uint8Array.from(atob(SAMPLE_PDF_BASE64), (c) => c.charCodeAt(0)));
  try {
    expect(doc.numPages).toBe(2);
    for (const [page, quote] of [[1, "The equipment label records the model and serial number."],
      [1, "Check the document revision against the equipment model."],
      [2, "Source reference          Keep the page with the note."]] as const) {
      const content = await (await doc.getPage(page)).getTextContent();
      const text = content.items.map((item) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ");
      expect(text).toContain(quote.replace(/\s+/g, " "));
    }
  } finally { await doc.destroy(); }
});
