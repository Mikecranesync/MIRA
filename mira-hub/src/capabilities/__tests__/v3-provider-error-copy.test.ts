// #4366 — a /v3 turn that no provider could serve shows the server's
// technician message (#4356), not "The answer could not be completed."
import { describe, expect, it } from "vitest";
import type { StreamResult } from "@/components/equipment/notebook-chat-utils";
import { partsFromStream } from "@/factorylm-ui/to-interaction";
import { ALL_PROVIDERS_FAILED_MESSAGE, NO_PROVIDER_CONFIGURED_MESSAGE } from "@/capabilities/provider-health";

type Live = StreamResult & { statusMessage?: string | null };
const LIVE = { turnId: "live-1-a" };

function failed(statusMessage: string | null): Live {
  return {
    content: "",
    citations: [],
    status: "error",
    basis: null,
    followups: [],
    machineEvidence: null,
    visualEvidence: null,
    safetyNotice: null,
    hazardNotice: null,
    sawStatus: true,
    statusMessage,
  } as Live;
}

describe("partsFromStream renders the server's provider-exhaustion copy (#4366)", () => {
  it("all providers failed → the technician message, retryable", () => {
    expect(partsFromStream(failed(ALL_PROVIDERS_FAILED_MESSAGE), LIVE)).toEqual([
      { type: "error", error: { code: "provider_failure", message: ALL_PROVIDERS_FAILED_MESSAGE, retryable: true } },
    ]);
  });

  it("no provider configured → the admin message, not retryable", () => {
    expect(partsFromStream(failed(NO_PROVIDER_CONFIGURED_MESSAGE), LIVE)).toEqual([
      { type: "error", error: { code: "provider_failure", message: NO_PROVIDER_CONFIGURED_MESSAGE, retryable: false } },
    ]);
  });

  it("operator-facing server text never reaches the technician", () => {
    for (const msg of ["Internal chat error — see server logs.", "No answer provider available.", null]) {
      expect(partsFromStream(failed(msg), LIVE)).toEqual([
        { type: "error", error: { code: "provider_failure", message: "The answer could not be completed.", retryable: true } },
      ]);
    }
  });

  it("a stopped or truncated turn keeps its own copy even with a server message", () => {
    const stopped = partsFromStream(failed(ALL_PROVIDERS_FAILED_MESSAGE), { ...LIVE, stopped: true });
    expect(stopped.at(-1)).toMatchObject({ error: { code: "stopped" } });
    const truncated = partsFromStream({ ...failed(ALL_PROVIDERS_FAILED_MESSAGE), sawStatus: false }, LIVE);
    expect(truncated.at(-1)).toMatchObject({ error: { message: "The answer ended before it completed." } });
  });
});
