import { describe, it, expect } from "vitest";
import * as mod from "../photo-source-honesty";
import {
  isPhotoSource,
  photoSourcesInScope,
  photoSourceDirective,
  photoTurnObservation,
} from "../photo-source-honesty";

/** The production shape: `nameplate/confirm/route.ts` inserts the extracted-text
 *  doc with sourceRole "photo" AND originFileId pointing at the photo file. */
const nameplateRow = (docId: string, filename = `nameplate-${docId}.txt`) => ({
  docId,
  filename,
  sourceRole: "photo",
  originFileId: `file-${docId}`,
});

const pdfRow = (docId: string, filename = "RCMS460-490_D00067_Q_DEEN.pdf") => ({
  docId,
  filename,
  sourceRole: null,
  originFileId: null,
});

describe("isPhotoSource — the discriminator matches what the Sources sheet shows", () => {
  it("a confirmed nameplate row is photo-derived", () => {
    expect(isPhotoSource(nameplateRow("a"))).toBe(true);
  });

  it("an ordinary uploaded PDF is not", () => {
    expect(isPhotoSource(pdfRow("b"))).toBe(false);
  });

  it("originFileId alone counts — the sheet draws a thumbnail from it", () => {
    expect(isPhotoSource({ sourceRole: null, originFileId: "file-x" })).toBe(true);
  });

  it("sourceRole alone counts — the sheet prints the '· photo' label from it", () => {
    expect(isPhotoSource({ sourceRole: "photo", originFileId: null })).toBe(true);
  });

  // Regression: `!== null` is true for `undefined`, which would arm the module
  // on every row that merely omits the column.
  it("an ABSENT originFileId is not evidence of a picture", () => {
    expect(isPhotoSource({ sourceRole: null } as unknown as { sourceRole: string | null; originFileId: string | null })).toBe(
      false,
    );
  });
});

describe("photoSourcesInScope — proof, scoped to this turn", () => {
  it("returns only rows in the turn's revalidated docIds", () => {
    const srcs = [nameplateRow("a"), nameplateRow("b"), pdfRow("c")];
    expect(photoSourcesInScope(srcs, ["a", "c"]).map((s) => s.docId)).toEqual(["a"]);
  });

  it("a picture the technician UNCHECKED is attached but not in scope", () => {
    expect(photoSourcesInScope([nameplateRow("a")], [])).toEqual([]);
  });

  it("buckets a merely-derived row separately from a declared photograph", () => {
    const derived = { docId: "d", filename: "x.txt", sourceRole: null, originFileId: "file-d" };
    expect(photoSourcesInScope([nameplateRow("a"), derived], ["a", "d"]).map((s) => s.role)).toEqual([
      "photo",
      "derived",
    ]);
  });
});

describe("photoSourceDirective — the prompt-side statement of fact", () => {
  const scope = (n: number) => photoSourcesInScope(Array.from({ length: n }, (_, i) => nameplateRow(String(i))), Array.from({ length: n }, (_, i) => String(i)));

  // THE BYTE-IDENTITY LOCK: with no picture, the prompt must be exactly what it
  // was before this feature existed.
  it("returns EXACTLY the empty string when no picture is in scope", () => {
    expect(photoSourceDirective([])).toBe("");
  });

  it("names the falsehood the production defect actually uttered", () => {
    expect(photoSourceDirective(scope(2))).toContain("NEVER say that no photo was provided");
  });

  it("states the real limitation: the image is never in context", () => {
    expect(photoSourceDirective(scope(1))).toContain("cannot see, view, or zoom into the picture itself");
  });

  // The bullet that turns a refusal into an answer. Without it the model treats
  // the extraction as ordinary text and declines a question it could answer.
  it("tells the model the extracted text came from a VISION reader, so it searches it first", () => {
    const d = photoSourceDirective(scope(1));
    expect(d).toContain("produced by a vision reader looking at the photograph");
    expect(d).toContain("Search it before you decline");
  });

  it("prescribes answering from the extraction before declining", () => {
    expect(photoSourceDirective(scope(1))).toContain("Never answer by denying the photograph");
  });

  // The referent problem the server cannot solve is delegated to the model.
  it("tells the model to NAME what is attached rather than deny pictures in general", () => {
    expect(photoSourceDirective(scope(2))).toContain("name which pictures ARE attached");
  });

  it("distinguishes 'not selected for this chat' from 'not provided'", () => {
    const d = photoSourceDirective(scope(1), 3);
    expect(d).toContain("not selected for this chat");
    expect(d).toContain("never \"not provided\"");
  });

  it("omits the not-selected bullet when every attached picture is in scope", () => {
    expect(photoSourceDirective(scope(2), 2)).not.toContain("not selected for this chat");
  });

  it("keeps the anti-hallucination floor: never invent what a picture shows", () => {
    expect(photoSourceDirective(scope(1))).toContain("Never describe, summarize, or infer what a picture looks like");
  });

  // Round 2 was refuted for calling a .txt document "a photograph". The
  // directive describes the row as TEXT EXTRACTED FROM one.
  it("never calls the source document itself a photograph", () => {
    const d = photoSourceDirective(scope(2));
    expect(d).toContain("are text extracted from photographs");
    expect(d).not.toMatch(/\b2 of the source documents listed above are photographs\b/);
  });

  it("agrees in number for a single picture", () => {
    expect(photoSourceDirective(scope(1))).toContain("is text extracted from a photograph");
  });
});

describe("STRUCTURAL LOCKS — the two rejected designs cannot come back", () => {
  // Round 1 replaced sentences of the model's answer; round 2 appended
  // server-authored prose to it. Both were refuted. This asserts the module's
  // exact export surface, so re-adding any function that touches model text
  // fails loudly here rather than in review.
  it("exports exactly the proof + prior surface, and nothing that reads or writes model text", () => {
    expect(Object.keys(mod).sort()).toEqual(
      ["isPhotoSource", "photoSourceDirective", "photoSourcesInScope", "photoTurnObservation"].sort(),
    );
  });

  it("no export accepts an answer string and returns a modified answer string", () => {
    const answer = "No photo was provided. The nameplate lists 1.5 A at 460 V.";
    // The only string-producing export is the directive, which never sees the
    // answer at all — it takes source rows.
    expect(photoSourceDirective([])).toBe("");
    // Nothing in the module can be handed the answer; assert the shape rather
    // than trusting the comment.
    for (const fn of Object.values(mod)) {
      if (typeof fn !== "function") continue;
      const out = (() => {
        try {
          return (fn as (x: unknown) => unknown)(answer);
        } catch {
          return undefined;
        }
      })();
      expect(out).not.toBe(answer);
      if (typeof out === "string") expect(answer.includes(out) && out.length > 0).toBe(false);
    }
  });
});

describe("photoTurnObservation — the denominator", () => {
  it("emits a structured, greppable event with no free text", () => {
    const o = photoTurnObservation({
      tenantId: "t",
      notebookId: "n",
      photosAttached: 2,
      photosInScope: 2,
      answerStatus: "answered",
      citationCount: 1,
      general: false,
    });
    expect(o.event).toBe("photo.turn");
    expect(o.component).toBe("notebook-chat");
    expect(o.photosAttached).toBe(2);
    // No question, no answer — those already live in equipment_notebook_turns.
    expect(JSON.stringify(o)).not.toMatch(/question|answer_text|content/i);
  });
});
