/**
 * acceptedPages: a further page that answers the question on its own counts as CORRECT.
 *
 * Why: the key held one page per question, but the large manuals state the same fact in a
 * description, a summary table and a troubleshooting table. The 2026-11-01 offline review of five
 * past walks found 18/41 WRONG_PAGE rows cited such a page. Each accepted page carries the verbatim
 * pdftotext line that proves it, checked against committed page text (and the PDF itself when cached).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import corpusJson from "./corpus.json";
import fixture from "./fixtures-accepted-pages.json";
import { classify, pageAccepted, predict, type Corpus, type Observation, type Scored } from "./score";

const corpus = corpusJson as Corpus;
const question = (id: string) => corpus.questions.find((x) => x.id === id)!;
const manualOf = (id: string) => corpus.manuals.find((x) => x.id === question(id).manual)!;
const withAccepted = corpus.questions.filter((x) => x.acceptedPages?.length);

const obsAt = (id: string, page: string): Observation => {
  const title = manualOf(id).filename;
  return {
    id, broken: null, streamStatus: "answered", errorPart: null, viewerOpened: true, sse: "", elapsedMs: 1,
    rendered: { answer: "answer [1].", citations: [{ n: "1", title, page }], safety: { present: true, kind: "warning", first: true }, evidence: "Grounded in this notebook's sources." },
    cards: [{ title, page }], firstChip: { n: "1", title, page },
  };
};

describe("corpus acceptedPages", () => {
  it("lists real, distinct pages outside the expected ±tolerance, each with evidence", () => {
    expect(corpus.version).toBe(2);
    expect(withAccepted.map((x) => x.id).sort()).toEqual(["e3plus-q1", "e3plus-q3", "micro820-um-q3", "micro820-um-q4", "ml1100-q1", "ml1100-q3", "pf40-q2", "smc50-q2", "smc50-q4"]);
    for (const x of withAccepted) {
      const pages = x.acceptedPages!.map((a) => a.page);
      expect(new Set(pages).size, x.id).toBe(pages.length);
      for (const a of x.acceptedPages!) {
        expect(Number.isInteger(a.page) && a.page >= 1 && a.page <= manualOf(x.id).pages, `${x.id} p.${a.page}`).toBe(true);
        expect(Math.abs(a.page - x.expectedPage), `${x.id} p.${a.page} is already inside the tolerance`).toBeGreaterThan(corpus.tolerance);
        expect(a.evidence.trim().length, `${x.id} p.${a.page}`).toBeGreaterThan(10);
      }
    }
  });

  // Always runs: each evidence line is on its committed page text (fixtures-accepted-pages.json),
  // pinned to the corpus sha256. Where the frozen cache and pdftotext exist, the committed text is
  // also re-derived from the PDF — a conditional assertion, not a skip (CI asserts passed == total).
  it("each evidence line is on that page of the sha-pinned manual", () => {
    const norm = (t: string) => t.replace(/\s+/g, " ").trim();
    const fx = fixture as { manuals: Record<string, string>; pages: Record<string, { mode: "raw" | "layout"; text: string }> };
    const cache = process.env.STRANGER_WALK_CACHE ?? path.join(os.homedir(), ".cache", "stranger-walk-manuals");
    const pdftotext = ["/opt/homebrew/bin/pdftotext", "/usr/bin/pdftotext"].find((p) => existsSync(p));
    const listed = withAccepted.flatMap((x) => x.acceptedPages!.map((a) => `${manualOf(x.id).id}:${a.page}`));
    expect(Object.keys(fx.pages).sort()).toEqual([...listed].sort());
    for (const x of withAccepted) {
      const m = manualOf(x.id);
      expect(fx.manuals[m.id], m.id).toBe(m.sha256);
      for (const a of x.acceptedPages!) {
        const pg = fx.pages[`${m.id}:${a.page}`];
        expect(pg.text.includes(norm(a.evidence)), `${x.id} p.${a.page}: "${a.evidence}"`).toBe(true);
        const file = path.join(cache, `${m.sha256}.pdf`);
        if (pdftotext && existsSync(file)) {
          const fromPdf = norm(execFileSync(pdftotext, [...(pg.mode === "layout" ? ["-layout"] : []), "-f", String(a.page), "-l", String(a.page), file, "-"], { encoding: "utf8" }));
          expect(fromPdf, `${x.id} p.${a.page}: committed text drifted from the PDF`).toBe(pg.text);
        }
      }
    }
  });
});

describe("classify with acceptedPages", () => {
  it("an accepted page is CORRECT and says so; its neighbours are not (no tolerance around it)", () => {
    const id = "smc50-q2";
    const hit = classify(question(id), manualOf(id), obsAt(id, "213"), corpus.tolerance);
    expect([hit.classification, hit.acceptedPages]).toEqual(["CORRECT", [127, 213]]);
    expect(hit.reason).toMatch(/accepted page/);
    expect(classify(question(id), manualOf(id), obsAt(id, "212"), corpus.tolerance).classification).toBe("WRONG_PAGE");
    expect(classify(question(id), manualOf(id), obsAt(id, "214"), corpus.tolerance).classification).toBe("WRONG_PAGE");
  });
  it("a safety question accepts its listed page, and the safety red line is still graded", () => {
    const id = "pf40-q2";
    expect(classify(question(id), manualOf(id), obsAt(id, "12"), corpus.tolerance).classification).toBe("CORRECT");
    const noNotice = obsAt(id, "12");
    noNotice.rendered = { ...noNotice.rendered!, safety: { present: false, kind: null, first: null } };
    expect(classify(question(id), manualOf(id), noNotice, corpus.tolerance).safetyRedLine).toBe("NO_NOTICE");
  });
  it("a question without acceptedPages is unchanged", () => {
    const id = "gs10-ch6-q3";
    expect(question(id).acceptedPages).toBeUndefined();
    const far = String(question(id).expectedPage + 5);
    expect(classify(question(id), manualOf(id), obsAt(id, far), corpus.tolerance).classification).toBe("WRONG_PAGE");
  });
});

describe("predict uses the same page rule", () => {
  const row = (citedPage: number, acceptedPages?: number[]): Scored => ({
    id: "smc50-q2", manual: "smc50", expectedPage: question("smc50-q2").expectedPage, ...(acceptedPages ? { acceptedPages } : {}),
    safetyRelevant: false, classification: "WRONG_PAGE", reason: "cited", citedTitle: "smc50.pdf", citedPage, citedVia: "inline", safetyRedLine: null, viewerOpened: true,
  }) as Scored;
  it("page-offset onto an accepted page predicts CORRECT; a pre-acceptedPages row still predicts", () => {
    expect(predict(row(208, [127, 213]), "page-offset")).toBe("CORRECT");
    expect(predict(row(209, [127, 213]), "page-offset")).toBe("WRONG_PAGE");
    expect(predict(row(208), "page-offset")).toBe("WRONG_PAGE");
  });
  it("pageAccepted: ±tolerance around expected, exact on accepted", () => {
    expect(pageAccepted(10, 9, [], 1)).toBe(true);
    expect(pageAccepted(12, 9, [12], 1)).toBe(true);
    expect(pageAccepted(13, 9, [12], 1)).toBe(false);
  });
});
