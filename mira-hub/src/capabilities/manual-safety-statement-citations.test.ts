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


describe("operating cautions written as manual notes", () => {
  const ACCELERATION_CAUTION = "Note that setting the acceleration time too short may cause motor damage or trigger drive\nprotection due to over-current during the drive's acceleration.";
  const EARTH_FAULT_CAUTION = "Note: Disabling earth fault (ground\nfault) may damage drive.";

  it.each([
    [139, ACCELERATION_CAUTION, "motor damage"],
    [363, EARTH_FAULT_CAUTION, "may damage drive"],
  ])("carries the caution from cited PDF page %s", (p, caution, expected) => {
    expect(manualSafetyStatementForCitations([cite("1", p)], [page(p, PLAIN)], [page(p, caution)])).toMatchObject({
      marker: "CAUTION (manual text)",
      statement: expect.stringContaining(expected),
      sourceCitationId: "1",
      page: p,
    });
  });

  it("never lets an operating note mask an existing warning on either cited page", () => {
    const danger = "DANGER: Hazardous voltage. Isolate the power supply.";
    const chunks = [page(139, ACCELERATION_CAUTION), page(140, PLAIN)];
    expect(manualSafetyStatementForCitations([cite("1", 139)], chunks, [page(139, danger)]))
      .toMatchObject({ marker: "DANGER", sourceCitationId: "1", page: 139 });
    expect(manualSafetyStatementForCitations([cite("1", 139), cite("2", 140)], chunks, [page(140, danger)]))
      .toMatchObject({ marker: "DANGER", sourceCitationId: "2", page: 140 });
  });

  it("preserves a complete condition with a dotted parameter and decimal threshold", () => {
    const condition = "Disabling earth fault (ground fault) may damage drive if parameter P1.02 exceeds 1.5 amps.";
    const chunks = [page(363, `Note: ${condition} See the next chapter.`)];
    expect(manualSafetyStatementForCitations([cite("1", 363)], chunks)).toMatchObject({ statement: condition });
    expect(manualSafetyStatementForCitations([cite("1", 363)], [page(363, `Note: ${condition.split(".02")[0]}.`)])).toBeNull();
    const abbreviated = "Disabling earth fault (ground fault) may damage drive if voltage exceeds approx. 50 V.";
    expect(manualSafetyStatementForCitations([cite("1", 363)], [page(363, `Note: ${abbreviated} See the appendix.`)]))
      .toMatchObject({ statement: abbreviated });
    expect(manualSafetyStatementForCitations([cite("1", 363)], [
      page(363, "Note: Disabling earth fault (ground fault) may damage drive if P1."),
    ])).toBeNull();
  });

  it.each([
    "Disabling earth fault (ground fault) may damage drive if the a.c. supply exceeds 230 V.",
    "Disabling earth fault (ground fault) may damage drive if the d.c. limit is exceeded.",
    "Disabling earth fault (ground fault) may damage drive if the a. c. supply exceeds 230 V.",
    "Disabling earth fault (ground fault) may damage drive unless wired as shown in Fig. 4.",
  ])("keeps the complete cited condition %s", (condition) => {
    const chunks = [page(363, `Note: ${condition} See the next chapter for dimensions.`)];
    expect(manualSafetyStatementForCitations([cite("1", 363)], chunks)).toMatchObject({ statement: condition });
  });

  it.each(["if the a.", "if the a.c.", "if the a.c. See the next chapter.", "unless wired as shown in Fig."])(
    "omits an ambiguous or truncated cited condition ending %s",
    (condition) => {
      const content = `Note: Disabling earth fault (ground fault) may damage drive ${condition}`;
      expect(manualSafetyStatementForCitations([cite("1", 363)], [page(363, content)])).toBeNull();
    },
  );

  it.each(["if a listed condition still needs verification", "rather than " + "waiting for the project review ".repeat(8)])(
    "keeps the later complete caution after an unpunctuated note (%s)",
    incomplete => {
      const truncated = `Note: Disabling earth fault (ground fault) may damage drive ${incomplete}`.trim();
      expect(manualSafetyStatementForCitations([cite("1", 139)], [page(139, truncated)])).toBeNull();
      const content = `${truncated}\n${ACCELERATION_CAUTION}`;
      expect(manualSafetyStatementForCitations([cite("1", 139)], [page(139, content)])).toMatchObject({
        marker: "CAUTION (manual text)",
        statement: "setting the acceleration time too short may cause motor damage or trigger drive protection due to over-current during the drive's acceleration.",
        sourceCitationId: "1",
        page: 139,
      });
    },
  );

  it("disregards a benign setting note and a caution on an uncited page", () => {
    expect(manualSafetyStatementForCitations([cite("1", 140)], [
      page(140, "Note that setting the acceleration time too short may trigger a message."),
      page(139, ACCELERATION_CAUTION),
    ])).toBeNull();
  });
});
