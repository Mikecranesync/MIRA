import { describe, it, expect, vi } from "vitest";
import { normalizeScreenTextLines, loadScreenTextLines, MAX_SCREEN_LINES, MAX_SCREEN_LINE_CHARS } from "./screen-text";

describe("normalizeScreenTextLines", () => {
  it("keeps verbatim lines, trims them, and drops blanks", () => {
    expect(normalizeScreenTextLines(["  Error: Wire break on Output channel 3 ", "", "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2."]))
      .toEqual(["Error: Wire break on Output channel 3", "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2."]);
  });
  it("never completes a cut-off field", () => {
    expect(normalizeScreenTextLines(["40 08:14:3… 03/02/2027 I"])).toEqual(["40 08:14:3… 03/02/2027 I"]);
  });
  it("returns [] for anything that is not an array of strings", () => {
    expect(normalizeScreenTextLines(undefined)).toEqual([]);
    expect(normalizeScreenTextLines("Error: x")).toEqual([]);
    expect(normalizeScreenTextLines([1, null, { a: 1 }])).toEqual([]);
  });
  it("caps line count and line length", () => {
    const many = Array.from({ length: MAX_SCREEN_LINES + 5 }, (_, i) => `line ${i}`);
    expect(normalizeScreenTextLines(many)).toHaveLength(MAX_SCREEN_LINES);
    const capped = normalizeScreenTextLines(["x".repeat(MAX_SCREEN_LINE_CHARS + 50)])[0];
    expect(capped).toHaveLength(MAX_SCREEN_LINE_CHARS);
    expect(capped.endsWith("…")).toBe(true); // cut by the cap = cut off, never "complete"
  });
  it("control: a line exactly at the cap is stored unchanged", () => {
    const exact = "y".repeat(MAX_SCREEN_LINE_CHARS);
    expect(normalizeScreenTextLines([exact])[0]).toBe(exact);
  });
  it("strips control characters", () => {
    expect(normalizeScreenTextLines(["Error:\u0007 Wire break"])).toEqual(["Error: Wire break"]);
  });
});

describe("loadScreenTextLines", () => {
  it("reads the lines stored on the LOOK row's own evidence item, tenant-scoped", async () => {
    const query = vi.fn(async () => ({ rows: [{ lines: ["Error: Wire break on Output channel 3"] }] }));
    const out = await loadScreenTextLines({ query } as never, "tenant-1", "11111111-2222-3333-4444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(out).toEqual(["Error: Wire break on Output channel 3"]);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/tenant_id = \$1/);
    expect(sql).toMatch(/session_id = \$2::uuid/);
    // Newest row that HAS lines — a later row without them must not hide them (review #4389 r4).
    expect(sql).toMatch(/capture_meta \? 'screen_text_lines'/);
    // Bound to THIS photo, not just its session — another photo's text can never be read as this one's.
    expect(sql).toMatch(/capture_meta->>'file_id' = \$3/);
    expect(params).toEqual(["tenant-1", "11111111-2222-3333-4444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]);
  });
  it("returns null for a non-UUID session without querying", async () => {
    const query = vi.fn();
    expect(await loadScreenTextLines({ query } as never, "tenant-1", "not-a-uuid", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
  it("returns null for a non-UUID file id without querying", async () => {
    const query = vi.fn();
    expect(await loadScreenTextLines({ query } as never, "tenant-1", "11111111-2222-3333-4444-555555555555", "nope")).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
  it("returns null when no lines are stored", async () => {
    const query = vi.fn(async () => ({ rows: [{ lines: null }] }));
    expect(await loadScreenTextLines({ query } as never, "tenant-1", "11111111-2222-3333-4444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBeNull();
  });
});
