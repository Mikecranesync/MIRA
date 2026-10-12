// #4366 — a /v3 turn that no provider could serve shows the server's
// technician message (#4356), not "The answer could not be completed."
import { describe, expect, it } from "vitest";
import type { PersistedTurn, StreamResult } from "@/components/equipment/notebook-chat-utils";
import {
  isRetryableProviderExhaustion,
  partsFromStream,
  threadFromPersisted,
  turnsFromPersisted,
  withRetryableLatestFailure,
  type HubNotebookMeta,
} from "@/factorylm-ui/to-interaction";
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

// #4374 Codex R1 F1: the reloaded turn must say the same thing the live turn did.
// The route persists a typed `provider_failure` marker; hydration maps it.
const META: HubNotebookMeta = {
  notebookId: "nb-1",
  threadId: "notebook-nb-1:thread-t-1",
  title: "Conveyor CV-101",
  tenantId: "tenant-1",
  identityConfirmed: true,
  capturedAt: "2026-10-12T12:00:00.000Z",
};
function errorRow(id: string, evidence: unknown[]): PersistedTurn & { createdAt: string } {
  return { id, question: "what is F004", answerStatus: "error", answerText: null, evidence: evidence as PersistedTurn["evidence"], basis: null, createdAt: "2026-10-12T12:00:00.000Z" };
}
const errorPart = (turns: ReturnType<typeof turnsFromPersisted>) =>
  turns.at(-1)?.parts.find((p) => p.type === "error") as { error: { message: string; retryable: boolean } } | undefined;

describe("hydration renders the persisted provider-exhaustion copy (#4374 R1 F1)", () => {
  it("all_providers_failed marker → the technician message", () => {
    const part = errorPart(turnsFromPersisted(errorRow("t1", [{ kind: "provider_failure", reason: "all_providers_failed" }]), META));
    expect(part?.error.message).toBe(ALL_PROVIDERS_FAILED_MESSAGE);
  });

  it("no_provider_configured marker → the admin message", () => {
    const part = errorPart(turnsFromPersisted(errorRow("t1", [{ kind: "provider_failure", reason: "no_provider_configured" }]), META));
    expect(part?.error.message).toBe(NO_PROVIDER_CONFIGURED_MESSAGE);
  });

  it("a persisted row is never retryable on its own (Retry belongs to the live send)", () => {
    const part = errorPart(turnsFromPersisted(errorRow("t1", [{ kind: "provider_failure", reason: "all_providers_failed" }]), META));
    expect(part?.error.retryable).toBe(false);
  });

  it("control: an error row with no marker keeps the generic copy", () => {
    expect(errorPart(turnsFromPersisted(errorRow("t1", []), META))?.error.message).toBe("The answer could not be completed.");
  });

  it("control: an unknown reason falls back to the generic copy", () => {
    const part = errorPart(turnsFromPersisted(errorRow("t1", [{ kind: "provider_failure", reason: "bogus" }]), META));
    expect(part?.error.message).toBe("The answer could not be completed.");
  });
});

// #4374 Codex R1 F2: a terminal exhaustion frame must leave a working Retry —
// and only on the newest turn, because the host's retry re-sends ONE request.
describe("retry after provider exhaustion (#4374 R1 F2)", () => {
  it("the shared predicate: all-providers-failed is retryable, the rest are not", () => {
    expect(isRetryableProviderExhaustion(failed(ALL_PROVIDERS_FAILED_MESSAGE))).toBe(true);
    expect(isRetryableProviderExhaustion(failed(NO_PROVIDER_CONFIGURED_MESSAGE))).toBe(false);
    expect(isRetryableProviderExhaustion(failed("Internal chat error — see server logs."))).toBe(false);
    expect(isRetryableProviderExhaustion({ ...failed(ALL_PROVIDERS_FAILED_MESSAGE), status: "answered" })).toBe(false);
  });

  it("only the newest exhausted turn becomes retryable — older ones stay inert", () => {
    const marker = [{ kind: "provider_failure", reason: "all_providers_failed" }];
    const turns = threadFromPersisted([errorRow("old", marker), errorRow("new", marker)], META).turns;
    const out = withRetryableLatestFailure(turns);
    const errs = out.filter((t) => t.role === "assistant").map((t) => (t.parts.find((p) => p.type === "error") as { error: { retryable: boolean } }).error.retryable);
    expect(errs).toEqual([false, true]);
  });

  it("control: a newest turn that is not a provider failure is left untouched", () => {
    const turns = threadFromPersisted([errorRow("old", [{ kind: "provider_failure", reason: "all_providers_failed" }]), { ...errorRow("ok", []), answerStatus: "answered" as const, answerText: "Check the bus." }], META).turns;
    expect(withRetryableLatestFailure(turns)).toEqual(turns);
  });

  it("control: a no-provider-configured newest turn is never made retryable", () => {
    const turns = threadFromPersisted([errorRow("n", [{ kind: "provider_failure", reason: "no_provider_configured" }])], META).turns;
    expect(withRetryableLatestFailure(turns)).toEqual(turns);
  });
});
