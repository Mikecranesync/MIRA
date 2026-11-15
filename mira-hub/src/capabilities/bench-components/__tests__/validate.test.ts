/**
 * The revision body a caller sends: a photo-file id is refused until a photo
 * path checks the file belongs to the caller's tenant (the column's foreign key
 * is checked across tenants, so accepting an id would answer "does this upload
 * exist" for anyone's file).
 *
 * Run: npx vitest run src/capabilities/bench-components/__tests__/validate.test.ts
 */
import { describe, expect, it } from "vitest";
import { readRevisionInput } from "../validate";

const typed = { rawLabel: "GS11N-20P2", inputKind: "typed", catalogNumber: "GS11N-20P2" };

describe("readRevisionInput — evidence file", () => {
  it("a caller-supplied photo-file id is refused", () => {
    expect(readRevisionInput({ ...typed, evidenceFileId: "33333333-3333-4333-8333-333333333333" }, false)).toEqual({
      error: "evidence_file_id_unsupported",
    });
  });

  it("control: the same observation without one is read, with no file linked", () => {
    for (const body of [typed, { ...typed, evidenceFileId: null }]) {
      const read = readRevisionInput(body, false);
      if ("error" in read) throw new Error(read.error);
      expect(read.catalogNumber).toBe("GS11N-20P2");
      expect(read.evidenceFileId).toBeNull();
    }
  });
});
