import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseBundle } from "./bundle-import";
import { readZipEntries } from "./unzip";

const manifest = JSON.stringify({
  schema: "mira-contextualizer/bundle@1",
  project: { name: "Conveyor Line 1", description: "May demo" },
  sources: [
    { file: "conveyor.L5X", type: "l5x", status: "done" },
    { file: "gs10.pdf", type: "manual", status: "done" },
  ],
});
const review = JSON.stringify({
  schema: "mira-contextualizer/review@1",
  decisions: [
    { tag: "Conv_Run", roles: ["output"], status: "accepted", confidence: 0.9,
      unsPath: "enterprise/site/area/line/cv/run", source: "conveyor.L5X", evidence: { x: 1 } },
    { tag: "F0004", roles: ["fault_code"], status: "pending", confidence: 0.6,
      unsPath: null, source: "gs10.pdf", evidence: { mentions: [] } },
    { tag: "", roles: [], status: "pending" }, // dropped (no tag)
  ],
});

describe("parseBundle", () => {
  it("parses manifest + review into normalized rows", () => {
    const b = parseBundle({ "manifest.json": manifest, "review.json": review });
    expect(b.projectName).toBe("Conveyor Line 1");
    expect(b.description).toBe("May demo");
    expect(b.sources).toHaveLength(2);
    expect(b.sources[1]).toEqual({ fileName: "gs10.pdf", sourceType: "manual", status: "done" });
    expect(b.extractions).toHaveLength(2); // empty-tag decision dropped
    const run = b.extractions[0];
    expect(run.tagName).toBe("Conv_Run");
    expect(run.status).toBe("accepted");
    expect(run.unsPathProposed).toBe("enterprise/site/area/line/cv/run");
    expect(run.sourceFile).toBe("conveyor.L5X");
  });

  it("rejects a non-bundle manifest", () => {
    expect(() => parseBundle({ "manifest.json": JSON.stringify({ schema: "something/else" }), "review.json": "{}" }))
      .toThrow(/not a Factory Context Bundle/);
  });

  it("throws when a required file is missing", () => {
    expect(() => parseBundle({ "manifest.json": manifest })).toThrow(/missing review.json/);
  });

  it("coerces unknown source types and statuses to safe defaults", () => {
    const m = JSON.stringify({ schema: "mira-contextualizer/bundle@1", project: {},
      sources: [{ file: "x", type: "weird", status: "??" }] });
    const r = JSON.stringify({ decisions: [{ tag: "T", status: "bogus" }] });
    const b = parseBundle({ "manifest.json": m, "review.json": r });
    expect(b.projectName).toBe("Imported project");
    expect(b.sources[0].sourceType).toBe("other");
    expect(b.extractions[0].status).toBe("pending");
  });
});

function makeZipEntry(name: string, content: string): Buffer {
  const data = deflateRawSync(Buffer.from(content, "utf-8"));
  const nameBuf = Buffer.from(name, "utf-8");
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(0, 6);
  h.writeUInt16LE(8, 8); // deflate
  h.writeUInt32LE(data.length, 18);
  h.writeUInt32LE(content.length, 22);
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28);
  return Buffer.concat([h, nameBuf, data]);
}

describe("readZipEntries", () => {
  it("reads deflated entries and round-trips through parseBundle", () => {
    const zip = Buffer.concat([
      makeZipEntry("manifest.json", manifest),
      makeZipEntry("review.json", review),
    ]);
    const entries = readZipEntries(zip);
    expect(Object.keys(entries).sort()).toEqual(["manifest.json", "review.json"]);
    const files: Record<string, string> = {};
    for (const [k, v] of Object.entries(entries)) files[k] = v.toString("utf-8");
    expect(parseBundle(files).projectName).toBe("Conveyor Line 1");
  });
});
