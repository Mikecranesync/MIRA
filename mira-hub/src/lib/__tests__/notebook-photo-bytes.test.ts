/**
 * NOTEBOOK PHOTO BYTES — the authorization gate for bytes that LEAVE THE
 * BUILDING.
 *
 * Run: npx vitest run notebook-photo-bytes
 *
 * These bytes are base64'd into a request to a third-party inference provider.
 * A mistake here does not leak a row — it ships one customer's photograph of
 * their control panel into another customer's answer. So this file is written
 * as an adversary: every case drives a HOSTILE id or a MISLABELLED file and
 * asserts BOTH that the result is `null` AND that the byte query never ran.
 *
 * The last test is the important one for the future: it pins
 * `photoLinkedToTarget` as the SOLE authorization path. If someone later
 * "optimizes" this module by inlining a tenant predicate instead of calling it,
 * that test fails — which is the only way a second, drifting authorization path
 * gets caught before it ships.
 *
 * The fake DB below evaluates the real SQL predicates against a fixture world
 * rather than returning canned rows, so `role = 'photo'`, the tenant columns,
 * and `octet_length(content) <= $3` are actually exercised.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const NB = "22222222-2222-4222-8222-222222222222";
const OTHER_NB = "88888888-8888-4888-8888-888888888888";
const FILE = "f0000000-0000-4000-8000-000000000001";
const CREATED_AT = "2026-09-01T12:00:00.000Z";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF_BYTES = Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1");

type Link = { tenantId: string; fileId: string; targetType: string; targetId: string; role: string };
type FileRow = {
  id: string;
  tenantId: string;
  filename: string | null;
  mimeType: string | null;
  content: Buffer | null;
};

const world = vi.hoisted(() => ({
  links: [] as Link[],
  files: [] as FileRow[],
  /** Every SQL string the module actually executed, in order. */
  executed: [] as string[],
}));

/**
 * A fake `withTenantContext` that EVALUATES the two real queries against
 * `world`. Dispatch is by the one token that distinguishes them: the link query
 * names `workspace_file_links`, the byte query names `octet_length(content)`.
 */
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: async (sql: string, params: unknown[]) => {
        world.executed.push(sql);
        if (/workspace_file_links/.test(sql)) {
          const [tenantId, fileId, targetType, targetId] = params as string[];
          const link = world.links.find(
            (l) =>
              l.tenantId === tenantId &&
              l.fileId === fileId &&
              l.targetType === targetType &&
              l.targetId === targetId &&
              l.role === "photo", // the SQL predicate, honoured
          );
          if (!link) return { rows: [] };
          // The SQL JOINs on f.id = l.file_id AND f.tenant_id = l.tenant_id.
          const f = world.files.find((x) => x.id === link.fileId && x.tenantId === link.tenantId);
          if (!f) return { rows: [] };
          return {
            rows: [
              {
                file_id: f.id,
                mime_type: f.mimeType,
                filename: f.filename,
                created_at: CREATED_AT,
              },
            ],
          };
        }
        if (/octet_length\(content\)/.test(sql)) {
          const [id, tenantId, maxBytes] = params as [string, string, number];
          const f = world.files.find((x) => x.id === id && x.tenantId === tenantId);
          if (!f || f.content == null) return { rows: [] };
          if (f.content.length > maxBytes) return { rows: [] }; // the SQL cap
          return { rows: [{ filename: f.filename, mime_type: f.mimeType, content: f.content }] };
        }
        throw new Error(`unexpected SQL in notebook-photo-bytes: ${sql}`);
      },
    }),
  ),
}));

// The module under test must call the REAL photoLinkedToTarget — this wrapper
// only counts the calls, so "is it still the sole gate?" is assertable.
const linkSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/workspace-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace-files")>();
  return {
    ...actual,
    photoLinkedToTarget: vi.fn(async (...args: Parameters<typeof actual.photoLinkedToTarget>) => {
      linkSpy.calls += 1;
      return actual.photoLinkedToTarget(...args);
    }),
  };
});

import { readLinkedPhotoBytes } from "@/lib/notebook-photo-bytes";

const MAX = 4 * 1024 * 1024;

/** How many times the BYTE query ran. The number that matters for a leak. */
function byteQueries(): number {
  return world.executed.filter((s) => /octet_length\(content\)/.test(s)).length;
}

/** The ordinary, correct world: one JPEG photo linked to NB in TENANT. */
function goodPhoto(over: Partial<FileRow> = {}, role = "photo") {
  world.links = [{ tenantId: TENANT, fileId: FILE, targetType: "equipment_notebook", targetId: NB, role }];
  world.files = [
    { id: FILE, tenantId: TENANT, filename: "panel.jpg", mimeType: "image/jpeg", content: JPEG, ...over },
  ];
}

beforeEach(() => {
  world.links = [];
  world.files = [];
  world.executed = [];
  linkSpy.calls = 0;
});

// ─────────────────────────────────────────────────────────────────────────────
describe("1. the happy path", () => {
  it("returns the bytes, the SNIFFED mime, and a SERVER-derived capturedAt", async () => {
    goodPhoto();
    const got = await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", NB, MAX);
    expect(got).not.toBeNull();
    expect(got!.fileId).toBe(FILE);
    expect(got!.buffer.equals(JPEG)).toBe(true);
    expect(got!.mimeType).toBe("image/jpeg");
    expect(got!.filename).toBe("panel.jpg");
    // Derived from the stored row's created_at — never from any caller input.
    expect(got!.capturedAt).toBe(CREATED_AT);
  });

  it("a PNG is read as image/png", async () => {
    goodPhoto({ mimeType: "image/png", filename: "panel.png", content: PNG });
    const got = await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", NB, MAX);
    expect(got!.mimeType).toBe("image/png");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. TENANT SAFETY — the cases that would ship a customer's photo elsewhere.
// ─────────────────────────────────────────────────────────────────────────────
describe("2. tenant safety — hostile ids never reach the bytes", () => {
  it("ANOTHER tenant asking for this file gets null, and the byte query NEVER runs", async () => {
    goodPhoto();
    const got = await readLinkedPhotoBytes(OTHER_TENANT, FILE, "equipment_notebook", NB, MAX);
    expect(got).toBeNull();
    expect(byteQueries()).toBe(0);
  });

  it("a file linked to a DIFFERENT notebook gets null, and the byte query NEVER runs", async () => {
    goodPhoto();
    const got = await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", OTHER_NB, MAX);
    expect(got).toBeNull();
    expect(byteQueries()).toBe(0);
  });

  it("a malformed (non-UUID) file id gets null with no query at all", async () => {
    goodPhoto();
    const got = await readLinkedPhotoBytes(TENANT, "../../etc/passwd", "equipment_notebook", NB, MAX);
    expect(got).toBeNull();
    expect(world.executed).toHaveLength(0);
  });

  it("a file whose row belongs to another tenant is invisible even with a matching link", async () => {
    // A link row that claims this tenant, but the FILE is owned elsewhere: the
    // JOIN's `f.tenant_id = l.tenant_id` is what refuses it.
    world.links = [
      { tenantId: TENANT, fileId: FILE, targetType: "equipment_notebook", targetId: NB, role: "photo" },
    ];
    world.files = [
      { id: FILE, tenantId: OTHER_TENANT, filename: "panel.jpg", mimeType: "image/jpeg", content: JPEG },
    ];
    expect(await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", NB, MAX)).toBeNull();
    expect(byteQueries()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. NOT A PHOTOGRAPH — role and capability.
// ─────────────────────────────────────────────────────────────────────────────
describe("3. only a file linked AS A PHOTO, of a viewable raster type", () => {
  it("role 'manual' is refused before the bytes are touched", async () => {
    goodPhoto({}, "manual");
    expect(await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", NB, MAX)).toBeNull();
    expect(byteQueries()).toBe(0);
  });

  it("a PDF linked as a photo is refused before the bytes are touched", async () => {
    goodPhoto({ mimeType: "application/pdf", filename: "manual.pdf", content: PDF_BYTES });
    expect(await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", NB, MAX)).toBeNull();
    expect(byteQueries()).toBe(0);
  });

  it("image/svg+xml is refused — it is scriptable and deliberately not viewable", async () => {
    goodPhoto({ mimeType: "image/svg+xml", filename: "diagram.svg", content: Buffer.from("<svg/>") });
    expect(await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", NB, MAX)).toBeNull();
    expect(byteQueries()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE BYTES ARE THE ONLY CLAIM NOBODY MADE.
// ─────────────────────────────────────────────────────────────────────────────
describe("4. magic bytes — the sniff wins over the declared type", () => {
  it("a file DECLARED image/jpeg whose bytes are a PDF is refused", async () => {
    // `role` on an attach request is client-supplied and unvalidated, and the
    // declared MIME is another client claim. Only the header is not.
    goodPhoto({ mimeType: "image/jpeg", filename: "panel.jpg", content: PDF_BYTES });
    const got = await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", NB, MAX);
    expect(got).toBeNull();
    // The bytes WERE fetched (the declaration got it that far) — and then
    // refused. This is exactly the gate `effectiveImageMime` would not apply.
    expect(byteQueries()).toBe(1);
  });

  it("an empty file is refused", async () => {
    goodPhoto({ content: Buffer.alloc(0) });
    expect(await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", NB, MAX)).toBeNull();
  });

  it("a NULL content column is refused (a chunks-only doc has no bytes)", async () => {
    goodPhoto({ content: null });
    expect(await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", NB, MAX)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("5. the size cap is enforced in SQL", () => {
  it("bytes over the cap never come back", async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(4096)]);
    goodPhoto({ content: big });
    expect(await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", NB, 1024)).toBeNull();
    // The query ran, but the row was rejected by `octet_length(content) <= $3`,
    // so the bytes never crossed the wire into the heap.
    expect(byteQueries()).toBe(1);
  });

  it("a non-positive cap short-circuits before any query", async () => {
    goodPhoto();
    expect(await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", NB, 0)).toBeNull();
    expect(world.executed).toHaveLength(0);
  });

  it("bytes at exactly the cap are allowed", async () => {
    goodPhoto();
    const got = await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", NB, JPEG.length);
    expect(got).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE LOCK — one authorization path, forever.
// ─────────────────────────────────────────────────────────────────────────────
describe("6. photoLinkedToTarget is the SOLE authorization path", () => {
  it("is called on the happy path", async () => {
    goodPhoto();
    await readLinkedPhotoBytes(TENANT, FILE, "equipment_notebook", NB, MAX);
    expect(linkSpy.calls).toBe(1);
  });

  it("is called FIRST — when it refuses, nothing else runs", async () => {
    goodPhoto();
    await readLinkedPhotoBytes(OTHER_TENANT, FILE, "equipment_notebook", NB, MAX);
    expect(linkSpy.calls).toBe(1);
    // If a future edit inlines its own tenant predicate instead of calling the
    // shared one, this is the assertion that fails.
    expect(byteQueries()).toBe(0);
  });
});
