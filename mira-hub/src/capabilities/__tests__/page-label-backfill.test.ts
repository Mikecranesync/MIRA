/**
 * #4508 — planPageLabelBackfill decides which existing v2 chunk rows of ONE
 * document get `metadata.page_label`, from a local copy of the PDF. It writes
 * nothing itself. It refuses the whole document unless the local PDF provably
 * IS the uploaded one: every stored chunk's opening text must appear on the
 * SAME page of the local PDF's text (whitespace-normalised). Chunk boundaries
 * may drift between parser builds (staging ACS355: 258 of 974 rows chunked
 * differently, all 974 still on their own page), so placement — not identical
 * chunking — is the proof. A text-repaired row is matched by page range only,
 * since its content was decoded after extraction.
 *
 * Run: npx vitest run src/capabilities/__tests__/page-label-backfill.test.ts
 */
import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/node-knowledge-ingest";
import { planPageLabelBackfill, uploadIdentity, type BackfillRow } from "@/capabilities/page-label-backfill";

const PAGES = [
  "Front matter page with the copyright notice and the document number.",
  "Contents page listing Safety, Installation and Start-up chapters.",
  "Safety chapter: wait five minutes after disconnecting power before work.",
];
const LABELS = ["i", "ii", "1"];

/** The rows ingest would have written for PAGES (no labels yet). */
function storedRows(pages = PAGES): BackfillRow[] {
  const rows: BackfillRow[] = [];
  let idx = 0;
  pages.forEach((text, p) => {
    for (const piece of chunkText(text)) {
      rows.push({ id: `r${idx}`, sourcePage: p + 1, content: piece, pageLabel: null, textRepair: null });
      idx++;
    }
  });
  return rows;
}

describe("planPageLabelBackfill", () => {
  it("labels every row of a matching document with its page's printed label", () => {
    const plan = planPageLabelBackfill(storedRows(), PAGES, LABELS);
    expect(plan).toEqual({
      ok: true,
      updates: [
        { id: "r0", label: "i" },
        { id: "r1", label: "ii" },
        { id: "r2", label: "1" },
      ],
      unchanged: 0,
    });
  });

  it("refuses when the local PDF has no label tree", () => {
    expect(planPageLabelBackfill(storedRows(), PAGES, null)).toEqual({ ok: false, reason: "no_labels" });
  });

  it("refuses when there are no stored rows for the document", () => {
    expect(planPageLabelBackfill([], PAGES, LABELS)).toEqual({ ok: false, reason: "no_rows" });
  });

  it("refuses the whole document when one row's text is not in the local PDF (wrong file)", () => {
    const rows = storedRows();
    rows[1] = { ...rows[1], content: "Contents page of a DIFFERENT revision." };
    expect(planPageLabelBackfill(rows, PAGES, LABELS)).toEqual({ ok: false, reason: "content_not_on_page" });
  });

  it("refuses when a row's text is on a different page than the one it records", () => {
    const rows = storedRows();
    rows[2] = { ...rows[2], sourcePage: 2 };
    expect(planPageLabelBackfill(rows, PAGES, LABELS)).toEqual({ ok: false, reason: "content_not_on_page" });
  });

  it("refuses when a row's page is past the local document", () => {
    const rows = storedRows();
    rows.push({ id: "extra", sourcePage: 4, content: "x", pageLabel: null, textRepair: null });
    expect(planPageLabelBackfill(rows, PAGES, LABELS)).toEqual({ ok: false, reason: "page_out_of_range" });
  });

  it("refuses a row without a page", () => {
    const rows = storedRows();
    rows[0] = { ...rows[0], sourcePage: null };
    expect(planPageLabelBackfill(rows, PAGES, LABELS)).toEqual({ ok: false, reason: "page_out_of_range" });
  });

  it("accepts chunk-boundary drift: a stored chunk cut differently is still placed by its page", () => {
    // Ingest extracted page 3 with extra trailing text, so its chunk is longer
    // than re-chunking the local text would produce; it still starts on page 3.
    const rows = storedRows();
    rows[2] = { ...rows[2], content: `${PAGES[2]}\nDI5 Ramp pair selection text the local build drops.` };
    const plan = planPageLabelBackfill(rows, PAGES, LABELS);
    expect(plan.ok && plan.updates.find((u) => u.id === "r2")).toEqual({ id: "r2", label: "1" });
  });

  it("matches whitespace-normalised text (newlines vs spaces)", () => {
    const rows = storedRows();
    rows[2] = { ...rows[2], content: rows[2].content.replace(/ /g, "\n") };
    const plan = planPageLabelBackfill(rows, PAGES, LABELS);
    expect(plan.ok).toBe(true);
  });

  it("refuses when a row already carries a DIFFERENT page_label", () => {
    const rows = storedRows();
    rows[2] = { ...rows[2], pageLabel: "7" };
    expect(planPageLabelBackfill(rows, PAGES, LABELS)).toEqual({ ok: false, reason: "label_conflict" });
  });

  it("is idempotent: rows already carrying the same label are left unchanged", () => {
    const rows = storedRows().map((r, k) => ({ ...r, pageLabel: LABELS[k] }));
    expect(planPageLabelBackfill(rows, PAGES, LABELS)).toEqual({ ok: true, updates: [], unchanged: 3 });
  });

  it("matches a text-repaired row by page range only", () => {
    const rows = storedRows();
    rows[1] = { ...rows[1], content: "decoded English text", textRepair: "shift29" };
    const plan = planPageLabelBackfill(rows, PAGES, LABELS);
    expect(plan.ok && plan.updates.map((u) => u.id)).toEqual(["r0", "r1", "r2"]);
  });

  it("skips a page whose label is blank instead of writing a guess", () => {
    const plan = planPageLabelBackfill(storedRows(), PAGES, ["i", null, "1"]);
    expect(plan).toEqual({
      ok: true,
      updates: [
        { id: "r0", label: "i" },
        { id: "r2", label: "1" },
      ],
      unchanged: 1,
    });
  });

  it("refuses when the label list does not line up with the local pages", () => {
    expect(planPageLabelBackfill(storedRows(), PAGES, ["i", "ii"])).toEqual({ ok: false, reason: "no_labels" });
  });
});

// #5065 Codex r1 F1: /PageLabels is metadata the extracted text does not reveal, so text placement
// can never prove which label tree the uploaded bytes carried. Only the upload's own hash can.
describe("uploadIdentity", () => {
  const SHA = "49aab44098854107".padEnd(64, "0");
  it("accepts a local file whose sha256 equals the upload's recorded hash", () => {
    expect(uploadIdentity(SHA, SHA)).toEqual({ ok: true });
  });
  it("refuses a different file", () => {
    expect(uploadIdentity(SHA, SHA.replace(/0$/, "1"))).toEqual({ ok: false, reason: "sha_mismatch" });
  });
  it("refuses an upload with no recorded hash, whatever the text says", () => {
    expect(uploadIdentity(null, SHA)).toEqual({ ok: false, reason: "no_upload_hash" });
    expect(uploadIdentity("  ", SHA)).toEqual({ ok: false, reason: "no_upload_hash" });
  });
});
