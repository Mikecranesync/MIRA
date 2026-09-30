import { describe, expect, it } from "vitest";
import { PHOTO_PROVENANCE_NOTE, withPhotoProvenance } from "./photo-provenance";

describe("#4143 withPhotoProvenance", () => {
  it("appends the note when a photo observation is in context", () => {
    expect(withPhotoProvenance("SYS", "## Earlier photo\n- SIEMENS TP700 Comfort")).toBe(`SYS\n\n${PHOTO_PROVENANCE_NOTE}`);
  });
  it("leaves the prompt byte-identical with no photo context", () => {
    expect(withPhotoProvenance("SYS", "")).toBe("SYS");
    expect(withPhotoProvenance("SYS", "  \n ")).toBe("SYS");
  });
  it("asks for a verbatim quote and forbids an inferred device type", () => {
    expect(PHOTO_PROVENANCE_NOTE).toMatch(/quoting the exact text you read/);
    expect(PHOTO_PROVENANCE_NOTE).toMatch(/Name the device type .* only if the label or the photo observation names it/);
  });
  it("teaches no real product and no voltage number (would leak into answers / read as a rating)", () => {
    expect(PHOTO_PROVENANCE_NOTE).not.toMatch(/TP700|6AV2|MG17|32906|SIEMENS/i);
    expect(PHOTO_PROVENANCE_NOTE).not.toMatch(/\d\s*V\b/);
  });
});
