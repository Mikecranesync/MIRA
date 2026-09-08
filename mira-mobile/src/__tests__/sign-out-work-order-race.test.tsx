// @vitest-environment jsdom
// A work-order create can become an offline-queue write only after its request
// fails. Sign-out must therefore wait for the whole mutation, not merely inspect
// the queue at one instant, before it ends the session and purges device data.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api, preferenceData, preferenceFailures } = vi.hoisted(() => ({
  api: {
    createWorkOrder: vi.fn(),
    getMe: vi.fn(),
    listAssets: vi.fn(),
    listWorkOrders: vi.fn(),
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
    listAssets: api.listAssets,
    listWorkOrders: api.listWorkOrders,
    signOut: api.signOut,
  };
});

import App from "../App";
import { ApiError } from "../api/client";
import type { WorkOrder } from "../api/resources";
import { resumeSessionLocalWrites, withSessionLocalProducer } from "../lib/offline-queue";

const ME = {
  id: "user-1",
  email: "tech@example.com",
  name: "Tech",
  role: "technician",
  tenantId: "tenant-a",
  capabilities: ["work_orders.create"],
};

const CREATED_WORK_ORDER: WorkOrder = {
  id: "wo-1",
  work_order_number: "WO-1",
  title: "Conveyor jam",
  description: "Conveyor is jammed",
  asset: "Line 1 Conveyor",
  equipment_id: "asset-1",
  status: "open",
  priority: "medium",
  source_label: "mobile",
  suggested_actions: [],
  safety_warnings: [],
  created_at: "2026-09-07T00:00:00.000Z",
};

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
  api.listAssets.mockReset().mockResolvedValue([
    { id: "asset-1", name: "Line 1 Conveyor", tag: "CV-101", location: "Line 1" },
  ]);
  api.listWorkOrders.mockReset().mockResolvedValue([]);
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
      .mockResolvedValue({ workOrder: CREATED_WORK_ORDER, replayed: false });

    const { container } = render(<App onBundleReady={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /New work order/i }));

    await waitFor(() => expect(container.querySelectorAll("select")).toHaveLength(2));
    const [asset] = Array.from(container.querySelectorAll("select"));
    const [, description] = Array.from(container.querySelectorAll("input"));
    fireEvent.change(asset, { target: { value: "asset-1" } });
    fireEvent.change(description, { target: { value: "Conveyor is jammed" } });
    fireEvent.click(screen.getByRole("button", { name: "Create work order" }));
    await screen.findByRole("button", { name: "Creating…" });

    fireEvent.click(screen.getByRole("button", { name: /More/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

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
      await pendingCreate.catch(() => undefined);
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
    api.createWorkOrder.mockResolvedValue({ workOrder: CREATED_WORK_ORDER, replayed: false });

    const { container } = render(<App onBundleReady={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /More/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(api.signOut).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Workorders/i }));
    fireEvent.click(await screen.findByRole("button", { name: /New work order/i }));
    await waitFor(() => expect(container.querySelectorAll("select")).toHaveLength(2));
    const [asset] = Array.from(container.querySelectorAll("select"));
    const [, description] = Array.from(container.querySelectorAll("input"));
    fireEvent.change(asset, { target: { value: "asset-1" } });
    fireEvent.change(description, { target: { value: "Conveyor is jammed" } });
    fireEvent.click(screen.getByRole("button", { name: "Create work order" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create work order" })).toBeTruthy(),
    );
    expect(api.createWorkOrder).not.toHaveBeenCalled();
    expect(
      Array.from(preferenceData.keys()).some((key) => key.startsWith("flm.woqueue.v1.")),
    ).toBe(false);

    finishSignOut();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy());
  });

  it("does not let a post-barrier background drain recreate a purged tenant queue", async () => {
    preferenceData.set("flm.activeTab.v1", "more");
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
    let rejectLateDrain!: (error: unknown) => void;
    const lateDrain = new Promise<never>((_resolve, reject) => {
      rejectLateDrain = reject;
    });
    void lateDrain.catch(() => undefined);
    api.createWorkOrder
      .mockRejectedValueOnce(new ApiError("network", null, "offline"))
      .mockImplementationOnce(() => lateDrain);

    render(<App onBundleReady={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(api.signOut).toHaveBeenCalledTimes(1));
    expect(api.createWorkOrder).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Workorders/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    finishSignOut();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy());
    rejectLateDrain(new ApiError("network", null, "offline"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

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
    fireEvent.click(await screen.findByRole("button", { name: /More/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

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
    fireEvent.click(await screen.findByRole("button", { name: /More/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

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
    fireEvent.click(await screen.findByRole("button", { name: /More/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

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
