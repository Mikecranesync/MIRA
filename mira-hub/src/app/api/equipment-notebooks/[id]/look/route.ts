/**
 * POST /api/equipment-notebooks/[id]/look
 *
 * Sensor v0 · LOOK (contract §4.1, docs/prd/2026-08-28-sensor-v0-contract.md).
 * A technician photographs a component/connector/indicator INSIDE a notebook
 * and gets back an *observation*: what is visible in the frame, nothing more.
 *
 * Mirrors `nameplate/recognize` — same session, ownership, multipart, MIME
 * sniff, cap, park-then-link discipline — and differs in exactly one thing:
 * the vision pass is a fixed INSPECTION prompt over `togetherVisionCall`
 * (`@/lib/nameplate/passes`) instead of a nameplate recognizer.
 *
 * Laws honored here:
 * 1. PARK BEFORE VISION. The photo survives a 502/503; the response always
 *    carries `fileId` + `attachment` (SHA-256 dedup via parkOrReuseFile; the
 *    link upsert is idempotent, so re-posting the same bytes never duplicates).
 * 2. OBSERVATIONS ONLY. The prompt forbids diagnosis and hidden-state guesses.
 *    The text is returned as conversation context (`provenance:"phone_photo"`,
 *    `capturedAt` = server receipt time). It is NOT written to
 *    `knowledge_entries`, never marked verified, never touches the notebook's
 *    identity fields. Citable-source materialization stays behind the existing
 *    confirmation doors (#3440) — this route opens none.
 *
 * JSON shape (documented here, no shared type — one consumer today):
 *   200 { fileId, attachment:{linkId,notebookId}, clientKey?,
 *         observation:{ text, capturedAt, provenance:"phone_photo", model } }
 *   502/503 { error, message, reason, fileId, attachment, clientKey?, observation:null }
 *   `quality` (assessCapture) is deliberately absent: assessCapture is pure
 *   over DECODED grayscale pixels and the Hub has no image decoder, so the
 *   retake hint is a client-side call (see capture-quality.ts header).
 *
 * TURN FLIGHT RECORDER (docs/architecture/observability/2026-09-22-turn-flight-
 * recorder.md §3/§4, lane I2): a `mira.turn` root span (kind="look") wraps the
 * whole request, with `attachment.persist` and a per-vision-call `chat <model>`
 * child. `x-mira-trace-id` is set and `traceId` rides in the JSON body
 * (additive). The `kind:"look"` Turn Evidence Packet is persisted through the
 * same single ledger writer as chat (`persistTurnUsage`, platform
 * `hub_notebook_look`, empty question) — last and non-fatal, after the
 * response body is fixed. Observations remain conversation context, never a
 * citable source: nothing here writes knowledge_entries or touches identity.
 *
 * #3967 — observations carry notebook/owner/thread association in the existing
 * VisualSession ledger. LOOK is not an answered chat turn and writes no fake
 * question/answer pair into conversation history.
 */
import { NextRequest, NextResponse } from "next/server";
import { context, trace, type Span } from "@opentelemetry/api";
import { getTracer, setSpanAttrs, type SpanAttrs } from "@/capabilities/observability/tracing";
import { startTurnRecorder } from "@/capabilities/observability/turn-recorder";
import { closeTurn, openTurn, type TurnOutcome } from "@/capabilities/observability/turn-lifecycle";
import {
  recordArrival,
  recordResponse,
  type IngressRecord,
} from "@/capabilities/observability/turn-ingress";
import {
  anomalyChecksEnabled,
  environmentName,
  gitSha,
  productionRouteDetected,
  serviceVersion,
} from "@/capabilities/observability/config";
import { persistTurnUsage } from "@/lib/inference/persist-usage";
import type { TurnUsage } from "@/lib/inference/canonical-cascade";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, normalizeNotebookThreadId } from "@/lib/equipment-notebooks";
import { parkOrReuseFile, attachFileToTargets, sha256Hex } from "@/lib/workspace-files";
import {
  normalizeLookHazards,
  recordLookObservation,
  type LookHazardDescriptor,
} from "@/lib/visual-evidence-context";
import { isRecognizerConfigured, fixtureSelected } from "@/lib/nameplate";
import { effectiveImageMime } from "@/lib/nameplate/image-mime";
import { resolveRecognitionImage } from "@/lib/nameplate/detect";
import { togetherVisionCall, openaiVisionCall, safeJson, type VisionCall } from "@/lib/nameplate/passes";

import { prepareInspectionImage, type InspectionPreprocessing } from "@/lib/nameplate/preprocess";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Raster safelist mirrors workspace-files' VIEWABLE_IMAGE_MIMES. SVG is
// deliberately absent — it is scriptable, and this door accepts camera photos.
const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUESTION_CHARS = 500;
const MAX_CLIENT_KEY_CHARS = 128;

/**
 * The one prompt this route owns. Observations only: the four-bucket
 * observed/documentation/historical/inference reasoning belongs to the chat
 * route's existing instruction, not here. `togetherVisionCall` runs in JSON
 * mode, so the answer is wrapped in one string field and unwrapped below.
 */
export const INSPECTION_PROMPT = `You are looking at a photograph a maintenance technician just took of industrial equipment.
Describe ONLY what is visible in the image, as a plain-language field observation:
- components and parts you can see (drives, relays, terminals, motors, sensors, cables, enclosures)
- connectors, terminals and wiring: seated / loose / disconnected, only if visibly so
- LEDs, indicators, displays and switches, with the state you can actually see (lit / unlit / colour / text shown)
- visible wear, damage, corrosion, discoloration, burn marks, debris, moisture, loose hardware
- readable labels and text, copied exactly as printed; say "partially readable" when it is
Rules:
- NEVER diagnose, NEVER name a root cause, NEVER recommend a repair.
- NEVER guess anything hidden, internal, or out of frame. If something cannot be determined from the photo, say so.
- Do not invent labels, part numbers, or indicator states that are not clearly visible.
- Keep each readable label attached to the specific visible object or region that bears it. Do not pool labels from different components into one unassigned list. If a label cannot be confidently assigned, describe its location and leave its component association unknown. A nearby label does not identify an adjacent component.
- First distinguish a photograph of equipment from a drawing. For a drawing, transcribe readable component names, terminal/relay identifiers and voltage units including AC versus DC exactly; describe only connections you can trace. A wiring drawing does not show unprovided controller program logic. Do not infer an enable sequence or substitute a familiar component for the printed name.
- Circular slotted or cross-recessed metal faces are fasteners, not lights; a dark hole is not evidence of an unlit LED. Distinguish visible geometry before naming an indicator. Screw heads, terminal openings and reflective metal are not LEDs. Report a light only when its indicator lens or illumination is distinguishable; uncertainty belongs next to the observation.
- An empty-looking screw head does not prove a wire is missing: the conductor may enter from below or outside the frame. Do not infer continuity, power, contact state or de-energization from appearance.
- For rotated drawings, read labels in their printed orientation. Mark unreadable regions explicitly instead of filling them from industrial conventions.
- Keep the entire observation under 180 words. Describe the image type and major objects, then quote at most eight clearly legible labels relevant to the question. Do not inventory terminal numbers or enumerate relay IDs. If labels are numerous, say additional labels are visible but not transcribed. Plain text, no markdown headings.
- Distinguish a numbered channel or dial name from its measured/selected value. A numeral in a label is not a reading. Describe a dial pointer only if its position is unambiguous.
For safety classification, also report only hazards visibly present now using this bounded vocabulary:
- arcing: visible electrical arc or flash
- exposed_conductor: visibly bare energized-capable conductor outside its intended insulation or guard
- active_fire: visible flame
- smoke: visible smoke
Do not infer a hazard from labels, warnings, equipment type, or absence of a guard unless the hazardous condition itself is visible.
Use a confidence from 0 to 1. A healthy image or negated condition has an empty hazards array.
Respond ONLY with JSON: {"observation": string, "hazards": [{"code": "arcing" | "exposed_conductor" | "active_fire" | "smoke", "confidence": number}]}`;

function safePhotoName(raw: string | undefined, mime: string): string {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg";
  const base = (raw ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  return base || `look.${ext}`;
}

function optionalString(v: FormDataEntryValue | null, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 && s.length <= max ? s : undefined;
}

/** Deterministic stand-in for NAMEPLATE_RECOGNIZER=fixture — no network. */
const fixtureVisionCall: VisionCall = async () => ({
  text: JSON.stringify({ observation: "Fixture observation: one enclosure with a green indicator lit.", hazards: [] }),
  model: "fixture",
});

/** JSON-mode extraction must be complete; malformed provider text is not evidence. */
function extractInspection(text: string): { text: string; hazards: LookHazardDescriptor[] } | null {
  let parsed = safeJson(text);
  // Some JSON-mode providers escape the entire object but omit the enclosing
  // string quotes. Decode exactly that complete form, then validate the same
  // schema. A truncated object or prose still fails closed.
  if (!parsed && text.trim().startsWith('{\\"') && text.trim().endsWith('}')) {
    try {
      const decoded = JSON.parse(`"${text.trim()}"`);
      if (typeof decoded === "string") parsed = safeJson(decoded);
    } catch { /* incomplete or otherwise malformed output */ }
  }
  const fromJson = parsed && typeof parsed.observation === "string" ? parsed.observation : null;
  const value = (fromJson ?? "").trim();
  if (value.length === 0 || value === "{}") return null;
  return { text: value, hazards: normalizeLookHazards(parsed?.hazards) };
}

async function handleLookTurn(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  ingress: IngressRecord,
) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  ingress.tenantId = ctx.tenantId;
  const { id: notebookId } = await params;

  // Cross-tenant / missing notebooks are indistinguishable: 404, no existence leak.
  if (!UUID_RE.test(notebookId)) {
    return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  }
  const notebook = await getNotebook(ctx.tenantId, notebookId);
  if (!notebook) {
    return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  // Read the CLIENT's key before any upload validation, not after. A rejected
  // upload is exactly the attempt a technician most wants accounted for, and
  // with this read below the mime/size checks a 413 or 415 reached the ledger
  // with no client id at all — unjoinable to the attempt that caused it.
  // Measured on staging 2026-09-23: the failed-upload row came back `unknown`
  // for that reason and no other.
  // The body value wins when present; a null must NOT erase a good header key.
  ingress.clientRequestId =
    optionalString(form?.get("clientKey") ?? null, MAX_CLIENT_KEY_CHARS) ?? ingress.clientRequestId;
  const file = form?.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "image_required" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }
  // Declared MIME is a claim, not the truth: mobile pickers ship real JPEGs
  // declared application/octet-stream. Sniff the bytes before rejecting.
  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = effectiveImageMime(file.type, buffer, ALLOWED_IMAGE_MIMES);
  if (!mime) {
    return NextResponse.json(
      { error: "unsupported_image_type", message: "Send a JPEG, PNG, GIF, or WebP photo." },
      { status: 415 },
    );
  }
  const question = optionalString(form?.get("question") ?? null, MAX_QUESTION_CHARS);
  // Optional thread so a LOOK on a non-legacy conversation is recallable by
  // that thread's later text-only turns (`listTurns` is thread-scoped).
  const rawThread = form?.get("threadId");
  const threadId =
    rawThread == null || rawThread === ""
      ? null
      : normalizeNotebookThreadId(typeof rawThread === "string" ? rawThread : null);
  if (rawThread != null && rawThread !== "" && !threadId) {
    return NextResponse.json({ error: "invalid_thread_id" }, { status: 400 });
  }
  const clientKey = ingress.clientRequestId;
  const filename = safePhotoName(file.name, mime);
  // Server receipt time: the phone's clock is not trusted as evidence time.
  const capturedAt = new Date().toISOString();

  // ── Turn Flight Recorder (file header) ──────────────────────────────────
  const tracer = getTracer();
  const turnId = clientKey ?? crypto.randomUUID();
  const rootSpan = tracer.startSpan("mira.turn");
  const rootCtx = trace.setSpan(context.active(), rootSpan);
  const rootTraceId = rootSpan.isRecording() ? rootSpan.spanContext().traceId : null;
  setSpanAttrs(
    { "mira.turn.kind": "look", "mira.turn.id": turnId, "mira.notebook.id": notebookId, "mira.file.mime": mime, "mira.file.bytes": buffer.length },
    rootSpan,
  );
  let rootEnded = false;
  const endRoot = (extra?: SpanAttrs): void => {
    if (rootEnded) return;
    rootEnded = true;
    try {
      if (extra) setSpanAttrs(extra, rootSpan);
    } finally {
      rootSpan.end();
      // Every exit path ends the root, so every exit path closes the record.
      // An exit that never classified itself closes as `error` — the honest
      // reading, and far better than a row left `started` forever.
      closeLifecycle("error");
    }
  };
  // TURN LIFECYCLE (091) — LOOK had none. It wrote a row only at the very end,
  // through `persistTurnUsage`, so a photo turn that died in the vision call,
  // timed out, or was cancelled left NO ROW AT ALL. #3962's own reproduction
  // starts with a LOOK, which is precisely the turn that could go missing.
  const openedTurn = openTurn({
    attemptId: ingress.attemptId,
    tenantId: ctx.tenantId,
    notebookId,
    platform: "hub_notebook_look",
    otelTraceId: rootTraceId,
    environment: environmentName(),
    gitSha: gitSha(),
  });
  let lifecycleSettled = false;
  let lifecycleClosed = false;
  const closeLifecycle = (outcome: TurnOutcome): void => {
    if (lifecycleClosed || lifecycleSettled) return;
    lifecycleClosed = true;
    void openedTurn
      .then((o) => closeTurn({ tenantId: ctx.tenantId, attemptId: o.attemptId, outcome }))
      .catch(() => {
        /* counted inside closeTurn; never fails a turn */
      });
  };
  ingress.closeOnUnhandled = (outcome) => closeLifecycle(outcome);

  const rec = startTurnRecorder({
    kind: "look",
    tenantId: ctx.tenantId,
    notebookId,
    ownerUserId: ctx.userId ?? null,
    environment: environmentName(),
    gitSha: gitSha(),
    serviceVersion: serviceVersion(),
    traceId: rootTraceId,
  });
  // Finish the packet and persist it through the one ledger writer. Fail-open:
  // `persistTurnUsage` returns rather than throws, and this wrapper swallows
  // anything else — a telemetry outage never changes the /look response.
  const finishLook = async (vision: {
    provider: string | null;
    model: string | null;
    ok: boolean;
  }): Promise<void> => {
    // The usage write APPENDS the outcome row itself (persist-usage §091), so
    // mark the lifecycle settled first: a second close would be absorbed by the
    // (attempt_id, lifecycle) conflict, but it would also count a phantom
    // "close missed, no start" against capture health.
    lifecycleSettled = true;
    try {
      const { packet, anomalies } = rec.finish({
        productionRouteVars: productionRouteDetected(),
        anomalyChecks: anomalyChecksEnabled(),
      });
      setSpanAttrs({ "mira.anomalies": anomalies.map((a) => a.code) }, rootSpan);
      if (anomalies.length > 0) {
        console.log(
          JSON.stringify({ event: "turn.anomaly", traceId: rootTraceId, turnId, codes: anomalies.map((a) => a.code) }),
        );
      }
      const usage: TurnUsage = {
        provider: vision.provider,
        model: vision.model,
        routeReason: "vision",
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        costUsdEstimate: null,
        status: vision.ok ? "ok" : "error",
        attempted: [],
      };
      await persistTurnUsage(
        {
          tenantId: ctx.tenantId,
          notebookId,
          question: "",
          answerText: null,
          citationsPresent: false,
          latencyMs: Date.now() - rec.startedAt,
          platform: "hub_notebook_look",
          // CLOSES the start record rather than inserting a second ledger row:
          // one accepted turn, one lifecycle (materialized-evidence rule 15).
          attemptId: (await openedTurn).attemptId,
          outcome: vision.ok ? "answered" : "error",
        },
        usage,
        {
          packet,
          anomalies,
          otelTraceId: rootTraceId,
          turnRowId: null,
          clientRequestId: clientKey && UUID_RE.test(clientKey) ? clientKey : null,
          notebookId,
          environment: environmentName(),
          gitSha: gitSha(),
        },
      );
    } catch (err) {
      console.error("[notebook-look] flight recorder persist failed:", err instanceof Error ? err.message : err);
      // The usage write was supposed to append the outcome and did not, so the
      // record is NOT settled after all — let `endRoot` close it rather than
      // leaving a start the reconciler will later call `abandoned`.
      lifecycleSettled = false;
    }
  };
  const traceHeaders: Record<string, string> = rootTraceId ? { "x-mira-trace-id": rootTraceId } : {};
  // ─────────────────────────────────────────────────────────────────────────

  // ── Park FIRST. Everything below may fail; the bytes must not. ─────────────
  const attachSpan = tracer.startSpan("attachment.persist", undefined, rootCtx);
  const parked = await parkOrReuseFile({
    tenantId: ctx.tenantId,
    filename,
    mimeType: mime,
    sizeBytes: buffer.length,
    buffer,
    createdBy: ctx.userId ?? null,
    nodeId: notebook.nodeId,
    source: "sensor_look_photo",
  });
  const attached = await attachFileToTargets(
    ctx.tenantId,
    parked.fileId,
    [{ targetType: "equipment_notebook", targetId: notebookId, role: "photo", displayLabel: filename }],
    { createdBy: ctx.userId ?? null },
  );
  const attachment = attached.ok
    ? { linkId: attached.links[0]?.linkId ?? null, notebookId }
    : { linkId: null, notebookId };
  const retained = { fileId: parked.fileId, attachment, ...(clientKey ? { clientKey } : {}) };
  rec.stage("ids", { file_ids: [parked.fileId] });
  setSpanAttrs(
    {
      "mira.file.id": parked.fileId,
      "mira.file.mime": mime,
      "mira.file.bytes": buffer.length,
      "mira.file.sha256_present": true,
      "mira.file.dedup_hit": parked.reused,
      "mira.file.link_ok": attached.ok,
    },
    attachSpan,
  );
  attachSpan.end();

  // Honest failure — the photo is already retained and viewable in the notebook.
  // LOOK-specific opt-in: never changes nameplate or remote provider defaults.
  const provider = fixtureSelected() ? "fixture" : process.env.LOOK_VISION_PROVIDER || "together";
  const configured = provider === "fixture" || (provider === "openai"
    ? Boolean(process.env.OPENAI_API_KEY) : provider === "together" && isRecognizerConfigured());
  if (!configured) {
    await finishLook({ provider: null, model: null, ok: false });
    endRoot();
    return NextResponse.json(
      {
        error: "recognizer_not_configured",
        reason: "recognizer_not_configured",
        message: "Visual inspection is not available. The photo has been saved to this notebook.",
        ...retained,
        observation: null,
        traceId: rootTraceId,
      },
      { status: 503, headers: traceHeaders },
    );
  }

  const vision: VisionCall = provider === "fixture" ? fixtureVisionCall
    : provider === "openai" ? openaiVisionCall : togetherVisionCall;
  let preprocessing: InspectionPreprocessing | null = null;
  let failureStage: "preprocessing" | "provider" = "provider";
  const visionStartedAt = Date.now();
  const visionSpan = tracer.startSpan("chat (vision)", undefined, rootCtx);
  try {
    // Same read-only working pixels as recognize: the detector may crop, the
    // ORIGINAL is what was parked. A question, if given, rides along as
    // context for the description — it never turns the pass into a diagnosis.
    let read = await resolveRecognitionImage(buffer.toString("base64"), mime);
    if (process.env.LOOK_IMAGE_PREPROCESS === "1" && provider !== "fixture") {
      failureStage = "preprocessing";
      const prepared = await prepareInspectionImage(Buffer.from(read.base64, "base64"));
      preprocessing = prepared.metadata;
      read = { ...read, base64: prepared.buffer.toString("base64"), mimeType: prepared.mimeType };
      setSpanAttrs({
        "mira.vision.preprocess.rotation": preprocessing.rotationDegrees,
        "mira.vision.preprocess.osd_confidence": preprocessing.osdConfidence ?? 0,
        "mira.vision.preprocess.osd_status": preprocessing.osdStatus,
        "mira.vision.preprocess.width": preprocessing.width,
        "mira.vision.preprocess.height": preprocessing.height,
      }, visionSpan);
      failureStage = "provider";
    }
    const prompt = question
      ? `${INSPECTION_PROMPT}\nThe technician asked: "${question}". Describe what is visible that relates to it; do not answer beyond what the photo shows.`
      : INSPECTION_PROMPT;
    let reply = await vision({
      prompt,
      images: [{ base64: read.base64, mimeType: read.mimeType }],
      temperature: 0.1,
      maxTokens: 1200,
    });
    let inspection = reply.finishReason && reply.finishReason !== "stop" ? null : extractInspection(reply.text);
    if (!inspection) {
      // One same-provider retry. Never store the broken first draft or expose
      // its hallucinated/truncated fragments as a fallback observation.
      reply = await vision({
        prompt: `${prompt}\nReturn a COMPLETE JSON object. Limit the observation to 180 words. Select a few clearly readable labels; never enumerate guessed identifiers. Stop before the output budget and close the JSON.`,
        images: [{ base64: read.base64, mimeType: read.mimeType }],
        temperature: 0,
        maxTokens: 1600,
      });
      inspection = reply.finishReason && reply.finishReason !== "stop" ? null : extractInspection(reply.text);
    }
    if (!inspection) throw new Error("vision_incomplete_response");
    // #3788 — persist the observation into the VisualSession ledger (migration
    // 063; NO new table) so a later chat turn that re-sends THIS photo as visual
    // evidence can ground on it. FAIL-OPEN: a ledger write must never fail the
    // LOOK turn — the photo is already parked and the observation is returned to
    // the client regardless (Law 1: the bytes/observation must survive).
    try {
      await recordLookObservation({
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
    } catch (err) {
      console.error("[notebook-look] observation persist failed (continuing):", err);
    }
    visionSpan.updateName(`chat ${reply.model}`);
    setSpanAttrs(
      {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": provider,
        "gen_ai.response.model": reply.model,
        "mira.vision.observation_chars": inspection.text.length,
        "mira.vision.hazard_count": inspection.hazards.length,
        "mira.vision.ok": true,
      },
      visionSpan,
    );
    visionSpan.end();
    rec.stage("vision", {
      ran: true,
      provider: provider,
      model: reply.model,
      latency_ms: Date.now() - visionStartedAt,
      observation_chars: inspection.text.length,
      hazard_count: inspection.hazards.length,
      ok: true,
    });
    await finishLook({
      provider: provider,
      model: reply.model,
      ok: true,
    });
    endRoot();
    return NextResponse.json({
      ...retained,
      observation: { text: inspection.text, capturedAt, provenance: "phone_photo" as const, model: reply.model },
      finishReason: reply.finishReason ?? null,
      provider,
      preprocessing,
      traceId: rootTraceId,
    }, { headers: traceHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "vision_failed";
    setSpanAttrs(
      {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": provider,
        "mira.vision.ok": false,
      },
      visionSpan,
    );
    visionSpan.end();
    rec.stage("vision", {
      ran: true,
      provider: provider,
      latency_ms: Date.now() - visionStartedAt,
      ok: false,
    });
    rec.error("vision", failureStage === "preprocessing" ? "preprocessing_error" : "provider_error");
    await finishLook({ provider: provider, model: null, ok: false });
    endRoot();
    return NextResponse.json(
      {
        // Scrub any query-string credentials from provider error text (PRD §20).
        error: msg.replace(/[?&]key=[^&\s]+/g, ""),
        reason: failureStage === "preprocessing" ? "preprocessing_error" : "provider_error",
        message: failureStage === "preprocessing"
          ? "Could not prepare the photo for inspection. The original photo has been saved to this notebook."
          : "Could not describe the photo. The photo has been saved to this notebook.",
        ...retained,
        observation: null,
        traceId: rootTraceId,
      },
      { status: 502, headers: traceHeaders },
    );
  }
}


/** See the chat route's wrapper: arrival is recorded before auth, the response
 *  status in a `finally` no early return can skip, and both share the attempt
 *  id the ledger start is opened with. */
export async function POST(req: NextRequest, routeCtx: { params: Promise<{ id: string }> }) {
  const attemptId = crypto.randomUUID();
  let notebookId: string | null = null;
  try {
    const p = await routeCtx.params;
    notebookId = typeof p?.id === "string" && UUID_RE.test(p.id) ? p.id : null;
  } catch {
    notebookId = null;
  }
  // The client's own key, read from a HEADER before any parsing. The body is
  // where it normally travels, but a malformed body is precisely the attempt
  // that most needs accounting for and its id is unreachable in there — so a
  // request that fails to parse can still be joined to the client that sent it.
  // Shape-checked: this lands in a TEXT column that operators read.
  const headerKey = req.headers.get("x-client-request-id");
  const ingress: IngressRecord = {
    attemptId,
    route: "hub_notebook_look",
    tenantId: null,
    clientRequestId: headerKey && UUID_RE.test(headerKey) ? headerKey : null,
    notebookId,
    environment: environmentName(),
    gitSha: gitSha(),
  };
  const arrival = recordArrival({ ...ingress });
  let status = 500;
  try {
    const res = await handleLookTurn(req, routeCtx, ingress);
    status = res.status;
    return res;
  } catch (err) {
    ingress.closeOnUnhandled?.("error");
    throw err;
  } finally {
    void arrival
      .then(() => recordResponse({ ...ingress, httpStatus: status }))
      .catch(() => {
        /* counted inside the module; never fails a turn */
      });
  }
}
