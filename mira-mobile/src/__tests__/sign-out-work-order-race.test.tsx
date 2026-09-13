// @vitest-environment jsdom
// A work-order create can become an offline-queue write only after its request
// fails. Sign-out must therefore wait for the whole mutation, not merely inspect
// the queue at one instant, before it ends the session and purges device data.
//
// The classic Workorders tab is retired from the runtime; the mutation seam it
// used (withWorkOrderQueueProducer + enqueueCreate + drainQueue) is unchanged
// and still guards sign-out, so these tests drive that seam directly and reach
// Sign out through the unified shell's footer.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api, preferenceData, preferenceFailures } = vi.hoisted(() => ({
  api: {
    createWorkOrder: vi.fn(),
    getMe: vi.fn(),
    listNotebooks: vi.fn(),
    signOut: vi.fn(),
  },
  preferenceData: new Map<string, string>(),
  preferenceFailures: { markerGet: false, markerSet: false },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
    minimizeApp: vi.fn(async () => {}),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    convertFileSrc: (path: string) => path,
    isNativePlatform: () => false,
  },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => {
      if (key === "flm.session.cleanup-required.v1" && preferenceFailures.markerGet) {
        throw new Error("marker storage unavailable");
      }
      return { value: preferenceData.get(key) ?? null };
    }),
    keys: vi.fn(async () => ({ keys: Array.from(preferenceData.keys()) })),
    remove: vi.fn(async ({ key }: { key: string }) => {
      preferenceData.delete(key);
    }),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      if (key === "flm.session.cleanup-required.v1" && preferenceFailures.markerSet) {
        throw new Error("marker storage unavailable");
      }
      preferenceData.set(key, value);
    }),
  },
}));

vi.mock("../api/resources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/resources")>();
  return {
    ...actual,
    createWorkOrder: api.createWorkOrder,
    getMe: api.getMe,
    listNotebooks: api.listNotebooks,
    signOut: api.signOut,
  };
});

import App from "../App";
import { ApiError } from "../api/client";
import { createWorkOrder } from "../api/resources";
import {
  drainQueue,
  enqueueCreate,
  preferencesStore,
  resumeSessionLocalWrites,
  withSessionLocalProducer,
  withWorkOrderQueueProducer,
} from "../lib/offline-queue";

const ME = {
  id: "user-1",
  email: "tech@example.com",
  name: "Tech",
  role: "technician",
  tenantId: "tenant-a",
  capabilities: ["work_orders.create"],
};

const CREATE_INPUT = {
  equipment_id: "asset-1",
  description: "Conveyor is jammed",
  priority: "medium",
  client_key: "client-key-1",
};

/** The exact producer shape the work-order composer wraps its mutation in:
 *  request first, offline-queue fallback second, both inside the barrier. */
function startWorkOrderMutation(): Promise<boolean> {
  return withWorkOrderQueueProducer(async () => {
    try {
      await createWorkOrder(CREATE_INPUT);
    } catch (err) {
      if (err instanceof ApiError && err.kind === "network") {
        await enqueueCreate(preferencesStore, ME.tenantId, CREATE_INPUT);
        return;
      }
      throw err;
    }
  });
}

async function signOutFromUnifiedFooter(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resumeSessionLocalWrites();
  preferenceFailures.markerGet = false;
  preferenceFailures.markerSet = false;
  preferenceData.clear();
  preferenceData.set("flm.chatui.v1", "legacy");
  preferenceData.set("flm.studio.v1.unsaved", "must-survive-until-producer-settles");
  preferenceData.set("flm.unified.notebook.v1", "prior-tenant-notebook");
  preferenceData.set("flm.ota.channel", "canary");
  vi.stubGlobal("crypto", { randomUUID: () => "client-key-1" });

  api.createWorkOrder.mockReset();
  api.getMe.mockReset().mockResolvedValue(ME);
  // Zero notebooks renders the unified empty state, whose footer carries the
  // real Sign out control — the shortest honest path to the barrier.
  api.listNotebooks.mockReset().mockResolvedValue([]);
  api.signOut.mockReset().mockResolvedValue(undefined);
});

describe("sign-out versus an enqueue-producing work-order mutation", () => {
  it("does not end the session or purge local data before the producer settles", async () => {
    let rejectCreate!: (error: unknown) => void;
    const pendingCreate = new Promise<never>((_resolve, reject) => {
      rejectCreate = reject;
    });
    api.createWorkOrder
      .mockImplementationOnce(() => pendingCreate)
      .mockResolvedValue({ workOrder: { id: "wo-1" }, replayed: false });

    render(<App onBundleReady={() => {}} />);
    await screen.findByRole("button", { name: "Sign out" });
    const producer = startWorkOrderMutation();

    await signOutFromUnifiedFooter();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.signOut).not.toHaveBeenCalled();
    expect(preferenceData.get("flm.studio.v1.unsaved")).toBe(
      "must-survive-until-producer-settles",
    );

    await act(async () => {
      rejectCreate(new ApiError("network", null, "offline"));
      await producer;
    });

    await waitFor(() => expect(api.signOut).toHaveBeenCalledTimes(1));
    expect(preferenceData.has("flm.studio.v1.unsaved")).toBe(false);
    expect(
      Array.from(preferenceData.keys()).some((key) => key.startsWith("flm.woqueue.v1.")),
    ).toBe(false);
    expect(preferenceData.has("flm.unified.notebook.v1")).toBe(false);
    expect(preferenceData.get("flm.ota.channel")).toBe("canary");
  });

  it("rejects a new create admitted after the sign-out producer barrier", async () => {
    let finishSignOut!: () => void;
    api.signOut.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSignOut = resolve;
        }),
    );
    api.createWorkOrder.mockResolvedValue({ workOrder: { id: "wo-1" }, replayed: false });

    render(<App onBundleReady={() => {}} />);
    await signOutFromUnifiedFooter();
    await waitFor(() => expect(api.signOut).toHaveBeenCalledTimes(1));

    const admitted = await startWorkOrderMutation();
    expect(admitted).toBe(false);
    expect(api.createWorkOrder).not.toHaveBeenCalled();
    expect(
      Array.from(preferenceData.keys()).some((key) => key.startsWith("flm.woqueue.v1.")),
    ).toBe(false);

    finishSignOut();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy());
  });

  it("does not let a post-barrier background drain recreate a purged tenant queue", async () => {
    preferenceData.set(
      "flm.woqueue.v1.tenant-a",
      JSON.stringify([
        {
          input: {
            equipment_id: "asset-1",
            description: "Retained old-tenant work",
            priority: "medium",
            client_key: "queued-before-sign-out",
          },
          queued_at: "2026-09-07T00:00:00.000Z",
          attempts: 0,
        },
      ]),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    let finishSignOut!: () => void;
    api.signOut.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishSignOut = resolve; }),
    );
    api.createWorkOrder.mockRejectedValueOnce(new ApiError("network", null, "offline"));

    render(<App onBundleReady={() => {}} />);
    await signOutFromUnifiedFooter();
    await waitFor(() => expect(api.signOut).toHaveBeenCalledTimes(1));
    expect(api.createWorkOrder).toHaveBeenCalledTimes(1);

    // The background drain any surface may attempt post-barrier (the classic
    // tab did this on mount) must be refused at admission, not merely fail.
    const drained = await drainQueue(preferencesStore, ME.tenantId, createWorkOrder);
    expect(drained).toBeNull();

    finishSignOut();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy());

    expect(api.createWorkOrder).toHaveBeenCalledTimes(1);
    expect(preferenceData.has("flm.woqueue.v1.tenant-a")).toBe(false);
  });

  it("waits for an admitted tenant-local writer and purges its final value", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const producer = withSessionLocalProducer(async () => {
      await gate;
      preferenceData.set("flm.studio.v1.delayed", "old tenant output");
    });

    render(<App onBundleReady={() => {}} />);
    await signOutFromUnifiedFooter();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.signOut).not.toHaveBeenCalled();

    release();
    await producer;
    await waitFor(() => expect(api.signOut).toHaveBeenCalledTimes(1));
    expect(preferenceData.has("flm.studio.v1.delayed")).toBe(false);
  });

  it("locks authenticated UI until failed local cleanup is retried successfully", async () => {
    api.signOut
      .mockRejectedValueOnce(new Error("cookie persistence unavailable"))
      .mockResolvedValueOnce(undefined);
    const producerBody = vi.fn(async () => undefined);

    render(<App onBundleReady={() => {}} />);
    await signOutFromUnifiedFooter();

    expect(
      await screen.findByRole("alert", { name: "Secure cleanup required" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(await withSessionLocalProducer(producerBody)).toBeUndefined();
    expect(producerBody).not.toHaveBeenCalled();
    expect(preferenceData.get("flm.session.cleanup-required.v1")).toBe("required");

    // Simulate a killed/restarted process. The durable marker must lock the
    // app before it attempts to reload the old authenticated session.
    cleanup();
    api.getMe.mockClear();
    api.getMe.mockRejectedValue(new Error("must not reload auth while cleanup is pending"));
    render(<App onBundleReady={() => {}} />);
    expect(
      await screen.findByRole("alert", { name: "Secure cleanup required" }),
    ).toBeTruthy();
    expect(api.getMe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry secure cleanup" }));

    await waitFor(() => expect(api.signOut).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(preferenceData.has("flm.session.cleanup-required.v1")).toBe(false);
  });

  it("aborts before sign-out when the durable cleanup marker cannot be armed", async () => {
    preferenceFailures.markerSet = true;
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<App onBundleReady={() => {}} />);
    await signOutFromUnifiedFooter();

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Could not begin secure sign-out. Your session is still active; try again.",
      ),
    );
    expect(api.signOut).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();

    const producerBody = vi.fn(async () => "allowed");
    expect(await withSessionLocalProducer(producerBody)).toBe("allowed");
  });

  it("stays locked when a boot-recovery retry cannot arm the durable marker", async () => {
    preferenceFailures.markerGet = true;
    preferenceFailures.markerSet = true;

    render(<App onBundleReady={() => {}} />);
    expect(
      await screen.findByRole("alert", { name: "Secure cleanup required" }),
    ).toBeTruthy();
    expect(api.getMe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry secure cleanup" }));

    expect(
      await screen.findByText(
        "FactoryLM could not secure the cleanup retry. Your data remains locked. Try again.",
      ),
    ).toBeTruthy();
    expect(api.signOut).not.toHaveBeenCalled();
    expect(preferenceData.get("flm.studio.v1.unsaved")).toBe(
      "must-survive-until-producer-settles",
    );
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry secure cleanup" })).toBeTruthy();
  });
});
