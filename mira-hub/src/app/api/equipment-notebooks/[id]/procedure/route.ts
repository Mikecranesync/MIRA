/**
 * WP-1 guided troubleshooting for one equipment notebook.
 *
 * GET  → the manufacturer procedures that apply to this notebook's confirmed machine, each with its
 *        revision check and the latest session (so a technician resumes where they stopped).
 * POST → { templateId, op: "start" | "restart" } or { templateId, op: "answer", input: StepInput }.
 *        The outcome of every answer is derived server-side (guided.ts `buildRecord`) and appended
 *        compare-and-set, so a double tap or a second device cannot interleave answers.
 *
 * Off unless NOTEBOOK_GUIDED_PROCEDURE=1 (404 otherwise). Read-only toward equipment: it records
 * what the technician observed; it never controls anything.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";
import { listSources } from "@/lib/equipment-notebooks";
import {
  buildRecord,
  escalationQuestion,
  MANUFACTURER_PROCEDURES,
  proceduresFor,
  viewSession,
  type NotebookManual,
  type StepInput,
} from "@/capabilities/diagnostic-plan/guided";
import {
  appendRecord,
  createSession,
  guidedProcedureEnabled,
  latestSession,
  type GuidedSession,
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
  const proc = MANUFACTURER_PROCEDURES.find((p) => p.template.id === session.input.templateId);
  if (!proc) return null;
  const view = viewSession(proc.template, session.run);
  return {
    runId: session.runId,
    startedAt: session.startedAt,
    revision: session.input.revision,
    view,
    askMira: view.status === "escalate" ? escalationQuestion(proc.template, session.run) : null,
  };
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
      session: applicability.applies ? sessionPayload(await latestSession(pool, ctx.tenantId, id, proc.template.id)) : null,
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
  const latest = await latestSession(pool, ctx.tenantId, id, template.id);

  if (body.op === "start" || body.op === "restart") {
    if (body.op === "start" && latest && latest.status === "running") return NextResponse.json({ session: sessionPayload(latest) });
    const created = await createSession(pool, ctx.tenantId, {
      notebookId: id,
      templateId: template.id,
      version: template.version ?? "",
      sourceSha256: template.source?.fileSha256 ?? "",
      revision: offered.applicability.revision,
    });
    return NextResponse.json({ session: sessionPayload(created) }, { status: 201 });
  }

  if (body.op !== "answer") return NextResponse.json({ error: "invalid_op" }, { status: 400 });
  if (!latest || latest.status !== "running") return NextResponse.json({ error: "no_active_session" }, { status: 409 });
  // A session started against one compiled version is never continued on another.
  if (latest.input.version !== (template.version ?? "")) {
    return NextResponse.json({ error: "procedure_version_changed", message: "This procedure was updated. Start again." }, { status: 409 });
  }
  const input = body.input as StepInput | undefined;
  if (!input || typeof input !== "object" || typeof input.stepId !== "string") return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const built = buildRecord(template, latest.run, input);
  if (!built.ok) return NextResponse.json({ error: "invalid_answer", message: built.error }, { status: 422 });
  const nextRun = { ...latest.run, records: [...latest.run.records, built.record] };
  const saved = await appendRecord(pool, ctx.tenantId, latest.runId, latest.run.records.length, built.record, statusFor(viewSession(template, nextRun)));
  if (!saved) {
    // Lost a race (double tap / second device): show the session as it now is.
    return NextResponse.json({ error: "stale_step", session: sessionPayload(await latestSession(pool, ctx.tenantId, id, template.id)) }, { status: 409 });
  }
  return NextResponse.json({ session: sessionPayload(saved) });
}
