/**
 * Turn Flight Recorder — /look route wiring (lane I2).
 *
 * Design: docs/architecture/observability/2026-09-22-turn-flight-recorder.md
 * §3/§7. One happy path: root `mira.turn` (kind="look") span + its
 * `attachment.persist` and `chat <model>` children, a `kind:"look"` packet.
 *
 * The `kind:"look"` packet is persisted through the one ledger writer
 * (`persistTurnUsage`, platform `hub_notebook_look`), mocked here; the raw
 * pool must still never see a knowledge_entries write.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { __testing__installInMemoryExporter } from "@/capabilities/observability/tracing";

const NOTEBOOK_ID = "11111111-2222-3333-4444-555555555555";
const NODE_ID = "99999999-8888-7777-6666-555555555555";
const FILE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TENANT_ID = "tenant-aaaa-bbbb";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({
  getNotebook: vi.fn(),
  updateNotebook: vi.fn(),
  markNameplateDocVerified: vi.fn(),
  recordTurn: vi.fn(async () => "ffffffff-ffff-4fff-8fff-ffffffffffff"),
  normalizeNotebookThreadId: (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null,
}));
vi.mock("@/lib/workspace-files", () => ({
  parkOrReuseFile: vi.fn(),
  attachFileToTargets: vi.fn(),
  sha256Hex: vi.fn(() => "photo-sha256"),
}));
vi.mock("@/lib/visual-evidence-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/visual-evidence-context")>();
  return {
    ...actual,
    recordLookObservation: vi.fn(async () => ({
      sessionId: "session-1",
      evidenceId: "evidence-1",
      observationId: "observation-1",
    })),
  };
});
vi.mock("@/lib/nameplate", () => ({
  isRecognizerConfigured: vi.fn(),
  fixtureSelected: vi.fn(),
}));
vi.mock("@/lib/nameplate/detect", () => ({ resolveRecognitionImage: vi.fn() }));
vi.mock("@/lib/nameplate/passes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/nameplate/passes")>();
  return { ...real, togetherVisionCall: vi.fn() };
});
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
const persistMock = vi.hoisted(() => ({
  persistTurnUsage: vi.fn<typeof import("@/lib/inference/persist-usage").persistTurnUsage>(
    async () => ({ persisted: true, traceId: "00000000-0000-4000-8000-000000000000" }) as const,
  ),
}));
vi.mock("@/lib/inference/persist-usage", () => persistMock);

import { POST } from "../[id]/look/route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { parkOrReuseFile, attachFileToTargets } from "@/lib/workspace-files";
import { isRecognizerConfigured, fixtureSelected } from "@/lib/nameplate";
import { resolveRecognitionImage } from "@/lib/nameplate/detect";
import { togetherVisionCall } from "@/lib/nameplate/passes";
import pool from "@/lib/db";

const session = { userId: "u_1", tenantId: TENANT_ID, email: "x@y", status: "trial", trialExpiresAt: null };
const notebook = {
  id: NOTEBOOK_ID,
  displayName: "Line 3 Case Packer",
  manufacturer: "Nobody Inc",
  model: "RIDE-1",
  nodeId: NODE_ID,
} as never;

const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

function makeReq(): Request {
  const fd = new FormData();
  fd.append("image", new File([new Uint8Array(JPEG_MAGIC).buffer], "connector.jpg", { type: "image/jpeg" }));
  return new Request(`https://hub.test/api/equipment-notebooks/${NOTEBOOK_ID}/look`, {
    method: "POST",
    body: fd,
  }) as never;
}

let handle: ReturnType<typeof __testing__installInMemoryExporter>;
beforeAll(() => {
  handle = __testing__installInMemoryExporter();
});

beforeEach(() => {
  vi.resetAllMocks();
  handle.reset();
  persistMock.persistTurnUsage.mockResolvedValue({ persisted: true, traceId: "00000000-0000-4000-8000-000000000000" });
  vi.mocked(sessionOr401).mockResolvedValue(session);
  vi.mocked(getNotebook).mockResolvedValue(notebook);
  vi.mocked(parkOrReuseFile).mockResolvedValue({ fileId: FILE_ID, reused: false, uploadId: null });
  vi.mocked(attachFileToTargets).mockResolvedValue({
    ok: true,
    links: [{ linkId: "link-1", targetType: "equipment_notebook", targetId: NOTEBOOK_ID }],
  });
  vi.mocked(isRecognizerConfigured).mockReturnValue(true);
  vi.mocked(fixtureSelected).mockReturnValue(false);
  vi.mocked(resolveRecognitionImage).mockImplementation(async (base64, mimeType) => ({
    base64,
    mimeType,
    imageSource: { kind: "original_photo" as const },
  }));
  vi.mocked(togetherVisionCall).mockResolvedValue({
    text: JSON.stringify({ observation: "Green indicator lit; connector seated.", hazards: [] }),
    model: "vision-test",
  });
});

describe("mira.turn (kind=look) span tree", () => {
  it("root span + attachment.persist + chat <model>, and a persisted kind:look packet — no product-data write", async () => {
    const res = await POST(makeReq() as never, makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.observation.text).toContain("Green indicator lit");

    // Observations are conversation context, never a citable source: the raw
    // pool never sees a knowledge_entries write. The ledger row is the one
    // legitimate side effect and goes through persistTurnUsage (mocked).
    const sql = [...vi.mocked(pool.query).mock.calls, ...vi.mocked(pool.connect).mock.calls]
      .map((c) => String((c as unknown[])[0] ?? ""))
      .join("\n");
    expect(sql).not.toMatch(/knowledge_entries/i);
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);
    const call = persistMock.persistTurnUsage.mock.calls[0]!;
    const [scope, usage, record] = call;
    expect(scope.platform).toBe("hub_notebook_look");
    expect(scope.question).toBe("");
    expect(usage.provider).toBe("together");
    expect(usage.status).toBe("ok");
    expect(record?.packet.kind).toBe("look");
    expect(record?.packet.vision.ran).toBe(true);
    expect(record?.packet.vision.observation_chars).toBeGreaterThan(0);
    expect(record?.otelTraceId).toBe(res.headers.get("x-mira-trace-id"));

    const traceId = res.headers.get("x-mira-trace-id");
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(body.traceId).toBe(traceId);

    const spans = handle.finished();
    const root = spans.find((s) => s.name === "mira.turn");
    expect(root).toBeTruthy();
    expect(root!.attributes["mira.turn.kind"]).toBe("look");
    expect(root!.spanContext().traceId).toBe(traceId);

    const attach = spans.find((s) => s.name === "attachment.persist");
    expect(attach).toBeTruthy();
    expect(attach!.attributes["mira.file.id"]).toBe(FILE_ID);
    expect(attach!.attributes["mira.file.dedup_hit"]).toBe(false);
    expect(attach!.attributes["mira.file.link_ok"]).toBe(true);

    const gen = spans.find((s) => s.name.startsWith("chat "));
    expect(gen).toBeTruthy();
    expect(gen!.name).toBe("chat vision-test");
    expect(gen!.attributes["gen_ai.provider.name"]).toBe("together");
    expect(gen!.attributes["mira.vision.ok"]).toBe(true);

    // Every span shares the one trace.
    for (const s of spans) expect(s.spanContext().traceId).toBe(traceId);
  });
});
