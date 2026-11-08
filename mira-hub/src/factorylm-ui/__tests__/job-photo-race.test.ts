/**
 * Codex adversarial review round 1 on PR #5173 @ 97c0516bf, finding F5: a photo that finishes
 * decoding after the technician recorded other work is added to the LATEST record, so that work
 * is kept; a photo that finishes after the packet changed is dropped, not written over it.
 * Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/job-photo-race
 */
import { describe, expect, it } from "vitest";
import { addNote, emptyRecord, recordMeasurement, type JobRecord } from "@/capabilities/work-packet/job-record";
import { addPhotoWhenDecoded } from "../JobRecordView";

const IMG = "data:image/jpeg;base64,AAAA";
const T = "2026-11-04T12:00:00.000Z";

function deferred() {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => { resolve = r; });
  return { promise, resolve };
}

const photo = (image: string) => ({ id: "ph1", image, caption: "", stepIndex: null, by: "T", at: T });

describe("F5 — a photo decoded late does not overwrite work recorded meanwhile", () => {
  it("keeps the issue and measurement recorded while the photo was decoding", async () => {
    let latest: JobRecord = emptyRecord("pk");
    const d = deferred();
    const pending = addPhotoWhenDecoded(() => d.promise, () => latest, "pk", photo);
    latest = addNote(latest, { id: "n1", kind: "issue", text: "Seal kit not in stores", stepIndex: null, by: "T", at: T, resolved: false });
    latest = recordMeasurement(latest, 0, "40 ft-lbs", "T", T);
    d.resolve(IMG);
    const next = await pending;
    expect(next).not.toBeNull();
    expect(next!.notes.map((n) => n.id)).toEqual(["n1"]);
    expect(next!.measurements[0]?.value).toBe("40 ft-lbs");
    expect(next!.photos.map((p) => p.id)).toEqual(["ph1"]);
  });

  it("drops the photo when the packet changed while it was decoding", async () => {
    let latest: JobRecord | null = emptyRecord("pk");
    const d = deferred();
    const pending = addPhotoWhenDecoded(() => d.promise, () => latest, "pk", photo);
    latest = emptyRecord("pk-other");
    d.resolve(IMG);
    expect(await pending).toBeNull();
  });

  it("control: with nothing recorded meanwhile the photo is simply added", async () => {
    const start = emptyRecord("pk");
    const next = await addPhotoWhenDecoded(async () => IMG, () => start, "pk", photo);
    expect(next!.photos).toHaveLength(1);
    expect(start.photos).toHaveLength(0);
  });
});
