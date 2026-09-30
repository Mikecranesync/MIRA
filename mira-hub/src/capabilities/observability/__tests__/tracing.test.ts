import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  __testing__installInMemoryExporter,
  activeSpanId,
  activeTraceId,
  isAllowedAttributeKey,
  redactAttributeValue,
  setSpanAttrs,
  withSpan,
} from "../tracing";

// NOTE ON ORDERING: `__testing__installInMemoryExporter()` registers a
// GLOBAL TracerProvider via `@opentelemetry/api`'s process-wide registry.
// The "no provider installed" describe block below therefore MUST run —
// and finish — before anything in this file calls that function. Vitest
// collects every `describe` body first (synchronously, top to bottom) and
// only then runs `it`s in declaration order, so as long as the installer is
// called from a `beforeAll` (which fires at RUN time, not COLLECT time) and
// this describe is declared first, the two states stay isolated within one
// file. Do not reorder these two `describe` blocks or hoist the installer
// call to module scope.

describe("withSpan / activeTraceId — tracing disabled (no provider installed)", () => {
  it("activeTraceId/activeSpanId are null with no active span", () => {
    expect(activeTraceId()).toBeNull();
    expect(activeSpanId()).toBeNull();
  });

  it("still runs fn and returns its value, against a non-recording span", async () => {
    const result = await withSpan("no-op-path", { "mira.turn.id": "abc" }, async (span) => {
      expect(span.isRecording()).toBe(false);
      return 42;
    });
    expect(result).toBe(42);
  });
});

describe("withSpan / activeTraceId / activeSpanId — with a registered provider", () => {
  let handle: ReturnType<typeof __testing__installInMemoryExporter>;

  beforeAll(() => {
    handle = __testing__installInMemoryExporter();
  });

  beforeEach(() => {
    handle.reset();
  });

  function finished(): ReadableSpan[] {
    return handle.finished();
  }

  it("is a 32-hex trace id inside a span, null outside one", async () => {
    expect(activeTraceId()).toBeNull();
    await withSpan("solo", {}, async () => {
      expect(activeTraceId()).toMatch(/^[0-9a-f]{32}$/);
      expect(activeSpanId()).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  it("creates a child of the active span and preserves trace id across an awaited async hop and a setTimeout hop", async () => {
    let outerTraceId: string | null = null;
    let innerTraceIdAfterAwait: string | null = null;
    let innerTraceIdAfterTimeout: string | null = null;

    await withSpan("outer", {}, async () => {
      outerTraceId = activeTraceId();
      await withSpan("inner", {}, async () => {
        await Promise.resolve();
        innerTraceIdAfterAwait = activeTraceId();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        innerTraceIdAfterTimeout = activeTraceId();
      });
    });

    expect(outerTraceId).toMatch(/^[0-9a-f]{32}$/);
    expect(innerTraceIdAfterAwait).toBe(outerTraceId);
    expect(innerTraceIdAfterTimeout).toBe(outerTraceId);

    const spans = finished();
    const outer = spans.find((s) => s.name === "outer");
    const inner = spans.find((s) => s.name === "inner");
    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    expect(inner?.parentSpanContext?.spanId).toBe(outer?.spanContext().spanId);
    expect(inner?.spanContext().traceId).toBe(outer?.spanContext().traceId);
  });

  it("re-throws but records the exception and still ends the span", async () => {
    const boom = new Error("boom");
    await expect(
      withSpan("failing", {}, async () => {
        throw boom;
      }),
    ).rejects.toThrow("boom");

    const span = finished().find((s) => s.name === "failing");
    expect(span).toBeDefined();
    expect(span?.ended).toBe(true);
    expect(span?.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(span?.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("sets allowlisted attrs passed to withSpan and drops the rest", async () => {
    await withSpan(
      "attrs",
      {
        "mira.turn.id": "t-1",
        "not.allowed.key": "dropped",
        "http.method": "POST",
      },
      async () => {},
    );
    const span = finished().find((s) => s.name === "attrs");
    expect(span?.attributes["mira.turn.id"]).toBe("t-1");
    expect(span?.attributes["http.method"]).toBe("POST");
    expect(span?.attributes["not.allowed.key"]).toBeUndefined();
  });

  describe("MiraAttributeProcessor — enforcement at onEnd (review finding)", () => {
    it("scrubs attributes written AFTER span start via raw span.setAttribute", async () => {
      // Auto-instrumentation and any caller that bypasses setSpanAttrs write
      // straight into the span; onStart never sees those. The exporter must.
      await withSpan("late-attrs", {}, async (span) => {
        span.setAttribute("http.request.header.authorization", "Bearer gsk_secret_value");
        span.setAttribute("db.statement", "select 1");
        span.setAttribute("not.allowlisted", "leak");
        span.setAttribute("mira.file.id", "pk-lf-should-redact");
      });
      const span = finished().find((s) => s.name === "late-attrs");
      expect(span).toBeDefined();
      const attrs = span!.attributes as Record<string, unknown>;
      expect(attrs["not.allowlisted"]).toBeUndefined();
      expect(attrs["db.statement"]).toBe("select 1");
      expect(attrs["http.request.header.authorization"]).toBe("[REDACTED]");
      expect(attrs["mira.file.id"]).toBe("[REDACTED]");
      expect(JSON.stringify(attrs)).not.toContain("gsk_secret_value");
      expect(JSON.stringify(attrs)).not.toContain("leak");
    });
  });

  describe("redaction keeps GenAI usage counters and drops empty arrays (staging trace findings)", () => {
    it("gen_ai.usage.input_tokens / output_tokens are numeric, not [REDACTED]", async () => {
      await withSpan("usage", { "gen_ai.usage.input_tokens": 1234, "gen_ai.usage.output_tokens": 56 }, async () => {});
      const span = finished().find((s) => s.name === "usage")!;
      expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(1234);
      expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(56);
    });
    it("credential-shaped token keys are still redacted", () => {
      for (const key of ["mira.session_token", "http.request.header.x-auth-token", "mira.token", "mira.access-token", "mira.refresh_token_value"]) {
        expect(redactAttributeValue(key, "abc"), key).toBe("[REDACTED]");
      }
      expect(redactAttributeValue("mira.context.prompt_tokens", 99)).toBe(99);
    });
    it("an empty array attribute is omitted rather than exported as an empty arrayValue", async () => {
      await withSpan("arrays", { "mira.retrieval.returned_doc_ids": [], "mira.context.evidence_doc_ids": ["d1"] }, async () => {});
      const span = finished().find((s) => s.name === "arrays")!;
      expect(span.attributes["mira.retrieval.returned_doc_ids"]).toBeUndefined();
      expect(span.attributes["mira.context.evidence_doc_ids"]).toEqual(["d1"]);
    });
  });

  describe("setSpanAttrs — allowlist + redaction + caps", () => {
    it("drops non-allowlisted keys", async () => {
      await withSpan("filter", {}, async (span) => {
        setSpanAttrs({ "mira.ok": "yes", "dropped.key": "no" }, span);
      });
      const span = finished().find((s) => s.name === "filter");
      expect(span?.attributes["mira.ok"]).toBe("yes");
      expect(span?.attributes["dropped.key"]).toBeUndefined();
    });

    it("redacts a Bearer token value", async () => {
      await withSpan("secret-value", {}, async (span) => {
        setSpanAttrs({ "http.request.header.custom": "Bearer abc123" }, span);
      });
      const span = finished().find((s) => s.name === "secret-value");
      expect(span?.attributes["http.request.header.custom"]).toBe("[REDACTED]");
    });

    it("redacts a cookie header value", async () => {
      await withSpan("secret-cookie", {}, async (span) => {
        setSpanAttrs({ "http.request.header.raw": "Cookie: next-auth.session-token=abc" }, span);
      });
      const span = finished().find((s) => s.name === "secret-cookie");
      expect(span?.attributes["http.request.header.raw"]).toBe("[REDACTED]");
    });

    it("redacts a Langfuse pk-lf- key value", async () => {
      await withSpan("secret-pk", {}, async (span) => {
        setSpanAttrs({ "mira.debug.value": "pk-lf-abcdef" }, span);
      });
      const span = finished().find((s) => s.name === "secret-pk");
      expect(span?.attributes["mira.debug.value"]).toBe("[REDACTED]");
    });

    it("redacts any value on a key named x-api-key regardless of shape", async () => {
      await withSpan("secret-key-name", {}, async (span) => {
        setSpanAttrs({ "mira.x-api-key": "harmless-looking-value" }, span);
      });
      const span = finished().find((s) => s.name === "secret-key-name");
      expect(span?.attributes["mira.x-api-key"]).toBe("[REDACTED]");
    });

    it("caps arrays at 32 entries and strings at 512 chars", async () => {
      const longArray = Array.from({ length: 40 }, (_, i) => `v${i}`);
      const longString = "x".repeat(600);
      await withSpan("caps", {}, async (span) => {
        setSpanAttrs({ "mira.list": longArray, "mira.text": longString }, span);
      });
      const span = finished().find((s) => s.name === "caps");
      const list = span?.attributes["mira.list"] as string[];
      const text = span?.attributes["mira.text"] as string;
      expect(list).toHaveLength(32);
      expect(text).toHaveLength(512);
    });
  });
});

describe("isAllowedAttributeKey", () => {
  it("allows the documented prefixes", () => {
    for (const key of [
      "mira.turn.id",
      "gen_ai.request.model",
      "http.method",
      "db.statement",
      "net.peer.name",
      "url.path",
      "server.address",
      "client.address",
      "error.type",
      "exception.message",
      "next.route",
    ]) {
      expect(isAllowedAttributeKey(key)).toBe(true);
    }
  });

  it("drops anything else", () => {
    for (const key of ["random.key", "custom_attr", "authorization"]) {
      expect(isAllowedAttributeKey(key)).toBe(false);
    }
  });
});

describe("redactAttributeValue", () => {
  it("passes through an ordinary value unchanged", () => {
    expect(redactAttributeValue("mira.turn.mode", "grounded")).toBe("grounded");
  });

  it("redacts by key regardless of value shape", () => {
    expect(redactAttributeValue("mira.session_token", 12345)).toBe("[REDACTED]");
  });
});
