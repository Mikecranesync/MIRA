import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LivingSheetPrint } from "./LivingSheetPrint";
import { newPractice, practiceView } from "./cv101-walkthrough-model";
it("keeps a tutorial preview out of the real global print portal", () => {
  const view = practiceView(newPractice("test", "2026-11-06T12:00:00.000Z", "demo-cv101-test"));
  const out = renderToStaticMarkup(<LivingSheetPrint view={view} seq={view.seq} printedAt="2026-11-06T12:00:00.000Z" preview />);
  expect(out).toContain("Synthetic CV-101 documentation review");
  expect(out).not.toContain("fl-print-portal");
});
