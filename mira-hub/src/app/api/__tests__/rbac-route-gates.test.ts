// #2360 deferred slice / #578 — per-route RBAC enforcement guard.
//
// Proves every route gated by the role→capability matrix returns 403 for an
// under-privileged session BEFORE it touches the database. The capability
// matrix itself is unit-tested in src/lib/__tests__/capabilities.test.ts; this
// file proves each route is actually WIRED to it (the gate sits right after
// sessionOr401, before any DB/body work, so a 403 here needs no DB mock).
//
// Deny-side only by design: it's the security-critical assertion and fully
// deterministic. The allow-side (no over-block) is covered by capabilities.test
// (capable roles HOLD the cap) + each route's own behavior tests, which now mock
// role:"owner" and pass.

import { beforeEach, describe, it, expect, vi } from "vitest";
import type { SessionContext } from "@/lib/session";

// Mock only the session source; requireCapability runs for real so it computes
// the 403 from the (under-privileged) role exactly as production would.
vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
import { sessionOr401 } from "@/lib/session";

// Routes guard on NEON_DATABASE_URL before the gate — satisfy it so we reach the
// gate. No real connection is opened: the gate returns 403 first.
process.env.NEON_DATABASE_URL ||= "postgres://gate-test/none";

import { POST as assetsCreate } from "@/app/api/assets/route";
import { POST as assetEnrich } from "@/app/api/assets/[id]/enrich/route";
import { POST as assetValidationQa } from "@/app/api/assets/[id]/validation-qa/route";
import { POST as assetQr } from "@/app/api/assets/[id]/qr/route";
import { POST as woCreate } from "@/app/api/work-orders/route";
import { PATCH as woUpdate } from "@/app/api/work-orders/[id]/route";
import { PATCH as pmWrite } from "@/app/api/pm-schedules/[id]/route";
import { PATCH as pmMeter } from "@/app/api/pm-schedules/[id]/meter/route";
import { POST as pmComplete } from "@/app/api/pm-schedules/[id]/complete/route";
import { POST as reportsGenerate } from "@/app/api/reports/generate/route";
import { POST as nsNode } from "@/app/api/namespace/node/route";
import { POST as nsPath } from "@/app/api/namespace/path/route";
import { POST as kgSync } from "@/app/api/kg/sync/route";
import { POST as readinessRecalc } from "@/app/api/readiness/recalculate/route";
import { POST as ccDisplay } from "@/app/api/command-center/display/route";
import { POST as wizardStep } from "@/app/api/wizard/[step]/route";
import { POST as suggestionsDecide } from "@/app/api/suggestions/[id]/decide/route";

const ID = "00000000-0000-0000-0000-0000000000aa";
const idParams = { params: Promise.resolve({ id: ID }) };
const stepParams = { params: Promise.resolve({ step: "site" }) };
const req = () => new Request("http://t/api", { method: "POST", body: "{}" });

function setRole(role: string | undefined) {
  const ctx: SessionContext = {
    userId: "u_1",
    tenantId: "00000000-0000-0000-0000-000000000099",
    email: "x@y",
    status: "trial",
    trialExpiresAt: null,
    role,
  };
  vi.mocked(sessionOr401).mockResolvedValue(ctx);
}

// Each gated mutating handler + the capability it requires. operator (and any
// role outside the matrix) must be denied on every one.
const GATED: Array<[string, (...a: never[]) => Promise<Response>, () => Promise<Response>]> = [
  ["POST /api/assets (assets.create)", assetsCreate, () => assetsCreate(req() as never)],
  ["POST /api/assets/[id]/enrich (assets.write)", assetEnrich, () => assetEnrich(req() as never, idParams as never)],
  ["POST /api/assets/[id]/validation-qa (assets.write)", assetValidationQa, () => assetValidationQa(req() as never, idParams as never)],
  ["POST /api/assets/[id]/qr (assets.write)", assetQr, () => assetQr(req() as never, idParams as never)],
  ["POST /api/work-orders (work_orders.create)", woCreate, () => woCreate(req() as never)],
  ["PATCH /api/work-orders/[id] (work_orders.update)", woUpdate, () => woUpdate(req() as never, idParams as never)],
  ["PATCH /api/pm-schedules/[id] (pm_schedules.write)", pmWrite, () => pmWrite(req() as never, idParams as never)],
  ["PATCH /api/pm-schedules/[id]/meter (pm_schedules.write)", pmMeter, () => pmMeter(req() as never, idParams as never)],
  ["POST /api/pm-schedules/[id]/complete (pm_schedules.complete)", pmComplete, () => pmComplete(req() as never, idParams as never)],
  ["POST /api/reports/generate (reports.generate)", reportsGenerate, () => reportsGenerate()],
  ["POST /api/namespace/node (namespace.admin)", nsNode, () => nsNode(req() as never)],
  ["POST /api/namespace/path (namespace.admin)", nsPath, () => nsPath(req() as never)],
  ["POST /api/kg/sync (namespace.admin)", kgSync, () => kgSync()],
  ["POST /api/readiness/recalculate (namespace.admin)", readinessRecalc, () => readinessRecalc()],
  ["POST /api/command-center/display (namespace.admin)", ccDisplay, () => ccDisplay(req() as never)],
  ["POST /api/wizard/[step] (namespace.admin)", wizardStep, () => wizardStep(req() as never, stepParams as never)],
  ["POST /api/suggestions/[id]/decide (proposals.decide)", suggestionsDecide, () => suggestionsDecide(req() as never, idParams as never)],
];

describe("RBAC route gates — under-privileged role is denied before any DB work", () => {
  beforeEach(() => vi.clearAllMocks());

  describe.each(GATED)("%s", (_label, _handler, call) => {
    it("operator → 403", async () => {
      setRole("operator");
      const res = await call();
      expect(res.status).toBe(403);
    });

    it("unknown role → 403 (least-privilege)", async () => {
      setRole("supervisor");
      const res = await call();
      expect(res.status).toBe(403);
    });
  });
});
