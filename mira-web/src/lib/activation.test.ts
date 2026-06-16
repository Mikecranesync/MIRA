import { describe, test, expect, mock } from "bun:test";
import { finalizeActivation, type ActivationDeps } from "./activation";

const baseTenant = {
  id: "t_123",
  email: "mike@example.com",
  first_name: "Mike",
  company: "ACME",
  tier: "active",
  stripe_customer_id: "cus_1",
  stripe_subscription_id: "sub_1",
  atlas_password: "pw",
  atlas_company_id: 0,
  atlas_user_id: 0,
  atlas_provisioning_status: "pending",
  activation_email_status: "pending",
  demo_seed_status: "pending",
  provisioning_attempts: 0,
  provisioning_last_attempt_at: null,
  provisioning_last_error: null,
  created_at: "2026-04-15T00:00:00Z",
} as const;

function makeDeps(overrides: Partial<ActivationDeps> = {}): ActivationDeps {
  return {
    signupUser: mock(async () => ({ companyId: 42, userId: 7, accessToken: "tok" })),
    updateTenantAtlas: mock(async () => {}),
    seedDemoData: mock(async () => {}),
    updateTenantSeedStatus: mock(async () => {}),
    signToken: mock(async () => "jwt"),
    sendActivatedEmail: mock(async () => true),
    updateTenantEmailStatus: mock(async () => {}),
    recordProvisioningAttempt: mock(async () => {}),
    deriveAtlasPassword: mock(() => "derived-pw"),
    ...overrides,
  };
}

describe("finalizeActivation", () => {
  test("happy path: all three steps succeed", async () => {
    const deps = makeDeps();
    const result = await finalizeActivation(baseTenant, deps);
    expect(result).toEqual({
      atlas: "ok",
      demo: "ok",
      email: "sent",
      token: "jwt",
    });
    expect(deps.updateTenantAtlas).toHaveBeenCalledWith("t_123", 42, 7, "ok");
    expect(deps.updateTenantSeedStatus).toHaveBeenCalledWith("t_123", "ok");
    expect(deps.updateTenantEmailStatus).toHaveBeenCalledWith("t_123", "sent");
    expect(deps.recordProvisioningAttempt).toHaveBeenCalledWith("t_123", null);
  });

  test("atlas fails: short-circuits, no seed, no email, records error", async () => {
    const deps = makeDeps({
      signupUser: mock(async () => { throw new Error("atlas 500"); }),
    });
    const result = await finalizeActivation(baseTenant, deps);
    expect(result.atlas).toBe("failed");
    expect(result.demo).toBe("pending");
    expect(result.email).toBe("pending");
    expect(result.token).toBeNull();
    expect(deps.seedDemoData).not.toHaveBeenCalled();
    expect(deps.sendActivatedEmail).not.toHaveBeenCalled();
    expect(deps.updateTenantAtlas).toHaveBeenCalledWith("t_123", 0, 0, "failed");
    expect(deps.recordProvisioningAttempt).toHaveBeenCalledWith("t_123", "atlas 500");
  });

  test("demo seed fails: non-fatal, email still sends", async () => {
    const deps = makeDeps({
      seedDemoData: mock(async () => { throw new Error("seed blew up"); }),
    });
    const result = await finalizeActivation(baseTenant, deps);
    expect(result.atlas).toBe("ok");
    expect(result.demo).toBe("failed");
    expect(result.email).toBe("sent");
    expect(deps.sendActivatedEmail).toHaveBeenCalled();
    expect(deps.updateTenantSeedStatus).toHaveBeenCalledWith("t_123", "failed");
  });

  test("email returns false (Resend down): status recorded as failed", async () => {
    const deps = makeDeps({
      sendActivatedEmail: mock(async () => false),
    });
    const result = await finalizeActivation(baseTenant, deps);
    expect(result.atlas).toBe("ok");
    expect(result.demo).toBe("ok");
    expect(result.email).toBe("failed");
    expect(deps.updateTenantEmailStatus).toHaveBeenCalledWith("t_123", "failed");
  });

  test("retry when atlas already ok: skips signup, still runs seed + email", async () => {
    const tenantAlreadyProvisioned = {
      ...baseTenant,
      atlas_company_id: 42,
      atlas_user_id: 7,
      atlas_provisioning_status: "ok",
    };
    const deps = makeDeps();
    const result = await finalizeActivation(tenantAlreadyProvisioned, deps);
    expect(deps.signupUser).not.toHaveBeenCalled();
    expect(deps.updateTenantAtlas).not.toHaveBeenCalled();  // not re-written
    expect(result.atlas).toBe("ok");
    expect(deps.seedDemoData).toHaveBeenCalled();
    expect(deps.sendActivatedEmail).toHaveBeenCalled();
    expect(result.email).toBe("sent");
  });

  test("signToken throws: atlas + seed still succeed, email=failed, token=null", async () => {
    const deps = makeDeps({
      signToken: mock(async () => { throw new Error("jwt secret missing"); }),
    });
    const result = await finalizeActivation(baseTenant, deps);
    expect(result.atlas).toBe("ok");
    expect(result.demo).toBe("ok");
    expect(result.email).toBe("failed");
    expect(result.token).toBeNull();
    expect(deps.updateTenantEmailStatus).toHaveBeenCalledWith("t_123", "failed");
  });

  test("updateTenantAtlas throws on ok-path: result still atlas=ok (bookkeeping errors swallowed)", async () => {
    const deps = makeDeps({
      updateTenantAtlas: mock(async () => { throw new Error("neon blip"); }),
    });
    // Does NOT reject — bookkeeping swallow means the activation result is still structured.
    const result = await finalizeActivation(baseTenant, deps);
    expect(result.atlas).toBe("ok");   // signup succeeded; status row may be stale but activation logic continues
    expect(result.email).toBe("sent"); // email still sends
  });

  test("sendActivatedEmail throws: result email=failed, no crash", async () => {
    const deps = makeDeps({
      sendActivatedEmail: mock(async () => { throw new Error("resend 500"); }),
    });
    const result = await finalizeActivation(baseTenant, deps);
    expect(result.atlas).toBe("ok");
    expect(result.demo).toBe("ok");
    expect(result.email).toBe("failed");
  });
});
