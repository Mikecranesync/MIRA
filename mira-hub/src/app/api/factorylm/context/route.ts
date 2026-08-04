import { NextResponse } from "next/server";
import { factoryLmContextSkill } from "@/lib/external-ai/context-skill";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

interface ContextApiBody {
  tool?: unknown;
  input?: unknown;
}

function badRequest(detail: string) {
  return NextResponse.json({ error: "Bad Request", detail }, { status: 400 });
}

async function resolveTenant(req: Request): Promise<string | NextResponse> {
  const i3xTenant = await resolveI3xTenant(req);
  if (i3xTenant) return i3xTenant;

  const session = await sessionOr401();
  if (session instanceof NextResponse) return session;
  return session.tenantId;
}

export async function POST(req: Request) {
  let body: ContextApiBody;
  try {
    body = (await req.json()) as ContextApiBody;
  } catch {
    return badRequest("invalid JSON body");
  }

  if (!body || typeof body.tool !== "string" || body.tool.trim().length === 0) {
    return badRequest("tool is required");
  }
  if (body.input !== undefined && (typeof body.input !== "object" || body.input === null || Array.isArray(body.input))) {
    return badRequest("input must be an object when provided");
  }

  const tenant = await resolveTenant(req);
  if (tenant instanceof NextResponse) return tenant;

  const result = await factoryLmContextSkill.call({
    tool: body.tool.trim(),
    input: (body.input ?? {}) as Record<string, unknown>,
    context: { tenantId: tenant },
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
