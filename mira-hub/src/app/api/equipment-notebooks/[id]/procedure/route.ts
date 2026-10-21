/**
 * WP-1 guided troubleshooting for one equipment notebook.
 *
 * GET  → the manufacturer procedures that apply to this notebook's confirmed machine, each with its
 *        revision check and the latest session (so a technician resumes where they stopped).
 * POST → { templateId, op: "start" | "restart" } or
 *        { templateId, op: "answer", sessionId, recordCount, input: StepInput }.
 *        The input is validated (guided.ts `parseStepInput`), its outcome derived server-side
 *        (`buildRecord`), and appended compare-and-set on the exact session and record count the
 *        technician was looking at — a double tap, a second device or an answer meant for an older
 *        session gets 409 with the current state, never a write (Codex #4573 F3).
 *        Sessions live in tenant-isolated `guided_procedure_sessions` (migration 105, RLS).
 *
 * Off unless NOTEBOOK_GUIDED_PROCEDURE=1 (404 otherwise). Read-only toward equipment: it records
 * what the technician observed; it never controls anything.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { listSources } from "@/lib/equipment-notebooks";
import {
  buildRecord,
  escalationQuestion,
  MANUFACTURER_PROCEDURES,
  parseStepInput,
  proceduresFor,
  viewSession,
  type NotebookManual,
} from "@/capabilities/diagnostic-plan/guided";
import {
  appendRecord,
  createSession,
  guidedProcedureEnabled,
  latestSession,
  type GuidedSession,
  type QueryDb,
  type SessionStatus,
} from "@/capabilities/guided-procedure-store";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

async function loadMachine(tenantId: string, notebookId: string) {
  // Read-only lookup (getNotebook would bump last_opened_at).
  const nb = await withTenantContext(tenantId, async (c) => {
    const r = await c.query(
      `SELECT manufacturer, model, catalog_number, identity_status
         FROM equipment_notebooks WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, notebookId],
    );
    return r.rows[0] as Record<string, unknown> | undefined;
  });
  if (!nb) return null;
  const sources = await listSources(tenantId, notebookId);
  const fileIds = sources.map((s) => s.fileId).filter((v): v is string => !!v && UUID_RE.test(v));
  const shaById = new Map<string, string>();
  if (fileIds.length) {
    const rows = await withTenantContext(tenantId, async (c) =>
      (
        await c.query(
          `SELECT id::text AS id, content_sha256 FROM namespace_direct_uploads
            WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
          [tenantId, fileIds],
        )
      ).rows,
    );
    for (const r of rows) if (r.content_sha256) shaById.set(String(r.id), String(r.content_sha256));
  }
  const manuals: NotebookManual[] = sources.map((s) => ({ filename: s.filename, sha256: s.fileId ? shaById.get(s.fileId) ?? null : null }));
  return {
    confirmed: nb.identity_status === "user_confirmed",
    identity: {
      manufacturer: (nb.manufacturer as string | null) ?? null,
      model: (nb.model as string | null) ?? null,
      catalogNumber: (nb.catalog_number as string | null) ?? null,
    },
    manuals,
  };
}

function sessionPayload(session: GuidedSession | null) {
  if (!session) return null;
  const proc = MANUFACTURER_PROCEDURES.find((p) => p.template.id === session.templateId);
  if (!proc) return null;
  const view = viewSession(proc.template, session.run);
  return {
    sessionId: session.id,
    recordCount: session.run.records.length,
    startedAt: session.startedAt,
    revision: session.revision,
    view,
    askMira: view.status === "escalate" ? escalationQuestion(proc.template, session.run) : null,
  };
}

/** Run a store call on one tenant-scoped client (RLS + the explicit tenant predicate). */
function inTenant<T>(tenantId: string, fn: (db: QueryDb) => Promise<T>): Promise<T> {
  return withTenantContext(tenantId, (c) => fn(c as unknown as QueryDb));
}

function statusFor(view: ReturnType<typeof viewSession>): SessionStatus {
  return view.status === "active" ? "running" : view.status === "resolved" ? "ok" : view.status === "escalate" ? "degraded" : "failed";
}

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!guidedProcedureEnabled()) return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  const machine = await loadMachine(ctx.tenantId, id);
  if (!machine) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  if (!machine.confirmed) return NextResponse.json({ procedures: [], reason: "identity_not_confirmed" });
  const offered = proceduresFor(machine.identity, machine.manuals);
  const procedures = await Promise.all(
    offered.map(async ({ proc, applicability }) => ({
      templateId: proc.template.id,
      title: proc.template.title,
      source: proc.template.source,
      applicability,
      session: applicability.applies
        ? sessionPayload(await inTenant(ctx.tenantId, (db) => latestSession(db, ctx.tenantId, id, proc.template.id)))
        : null,
    })),
  );
  return NextResponse.json({ procedures });
}

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!guidedProcedureEnabled()) return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const proc = MANUFACTURER_PROCEDURES.find((p) => p.template.id === body.templateId);
  if (!proc) return NextResponse.json({ error: "unknown_procedure" }, { status: 404 });

  const machine = await loadMachine(ctx.tenantId, id);
  if (!machine) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  if (!machine.confirmed) return NextResponse.json({ error: "identity_not_confirmed" }, { status: 409 });
  const offered = proceduresFor(machine.identity, machine.manuals).find((p) => p.proc === proc);
  if (!offered || !offered.applicability.applies) {
    const message = offered && !offered.applicability.applies ? offered.applicability.message : "This procedure does not apply to this machine.";
    return NextResponse.json({ error: "not_applicable", message }, { status: 409 });
  }
  const template = proc.template;
  const latest = await inTenant(ctx.tenantId, (db) => latestSession(db, ctx.tenantId, id, template.id));

  if (body.op === "start" || body.op === "restart") {
    if (body.op === "start" && latest && latest.status === "running") return NextResponse.json({ session: sessionPayload(latest) });
    const created = await inTenant(ctx.tenantId, (db) =>
      createSession(db, ctx.tenantId, {
        notebookId: id,
        templateId: template.id,
        templateVersion: template.version ?? "",
        sourceSha256: template.source?.fileSha256 ?? "",
        revision: offered.applicability.applies ? offered.applicability.revision : "not_attached",
        startedBy: ctx.userId ?? null,
      }),
    );
    return NextResponse.json({ session: sessionPayload(created) }, { status: 201 });
  }

  if (body.op !== "answer") return NextResponse.json({ error: "invalid_op" }, { status: 400 });
  const parsed = parseStepInput(body.input);
  if (!parsed.ok) return NextResponse.json({ error: "invalid_input", message: parsed.error }, { status: 400 });
  if (typeof body.sessionId !== "string" || !UUID_RE.test(body.sessionId) || !Number.isInteger(body.recordCount)) {
    return NextResponse.json({ error: "invalid_input", message: "An answer names its session and step count." }, { status: 400 });
  }
  // The answer must be for the session — and the exact step — the technician was looking at.
  if (!latest || latest.status !== "running" || latest.id !== body.sessionId || latest.run.records.length !== body.recordCount) {
    return NextResponse.json({ error: "stale_step", session: sessionPayload(latest) }, { status: 409 });
  }
  // A session started against one compiled version is never continued on another.
  if (latest.templateVersion !== (template.version ?? "")) {
    return NextResponse.json({ error: "procedure_version_changed", message: "This procedure was updated. Start again." }, { status: 409 });
  }

  const built = buildRecord(template, latest.run, parsed.input);
  if (!built.ok) return NextResponse.json({ error: "invalid_answer", message: built.error }, { status: 422 });
  const nextRun = { ...latest.run, records: [...latest.run.records, built.record] };
  const saved = await inTenant(ctx.tenantId, (db) =>
    appendRecord(db, ctx.tenantId, latest.id, latest.run.records.length, built.record, statusFor(viewSession(template, nextRun))),
  );
  if (!saved) {
    const now = await inTenant(ctx.tenantId, (db) => latestSession(db, ctx.tenantId, id, template.id));
    return NextResponse.json({ error: "stale_step", session: sessionPayload(now) }, { status: 409 });
  }
  return NextResponse.json({ session: sessionPayload(saved) });
}
