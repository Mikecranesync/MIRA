# Alarm Card, Slice 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A technician photographs an HMI alarm list and asks about it in an equipment notebook. MIRA answers with a deterministic alarm card covering RTD measurement alarms and fail-safe output wire break / passivation.

**Architecture:** LOOK's existing vision call also transcribes on-screen text verbatim, and the lines are stored in that photo's `evidence_item.capture_meta`. Pure TypeScript modules then group the lines into alarm records, parse them, look up versioned JSON family packs, and render a fixed-format card. The notebook chat route claims the turn through a read-only fast path that falls through on any miss. No model is in the card's path.

**Tech Stack:** Next.js route handlers (mira-hub), TypeScript, vitest, Postgres (Neon) via `withTenantContext`, JSON packs imported at build time.

**Spec:** `docs/superpowers/specs/2026-10-12-alarm-reasoning-design.md` (revision 2). Read it first. The plan argues from it.

## Global Constraints

- **Synthetic only.** No customer text or photos anywhere: not in code, tests, fixtures, commit messages, or PR bodies. Designations are invented with the same shape, e.g. `=y.CTL+07-K4.1-2.` Never send a customer photo to LOOK or to any cloud vision call.
- **Frozen paths (lifecycle guard).** Do not edit `mira-hub/src/lib/**` (that includes `visual-evidence-context.ts`), anything under `mira-hub/src/app/**/__tests__/`, or any non-TS/JSON file under `mira-hub/src/capabilities/**`. New backend code goes in `mira-hub/src/capabilities/`. Tests are co-located `*.test.ts` there or go under `mira-hub/src/capabilities/__tests__/`. The two route handlers (`look/route.ts`, `chat/route.ts`) are **not** frozen. Check a path with:
  `python3 -c "import importlib.util,sys;s=importlib.util.spec_from_file_location('g','tools/ui_surface_lifecycle_guard.py');g=importlib.util.module_from_spec(s);sys.modules['g']=g;s.loader.exec_module(g);p=g.load_guard_policy('docs/architecture/convergence/REGISTRY.yaml');print(g.path_is_guarded(sys.argv[1],p))" <path>`
- **Prove every test fails** (`.claude/rules/prove-the-test-fails.md`). For each new test, break the behaviour it names, watch *that* test go red, then restore it. Record the pass/fail counts both ways in the PR body.
- **The answer checker is never weakened.** `validateAnswer` (`mira-hub/src/capabilities/answer-validation.ts`) and `stepEnergyContradiction` (`mira-hub/src/capabilities/step-energy.ts`) are used as they are. If a card fails them, change the card.
- **Banned in pack text:** bypass, jumper, bridge out, force, override, substitute, simulate, reset, clear the alarm, acknowledge, reintegrate, depassivate, `ACK_REI`, disabling a diagnostic, parameterize off, changing hardware configuration / F-parameters, download, load / dummy / pull-down resistor (spec §6).
- **Site-procedure line**, verbatim and always last: `Anything that opens an enclosure or touches the circuit follows your site's lockout procedure with the equipment out of service.`
- **Spend:** one fidelity run with a declared $1.00 cap (Task 6). No other paid call in any task.
- **Commits:** Conventional Commits. Stage named paths only, never `git add -A`. End each message with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Bf8NAjQHkgCM8JefG1eHs3`.
- **Run tests from `mira-hub/`:** `npx vitest run <path>`. Typecheck with `npx tsc --noEmit -p .`.

## Branches and PRs

| PR | Branch (off fresh `origin/main`) | Tasks | Ships to users? |
|---|---|---|---|
| A | `fix/look-415-detected-type` | 0 | Log + response field only |
| B | `feat/alarm-card-slice1` | 1–4, 6a | No visible change (stores lines, adds unused modules, adds fidelity tooling) |
| C | `feat/alarm-card-fast-path` (on top of B once merged) | 5 | Yes — **stays draft until Task 6b passes** |

PR A lands first because it touches the same route file as Task 1. Each PR uses a fresh worktree under `.claude/worktrees/`, and the worktree is removed after its branch is pushed.

## File map

| File | New/Mod | Responsibility |
|---|---|---|
| `mira-hub/src/capabilities/image-format-sniff.ts` | new | Name an image format from its magic bytes (detection only) |
| `mira-hub/src/capabilities/screen-text.ts` | new | Normalize, store, and load `screen_text_lines` |
| `mira-hub/src/capabilities/alarm-line.ts` | new | Group visual lines into records; parse records |
| `mira-hub/src/capabilities/alarm-packs/rtd.v1.json` | new | RTD family pack |
| `mira-hub/src/capabilities/alarm-packs/fail-safe-output.v1.json` | new | Fail-safe output wire break + passivation pack |
| `mira-hub/src/capabilities/alarm-packs/loader.ts` | new | Validate packs, enforce the banned list, look up entries |
| `mira-hub/src/capabilities/alarm-card.ts` | new | Build the card text deterministically |
| `mira-hub/src/capabilities/alarm-fast-path.ts` | new | Turn-level trigger + evidence entry |
| `mira-hub/src/app/api/equipment-notebooks/[id]/look/route.ts` | mod | 415 logging (Task 0); prompt field + token cap + store lines (Task 1) |
| `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` | mod | Fast-path call (Task 5) |
| `tools/alarm-fidelity/alarm-page.html` | new | Synthetic alarm screen to photograph |
| `tools/alarm-fidelity/truth.json` | new | Ground truth for that page |
| `tools/alarm-fidelity/score.ts` | new | Score LOOK transcriptions on the three gate measures |
| `docs/runbooks/alarm-fidelity-capture.md` | new | Mike's capture run sheet |

---

### Task 0: Name the format the LOOK route rejects (PR A)

**Files:**
- Create: `mira-hub/src/capabilities/image-format-sniff.ts`
- Create: `mira-hub/src/capabilities/image-format-sniff.test.ts`
- Create: `mira-hub/src/capabilities/__tests__/look-unsupported-type.test.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/look/route.ts` (the `if (!mime)` block, currently lines 192–197)

**Interfaces:**
- Produces: `sniffImageFormat(bytes: Uint8Array): SniffedImageFormat`, where `SniffedImageFormat = "jpeg" | "png" | "gif" | "webp" | "heic" | "heif" | "avif" | "tiff" | "bmp" | "unknown"`. The 415 body gains `detected_type: SniffedImageFormat`.

- [ ] **Step 1: Write the failing unit test** — `mira-hub/src/capabilities/image-format-sniff.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { sniffImageFormat } from "./image-format-sniff";

const bytes = (...xs: number[]) => new Uint8Array(xs);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 0x18, ...ascii("ftyp"), ...ascii(brand), 0, 0, 0, 0]);

describe("sniffImageFormat", () => {
  it.each([
    ["jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)],
    ["png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ["gif", new Uint8Array(ascii("GIF89a"))],
    ["webp", new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")])],
    ["heic", ftyp("heic")],
    ["heic", ftyp("hevc")],
    ["heif", ftyp("mif1")],
    ["avif", ftyp("avif")],
    ["tiff", bytes(0x49, 0x49, 0x2a, 0x00)],
    ["tiff", bytes(0x4d, 0x4d, 0x00, 0x2a)],
    ["bmp", new Uint8Array([...ascii("BM"), 0, 0])],
  ] as const)("names %s", (format, input) => {
    expect(sniffImageFormat(input)).toBe(format);
  });

  it("says unknown for random bytes and for empty input", () => {
    expect(sniffImageFormat(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12))).toBe("unknown");
    expect(sniffImageFormat(new Uint8Array())).toBe("unknown");
  });

  it("does not call an ftyp box with a video brand an image (mp4 control)", () => {
    expect(sniffImageFormat(ftyp("isom"))).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mira-hub && npx vitest run src/capabilities/image-format-sniff.test.ts`
Expected: FAIL — `Failed to resolve import "./image-format-sniff"`.

- [ ] **Step 3: Implement** — `mira-hub/src/capabilities/image-format-sniff.ts`

```ts
/**
 * Name the format of an image the LOOK route rejected, so the 415 says what
 * the phone actually sent. 2026-10-12: a Pixel gallery pick got a 415 and
 * nothing recorded which format it was. Detection only — this never widens
 * what the route accepts; the allowlist stays in the route.
 */
export type SniffedImageFormat =
  | "jpeg" | "png" | "gif" | "webp" | "heic" | "heif" | "avif" | "tiff" | "bmp" | "unknown";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

function ascii(b: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...b.subarray(start, end));
}

export function sniffImageFormat(b: Uint8Array): SniffedImageFormat {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return "png";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "gif";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    if (AVIF_BRANDS.has(brand)) return "avif";
    if (HEIC_BRANDS.has(brand)) return "heic";
    if (HEIF_BRANDS.has(brand)) return "heif";
  }
  if (b.length >= 4 && b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) return "tiff";
  if (b.length >= 4 && b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a) return "tiff";
  if (b.length >= 2 && ascii(b, 0, 2) === "BM") return "bmp";
  return "unknown";
}
```

- [ ] **Step 4: Run the unit test** — Expected: PASS (13 tests).

- [ ] **Step 5: Write the failing route test** — `mira-hub/src/capabilities/__tests__/look-unsupported-type.test.ts`

Copy lines 12–123 of `mira-hub/src/app/api/equipment-notebooks/[id]/look/__tests__/look.test.ts` verbatim: the imports, every `vi.mock`, the constants, `makeParams`, `makeReq`, `armVision` and the `beforeEach`. Change one line: the route import becomes `import { POST } from "@/app/api/equipment-notebooks/[id]/look/route";`. Then append:

```ts
const HEIC = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);

describe("415 names the rejected format", () => {
  it("returns detected_type and logs declared + detected for a HEIC photo", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(makeReq({ content: HEIC, type: "image/heic", name: "IMG_0001.heic" }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toBe("unsupported_image_type");
    expect(body.detected_type).toBe("heic");
    expect(warn).toHaveBeenCalledWith(
      "[notebook-look] unsupported image type",
      expect.objectContaining({ declared: "image/heic", detected: "heic", bytes: HEIC.length }),
    );
    warn.mockRestore();
  });

  it("says unknown for bytes that are no known image, and the declared type is recorded as given", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(makeReq({ content: new Uint8Array(16).fill(7), type: "" }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(415);
    expect((await res.json()).detected_type).toBe("unknown");
    expect(warn).toHaveBeenCalledWith(
      "[notebook-look] unsupported image type",
      expect.objectContaining({ declared: "(none)", detected: "unknown" }),
    );
    warn.mockRestore();
  });

  it("control: a JPEG declared as octet-stream is still accepted", async () => {
    armVision("A grey enclosure.");
    const res = await POST(makeReq({ content: JPEG_MAGIC, type: "application/octet-stream" }), makeParams(NOTEBOOK_ID));
    expect(res.status).not.toBe(415);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd mira-hub && npx vitest run src/capabilities/__tests__/look-unsupported-type.test.ts`
Expected: the first two tests FAIL on `detected_type` (`undefined`); the control PASSES.

- [ ] **Step 7: Change the route.** Add `import { sniffImageFormat } from "@/capabilities/image-format-sniff";` beside the other `@/capabilities` imports, and replace the `if (!mime) { ... }` block with:

```ts
  if (!mime) {
    // 2026-10-12: a Pixel gallery pick got this 415 and nothing recorded which
    // format it was. Name it in the log and the body; the allowlist is unchanged.
    const detected = sniffImageFormat(buffer);
    console.warn("[notebook-look] unsupported image type", {
      declared: file.type || "(none)",
      detected,
      bytes: file.size,
    });
    return NextResponse.json(
      { error: "unsupported_image_type", message: "Send a JPEG, PNG, GIF, or WebP photo.", detected_type: detected },
      { status: 415 },
    );
  }
```

- [ ] **Step 8: Run both new files plus the existing LOOK suites** — Expected: all PASS.

Run: `cd mira-hub && npx vitest run src/capabilities/image-format-sniff.test.ts src/capabilities/__tests__/look-unsupported-type.test.ts "src/app/api/equipment-notebooks/[id]/look" src/app/api/equipment-notebooks/__tests__/look-flight-recorder.test.ts`

- [ ] **Step 9: Prove the route test fails for the right reason.** Temporarily remove `detected_type: detected,` from the route and re-run the route test. Expected: exactly the two `detected_type` tests fail. Restore the line. Record both counts.

- [ ] **Step 10: Typecheck, commit, push, open PR A**

```bash
cd mira-hub && npx tsc --noEmit -p . && cd ..
git add mira-hub/src/capabilities/image-format-sniff.ts mira-hub/src/capabilities/image-format-sniff.test.ts \
  mira-hub/src/capabilities/__tests__/look-unsupported-type.test.ts "mira-hub/src/app/api/equipment-notebooks/[id]/look/route.ts"
git commit -m "fix(hub): LOOK names the image format it rejects (log + 415 detected_type)"
```

---

### Task 1: LOOK transcribes screen text and stores it (PR B)

**Files:**
- Create: `mira-hub/src/capabilities/screen-text.ts`
- Create: `mira-hub/src/capabilities/screen-text.test.ts`
- Create: `mira-hub/src/capabilities/__tests__/look-screen-text.test.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/look/route.ts` (`INSPECTION_PROMPT`, `extractInspection`, `maxTokens`, the `recordLookObservation` block)

**Interfaces:**
- Produces:
  - `MAX_SCREEN_LINES = 80`, `MAX_SCREEN_LINE_CHARS = 200`
  - `normalizeScreenTextLines(raw: unknown): string[]`
  - `attachScreenTextLines(tenantId: string, evidenceId: string, lines: readonly string[]): Promise<boolean>` (true = row updated)
  - `loadScreenTextLines(c: QueryClient, tenantId: string, sessionId: string): Promise<string[] | null>`
- Consumes: `recordLookObservation(...)` returns `{ sessionId, evidenceId, observationId } | null` (existing); `withTenantContext` from `@/lib/tenant-context` (existing).

- [ ] **Step 1: Write the failing unit test** — `mira-hub/src/capabilities/screen-text.test.ts`

```ts
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
    expect(normalizeScreenTextLines(["x".repeat(MAX_SCREEN_LINE_CHARS + 50)])[0]).toHaveLength(MAX_SCREEN_LINE_CHARS);
  });
  it("strips control characters", () => {
    expect(normalizeScreenTextLines(["Error:\u0007 Wire break"])).toEqual(["Error: Wire break"]);
  });
});

describe("loadScreenTextLines", () => {
  it("reads the lines stored on the LOOK row's own evidence item, tenant-scoped", async () => {
    const query = vi.fn(async () => ({ rows: [{ lines: ["Error: Wire break on Output channel 3"] }] }));
    const out = await loadScreenTextLines({ query } as never, "tenant-1", "11111111-2222-3333-4444-555555555555");
    expect(out).toEqual(["Error: Wire break on Output channel 3"]);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/tenant_id = \$1/);
    expect(sql).toMatch(/session_id = \$2::uuid/);
    expect(params).toEqual(["tenant-1", "11111111-2222-3333-4444-555555555555"]);
  });
  it("returns null for a non-UUID session without querying", async () => {
    const query = vi.fn();
    expect(await loadScreenTextLines({ query } as never, "tenant-1", "not-a-uuid")).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
  it("returns null when no lines are stored", async () => {
    const query = vi.fn(async () => ({ rows: [{ lines: null }] }));
    expect(await loadScreenTextLines({ query } as never, "tenant-1", "11111111-2222-3333-4444-555555555555")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run src/capabilities/screen-text.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `mira-hub/src/capabilities/screen-text.ts`

```ts
/**
 * Verbatim on-screen text from a LOOK photo (spec 2026-10-12-alarm-reasoning-design.md §4).
 * Stored in the photo's own evidence_item.capture_meta as `screen_text_lines` — the
 * same JSONB where LOOK's hazards live — so a later turn reads it without re-sending
 * the photo to a model (materialized-evidence rules 1, 3, 14). Server-written only;
 * never accepted from a client. src/lib is frozen, so this lives here and merges
 * into the row recordLookObservation just inserted.
 */
import { withTenantContext } from "@/lib/tenant-context";

// Structural, like visual-evidence-context.ts: a pg PoolClient satisfies it.
type QueryClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};

export const MAX_SCREEN_LINES = 80;
export const MAX_SCREEN_LINE_CHARS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeScreenTextLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const line = item.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_SCREEN_LINE_CHARS);
    if (line) out.push(line);
    if (out.length >= MAX_SCREEN_LINES) break;
  }
  return out;
}

export async function attachScreenTextLines(
  tenantId: string,
  evidenceId: string,
  lines: readonly string[],
): Promise<boolean> {
  if (lines.length === 0 || !UUID_RE.test(evidenceId)) return false;
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `UPDATE evidence_item
          SET capture_meta = coalesce(capture_meta, '{}'::jsonb) || jsonb_build_object('screen_text_lines', $3::jsonb)
        WHERE tenant_id = $1 AND evidence_id = $2::uuid`,
      [tenantId, evidenceId, JSON.stringify(lines)],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

export async function loadScreenTextLines(
  c: QueryClient,
  tenantId: string,
  sessionId: string,
): Promise<string[] | null> {
  if (!UUID_RE.test(sessionId)) return null;
  const res = await c.query(
    `SELECT capture_meta->'screen_text_lines' AS lines
       FROM evidence_item
      WHERE tenant_id = $1 AND session_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId, sessionId],
  );
  const lines = normalizeScreenTextLines(res.rows[0]?.lines);
  return lines.length > 0 ? lines : null;
}
```

(`withTenantContext` is exported from `@/lib/tenant-context`; its callback receives a pg `PoolClient`, which satisfies the structural `QueryClient` above. Verified 2026-10-12.)

- [ ] **Step 4: Run the unit test** — Expected: PASS.

- [ ] **Step 5: Write the failing route test** — `mira-hub/src/capabilities/__tests__/look-screen-text.test.ts`

Copy the same harness as Task 0 Step 5 (lines 12–123 of `look.test.ts`, route import rewritten to `@/app/api/equipment-notebooks/[id]/look/route`, and also import `INSPECTION_PROMPT`). Add this mock **above** the route import:

```ts
vi.mock("@/capabilities/screen-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/screen-text")>()),
  attachScreenTextLines: vi.fn(async () => true),
}));
import { attachScreenTextLines } from "@/capabilities/screen-text";
```

Then append:

```ts
function armVisionJson(payload: Record<string, unknown>, model = "vision-test") {
  vi.mocked(togetherVisionCall).mockResolvedValue({ text: JSON.stringify(payload), model });
}

describe("LOOK stores verbatim screen text", () => {
  it("stores the normalized lines on the evidence row recordLookObservation returned", async () => {
    armVisionJson({
      observation: "An HMI screen showing a red alarm list.",
      hazards: [],
      screen_text_lines: ["40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 3", " =y.CTL+07-K4.1 / =y.CTL+07-K4.1-2. ", ""],
    });
    const res = await POST(makeReq({ content: JPEG_MAGIC }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    expect(attachScreenTextLines).toHaveBeenCalledWith(TENANT_ID, "evidence-1", [
      "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 3",
      "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.",
    ]);
    // The observation text is unchanged by the new field.
    expect((await res.json()).observation.text).toBe("An HMI screen showing a red alarm list.");
  });

  it("stores nothing when the photo shows no screen text", async () => {
    armVisionJson({ observation: "A motor.", hazards: [], screen_text_lines: [] });
    await POST(makeReq({ content: JPEG_MAGIC }), makeParams(NOTEBOOK_ID));
    expect(attachScreenTextLines).not.toHaveBeenCalled();
  });

  it("a failed line write never fails the LOOK turn", async () => {
    vi.mocked(attachScreenTextLines).mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    armVisionJson({ observation: "An HMI screen.", hazards: [], screen_text_lines: ["Error: x =y.CTL+07-K4.1-2."] });
    const res = await POST(makeReq({ content: JPEG_MAGIC }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    expect((await res.json()).observationPersisted).toBe(true);
    err.mockRestore();
  });

  it("asks for screen_text_lines, never completing cut-off text, with room for a full list", () => {
    expect(INSPECTION_PROMPT).toMatch(/"screen_text_lines": \[string\]/);
    expect(INSPECTION_PROMPT).toMatch(/never complete/i);
    expect(INSPECTION_PROMPT).toMatch(/NEVER diagnose/); // the observations-only contract is unchanged
  });

  it("gives the vision call room for a full alarm list", async () => {
    armVisionJson({ observation: "An HMI screen.", hazards: [], screen_text_lines: [] });
    await POST(makeReq({ content: JPEG_MAGIC }), makeParams(NOTEBOOK_ID));
    expect(vi.mocked(togetherVisionCall).mock.calls[0][0].maxTokens).toBe(1600);
  });
});
```

- [ ] **Step 6: Run it and watch it fail** — Expected: the first test FAILS (`attachScreenTextLines` not called), as do the prompt and `maxTokens` tests. The "nothing stored" test passes trivially; note that, because its proof is the mutation in Step 9.

- [ ] **Step 7: Change the route.**

(a) Add `import { attachScreenTextLines, normalizeScreenTextLines } from "@/capabilities/screen-text";`.

(b) In `INSPECTION_PROMPT`, replace the final line (`Respond ONLY with JSON: {"observation": string, "hazards": [...]}`) with these lines (template literal, keep the backtick at the end):

```
If the photo shows a screen, display, or printed alarm list, also transcribe its text into screen_text_lines:
- one entry per visual line, top to bottom, exactly as shown (keep spacing between columns as single spaces)
- characters you cannot read are written as "?"
- text that is cut off on the screen keeps its "…" or "..." exactly; never complete it and never guess the hidden characters
- an empty array when no screen or display text is visible
Respond ONLY with JSON: {"observation": string, "hazards": [{"code": "arcing" | "exposed_conductor" | "active_fire" | "smoke", "confidence": number}], "screen_text_lines": [string]}
```

(c) Change `extractInspection` to also return the lines:

```ts
function extractInspection(
  text: string,
): { text: string; hazards: LookHazardDescriptor[]; screenTextLines: string[] } | null {
  const parsed = safeJson(text);
  const fromJson = parsed && typeof parsed.observation === "string" ? parsed.observation : null;
  const value = (fromJson ?? text).trim();
  if (value.length === 0 || value === "{}") return null;
  return {
    text: value,
    hazards: normalizeLookHazards(parsed?.hazards),
    screenTextLines: normalizeScreenTextLines(parsed?.screen_text_lines),
  };
}
```

(d) In the `vision({...})` call change `maxTokens: 600` to `maxTokens: 1600`, and add the comment `// A full alarm list + the observation does not fit in 600; a cut-off JSON reply would lose the observation.`

(e) Replace the `try { await recordLookObservation({...}); observationPersisted = true; } catch ...` block with:

```ts
    let observationPersisted = false;
    let recorded: Awaited<ReturnType<typeof recordLookObservation>> = null;
    try {
      recorded = await recordLookObservation({
        tenantId: ctx.tenantId,
        ...(attachment.linkId ? { notebookId, threadId } : {}),
        fileId: parked.fileId,
        photoHash: sha256Hex(buffer),
        text: inspection.text,
        model: reply.model,
        hazards: inspection.hazards,
        capturedAt,
        createdBy: ctx.userId ?? null,
      });
      observationPersisted = true;
    } catch (err) {
      console.error("[notebook-look] observation persist failed (continuing):", err);
    }
    // Spec §4.2 — verbatim screen text rides on the same evidence row. Fail-open:
    // without lines the alarm card simply does not fire on a later turn.
    if (recorded && inspection.screenTextLines.length > 0) {
      try {
        await attachScreenTextLines(ctx.tenantId, recorded.evidenceId, inspection.screenTextLines);
      } catch (err) {
        console.error("[notebook-look] screen text persist failed (continuing):", err);
      }
    }
```

and add `"mira.vision.screen_lines": inspection.screenTextLines.length,` to the `setSpanAttrs` block and `screen_lines: inspection.screenTextLines.length,` to `rec.stage("vision", {...})`.

- [ ] **Step 8: Run new + existing LOOK suites** — Expected: all PASS.

Run: `cd mira-hub && npx vitest run src/capabilities/screen-text.test.ts src/capabilities/__tests__/look-screen-text.test.ts "src/app/api/equipment-notebooks/[id]/look" src/app/api/equipment-notebooks/__tests__/look-flight-recorder.test.ts`

- [ ] **Step 9: Prove it.** Run each mutation alone, watch the named test fail, then restore:
  - Delete the `attachScreenTextLines(...)` call: "stores the normalized lines" must fail.
  - Change `inspection.screenTextLines.length > 0` to `>= 0`: "stores nothing when the photo shows no screen text" must fail.
  - Remove the inner `try/catch`: "a failed line write never fails the LOOK turn" must fail.
  - Set `maxTokens` back to 600: "gives the vision call room" must fail.

- [ ] **Step 10: Typecheck and commit**

```bash
cd mira-hub && npx tsc --noEmit -p . && cd ..
git add mira-hub/src/capabilities/screen-text.ts mira-hub/src/capabilities/screen-text.test.ts \
  mira-hub/src/capabilities/__tests__/look-screen-text.test.ts "mira-hub/src/app/api/equipment-notebooks/[id]/look/route.ts"
git commit -m "feat(hub): LOOK transcribes on-screen text verbatim and stores it with the photo's evidence"
```

---

### Task 2: Group lines into records and parse them (PR B)

**Files:**
- Create: `mira-hub/src/capabilities/alarm-screens.fixture.ts` (synthetic screens shared by Tasks 2–4)
- Create: `mira-hub/src/capabilities/alarm-line.ts`
- Create: `mira-hub/src/capabilities/alarm-line.test.ts`

**Interfaces:**
- Produces (`alarm-line.ts`): types `Field`, `AlarmRecord`, `Designation`, `AlarmKind`, `AlarmLine` (exact shapes below); functions `groupAlarmRecords(lines: readonly string[]): AlarmRecord[]`, `parseAlarmRecord(record: AlarmRecord): AlarmLine | null`, `parseDesignations(text: string): Designation[]`, `timeSeconds(text: string): number | null`.
- Produces (`alarm-screens.fixture.ts`): `SCREEN_FAIL_SAFE`, `SCREEN_FAIL_SAFE_PASSIVATION_FIRST`, `SCREEN_PASSIVATION_ONLY`, `SCREEN_RTD`, `SCREEN_NEGATIVE`, `SCREEN_UNCOVERED_ONLY` — all `readonly string[]`.

- [ ] **Step 1: Write the fixture file** — `mira-hub/src/capabilities/alarm-screens.fixture.ts`

```ts
/**
 * Synthetic HMI alarm screens. Invented designations, addresses, dates and times
 * only (Mike 2026-10-12: no customer text in the repo). The LAYOUT copies what real
 * screens do: column header, entries wrapped over two or three lines, cut-off time
 * and address columns, every alarm listed twice.
 */
export const SCREEN_FAIL_SAFE: readonly string[] = [
  "No. Time Date Status Text",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 1",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.",
  "46 08:14:3… 03/02/2027 I Error: Safety program: F-I/O channel passivated",
  "F-runtime group 1",
  "Start address of the F-I/O: 61…",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 5",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.",
  "46 08:14:3… 03/02/2027 I Error: Safety program: F-I/O channel passivated",
  "F-runtime group 1",
  "Start address of the F-I/O: 61…",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 1",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 5",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.",
  "46 08:14:3… 03/02/2027 I Error: Safety program: F-I/O channel passivated",
  "F-runtime group 1",
  "Start address of the F-I/O: 62…",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 4",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-6.",
  "46 08:14:3… 03/02/2027 I Error: Safety program: F-I/O channel passivated",
  "F-runtime group 1",
  "Start address of the F-I/O: 62…",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 4",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-6.",
];

/** Same alarms, newest-first list where a passivation happens to be on top. */
export const SCREEN_FAIL_SAFE_PASSIVATION_FIRST: readonly string[] = [
  "46 08:14:3… 03/02/2027 I Error: Safety program: F-I/O channel passivated",
  "F-runtime group 1",
  "Start address of the F-I/O: 61…",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 1",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.",
];

export const SCREEN_PASSIVATION_ONLY: readonly string[] = [
  "46 09:01:07 03/02/2027 I Error: Safety program: F-I/O channel passivated",
  "F-runtime group 2",
  "Start address of the F-I/O: 70…",
];

/** RIGHT is on top but LEFT came in first; LEFT's view prints value 0 against limit 0. */
export const SCREEN_RTD: readonly string[] = [
  "No. Time Date Status Text",
  "113 06:02:19 11/05/2027 I Error: Temperature measurement RIGHT WINDING too high",
  "=1.HYD+04-TE3",
  "112 06:02:17 11/05/2027 I Error: Temperature measurement LEFT WINDING too high",
  "=1.HYD+04-TE2 value 0 limit 0",
  "9 06:02:20 11/05/2027 I Warning: Automatic stop",
  "7 06:01:58 11/05/2027 IO Error: E-stop reset required",
];

export const SCREEN_NEGATIVE: readonly string[] = [
  "Main menu",
  "Recipes",
  "Diagnostics",
  "Part no. 6ES7 523-1BL00",
  "Operator: shift B",
  "12:00",
  "Language: English",
];

export const SCREEN_UNCOVERED_ONLY: readonly string[] = [
  "21 10:00:01 11/05/2027 I Error: Overrange on Input channel 2",
  "=1.HYD+04-A2.1-3.",
];
```

- [ ] **Step 2: Write the failing tests** — `mira-hub/src/capabilities/alarm-line.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { groupAlarmRecords, parseAlarmRecord, parseDesignations, timeSeconds, type AlarmRecord } from "./alarm-line";
import { SCREEN_FAIL_SAFE, SCREEN_NEGATIVE, SCREEN_RTD } from "./alarm-screens.fixture";

const rec = (text: string, extra: Partial<AlarmRecord> = {}): AlarmRecord => ({
  lines: [text], number: null, time: null, date: null, status: null, text, count: 1, ...extra,
});

describe("groupAlarmRecords", () => {
  it("joins wrapped lines into records, drops the header, collapses duplicates (fail-safe screen)", () => {
    const records = groupAlarmRecords(SCREEN_FAIL_SAFE);
    expect(records.map((r) => [r.number, r.text, r.count])).toEqual([
      ["40", "Error: Wire break on Output channel 1 =y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.", 2],
      ["46", "Error: Safety program: F-I/O channel passivated F-runtime group 1 Start address of the F-I/O: 61…", 2],
      ["40", "Error: Wire break on Output channel 5 =y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.", 2],
      ["46", "Error: Safety program: F-I/O channel passivated F-runtime group 1 Start address of the F-I/O: 62…", 2],
      ["40", "Error: Wire break on Output channel 4 =y.CTL+07-K4.1 / =y.CTL+07-K4.1-6.", 2],
    ]);
  });
  it("captures number, cut-off time, date and status", () => {
    const [first] = groupAlarmRecords(SCREEN_FAIL_SAFE);
    expect(first.time).toEqual({ text: "08:14:3…", truncated: true });
    expect(first.date).toEqual({ text: "03/02/2027", truncated: false });
    expect(first.status).toBe("I");
    expect(first.lines).toHaveLength(2);
  });
  it("keeps a three-line record's lines and a full time", () => {
    const records = groupAlarmRecords(SCREEN_RTD);
    expect(records[0].time).toEqual({ text: "06:02:19", truncated: false });
    expect(records.find((r) => r.number === "7")?.status).toBe("IO");
  });
  it("starts a record on a message word with no row prefix", () => {
    const records = groupAlarmRecords(["Error: Wire break on Output channel 2", "=y.CTL+07-K4.1-2."]);
    expect(records).toHaveLength(1);
    expect(records[0].number).toBeNull();
    expect(records[0].text).toBe("Error: Wire break on Output channel 2 =y.CTL+07-K4.1-2.");
  });
  it("treats '...' like '…' as a cut-off marker", () => {
    expect(groupAlarmRecords(["40 08:14:3... 03/02/2027 I Error: x"])[0].time).toEqual({ text: "08:14:3...", truncated: true });
  });
  it("normalizes column pipes to spaces", () => {
    expect(groupAlarmRecords(["40 | 08:14:31 | 03/02/2027 | I | Error: x =y.CTL+07-K4.1-2."])[0].text)
      .toBe("Error: x =y.CTL+07-K4.1-2.");
  });
  it("produces no record from ordinary screen text", () => {
    expect(groupAlarmRecords(SCREEN_NEGATIVE)).toEqual([]);
  });
});

describe("parseDesignations", () => {
  it("parses track, function, location and device; trailing sentence dot excluded", () => {
    expect(parseDesignations("=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.")).toEqual([
      { raw: "=y.CTL+07-K4.1", track: "=y.", func: "CTL", location: "+07", device: "-K4.1" },
      { raw: "=y.CTL+07-K4.1-2", track: "=y.", func: "CTL", location: "+07", device: "-K4.1-2" },
    ]);
  });
  it("keeps unreadable characters as read", () => {
    expect(parseDesignations("=y.C?L+07-K4.1-2.")[0].raw).toBe("=y.C?L+07-K4.1-2");
  });
  it("needs a location or device — a bare track is not a designation", () => {
    expect(parseDesignations("value =1.HYD only")).toEqual([]);
  });
});

describe("parseAlarmRecord", () => {
  it("output wire break: kind, channel, most specific designation first", () => {
    const l = parseAlarmRecord(rec("Error: Wire break on Output channel 3 =y.CTL+07-K4.1 / =y.CTL+07-K4.1-2."))!;
    expect(l.kind).toBe("io_diagnostic");
    expect(l.diagnostic).toBe("wire_break");
    expect(l.channel).toEqual({ io: "output", number: 3 });
    expect(l.designations[0].raw).toBe("=y.CTL+07-K4.1-2");
  });
  it("input wire break", () => {
    const l = parseAlarmRecord(rec("Error: Wire break on Input channel 0 =2.ANA+03-A1.4-1."))!;
    expect(l.channel).toEqual({ io: "input", number: 0 });
  });
  it("passivation: F-group and a cut-off address, no designation needed", () => {
    const l = parseAlarmRecord(rec("Error: Safety program: F-I/O channel passivated F-runtime group 1 Start address of the F-I/O: 61…"))!;
    expect(l.kind).toBe("safety_passivation");
    expect(l.fGroup).toBe("1");
    expect(l.fAddress).toEqual({ text: "61…", truncated: true });
  });
  it("temperature too high with a subject", () => {
    const l = parseAlarmRecord(rec("Error: Temperature measurement RIGHT WINDING too high =1.HYD+04-TE3"))!;
    expect([l.kind, l.quantity, l.direction, l.subject]).toEqual(["measurement_limit", "temperature", "high", "RIGHT WINDING"]);
    expect(l.value).toEqual({ shown: false, reason: "not_displayed" });
  });
  it("German temperature too low", () => {
    const l = parseAlarmRecord(rec("Fehler: Temperaturmessung LINKS zu niedrig =1.HYD+04-TE2"))!;
    expect([l.kind, l.quantity, l.direction]).toEqual(["measurement_limit", "temperature", "low"]);
  });
  it("zero value against zero limit means the reading is not on this view", () => {
    const l = parseAlarmRecord(rec("Error: Temperature measurement LEFT WINDING too high =1.HYD+04-TE2 value 0 limit 0"))!;
    expect(l.value).toEqual({ shown: false, reason: "zero_and_zero_limit" });
  });
  it("a shown value and limit", () => {
    const l = parseAlarmRecord(rec("Error: Temperature measurement LEFT WINDING too high =1.HYD+04-TE2 value 132.5 °C limit 120 °C"))!;
    expect(l.value).toEqual({ shown: true, number: 132.5, unit: "°C" });
    expect(l.limit).toEqual({ number: 120, unit: "°C" });
  });
  it("an unreadable value is never parsed as a number", () => {
    const l = parseAlarmRecord(rec("Error: Temperature measurement LEFT WINDING too high =1.HYD+04-TE2 value 1?2.5 °C"))!;
    expect(l.value).toEqual({ shown: false, reason: "unreadable" });
  });
  it("a cut-off value is never completed", () => {
    const l = parseAlarmRecord(rec("Error: Temperature measurement LEFT WINDING too high =1.HYD+04-TE2 value 13… °C"))!;
    expect(l.value).toEqual({ shown: false, reason: "truncated" });
  });
  it("overrange and switch trip are recognized kinds", () => {
    expect(parseAlarmRecord(rec("Error: Overrange on Input channel 2 =1.HYD+04-A2.1-3."))!.diagnostic).toBe("overrange");
    expect(parseAlarmRecord(rec("Error: Thermal switch tripped =1.HYD+04-BT1"))!.kind).toBe("switch_trip");
  });
  it("returns null without an identifier", () => {
    expect(parseAlarmRecord(rec("Error: Wire break on Output channel 3"))).toBeNull();
    expect(parseAlarmRecord(rec("Error: Safety program: F-I/O channel passivated"))).toBeNull();
  });
  it("returns null for an unrecognized message", () => {
    expect(parseAlarmRecord(rec("Warning: Automatic stop"))).toBeNull();
    expect(parseAlarmRecord(rec("Error: E-stop reset required =1.HYD+04-S1"))).toBeNull();
  });
});

describe("timeSeconds", () => {
  it("parses only a full hh:mm:ss", () => {
    expect(timeSeconds("06:02:17")).toBe(6 * 3600 + 2 * 60 + 17);
    expect(timeSeconds("08:14:3…")).toBeNull();
    expect(timeSeconds("08:14")).toBeNull();
  });
});
```

- [ ] **Step 3: Run it and watch it fail** — `npx vitest run src/capabilities/alarm-line.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement** — `mira-hub/src/capabilities/alarm-line.ts`

```ts
/**
 * Alarm-list reading, deterministic (spec docs/superpowers/specs/2026-10-12-alarm-reasoning-design.md §5).
 * Input: the verbatim visual lines LOOK transcribed from an HMI alarm screen.
 * Output: alarm records (wrapped lines joined, duplicates collapsed) and the parsed
 * fields a pack is keyed on. No model, no network, no I/O. Never "corrects" a misread,
 * never completes a cut-off field.
 */

export type Field = { text: string; truncated: boolean };

export type AlarmRecord = {
  lines: string[];
  number: string | null;
  time: Field | null;
  date: Field | null;
  status: string | null;
  text: string;
  count: number;
};

export type Designation = {
  raw: string;
  track: string;
  func: string;
  location: string | null;
  device: string | null;
};

export type AlarmKind =
  | "measurement_limit" | "switch_trip" | "resistance_test" | "io_diagnostic"
  | "safety_passivation" | "state" | "unknown";

export type AlarmLine = {
  record: AlarmRecord;
  designations: Designation[];
  kind: AlarmKind;
  diagnostic: "wire_break" | "overrange" | "underrange" | null;
  channel: { io: "input" | "output"; number: number } | null;
  fGroup: string | null;
  fAddress: Field | null;
  quantity: "temperature" | "resistance" | "voltage" | "current" | "pressure" | null;
  subject: string | null;
  direction: "high" | "low" | null;
  value:
    | { shown: true; number: number; unit: string | null }
    | { shown: false; reason: "not_displayed" | "zero_and_zero_limit" | "unreadable" | "truncated" };
  limit: { number: number; unit: string | null } | null;
};

const CUT = "(?:…|\\.\\.\\.)";
const TRUNCATED = new RegExp(`${CUT}$`);
const STATUS = "IAO|IOA|IA|IO|IQ|KGQ|KQG|KG|KQ|I|O|A|Q|K|G";
const ROW_PREFIX = new RegExp(
  `^(?:(\\d{1,6})\\s+)?(\\d{1,2}:\\d{2}(?::\\d{0,2})?${CUT}?)\\s+` +
    `(?:(\\d{1,4}[./-]\\d{1,2}[./-]\\d{0,4}${CUT}?)\\s+)?` +
    `(?:(${STATUS})\\s+)?(.*)$`,
);
const MESSAGE_START = /^(?:error|warning|fault|alarm|fehler|warnung|störung)\s*:/i;
const FULL_TIME = /^(\d{1,2}):(\d{2}):(\d{2})$/;
const UNIT = "(°C|°F|Ω|ohm|%|mA|V|A|bar)";

const RX = {
  wireBreak: /\bwire[ -]?break\b|drahtbruch/i,
  overrange: /\boverrange\b|\boverflow\b|überlauf/i,
  underrange: /\bunderrange\b|\bunderflow\b|unterlauf/i,
  passivated: /\bpassivat(?:ed|ion)\b|passiviert/i,
  channel: /\b(output|input)\s+channel\s+(\d{1,3})\b/i,
  fGroup: /\bF-runtime group\s+(\d{1,3})\b/i,
  fAddress: /\bstart address of the F-I\/O:\s*(\S+)/i,
  temperature: /\btemperature\b|temperaturmessung|\btemperatur\b/i,
  resistance: /\bresistance measurement\b|widerstandsmessung/i,
  resistanceTest: /\bresistance test\b/i,
  high: /\btoo high\b|\bzu hoch\b/i,
  low: /\btoo low\b|\bzu niedrig\b/i,
  tripped: /\btripped\b|ausgelöst/i,
  subject: /measurement\s+(.+?)\s+(?:too high|too low)/i,
  value: new RegExp(`\\b(?:value|actual|istwert)\\s*[:=]?\\s*(-?[\\d?]+(?:[.,][\\d?]+)?)(…|\\.\\.\\.)?\\s*${UNIT}?(?![A-Za-z])`, "i"),
  limit: new RegExp(`\\b(?:limit|grenzwert|setpoint)\\s*[:=]?\\s*(-?\\d+(?:[.,]\\d+)?)\\s*${UNIT}?(?![A-Za-z])`, "i"),
};

const DESIGNATION = /(=[0-9A-Za-z?]{1,3}\.)([A-Za-z?][A-Za-z0-9?]*)(\+[A-Za-z0-9?]+)?(-[A-Za-z0-9?]+(?:[.-][A-Za-z0-9?]+)*)?/g;

function field(raw: string): Field {
  const text = raw.trim();
  return { text, truncated: TRUNCATED.test(text) };
}

function clean(raw: string): string {
  return raw.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();
}

export function timeSeconds(text: string): number | null {
  const m = FULL_TIME.exec(text);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

export function groupAlarmRecords(lines: readonly string[]): AlarmRecord[] {
  const records: AlarmRecord[] = [];
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    const row = ROW_PREFIX.exec(line);
    if (row) {
      records.push({
        lines: [line],
        number: row[1] ?? null,
        time: field(row[2]),
        date: row[3] ? field(row[3]) : null,
        status: row[4] ?? null,
        text: row[5].trim(),
        count: 1,
      });
      continue;
    }
    if (MESSAGE_START.test(line)) {
      records.push({ lines: [line], number: null, time: null, date: null, status: null, text: line, count: 1 });
      continue;
    }
    const current = records[records.length - 1];
    if (!current) continue; // column headers and noise before the first record
    current.lines.push(line);
    current.text = current.text ? `${current.text} ${line}` : line;
  }
  return collapseDuplicates(records);
}

function collapseDuplicates(records: AlarmRecord[]): AlarmRecord[] {
  const seen = new Map<string, AlarmRecord>();
  const out: AlarmRecord[] = [];
  for (const r of records) {
    const key = `${r.number ?? ""}\u0000${r.text}`;
    const first = seen.get(key);
    if (!first) {
      seen.set(key, r);
      out.push(r);
      continue;
    }
    first.count += 1;
    // Keep the earliest full time on the same date so first-out can still use it.
    const a = first.time ? timeSeconds(first.time.text) : null;
    const b = r.time ? timeSeconds(r.time.text) : null;
    if (a !== null && b !== null && b < a && first.date?.text === r.date?.text) first.time = r.time;
  }
  return out;
}

export function parseDesignations(text: string): Designation[] {
  const out: Designation[] = [];
  for (const m of text.matchAll(DESIGNATION)) {
    const location = m[3] ?? null;
    const device = m[4] ?? null;
    if (!location && !device) continue;
    out.push({ raw: m[0], track: m[1], func: m[2], location, device });
  }
  return out;
}

function num(s: string): number {
  return Number(s.replace(",", "."));
}

function parseLimit(t: string): AlarmLine["limit"] {
  const m = RX.limit.exec(t);
  return m ? { number: num(m[1]), unit: m[2] ?? null } : null;
}

function parseValue(t: string): AlarmLine["value"] {
  const m = RX.value.exec(t);
  if (!m) return { shown: false, reason: "not_displayed" };
  if (m[2]) return { shown: false, reason: "truncated" };
  if (m[1].includes("?")) return { shown: false, reason: "unreadable" };
  const n = num(m[1]);
  const limit = parseLimit(t);
  if (n === 0 && (limit === null || limit.number === 0)) return { shown: false, reason: "zero_and_zero_limit" };
  return { shown: true, number: n, unit: m[3] ?? null };
}

export function parseAlarmRecord(record: AlarmRecord): AlarmLine | null {
  const t = record.text;
  const designations = parseDesignations(t).sort((a, b) => (b.device?.length ?? 0) - (a.device?.length ?? 0));
  const ch = RX.channel.exec(t);
  const channel = ch
    ? { io: (ch[1].toLowerCase() === "output" ? "output" : "input") as "input" | "output", number: Number(ch[2]) }
    : null;
  const fGroup = RX.fGroup.exec(t)?.[1] ?? null;
  const fa = RX.fAddress.exec(t);
  const fAddress = fa ? field(fa[1]) : null;
  const direction: AlarmLine["direction"] = RX.high.test(t) ? "high" : RX.low.test(t) ? "low" : null;

  let kind: AlarmKind = "unknown";
  let diagnostic: AlarmLine["diagnostic"] = null;
  let quantity: AlarmLine["quantity"] = null;
  if (RX.passivated.test(t)) kind = "safety_passivation";
  else if (RX.wireBreak.test(t)) { kind = "io_diagnostic"; diagnostic = "wire_break"; }
  else if (RX.overrange.test(t)) { kind = "io_diagnostic"; diagnostic = "overrange"; }
  else if (RX.underrange.test(t)) { kind = "io_diagnostic"; diagnostic = "underrange"; }
  else if (direction && RX.temperature.test(t)) { kind = "measurement_limit"; quantity = "temperature"; }
  else if (direction && RX.resistance.test(t)) { kind = "measurement_limit"; quantity = "resistance"; }
  else if (RX.resistanceTest.test(t)) { kind = "resistance_test"; quantity = "resistance"; }
  else if (RX.tripped.test(t)) kind = "switch_trip";
  if (kind === "unknown") return null;

  const identified = designations.length > 0 || (kind === "safety_passivation" && (fGroup !== null || fAddress !== null));
  if (!identified) return null;

  const isMeasurement = kind === "measurement_limit";
  return {
    record,
    designations,
    kind,
    diagnostic,
    channel,
    fGroup,
    fAddress,
    quantity,
    subject: isMeasurement ? RX.subject.exec(t)?.[1]?.trim() ?? null : null,
    direction: isMeasurement ? direction : null,
    value: parseValue(t),
    limit: parseLimit(t),
  };
}
```

- [ ] **Step 5: Run the tests** — Expected: PASS. If a regex case fails, fix the regex, never the expected value. Every expected value above was derived from the spec.

- [ ] **Step 6: Prove it.** Run each mutation alone, watch the named test fail, then restore:
  - Remove the `collapseDuplicates` call (return `records`): "collapses duplicates" must fail.
  - Remove `${CUT}?` from the time group: "captures number, cut-off time" must fail.
  - Remove the `if (m[2])` truncation branch: "a cut-off value is never completed" must fail.
  - Remove the `identified` check: "returns null without an identifier" must fail.
  - Remove the `.sort(...)` on designations: "most specific designation first" must fail.

- [ ] **Step 7: Commit**

```bash
git add mira-hub/src/capabilities/alarm-line.ts mira-hub/src/capabilities/alarm-line.test.ts mira-hub/src/capabilities/alarm-screens.fixture.ts
git commit -m "feat(hub): deterministic alarm-list grouping and parsing (wrapped records, cut-off fields, duplicates)"
```

---

### Task 3: Family packs, loader, banned-pattern guard (PR B)

**Files:**
- Create: `mira-hub/src/capabilities/alarm-packs/rtd.v1.json`
- Create: `mira-hub/src/capabilities/alarm-packs/fail-safe-output.v1.json`
- Create: `mira-hub/src/capabilities/alarm-packs/loader.ts`
- Create: `mira-hub/src/capabilities/alarm-packs/loader.test.ts`

**Interfaces:**
- Produces: types `PackEntry`, `AlarmPack`; constants `SITE_PROCEDURE_LINE`, `BANNED_PATTERNS`, `ALARM_PACKS`; functions `validatePack(raw: unknown): AlarmPack`, `packFor(key: string, packs?: readonly AlarmPack[]): { pack: AlarmPack; entry: PackEntry } | null`.
- Pack keys: `measurement_limit:temperature:high`, `measurement_limit:temperature:low`, `io_diagnostic:wire_break:input`, `io_diagnostic:wire_break:output`, `safety_passivation`.

- [ ] **Step 1: Write the packs.**

`mira-hub/src/capabilities/alarm-packs/rtd.v1.json`:

```json
{
  "pack_id": "rtd",
  "version": 1,
  "title": "RTD",
  "source": "MIRA engineering reference",
  "invalidated_by": "Any reviewed edit to these entries; bump version.",
  "site_procedure_line": "Anything that opens an enclosure or touches the circuit follows your site's lockout procedure with the equipment out of service.",
  "entries": [
    {
      "key": "measurement_limit:temperature:high",
      "means": "A temperature measurement is above its alarm limit.",
      "hypotheses": [
        "The measured point really is above its limit.",
        "The RTD loop is open or high-resistance (lead, terminal, joint, or element). That also raises a wire-break or overrange diagnostic on the input channel."
      ],
      "checks": [
        "Read the actual value and the time of the alarm from the alarm history or the diagnostic view.",
        "Compare the sibling channel at the same location, such as the other sensor of a left/right pair.",
        "Read the input channel's diagnostic (wire break, overrange, underrange) on the HMI diagnostics page or online in the engineering software, read only — change nothing in the controller."
      ],
      "does_not_prove": ["an over-temperature", "a sensor fault", "the cause"]
    },
    {
      "key": "measurement_limit:temperature:low",
      "means": "A temperature measurement is below its alarm limit.",
      "hypotheses": [
        "The measured point really is below its limit.",
        "The RTD or its leads are shorted, or the channel is configured for the wrong sensor type."
      ],
      "checks": [
        "Read the actual value and the time of the alarm from the alarm history or the diagnostic view.",
        "Compare the sibling channel at the same location, such as the other sensor of a left/right pair.",
        "Read the input channel's diagnostic (wire break, overrange, underrange) on the HMI diagnostics page or online in the engineering software, read only — change nothing in the controller."
      ],
      "does_not_prove": ["an under-temperature", "a sensor fault", "the cause"]
    },
    {
      "key": "io_diagnostic:wire_break:input",
      "means": "The input channel reports an open circuit in its field wiring.",
      "hypotheses": [
        "An open circuit in the field loop: lead, terminal, joint, or the sensor element.",
        "A failed input channel."
      ],
      "checks": [
        "Read the time of the alarm from the alarm history or the diagnostic view.",
        "Compare the sibling channel at the same location, such as the other sensor of a left/right pair.",
        "Read the module and channel diagnostics on the HMI diagnostics page or online in the engineering software, read only — change nothing in the controller."
      ],
      "does_not_prove": ["that a wire is broken", "which part of the loop is open", "the cause"]
    }
  ]
}
```

`mira-hub/src/capabilities/alarm-packs/fail-safe-output.v1.json`:

```json
{
  "pack_id": "fail-safe-output",
  "version": 1,
  "title": "fail-safe output",
  "source": "MIRA engineering reference",
  "invalidated_by": "Any reviewed edit to these entries; bump version.",
  "site_procedure_line": "Anything that opens an enclosure or touches the circuit follows your site's lockout procedure with the equipment out of service.",
  "rules": {
    "shared_cause": "Several channels came in at the same time on this screen — look first for something they share (cable, connector, junction box, load supply) before chasing separate faults.",
    "consequence": "The passivation messages are most likely the safety program's response to these wire breaks. This screen doesn't show which passivation belongs to which channel."
  },
  "entries": [
    {
      "key": "io_diagnostic:wire_break:output",
      "means": "The output channel reports that it cannot detect its load — the module's wire-break check tripped.",
      "hypotheses": [
        "An open circuit between the output and its load: wire, terminal, connector, or the load's own coil or element.",
        "The load is connected but draws less current than the channel needs to detect it, for example after an actuator or relay was replaced with a different type."
      ],
      "checks": [
        "Read the full time of each alarm, to the second, from the alarm history or the controller's diagnostic buffer, to see which came first.",
        "Read the module and channel diagnostics on the HMI diagnostics page or online in the engineering software, read only — change nothing in the controller.",
        "On the drawings, find what each listed channel drives and what those circuits share: cable, connector, junction box, load supply."
      ],
      "does_not_prove": ["that a wire is broken", "which alarm came first", "what the outputs drive", "the cause"]
    },
    {
      "key": "safety_passivation",
      "means": "The safety program switched this channel to its safe state — output off — because of a fault it was told about. It stays there while the fault is present.",
      "hypotheses": [
        "A channel or module fault the module reported to the safety program.",
        "A communication fault between the controller and the module. The diagnostic buffer tells these apart."
      ],
      "checks": [
        "Read the full time of each alarm, to the second, from the alarm history or the controller's diagnostic buffer, to see which came first.",
        "Read the module and channel diagnostics on the HMI diagnostics page or online in the engineering software, read only — change nothing in the controller.",
        "On the drawings or a printout of the hardware configuration, find which module the F-I/O start address belongs to and what its channels drive."
      ],
      "does_not_prove": ["which channel or module is at fault", "what the outputs drive", "the cause"]
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests** — `mira-hub/src/capabilities/alarm-packs/loader.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { ALARM_PACKS, BANNED_PATTERNS, SITE_PROCEDURE_LINE, packFor, validatePack, type AlarmPack } from "./loader";
import rtd from "./rtd.v1.json";

const clone = (): AlarmPack => JSON.parse(JSON.stringify(rtd)) as AlarmPack;

// Independent of BANNED_PATTERNS on purpose: deleting a pattern must turn its row red.
const MUST_REJECT: [string, string][] = [
  ["bypass", "Bypass the safety relay to test it."],
  ["jumper", "Jumper the output terminals."],
  ["bridge-out", "Bridge out the wire-break input."],
  ["force", "Force the output on from the engineering software."],
  ["override", "Override the channel."],
  ["substitute", "Substitute a resistor for the RTD."],
  ["simulate", "Simulate the sensor value."],
  ["reset", "Reset the module."],
  ["clear-alarm", "Clear the alarm and watch it."],
  ["acknowledge", "Acknowledge the F-I/O."],
  ["reintegrate", "Reintegrate the channel."],
  ["depassivate", "Depassivate the channel."],
  ["ack-rei", "Set ACK_REI in the safety program."],
  ["disable-diagnostic", "Deactivate wire break detection on that channel."],
  ["parameterize-off", "Parameterize it off in the hardware config."],
  ["change-config", "Change the F-parameters to stop it."],
  ["download", "Download the corrected program."],
  ["load-resistor", "Fit a load resistor across the output."],
];

describe("alarm packs", () => {
  it("both shipped packs load", () => {
    expect(ALARM_PACKS.map((p) => p.pack_id)).toEqual(["rtd", "fail-safe-output"]);
  });
  it.each([
    "measurement_limit:temperature:high",
    "measurement_limit:temperature:low",
    "io_diagnostic:wire_break:input",
    "io_diagnostic:wire_break:output",
    "safety_passivation",
  ])("has an entry for %s", (key) => {
    const hit = packFor(key);
    expect(hit).not.toBeNull();
    expect(hit!.entry.hypotheses).toHaveLength(2);
    expect(hit!.entry.checks).toHaveLength(3);
  });
  it("returns null for an uncovered key", () => {
    expect(packFor("io_diagnostic:overrange:input")).toBeNull();
  });
  it("every pack carries the exact site-procedure line", () => {
    for (const p of ALARM_PACKS) expect(p.site_procedure_line).toBe(SITE_PROCEDURE_LINE);
  });

  it.each(MUST_REJECT)("rejects banned pattern %s", (id, phrase) => {
    const bad = clone();
    bad.entries[0].checks[2] = phrase;
    expect(() => validatePack(bad)).toThrow(`alarm_pack_banned:${id}:rtd`);
  });
  it("the ban list covers every row of the table above (no silent removals)", () => {
    expect(BANNED_PATTERNS.map((b) => b.id).sort()).toEqual(MUST_REJECT.map(([id]) => id).sort());
  });
  it("control: read-only wording that names the risk without instructing it passes", () => {
    const ok = clone();
    ok.entries[0].checks[2] = "Read the module diagnostics online in the engineering software, read only — change nothing in the controller.";
    expect(() => validatePack(ok)).not.toThrow();
  });
  it("rejects structural defects", () => {
    const twoChecks = clone(); twoChecks.entries[0].checks = ["a", "b"] as never;
    expect(() => validatePack(twoChecks)).toThrow("alarm_pack_invalid:checks");
    const badLine = clone(); badLine.site_procedure_line = "Be careful.";
    expect(() => validatePack(badLine)).toThrow("alarm_pack_invalid:site_procedure_line");
    const dup = clone(); dup.entries.push(dup.entries[0]);
    expect(() => validatePack(dup)).toThrow("alarm_pack_invalid:duplicate_key");
  });
});
```

- [ ] **Step 3: Run it and watch it fail** — `npx vitest run src/capabilities/alarm-packs/loader.test.ts` → FAIL (loader missing).

- [ ] **Step 4: Implement** — `mira-hub/src/capabilities/alarm-packs/loader.ts`

```ts
/**
 * Alarm family packs (spec 2026-10-12-alarm-reasoning-design.md §6). Versioned data,
 * imported at build time (same stance as src/lib/drive-packs/loader.ts) and validated
 * at import: a pack whose text instructs a bypass, reset, reintegration, disabled
 * diagnostic, download, or load resistor never loads. The ban list is the safety
 * boundary — read-only troubleshooting intelligence, no control actions.
 */
import rtdJson from "./rtd.v1.json";
import failSafeOutputJson from "./fail-safe-output.v1.json";

export type PackEntry = {
  key: string;
  means: string;
  hypotheses: [string, string];
  checks: [string, string, string];
  does_not_prove: string[];
};

export type AlarmPack = {
  pack_id: string;
  version: number;
  title: string;
  source: "MIRA engineering reference";
  invalidated_by: string;
  site_procedure_line: string;
  entries: PackEntry[];
  rules?: { shared_cause?: string; consequence?: string };
};

export const SITE_PROCEDURE_LINE =
  "Anything that opens an enclosure or touches the circuit follows your site's lockout procedure with the equipment out of service.";

export const BANNED_PATTERNS: readonly { id: string; rx: RegExp }[] = [
  { id: "bypass", rx: /\bbypass/i },
  { id: "jumper", rx: /\bjumper/i },
  { id: "bridge-out", rx: /\bbridge (?:it )?out\b|\bbridging\b/i },
  { id: "force", rx: /\bforc(?:e|ed|ing)\b/i },
  { id: "override", rx: /\boverrid(?:e|ing)\b/i },
  { id: "substitute", rx: /\bsubstitut/i },
  { id: "simulate", rx: /\bsimulat/i },
  { id: "reset", rx: /\breset/i },
  { id: "clear-alarm", rx: /\bclear (?:the |this )?(?:alarm|fault|error)/i },
  { id: "acknowledge", rx: /\backnowledg/i },
  { id: "reintegrate", rx: /\breintegrat/i },
  { id: "depassivate", rx: /\bde-?passivat/i },
  { id: "ack-rei", rx: /ACK_REI/i },
  { id: "disable-diagnostic", rx: /\b(?:deactivat|disabl|turn(?:ing)? off|switch(?:ing)? off)\w*\s+(?:the\s+)?(?:wire[ -]?break|diagnos)/i },
  { id: "parameterize-off", rx: /\bparameteri[sz]\w*\s+(?:it\s+)?off\b/i },
  { id: "change-config", rx: /\bchang\w*\s+(?:the\s+)?(?:hardware configuration|F-parameter)/i },
  { id: "download", rx: /\bdownload/i },
  { id: "load-resistor", rx: /\b(?:load|dummy|pull-?down)\s+(?:resistor|load)\b|\badd(?:ing)?\s+(?:a\s+)?resistor/i },
];

function fail(code: string, packId: string): never {
  throw new Error(`alarm_pack_invalid:${code}:${packId}`);
}

function packTexts(p: AlarmPack): string[] {
  return [
    p.title,
    ...Object.values(p.rules ?? {}),
    ...p.entries.flatMap((e) => [e.means, ...e.hypotheses, ...e.checks, ...e.does_not_prove]),
  ];
}

export function validatePack(raw: unknown): AlarmPack {
  const p = raw as AlarmPack;
  const id = typeof p?.pack_id === "string" ? p.pack_id : "?";
  if (!p || typeof p.pack_id !== "string" || typeof p.version !== "number") fail("header", id);
  if (p.source !== "MIRA engineering reference") fail("source", id);
  if (p.site_procedure_line !== SITE_PROCEDURE_LINE) fail("site_procedure_line", id);
  if (!Array.isArray(p.entries) || p.entries.length === 0) fail("entries", id);
  const keys = new Set<string>();
  for (const e of p.entries) {
    if (typeof e.key !== "string" || !e.key) fail("key", id);
    if (keys.has(e.key)) fail("duplicate_key", id);
    keys.add(e.key);
    if (typeof e.means !== "string" || !e.means.trim()) fail("means", id);
    if (!Array.isArray(e.hypotheses) || e.hypotheses.length !== 2) fail("hypotheses", id);
    if (!Array.isArray(e.checks) || e.checks.length !== 3) fail("checks", id);
    if (!Array.isArray(e.does_not_prove)) fail("does_not_prove", id);
  }
  for (const text of packTexts(p)) {
    for (const b of BANNED_PATTERNS) {
      if (b.rx.test(text)) throw new Error(`alarm_pack_banned:${b.id}:${id}`);
    }
  }
  return p;
}

export const ALARM_PACKS: readonly AlarmPack[] = [validatePack(rtdJson), validatePack(failSafeOutputJson)];

export function packFor(
  key: string,
  packs: readonly AlarmPack[] = ALARM_PACKS,
): { pack: AlarmPack; entry: PackEntry } | null {
  for (const pack of packs) {
    const entry = pack.entries.find((e) => e.key === key);
    if (entry) return { pack, entry };
  }
  return null;
}
```

Note: the error-code test for structural defects matches by substring. `fail("checks", "rtd")` throws `alarm_pack_invalid:checks:rtd`, which contains `alarm_pack_invalid:checks`.

- [ ] **Step 5: Run the tests** — Expected: PASS.

- [ ] **Step 6: Prove it.** Delete the `reset` row from `BANNED_PATTERNS`. Expected: "rejects banned pattern reset" fails, and so does "the ban list covers every row". Restore it. Then change the `checks.length !== 3` guard to `!== 2`. Expected: "both shipped packs load" fails (the import throws). Restore it.

- [ ] **Step 7: Safety review (blocks merge).** Dispatch the `safety-reviewer` agent (read-only). Give it the two JSON packs, `BANNED_PATTERNS`, and spec §6–§7, with this brief: "Find any pack text that could be read as permission to work on an energized circuit, defeat a safety function, reset, reintegrate, disable a diagnostic, or change controller configuration; and any banned behaviour the list misses." Record the verdict in the PR body. Fix any finding by editing pack text, never by narrowing the ban list.

- [ ] **Step 8: Commit**

```bash
git add mira-hub/src/capabilities/alarm-packs/
git commit -m "feat(hub): RTD and fail-safe output alarm packs with a banned-action guard"
```

---

### Task 4: The alarm card (PR B)

**Files:**
- Create: `mira-hub/src/capabilities/alarm-card.ts`
- Create: `mira-hub/src/capabilities/alarm-card.test.ts`

**Interfaces:**
- Consumes: Task 2's `groupAlarmRecords`, `parseAlarmRecord`, `timeSeconds`, `AlarmLine`; Task 3's `AlarmPack`, `PackEntry`, `packFor`, `ALARM_PACKS`; `validateAnswer` from `./answer-validation`; `stepEnergyContradiction` from `./step-energy`.
- Produces: `packKey(l: AlarmLine): string | null`; `buildAlarmCard(lines: readonly string[], packs?: readonly AlarmPack[]): AlarmCard | null`; type `AlarmCard = { text: string; lead: AlarmLine; covered: AlarmLine[]; packIds: string[]; packVersions: number[]; firstOut: boolean; valuesRedacted: boolean }`.
- No file snapshots: a `.snap` file under `src/capabilities/` is a frozen (non-TS/JSON) path. Assert explicitly.

- [ ] **Step 1: Write the failing tests** — `mira-hub/src/capabilities/alarm-card.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildAlarmCard } from "./alarm-card";
import { validateAnswer } from "./answer-validation";
import { stepEnergyContradiction } from "./step-energy";
import { SITE_PROCEDURE_LINE } from "./alarm-packs/loader";
import {
  SCREEN_FAIL_SAFE, SCREEN_FAIL_SAFE_PASSIVATION_FIRST, SCREEN_PASSIVATION_ONLY,
  SCREEN_RTD, SCREEN_NEGATIVE, SCREEN_UNCOVERED_ONLY,
} from "./alarm-screens.fixture";

const HEADINGS = ["**Alarm**", "**What it means**", "**Two hypotheses**", "**Next three checks**", "**What this does not prove**"];

function passesCheckers(text: string) {
  expect(validateAnswer({ answerText: text, question: "what does this alarm mean", general: false, served: true, refused: false, evidenceSufficient: true })).toEqual({ ok: true });
  expect(stepEnergyContradiction(text)).toBeNull();
}

describe("alarm card — fail-safe output screen", () => {
  const card = buildAlarmCard(SCREEN_FAIL_SAFE)!;

  it("builds a card led by the top wire break, not a first-out (times are cut off)", () => {
    expect(card).not.toBeNull();
    expect(card.lead.record.text).toContain("Output channel 1");
    expect(card.firstOut).toBe(false);
    expect(card.packIds).toEqual(["fail-safe-output"]);
  });
  it("keeps the fixed section order and ends with the site-procedure line", () => {
    const idx = HEADINGS.map((h) => card.text.indexOf(h));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(card.text.trimEnd().endsWith(SITE_PROCEDURE_LINE)).toBe(true);
  });
  it("adds the shared-cause and consequence notes", () => {
    expect(card.text).toContain("Several channels came in at the same time on this screen");
    expect(card.text).toContain("This screen doesn't show which passivation belongs to which channel.");
  });
  it("collapses duplicates with a count and lists the other alarms", () => {
    expect(card.text).toContain("(×2)");
    expect(card.text).toContain("Output channel 5");
    expect(card.text).toContain("Output channel 4");
  });
  it("names what it could not read", () => {
    expect(card.text).toContain("This screen cuts off the times, so it can't show which alarm came first — read it from the alarm history.");
    expect(card.text).toContain("The F-I/O start addresses are cut off.");
  });
  it("puts designations only inside quoted alarm lines", () => {
    for (const line of card.text.split("\n")) {
      if (/=y\.CTL/.test(line)) expect(line.startsWith("> ") || line.startsWith("- ")).toBe(true);
    }
  });
  it("passes the answer checker and the energized-step check unmodified", () => passesCheckers(card.text));
});

describe("alarm card — lead selection", () => {
  it("a passivation never leads over a wire break on the same screen", () => {
    const card = buildAlarmCard(SCREEN_FAIL_SAFE_PASSIVATION_FIRST)!;
    expect(card.lead.kind).toBe("io_diagnostic");
  });
  it("a passivation-only screen leads with the passivation and adds no consequence note", () => {
    const card = buildAlarmCard(SCREEN_PASSIVATION_ONLY)!;
    expect(card.lead.kind).toBe("safety_passivation");
    expect(card.text).toContain("A communication fault between the controller and the module.");
    expect(card.text).not.toContain("which passivation belongs to which channel");
    passesCheckers(card.text);
  });
  it("first-out: full times on one date lead with the earliest, not the top line", () => {
    const card = buildAlarmCard(SCREEN_RTD)!;
    expect(card.firstOut).toBe(true);
    expect(card.lead.record.text).toContain("LEFT WINDING");
    expect(card.text).not.toContain("cuts off the times");
  });
});

describe("alarm card — RTD screen", () => {
  const card = buildAlarmCard(SCREEN_RTD)!;
  it("says the reading is not on this view when value and limit are both 0", () => {
    expect(card.text).toContain("The reading isn't shown on this screen — read it from the alarm history.");
  });
  it("lists uncovered alarms verbatim under Also on this screen", () => {
    const also = card.text.slice(card.text.indexOf("**Also on this screen**"));
    expect(also).toContain("Warning: Automatic stop");
    expect(also).toContain("Error: E-stop reset required");
  });
  it("co-alarms with stop/reset wording sit before the site-procedure line and pass both checkers", () => {
    expect(card.text.indexOf("E-stop reset")).toBeLessThan(card.text.indexOf(SITE_PROCEDURE_LINE));
    passesCheckers(card.text);
  });
  it("never asserts absence", () => {
    expect(card.text).not.toMatch(/\bnot tripped\b/i);
  });
});

describe("alarm card — when there is no card", () => {
  it("ordinary screen text", () => expect(buildAlarmCard(SCREEN_NEGATIVE)).toBeNull());
  it("only alarms no pack covers", () => expect(buildAlarmCard(SCREEN_UNCOVERED_ONLY)).toBeNull());
  it("no lines", () => expect(buildAlarmCard([])).toBeNull());
});

describe("alarm card — shared-cause rule edges", () => {
  it("different visible times: no shared-cause note", () => {
    const card = buildAlarmCard([
      "40 08:14:31 03/02/2027 I Error: Wire break on Output channel 1", "=y.CTL+07-K4.1-2.",
      "40 08:20:05 03/02/2027 I Error: Wire break on Output channel 5", "=y.CTL+07-K4.1-2.",
    ])!;
    expect(card.text).not.toContain("Several channels came in at the same time");
  });
  it("one channel listed twice is not several channels", () => {
    const card = buildAlarmCard([
      "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 1", "=y.CTL+07-K4.1-2.",
      "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 1", "=y.CTL+07-K4.1-2.",
    ])!;
    expect(card.text).not.toContain("Several channels came in at the same time");
  });
});

describe("alarm card — a shown value", () => {
  it("either shows the value or leaves it on the photo; never fails the checker", () => {
    const card = buildAlarmCard([
      "112 06:02:17 11/05/2027 I Error: Temperature measurement LEFT WINDING too high",
      "=1.HYD+04-TE2 value 132.5 °C limit 120 °C",
    ])!;
    expect(card).not.toBeNull();
    passesCheckers(card.text);
    if (card.valuesRedacted) expect(card.text).toContain("values left on your photo");
  });
});
```

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run src/capabilities/alarm-card.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `mira-hub/src/capabilities/alarm-card.ts`

```ts
/**
 * The alarm card (spec 2026-10-12-alarm-reasoning-design.md §7). Deterministic: no
 * model in its path. Groups and parses the transcribed lines, looks up family packs,
 * and renders a fixed-order card that must pass validateAnswer and the energized-step
 * check UNMODIFIED — if it cannot, there is no card (the turn falls through).
 */
import { groupAlarmRecords, parseAlarmRecord, timeSeconds, type AlarmLine, type AlarmRecord } from "./alarm-line";
import { ALARM_PACKS, packFor, type AlarmPack } from "./alarm-packs/loader";
import { validateAnswer } from "./answer-validation";
import { stepEnergyContradiction } from "./step-energy";

export type AlarmCard = {
  text: string;
  lead: AlarmLine;
  covered: AlarmLine[];
  packIds: string[];
  packVersions: number[];
  firstOut: boolean;
  valuesRedacted: boolean;
};

const CUT_TIMES =
  "This screen cuts off the times, so it can't show which alarm came first — read it from the alarm history.";
const MIXED_DATES = "I can't order these alarms from this screen — read the order from the alarm history.";
const NOT_ON_VIEW = "The reading isn't shown on this screen — read it from the alarm history.";

export function packKey(l: AlarmLine): string | null {
  if (l.kind === "measurement_limit" && l.quantity === "temperature" && l.direction) {
    return `measurement_limit:temperature:${l.direction}`;
  }
  if (l.kind === "io_diagnostic" && l.diagnostic === "wire_break" && l.channel) {
    return `io_diagnostic:wire_break:${l.channel.io}`;
  }
  if (l.kind === "safety_passivation") return "safety_passivation";
  return null;
}

function fullSeconds(r: AlarmRecord): number | null {
  return r.time && !r.time.truncated ? timeSeconds(r.time.text) : null;
}

function pickLead(covered: AlarmLine[]): { lead: AlarmLine; firstOut: boolean; note: string | null } {
  // A passivation is the safety program's response; it never heads the card over a cause.
  const causes = covered.filter((l) => l.kind !== "safety_passivation");
  const pool = causes.length > 0 ? causes : covered;
  if (pool.length === 1) return { lead: pool[0], firstOut: false, note: null };
  const secs = pool.map((l) => fullSeconds(l.record));
  const dates = new Set(pool.map((l) => (l.record.date ? `${l.record.date.text}|${l.record.date.truncated}` : "")));
  const sameDay = dates.size === 1 && !pool.some((l) => l.record.date?.truncated);
  if (secs.every((s) => s !== null) && sameDay) {
    let best = 0;
    secs.forEach((s, i) => { if ((s as number) < (secs[best] as number)) best = i; });
    return { lead: pool[best], firstOut: true, note: null };
  }
  return { lead: pool[0], firstOut: false, note: secs.every((s) => s !== null) ? MIXED_DATES : CUT_TIMES };
}

function quote(r: AlarmRecord, redact: boolean): string {
  const text = redact
    ? r.text.replace(/(-?[\d?]+(?:[.,][\d?]+)?)(…|\.\.\.)?\s*(°C|°F|Ω|ohm|%|mA|V|A|bar)(?![A-Za-z])/g, "[on your photo]")
    : r.text;
  return r.count > 1 ? `${text} (×${r.count})` : text;
}

function sharedCause(covered: AlarmLine[]): boolean {
  const byTime = new Map<string, Set<string>>();
  for (const l of covered) {
    if (l.kind !== "io_diagnostic" || l.diagnostic !== "wire_break" || !l.record.time) continue;
    const who = `${l.designations[0]?.raw ?? ""}#${l.channel?.number ?? ""}`;
    const set = byTime.get(l.record.time.text) ?? new Set<string>();
    set.add(who);
    byTime.set(l.record.time.text, set);
  }
  return [...byTime.values()].some((s) => s.size >= 2);
}

function render(
  lead: AlarmLine,
  covered: AlarmLine[],
  uncovered: AlarmRecord[],
  orderNote: string | null,
  packs: readonly AlarmPack[],
  redact: boolean,
): string | null {
  const hit = packFor(packKey(lead)!, packs);
  if (!hit) return null;
  const { pack, entry } = hit;
  const rulesPack = packs.find((p) => p.rules) ?? null;
  const out: string[] = [];

  out.push(redact ? "**Alarm** — as read from your photo (values left on your photo)" : "**Alarm** — as read from your photo");
  out.push(`> ${quote(lead.record, redact)}`);
  if (lead.kind === "measurement_limit" && !lead.value.shown &&
      (lead.value.reason === "not_displayed" || lead.value.reason === "zero_and_zero_limit")) {
    out.push(NOT_ON_VIEW);
  }
  out.push("", "**What it means**", entry.means);
  out.push("", "**Two hypotheses**", `1. ${entry.hypotheses[0]}`, `2. ${entry.hypotheses[1]}`);

  const together: string[] = [];
  if (rulesPack?.rules?.shared_cause && sharedCause(covered)) together.push(rulesPack.rules.shared_cause);
  const hasWireBreak = covered.some((l) => l.kind === "io_diagnostic" && l.diagnostic === "wire_break");
  const hasPassivation = covered.some((l) => l.kind === "safety_passivation");
  if (rulesPack?.rules?.consequence && hasWireBreak && hasPassivation) together.push(rulesPack.rules.consequence);
  if (together.length) out.push("", "**Read together**", ...together);

  out.push("", "**Next three checks** (look and read only)", ...entry.checks.map((c, i) => `${i + 1}. ${c}`));

  const others = [...covered.filter((l) => l !== lead).map((l) => l.record), ...uncovered];
  if (others.length) out.push("", "**Also on this screen**", ...others.map((r) => `- ${quote(r, redact)}`));

  out.push("", "**What this does not prove**", ...entry.does_not_prove.map((d) => `- ${d}`));

  const cannot: string[] = [];
  if (orderNote) cannot.push(orderNote);
  if (covered.some((l) => l.fAddress?.truncated)) cannot.push("The F-I/O start addresses are cut off.");
  if (!lead.value.shown && (lead.value.reason === "truncated" || lead.value.reason === "unreadable")) {
    cannot.push("The reading is cut off or unreadable on this screen.");
  }
  if ([...covered.map((l) => l.record), ...uncovered].some((r) => r.text.includes("?"))) {
    cannot.push("Some characters could not be read; they are shown as ?.");
  }
  if (cannot.length) out.push("", "**What I could not read**", ...cannot.map((c) => `- ${c}`));

  const sources = [...new Set(covered.map((l) => packFor(packKey(l)!, packs)!.pack))]
    .map((p) => `${p.title} v${p.version}`).join(", ");
  out.push("", `Source: your photo · MIRA engineering reference — ${sources}`);
  out.push("", pack.site_procedure_line);
  return out.join("\n");
}

function passes(text: string): boolean {
  const v = validateAnswer({ answerText: text, question: "", general: false, served: true, refused: false, evidenceSufficient: true });
  return v.ok && stepEnergyContradiction(text) === null;
}

export function buildAlarmCard(lines: readonly string[], packs: readonly AlarmPack[] = ALARM_PACKS): AlarmCard | null {
  const records = groupAlarmRecords(lines);
  const covered: AlarmLine[] = [];
  const uncovered: AlarmRecord[] = [];
  for (const r of records) {
    const parsed = parseAlarmRecord(r);
    const key = parsed ? packKey(parsed) : null;
    if (parsed && key && packFor(key, packs)) covered.push(parsed);
    else uncovered.push(r);
  }
  if (covered.length === 0) return null;
  const { lead, firstOut, note } = pickLead(covered);
  const usedPacks = [...new Set(covered.map((l) => packFor(packKey(l)!, packs)!.pack))];
  const base = {
    lead, covered, firstOut,
    packIds: usedPacks.map((p) => p.pack_id),
    packVersions: usedPacks.map((p) => p.version),
  };

  const plain = render(lead, covered, uncovered, note, packs, false);
  if (plain && passes(plain)) return { ...base, text: plain, valuesRedacted: false };
  // The checker blocked something (e.g. a quoted rating). Leave values on the photo —
  // the checker is never weakened (spec §7).
  const redacted = render(lead, covered, uncovered, note, packs, true);
  if (redacted && passes(redacted)) return { ...base, text: redacted, valuesRedacted: true };
  return null;
}
```

- [ ] **Step 4: Run the tests** — Expected: PASS. If `validateAnswer` rejects a card, read its `violation` and `detail` (log them in a scratch test), then change the **card wording**. Never change `answer-validation.ts` or `step-energy.ts`. If a pack sentence is what trips the checker, change the pack text and re-run the Task 3 tests.

- [ ] **Step 5: Prove it.** Run each mutation alone, watch the named test fail, then restore:
  - In `pickLead`, drop the `causes` preference (`const pool = covered;`): "a passivation never leads" must fail.
  - Move the `pack.site_procedure_line` push to the top of `render`: "ends with the site-procedure line" must fail (and probably the energized-step check too).
  - Make `sharedCause` return `true`: "different visible times: no shared-cause note" must fail.
  - In `pickLead`, always return `firstOut: false`: "first-out" must fail.

- [ ] **Step 6: Typecheck and commit**

```bash
cd mira-hub && npx tsc --noEmit -p . && cd ..
git add mira-hub/src/capabilities/alarm-card.ts mira-hub/src/capabilities/alarm-card.test.ts
git commit -m "feat(hub): deterministic alarm card that passes the answer checker unmodified"
```

---

### Task 5: Chat fast path (PR C — stays draft until Task 6b passes)

**Files:**
- Create: `mira-hub/src/capabilities/alarm-fast-path.ts`
- Create: `mira-hub/src/capabilities/alarm-fast-path.test.ts`
- Create: `mira-hub/src/capabilities/__tests__/chat-alarm-fast-path.test.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` (one block, inserted right after the closing brace of `if (boundAsset.state === "unresolvable" && !safetyTrigger) { ... }`, near line 1586)

**Interfaces:**
- Consumes: `buildAlarmCard`, `AlarmCard` (Task 4); `loadScreenTextLines` (Task 1); `validateAnswer`, `chunkForRelease` (existing). In the route: `visualEntry`, `lookRow` (`.sessionId`), `safetyTrigger`, `identityDisputed`, `message`, `threadId`, `clientRequestId`, `requestClaimToken`, `docIds`, `assetSnapshot`, `releaseClaimOnFailure`, `recordTurn`, `finishAndPersist`, `rootTraceId`, `turnId`, `endRoot`, `rec`, `enc`, `sse`, `visualEvidenceMarker`, `withTenantContext`, `lifecycleOutcome` (all already in scope at the insertion point; verify each name with grep before writing).
- Produces: `alarmIntent(question: string, card: AlarmCard): boolean`, `alarmCardForTurn(opts: { question: string; lines: readonly string[] | null }): AlarmCard | null`, type `AlarmReadingEntry`, `alarmReadingEntry(fileId: string, card: AlarmCard): AlarmReadingEntry`.

- [ ] **Step 1: Write the failing unit test** — `mira-hub/src/capabilities/alarm-fast-path.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { alarmCardForTurn, alarmReadingEntry } from "./alarm-fast-path";
import { SCREEN_FAIL_SAFE, SCREEN_NEGATIVE } from "./alarm-screens.fixture";

describe("alarmCardForTurn", () => {
  it.each(["", "what does this alarm mean", "What do these alarms mean?", "why is this alarming", "what is this fault"])(
    "claims an alarm question: %j", (q) => {
      expect(alarmCardForTurn({ question: q, lines: SCREEN_FAIL_SAFE })).not.toBeNull();
    });
  it("claims a question that quotes a designation on the screen", () => {
    expect(alarmCardForTurn({ question: "what is =y.CTL+07-K4.1-6 doing", lines: SCREEN_FAIL_SAFE })).not.toBeNull();
  });
  it.each(["what is the torque spec for the motor mount", "show me the wiring for the pump"])(
    "falls through on an unrelated question: %j", (q) => {
      expect(alarmCardForTurn({ question: q, lines: SCREEN_FAIL_SAFE })).toBeNull();
    });
  it("falls through with no lines or non-alarm lines", () => {
    expect(alarmCardForTurn({ question: "what does this alarm mean", lines: null })).toBeNull();
    expect(alarmCardForTurn({ question: "what does this alarm mean", lines: SCREEN_NEGATIVE })).toBeNull();
  });
});

describe("alarmReadingEntry", () => {
  it("records packs and parsed records, never the card prose", () => {
    const card = alarmCardForTurn({ question: "", lines: SCREEN_FAIL_SAFE })!;
    const e = alarmReadingEntry("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", card);
    expect(e.kind).toBe("alarm_reading");
    expect(e.packIds).toEqual(["fail-safe-output"]);
    expect(e.records[0]).toMatchObject({ kind: "io_diagnostic", count: 2 });
    expect(JSON.stringify(e)).not.toContain("**What it means**");
  });
});
```

- [ ] **Step 2: Run it and watch it fail** → FAIL (module missing).

- [ ] **Step 3: Implement** — `mira-hub/src/capabilities/alarm-fast-path.ts`

```ts
/**
 * Notebook-chat fast path for the alarm card (spec §8, .claude/rules/fast-path-optimization.md).
 * Read-only, deterministic, claims a turn only for an alarm question about a photo
 * whose stored screen text produces a card; everything else falls through.
 */
import { buildAlarmCard, type AlarmCard } from "./alarm-card";
import { validateAnswer } from "./answer-validation";

const ALARM_INTENT =
  /\b(?:this|these|that|those) (?:alarm|alarms|fault|faults|error|errors)\b|\bwhat does (?:this|that|it) mean\b|\bwhy is (?:this|it) alarming\b|\bwhat(?:'s| is) this (?:fault|error|alarm)\b/i;

export function alarmIntent(question: string, card: AlarmCard): boolean {
  const q = question.trim();
  if (!q) return true;
  if (ALARM_INTENT.test(q)) return true;
  const lower = q.toLowerCase();
  return card.covered.some((l) => l.designations.some((d) => lower.includes(d.raw.toLowerCase())));
}

export function alarmCardForTurn(opts: { question: string; lines: readonly string[] | null }): AlarmCard | null {
  if (!opts.lines || opts.lines.length === 0) return null;
  const card = buildAlarmCard(opts.lines);
  if (!card || !alarmIntent(opts.question, card)) return null;
  const v = validateAnswer({
    answerText: card.text, question: opts.question, general: false, served: true, refused: false, evidenceSufficient: true,
  });
  return v.ok ? card : null;
}

export type AlarmReadingEntry = {
  kind: "alarm_reading";
  fileId: string;
  packIds: string[];
  packVersions: number[];
  records: { text: string; kind: string; designations: string[]; count: number }[];
};

export function alarmReadingEntry(fileId: string, card: AlarmCard): AlarmReadingEntry {
  return {
    kind: "alarm_reading",
    fileId,
    packIds: card.packIds,
    packVersions: card.packVersions,
    records: card.covered.map((l) => ({
      text: l.record.text,
      kind: l.kind,
      designations: l.designations.map((d) => d.raw),
      count: l.record.count,
    })),
  };
}
```

- [ ] **Step 4: Run the unit test** — Expected: PASS.

- [ ] **Step 5: Write the failing route test** — `mira-hub/src/capabilities/__tests__/chat-alarm-fast-path.test.ts`

Copy lines 21–136 of `mira-hub/src/app/api/equipment-notebooks/[id]/chat/__tests__/chat-look-grounding.test.ts` verbatim (imports, constants, all `vi.hoisted` mocks and `vi.mock` calls, `req`, `releasedContentOf`, `params`), and its `beforeEach` (lines 137–150). Change the route import to `import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";`. Add these above the route import:

```ts
const screenMock = vi.hoisted(() => ({ loadScreenTextLines: vi.fn(async () => null as string[] | null) }));
vi.mock("@/capabilities/screen-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/screen-text")>()),
  loadScreenTextLines: screenMock.loadScreenTextLines,
}));
import { SCREEN_FAIL_SAFE } from "@/capabilities/alarm-screens.fixture";
```

Then append:

```ts
describe("alarm card fast path", () => {
  beforeEach(() => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: CAPTURED_AT });
    screenMock.loadScreenTextLines.mockResolvedValue([...SCREEN_FAIL_SAFE]);
  });

  it("answers an alarm question from the card: no provider call, turn persisted as answered with both evidence entries", async () => {
    const res = await POST(req({ message: "what does this alarm mean", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(releasedContentOf(body)).toContain("**What it means**");
    expect(body).toContain('"status":"answered"');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const persisted = (nbMock.recordTurn.mock.calls[0] as unknown[])[2] as { answerStatus: string; evidence: { kind: string }[]; model: unknown };
    expect(persisted.answerStatus).toBe("answered");
    expect(persisted.model).toBeNull();
    expect(persisted.evidence.map((e) => e.kind)).toEqual(expect.arrayContaining(["visual_observation", "alarm_reading"]));
    expect(screenMock.loadScreenTextLines).toHaveBeenCalledWith(expect.anything(), TENANT, "s1");
  });

  it("falls through on an unrelated question", async () => {
    await POST(req({ message: "what is the torque spec for the motor mount", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    const persisted = nbMock.recordTurn.mock.calls.length
      ? ((nbMock.recordTurn.mock.calls[0] as unknown[])[2] as { evidence: { kind: string }[] })
      : { evidence: [] };
    expect(persisted.evidence.map((e) => e.kind)).not.toContain("alarm_reading");
  });

  it("falls through when no lines are stored", async () => {
    screenMock.loadScreenTextLines.mockResolvedValue(null);
    const res = await POST(req({ message: "what does this alarm mean", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    expect(releasedContentOf(await res.text())).not.toContain("**What it means**");
  });

  it("falls through when loading the lines throws", async () => {
    screenMock.loadScreenTextLines.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ message: "what does this alarm mean", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    expect(res.status).toBe(200);
    expect(releasedContentOf(await res.text())).not.toContain("**What it means**");
  });

  it("never claims a turn whose photo carries a blocking hazard", async () => {
    veMock.loadVisualEvidenceForPhoto.mockResolvedValueOnce({
      ...(await veMock.loadVisualEvidenceForPhoto()),
      hazards: [{ code: "smoke", confidence: 0.95 }],
    } as never);
    const res = await POST(req({ message: "what does this alarm mean", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    expect(releasedContentOf(await res.text())).not.toContain("**What it means**");
  });

  it("control: no photo, no fast path", async () => {
    filesMock.photoLinkedToTarget.mockResolvedValue(null);
    await POST(req({ message: "what does this alarm mean", mode: "general" }), params);
    expect(screenMock.loadScreenTextLines).not.toHaveBeenCalled();
  });
});
```

If the harness's `req`/`params` names differ, use the harness's own names. Those helpers are copied verbatim; read them before writing the assertions.

- [ ] **Step 6: Run it and watch it fail** — Expected: the first test FAILS (no card content). The fall-through tests pass trivially; they are proven by the mutations in Step 9.

- [ ] **Step 7: Insert the fast path in the route.** Add imports beside the other `@/capabilities` imports:

```ts
import { alarmCardForTurn, alarmReadingEntry } from "@/capabilities/alarm-fast-path";
import { loadScreenTextLines } from "@/capabilities/screen-text";
```

Insert right after the closing `}` of the `if (boundAsset.state === "unresolvable" && !safetyTrigger) { ... }` block:

```ts
  // Alarm card fast path (spec docs/superpowers/specs/2026-10-12-alarm-reasoning-design.md §8;
  // .claude/rules/fast-path-optimization.md). A verified photo whose stored screen text
  // produces a card, asked about as an alarm, is answered from the deterministic card:
  // no retrieval, no provider. Read-only. Any miss or error falls through unchanged.
  // A flagged hazard turn never takes this path (its banner + normal answer own it).
  if (visualEntry && lookRow && !safetyTrigger && !identityDisputed) {
    let alarmCard: ReturnType<typeof alarmCardForTurn> = null;
    try {
      const sessionId = lookRow.sessionId;
      const lines = await withTenantContext(ctx.tenantId, (c) => loadScreenTextLines(c, ctx.tenantId, sessionId));
      alarmCard = alarmCardForTurn({ question: message, lines });
    } catch (err) {
      console.error("[notebook-chat] alarm card skipped (falling through):", err instanceof Error ? err.message : err);
    }
    if (alarmCard) {
      const cardText = alarmCard.text;
      lifecycleOutcome = "answered";
      rec.stage("alarm_card", {
        claimed: true,
        pack_ids: alarmCard.packIds,
        covered: alarmCard.covered.length,
        first_out: alarmCard.firstOut,
        values_redacted: alarmCard.valuesRedacted,
      });
      const cardTurnRowId = await releaseClaimOnFailure(() => recordTurn(ctx.tenantId, notebookId, {
        ownerUserId: ctx.userId,
        threadId,
        clientRequestId,
        claimToken: requestClaimToken,
        question: message,
        answerStatus: "answered",
        answerText: cardText,
        enabledSourceDocIds: docIds,
        evidence: [visualEntry, alarmReadingEntry(visualEntry.fileId, alarmCard)],
        model: null,
        ...assetSnapshot,
      }));
      await finishAndPersist(cardTurnRowId, {
        provider: null, model: null, routeReason: "alarm_card", inputTokens: null, cachedInputTokens: null,
        outputTokens: null, costUsdEstimate: null, status: "empty", attempted: [],
      }, { answerText: cardText, citationsPresent: false, latencyMs: null });
      endRoot();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (rootTraceId) {
            const traceFrame: NotebookTraceFrame = { kind: "trace", traceId: rootTraceId, turnId };
            controller.enqueue(enc.encode(sse(traceFrame)));
          }
          for (const piece of chunkForRelease(cardText)) {
            controller.enqueue(enc.encode(sse({ kind: "content", content: piece } as NotebookContentFrame)));
          }
          const sources: NotebookSourcesFrame = { kind: "sources", citations: [], sourceSnapshot: docIds };
          controller.enqueue(enc.encode(sse(sources)));
          controller.enqueue(enc.encode(sse(visualEvidenceMarker(visualEntry))));
          const status: NotebookStatusFrame = { kind: "status", status: "answered" };
          controller.enqueue(enc.encode(sse(status)));
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          ...(rootTraceId ? { "x-mira-trace-id": rootTraceId } : {}),
        },
      });
    }
  }
```

Before inserting, confirm that every identifier used above is in scope at that line: `grep -n -E "const (enc|rootTraceId|turnId|docIds|assetSnapshot|identityDisputed|clientRequestId)\b|let (requestClaimToken|lifecycleOutcome)\b|const finishAndPersist|const releaseClaimOnFailure|const endRoot|const rec\b" "mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts"`. If one is declared **after** the insertion point (for example `enc` at line ~2087), declare a local `const cardEnc = new TextEncoder();` instead and use it. Never move existing declarations. If `rec.stage` rejects the unknown stage name `alarm_card` at type level, record the same fields under the existing stage the abstain path uses (`answer_gate`, with `decision: "alarm_card"`). Check its type first.

- [ ] **Step 8: Run the new tests plus every existing notebook-chat suite** — Expected: all PASS.

Run: `cd mira-hub && npx vitest run src/capabilities/alarm-fast-path.test.ts src/capabilities/__tests__/chat-alarm-fast-path.test.ts "src/app/api/equipment-notebooks/[id]/chat"`

- [ ] **Step 9: Prove it.** Run each mutation alone, watch the named test fail, then restore:
  - Remove `!safetyTrigger &&`: "never claims a turn whose photo carries a blocking hazard" must fail.
  - Make `alarmIntent` return `true`: "falls through on an unrelated question" (route and unit) must fail.
  - Remove the `try/catch` around the load: "falls through when loading the lines throws" must fail (500 or throw).
  - Drop `alarmReadingEntry(...)` from `evidence`: the first route test must fail.

- [ ] **Step 10: Full hub suite, typecheck, commit, open PR C as draft**

```bash
cd mira-hub && npx vitest run && npx tsc --noEmit -p . && cd ..
git add mira-hub/src/capabilities/alarm-fast-path.ts mira-hub/src/capabilities/alarm-fast-path.test.ts \
  mira-hub/src/capabilities/__tests__/chat-alarm-fast-path.test.ts "mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts"
git commit -m "feat(hub): notebook chat answers an alarm-list photo with the deterministic alarm card"
gh pr create --draft ...   # body states: stays draft until the fidelity run (Task 6b) passes
```

Compare the full-suite result against `origin/main`: a failure that also fails on main is pre-existing (name it in the PR body); a new failure is yours.

---

### Task 6a: Fidelity tooling (PR B)

**Files:**
- Create: `tools/alarm-fidelity/alarm-page.html`
- Create: `tools/alarm-fidelity/truth.json`
- Create: `tools/alarm-fidelity/score.ts`
- Create: `tools/alarm-fidelity/score.test.ts` (run with `cd mira-hub && npx vitest run --root .. tools/alarm-fidelity/score.test.ts`; if the root config refuses, put the test beside `score.ts` and run it with `npx tsx tools/alarm-fidelity/score.test.ts` using `node:assert`)
- Create: `docs/runbooks/alarm-fidelity-capture.md`

**Interfaces:**
- `truth.json`: `{ "screens": [{ "id": "fs-1", "lines": string[], "records": string[] }] }`. `records` holds the exact joined text of each record.
- `score.ts` exports `scoreScreen(truth: { lines: string[]; records: string[] }, transcribed: string[]): { designationExact: number; designationTotal: number; inventedInCutFields: number; recordsCorrect: number; recordsTotal: number }` and `gate(results): { pass: boolean; designationRate: number; groupingRate: number; invented: number }`. `pass` is designationRate ≥ 0.9, groupingRate ≥ 0.9, and invented === 0.

- [ ] **Step 1: Write `alarm-page.html`.** One self-contained page with no external assets. Dark background, a header row `No. Time Date Status Text`, and the rows of `SCREEN_FAIL_SAFE` and `SCREEN_RTD` laid out in columns. Each message wraps onto continuation lines exactly as in the fixture. Cut-off fields show a literal `…`. The rows are red, with the first row "selected" (darker). Font 18–22px monospace-like sans, sized so the list fills a laptop screen. Use only the fixture strings: copy them from `mira-hub/src/capabilities/alarm-screens.fixture.ts`.

- [ ] **Step 2: Write `truth.json`** from the same fixture strings. `lines` are the visual lines without the header. `records` are the expected joined texts, which are exactly what `groupAlarmRecords` produces **before** duplicate collapse. Get them by running a scratch script over the fixtures; do not hand-type them.

- [ ] **Step 3: Write the failing scorer test, then `score.ts`.** Rules the test pins:
  - **designationExact:** every designation token in `truth.lines` (regex from `alarm-line.ts` `DESIGNATION`) appears byte-exact in the transcribed lines. A `…` that is present counts as part of exact.
  - **inventedInCutFields:** for each truth token ending in `…`, look in the transcription for its prefix (the text before `…`) followed by one or more characters other than `…`/`.` — any such hit is an invented completion. Example: truth `08:14:3…`, transcribed `08:14:35` → 1 invented.
  - **recordsCorrect:** run `groupAlarmRecords` (import from `../../mira-hub/src/capabilities/alarm-line`) on the transcription without collapsing — call the exported grouping and compare against `records` by position. Expose an option `{ collapse: false }`, or compare `lines`/`text` before the counts are merged. If adding that option, add it to `alarm-line.ts` with a test in Task 2's file. Count positions where the text matches exactly.
  - Test cases: perfect transcription → all rates 1, invented 0, `pass` true. One completed cut-off → invented 1, `pass` false. One designation off by a character → designationExact = total − 1. Two records merged → recordsCorrect drops by 2.

- [ ] **Step 4: Write the run sheet** `docs/runbooks/alarm-fidelity-capture.md`. It is for Mike, in plain words:
  - Open `tools/alarm-fidelity/alarm-page.html` full screen on a laptop.
  - Take 10 photos with the Pixel in the FactoryLM app as LOOK photos in a test notebook on **staging**: 3 straight on, 3 angled about 30° left or right, 2 with overhead glare, 2 from about 1.5 m. The screen must fill at least half the frame.
  - Ask nothing, or "what does this alarm mean". Do not delete any photo afterwards.
  - Tell the session the notebook name.
  - **Cost:** 10 LOOK vision calls at gpt-5.4-mini prices — well under the $1.00 cap. The session records the actual spend from `decision_traces`.

- [ ] **Step 5: Commit** (PR B): `git add tools/alarm-fidelity docs/runbooks/alarm-fidelity-capture.md` + `git commit -m "test(hub): alarm fidelity page, ground truth, scorer and capture run sheet"`.

### Task 6b: Fidelity run (after PR B is deployed to staging; Mike holds the phone)

- [ ] Mike runs the capture sheet on staging.
- [ ] Read the stored `screen_text_lines` for those 10 photos through a **read-only** staging query (`db-inspect.yml` or psql against `factorylm/stg`, never prod). Filter on the test notebook's visual sessions.
- [ ] Score them with `score.ts`. Post the per-photo table and the gate result on PR C.
- [ ] **Pass:** mark PR C ready for review → Codex exact-head review → merge → staging → acceptance → prod (the `ship` skill chain).
- [ ] **Fail:** do not ship PR C. Run the same 10 stored photos through the OCR client (`mira-hub/src/lib/photo-ocr.ts`) with no new photos, score them, and report both results to Mike with a recommendation.

---

## Self-review (done while writing)

- **Spec coverage:** §4 → Task 1; §4.3 fallback → Task 6b; §5.1–5.3 → Task 2; §6 + banned list → Task 3; §7 lead rules, cross-record rules, could-not-read, checker compatibility, section order → Task 4; §8 trigger, read-only, fall-through, evidence entry, draft-until-gate → Task 5; §9 golden/negative sets, guards, route tests, fidelity, safety review → Tasks 2–6; §12.0 upload logging → Task 0.
- **Known gap, accepted:** spec §9 asks for "~40" golden records. This plan's fixtures plus parse cases come to about 30. Add more of the same shape only if a mutation shows a rule with no failing test.
- **Companion-signal absence wording (spec §7):** no slice-1 pack names a companion signal, so the rule has nothing to fire on. The "never asserts absence" test guards the wording.
