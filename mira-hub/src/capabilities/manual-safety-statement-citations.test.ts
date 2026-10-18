/**
 * #4508 — only the pages an answer CITES can carry its manual safety notice.
 *
 * Run: npx vitest run src/capabilities/manual-safety-statement-citations.test.ts
 */
import { describe, expect, it } from "vitest";
import { extractManualSafetyStatement, manualSafetyStatementForCitations } from "./manual-safety-statement";

const WARN = "WARNING: Hazardous voltage. Disconnect power before servicing the drive.";
const CAUTION = "CAUTION: Hot surfaces can cause burns. Allow the heatsink to cool.";
const PLAIN = "Parameter P01 sets the acceleration time in seconds.";

const page = (sourcePage: number, content: string) => ({ content, sourceUrl: "m.pdf", sourcePage });
const cite = (citationId: string, p: number) => ({ citationId, docId: "", sourceTitle: "Manual", page: p });

describe("manualSafetyStatementForCitations", () => {
  it("precondition: both statement pages extract alone, the plain page does not", () => {
    expect(extractManualSafetyStatement(WARN)?.marker).toBe("WARNING");
    expect(extractManualSafetyStatement(CAUTION)?.marker).toBe("CAUTION");
    expect(extractManualSafetyStatement(PLAIN)).toBeNull();
  });

  it("reads only cited pages: an uncited statement page is ignored", () => {
    const chunks = [page(1, PLAIN), page(2, WARN)];
    expect(manualSafetyStatementForCitations([cite("1", 1)], chunks)).toBeNull();
    expect(manualSafetyStatementForCitations([cite("2", 2)], chunks)).toMatchObject({ marker: "WARNING", sourceCitationId: "2", page: 2 });
  });

  it("no citations → null", () => {
    expect(manualSafetyStatementForCitations([], [page(1, WARN)])).toBeNull();
  });

  it("first hit in ascending citation order wins, whatever order the citations arrive in", () => {
    const chunks = [page(1, CAUTION), page(2, WARN)];
    expect(manualSafetyStatementForCitations([cite("2", 2), cite("1", 1)], chunks)).toMatchObject({ marker: "CAUTION", sourceCitationId: "1" });
  });

  it("groups chunks per page like buildCitations: a statement in the page's second chunk still counts", () => {
    const chunks = [page(1, PLAIN), page(1, WARN), page(2, PLAIN)];
    expect(manualSafetyStatementForCitations([cite("1", 1)], chunks)).toMatchObject({ marker: "WARNING", sourceCitationId: "1", page: 1 });
    expect(manualSafetyStatementForCitations([cite("2", 2)], chunks)).toBeNull();
  });
});

describe("extractManualSafetyStatement — ABB's 'WARNING!' form (real ACS355 text)", () => {
  // `pdftotext -layout` of the ACS355 user manual's Electrical safety page (Stranger Walk acs355-q2).
  const ACS355_SAFETY =
    " Electrical safety\n\n" +
    "        WARNING! Ignoring the following instructions can cause physical injury or\n" +
    "        death, or damage to the equipment.\n" +
    "Only qualified electricians are allowed to install and maintain the drive!";

  it("extracts the statement after 'WARNING!' without the exclamation mark", () => {
    const hit = extractManualSafetyStatement(ACS355_SAFETY);
    expect(hit?.marker).toBe("WARNING");
    expect(hit?.statement).toMatch(/^Ignoring the following instructions can cause physical injury or death/);
  });

  it("control: 'WARNINGS' (a word, not the marker) does not match", () => {
    expect(extractManualSafetyStatement("See the WARNINGS section of chapter 2 for details.")).toBeNull();
  });
});

describe("the rest of a cited page (#4509 Codex r2 F1)", () => {
  it("a warning in the 250th chunk of a large cited page is still found", () => {
    const rest = [...Array.from({ length: 249 }, () => page(1, PLAIN)), page(1, WARN)];
    expect(manualSafetyStatementForCitations([cite("1", 1)], [page(1, PLAIN)], rest)).toMatchObject({ marker: "WARNING", page: 1 });
  });
});
