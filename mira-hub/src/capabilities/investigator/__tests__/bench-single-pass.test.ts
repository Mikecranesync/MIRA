/**
 * Tests for `tools/investigator/single_pass.ts` (BENCH-A lane). See
 * `bench-openai-model.test.ts` for why these live here instead of under
 * `tools/investigator/`.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BASE_SYSTEM_PROMPT,
  GENERAL_SYSTEM_PROMPT,
} from "@/app/api/equipment-notebooks/[id]/chat/route";
import type { ManualChunk } from "@/lib/manual-rag";
import type { EvidenceItem } from "@/capabilities/investigator/types";
import {
  PRODUCTION_TOPK,
  chunksToEvidenceItems,
  defaultPostCheck,
  liftSystemPrompt,
} from "../../../../../tools/investigator/single_pass";

describe("liftSystemPrompt", () => {
  it("docGrounded=true returns the LIVE BASE_SYSTEM_PROMPT, byte-identical, with its real path:line", () => {
    const lifted = liftSystemPrompt(true);
    expect(lifted.text).toBe(BASE_SYSTEM_PROMPT);
    expect(lifted.sha256).toBe(createHash("sha256").update(BASE_SYSTEM_PROMPT).digest("hex"));
    expect(lifted.sourcePath).toBe("mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts");
    expect(lifted.sourceLine).toBe(325);
  });

  it("docGrounded=false returns the LIVE GENERAL_SYSTEM_PROMPT, byte-identical, with its real path:line", () => {
    const lifted = liftSystemPrompt(false);
    expect(lifted.text).toBe(GENERAL_SYSTEM_PROMPT);
    expect(lifted.sha256).toBe(createHash("sha256").update(GENERAL_SYSTEM_PROMPT).digest("hex"));
    expect(lifted.sourceLine).toBe(411);
  });
});

describe("PRODUCTION_TOPK", () => {
  it("matches the route's main retrieveNodeChunks call site (route.ts:2481, topK: 6)", () => {
    expect(PRODUCTION_TOPK).toBe(6);
  });
});

describe("chunksToEvidenceItems", () => {
  it("maps ManualChunk fields onto the shared EvidenceItem contract", () => {
    const chunk: ManualChunk = {
      content: "Fault F004 means ground fault.",
      docId: "doc-1",
      manufacturer: "AutomationDirect",
      modelNumber: "GS10",
      sourceUrl: "node-doc/doc-1/gs10.pdf",
      sourcePage: 42,
      title: "GS10 manual",
      rank: 1,
    };
    const items = chunksToEvidenceItems([chunk]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: "manual",
      docId: "doc-1",
      title: "GS10 manual",
      page: 42,
      text: "Fault F004 means ground fault.",
      toolCallIndex: 0,
    });
    expect(items[0].id).toContain("doc-1");
  });
});

describe("defaultPostCheck (wired to CORE's grounding.ts)", () => {
  it("flags an unsafe bypass-near-safety-target phrase", () => {
    const evidence: EvidenceItem[] = [];
    const { unsafePhrases } = defaultPostCheck("Bypass the interlock to continue running.", evidence);
    expect(unsafePhrases.length).toBeGreaterThan(0);
  });

  it("does not flag an ordinary grounded answer", () => {
    const evidence: EvidenceItem[] = [
      { id: "e1", source: "manual", docId: "d1", title: "t", page: 1, text: "Normal operating current is 620V.", toolCallIndex: 0 },
    ];
    const { unsafePhrases, ungroundedNumbers } = defaultPostCheck("Normal operating current is 620V.", evidence);
    expect(unsafePhrases).toEqual([]);
    expect(ungroundedNumbers).toEqual([]);
  });

  it("flags a number in the answer that is not present in any evidence text", () => {
    const evidence: EvidenceItem[] = [
      { id: "e1", source: "manual", docId: "d1", title: "t", page: 1, text: "Normal operating current is 620V.", toolCallIndex: 0 },
    ];
    const { ungroundedNumbers } = defaultPostCheck("The bus voltage should read 650V.", evidence);
    expect(ungroundedNumbers.length).toBeGreaterThan(0);
  });
});

/**
 * MUTATION CHECK:
 *
 * Mutated `single_pass.ts`'s `BASE_SYSTEM_PROMPT_LINE` constant from `325` to
 * `999`. Named test that failed: "docGrounded=true returns the LIVE
 * BASE_SYSTEM_PROMPT, byte-identical, with its real path:line" (assertion
 * `expect(lifted.sourceLine).toBe(325)` → `expected 999 to be 325`). Restored
 * the constant to `325` and reran — test passed again.
 */
