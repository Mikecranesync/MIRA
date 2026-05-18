import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { slugify, sitePath, linePath } from "@/lib/uns";

export const dynamic = "force-dynamic";

/**
 * Onboarding wizard — slice 0.
 *
 * Spec : docs/specs/maintenance-namespace-builder-spec.md §"Onboarding wizard"
 * Plan : docs/plans/2026-05-15-maintenance-namespace-builder.md (Phase 3
 *        deliverable #1, slice 0 — minimum 3-step flow that creates
 *        a tenant's first site + first line as kg_entities so /namespace
 *        renders something instead of the empty state).
 *
 * Endpoints
 *   GET  /api/wizard/[step]   → returns current wizard_progress row
 *                                (or { status: 'not_started' } if none)
 *   POST /api/wizard/[step]   → saves payload for that step into
 *                                wizard_progress.step_payloads[step]
 *   POST /api/wizard/finish   → reads saved payloads, inserts kg_entities
 *                                (site + line) with uns_path values, writes
 *                                namespace_versions rows, marks wizard
 *                                completed.
 *
 * Slice 0 step ids: 'company', 'site', 'line', 'finish'. Slice 1 adds
 * 'area', 'asset', tag-import.
 */

interface CompanyPayload { name: string }
interface SitePayload    { name: string; location?: string }
interface LinePayload    { name: string; description?: string }
type StepPayload = CompanyPayload | SitePayload | LinePayload | Record<string, unknown>;

interface WizardRow {
  id: string;
  current_step: string;
  status: string;
  step_payloads: Record<string, StepPayload>;
  started_at: string;
  completed_at: string | null;
}

const STEPS = ["company", "site", "line", "finish"] as const;
type Step = typeof STEPS[number];

function isStep(s: string): s is Step {
  return (STEPS as readonly string[]).includes(s);
}

function nextStep(step: Step): Step {
  const i = STEPS.indexOf(step);
  return STEPS[Math.min(i + 1, STEPS.length - 1)];
}

export async function GET(_req: Request, { params }: { params: Promise<{ step: string }> }) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { step } = await params;
  if (!isStep(step)) return NextResponse.json({ error: "unknown step" }, { status: 400 });

  try {
    const row = await withTenantContext(ctx.tenantId, async (c) => {
      const r = await c.query<WizardRow>(
        `SELECT id, current_step, status, step_payloads, started_at::text, completed_at::text
           FROM wizard_progress
          WHERE tenant_id = $1 AND wizard_kind = 'namespace_onboarding'`,
        [ctx.tenantId],
      );
      return r.rows[0] ?? null;
    });
    if (!row) return NextResponse.json({ status: "not_started", currentStep: STEPS[0], stepPayloads: {} });
    return NextResponse.json({
      status: row.status,
      currentStep: row.current_step,
      stepPayloads: row.step_payloads,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    });
  } catch (err) {
    console.error("[api/wizard GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ step: string }> }) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { step } = await params;
  if (!isStep(step)) return NextResponse.json({ error: "unknown step" }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }

  if (step === "finish") {
    return finishWizard(ctx.tenantId, ctx.userId);
  }

  const validated = validateStep(step, body);
  if (validated.kind === "invalid") {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const next = nextStep(step);
    const row = await withTenantContext(ctx.tenantId, async (c) => {
      const r = await c.query<WizardRow>(
        `INSERT INTO wizard_progress
              (tenant_id, wizard_kind, status, current_step, step_payloads, updated_at)
         VALUES ($1, 'namespace_onboarding', 'in_progress', $2, jsonb_build_object($3::text, $4::jsonb), now())
         ON CONFLICT (tenant_id, wizard_kind) DO UPDATE
              SET current_step  = EXCLUDED.current_step,
                  step_payloads = wizard_progress.step_payloads || jsonb_build_object($3::text, $4::jsonb),
                  updated_at    = now()
         RETURNING id, current_step, status, step_payloads, started_at::text, completed_at::text`,
        [ctx.tenantId, next, step, JSON.stringify(validated.value)],
      );
      return r.rows[0];
    });
    return NextResponse.json({ ok: true, currentStep: row.current_step, stepPayloads: row.step_payloads });
  } catch (err) {
    console.error("[api/wizard POST]", err);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}

type Validated =
  | { kind: "valid"; value: StepPayload }
  | { kind: "invalid"; error: string };

function validateStep(step: Step, body: Record<string, unknown>): Validated {
  if (step === "company") {
    const name = String(body.name ?? "").trim();
    if (!name) return { kind: "invalid", error: "company name required" };
    if (name.length > 200) return { kind: "invalid", error: "company name too long" };
    return { kind: "valid", value: { name } };
  }
  if (step === "site") {
    const name = String(body.name ?? "").trim();
    if (!name) return { kind: "invalid", error: "site name required" };
    if (name.length > 200) return { kind: "invalid", error: "site name too long" };
    const location = body.location ? String(body.location).trim().slice(0, 200) : undefined;
    return { kind: "valid", value: { name, location } };
  }
  if (step === "line") {
    const name = String(body.name ?? "").trim();
    if (!name) return { kind: "invalid", error: "line name required" };
    if (name.length > 200) return { kind: "invalid", error: "line name too long" };
    const description = body.description ? String(body.description).trim().slice(0, 500) : undefined;
    return { kind: "valid", value: { name, description } };
  }
  return { kind: "invalid", error: "no validator for step" };
}

async function finishWizard(tenantId: string, userId: string) {
  try {
    const result = await withTenantContext(tenantId, async (c) => {
      const r = await c.query<{ step_payloads: Record<string, StepPayload> }>(
        `SELECT step_payloads
           FROM wizard_progress
          WHERE tenant_id = $1 AND wizard_kind = 'namespace_onboarding'
          FOR UPDATE`,
        [tenantId],
      );
      if (r.rows.length === 0) return { kind: "no_progress" as const };
      const payloads = r.rows[0].step_payloads ?? {};
      const site = payloads.site as SitePayload | undefined;
      const line = payloads.line as LinePayload | undefined;
      if (!site?.name || !line?.name) {
        return { kind: "incomplete" as const, missing: !site?.name ? "site" : "line" };
      }

      const sitePathStr = sitePath(site.name);
      if (!sitePathStr) {
        return { kind: "invalid_site_name" as const };
      }

      const linePathStr = linePath(site.name, line.name);
      if (!linePathStr) {
        return { kind: "invalid_line_name" as const };
      }

      const siteSlug = slugify(site.name)!; // guaranteed non-null by sitePath check above
      const lineSlug = slugify(line.name)!; // guaranteed non-null by linePath check above

      const siteRes = await c.query<{ id: string }>(
        `INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties, uns_path)
         VALUES ($1, 'site', $2, $3, $4::jsonb, $5::ltree)
         ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE
            SET name = EXCLUDED.name,
                uns_path = EXCLUDED.uns_path,
                updated_at = now()
         RETURNING id`,
        [tenantId, siteSlug, site.name, JSON.stringify({ location: site.location ?? null, source: "onboarding_wizard" }), sitePathStr],
      );
      const siteId = siteRes.rows[0].id;

      const lineRes = await c.query<{ id: string }>(
        `INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties, uns_path)
         VALUES ($1, 'line', $2, $3, $4::jsonb, $5::ltree)
         ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE
            SET name = EXCLUDED.name,
                uns_path = EXCLUDED.uns_path,
                updated_at = now()
         RETURNING id`,
        [tenantId, lineSlug, line.name, JSON.stringify({ description: line.description ?? null, source: "onboarding_wizard" }), linePathStr],
      );
      const lineId = lineRes.rows[0].id;

      for (const [entityId, entityKind, path, displayName] of [
        [siteId, "site", sitePathStr, site.name],
        [lineId, "line", linePathStr, line.name],
      ] as const) {
        await c.query(
          `INSERT INTO namespace_versions
                (tenant_id, operation, entity_id, entity_kind,
                 from_state, to_state,
                 actor_user_id, actor_kind, reason)
           VALUES ($1, 'create', $2, $3, NULL, $4::jsonb, $5, 'human', 'onboarding wizard')`,
          [tenantId, entityId, entityKind, JSON.stringify({ uns_path: path, name: displayName }), userId],
        );
      }

      await c.query(
        `UPDATE wizard_progress
            SET status = 'completed',
                current_step = 'finish',
                completed_at = now(),
                updated_at = now()
          WHERE tenant_id = $1 AND wizard_kind = 'namespace_onboarding'`,
        [tenantId],
      );

      return { kind: "ok" as const, siteId, lineId, sitePath: sitePathStr, linePath: linePathStr };
    });

    if (result.kind === "no_progress") {
      return NextResponse.json({ error: "wizard not started" }, { status: 400 });
    }
    if (result.kind === "incomplete") {
      return NextResponse.json({ error: `missing payload: ${result.missing}` }, { status: 400 });
    }
    if (result.kind === "invalid_site_name") {
      return NextResponse.json({ error: "site name is invalid for UNS path" }, { status: 400 });
    }
    if (result.kind === "invalid_line_name") {
      return NextResponse.json({ error: "line name is invalid for UNS path" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/wizard finish]", err);
    return NextResponse.json({ error: "Finish failed" }, { status: 500 });
  }
}
