/**
 * Redaction — every secret-shaped value, or key, that reaches a span must
 * never survive to the exporter; and the Turn Evidence Packet must never
 * have a field a caller could use to smuggle message/answer/prompt text.
 *
 * Design: docs/architecture/observability/2026-09-22-turn-flight-recorder.md
 * §3 "Attribute policy", §8 "Privacy". Exercises `tracing.ts`'s allowlist +
 * redaction on BOTH paths a span attribute can arrive by (the `withSpan`
 * attrs argument, applied at `onStart`, and a raw `span.setAttribute` call
 * after start, enforced only at `onEnd` by `MiraAttributeProcessor` — see
 * that class's own comment in `tracing.ts`) and `turn-evidence-packet.ts`'s
 * "no content fields by construction" guarantee.
 *
 * Run: npx vitest run src/capabilities/observability/__tests__/redaction.test.ts
 */
import { context, propagation, trace } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __testing__installInMemoryExporter, isAllowedAttributeKey, withSpan } from "../tracing";
import { emptyPacket } from "../turn-evidence-packet";
import { startTurnRecorder } from "../turn-recorder";

// `__testing__installInMemoryExporter()` registers a GLOBAL TracerProvider
// via `@opentelemetry/api`'s process-wide registry (a `Symbol.for(...)` on
// `globalThis` — verified by reading `@opentelemetry/api`'s
// `internal/global-utils.js`: `registerGlobal` stores on `globalThis`, and a
// SECOND registration attempt is a silent no-op, `diag.error`-logged only).
// That registry can survive across test FILES that share a worker process,
// not just across `describe` blocks within one file (see tracing.test.ts's
// own ordering note, which only covers the within-file case). `trace.disable()`
// (+ `context`/`propagation`) before installing makes THIS file's provider
// win regardless of what ran earlier in the same worker, and disabling again
// in `afterAll` leaves the registry empty for whichever file runs next —
// notably `tracing.test.ts` itself, whose first describe block asserts "no
// provider installed" and would break if a prior file left a real one behind.
let handle: ReturnType<typeof __testing__installInMemoryExporter>;

beforeAll(() => {
  trace.disable();
  context.disable();
  propagation.disable();
  handle = __testing__installInMemoryExporter();
});

afterAll(() => {
  trace.disable();
  context.disable();
  propagation.disable();
});

beforeEach(() => {
  handle.reset();
});

function finishedSpan(name: string): ReadableSpan {
  const span = handle.finished().find((s) => s.name === name);
  if (!span) throw new Error(`no finished span named ${name}`);
  return span;
}

type Row = { label: string; key: string; value: string; secret: string };

/**
 * VALUE-shape rows: a neutral, non-secret-NAMED key (no allowlisted prefix
 * collision with SECRET_KEY_PATTERN) carrying a secret-SHAPED value — proves
 * `redactAttributeValue`'s marker scan catches the shape regardless of what
 * the caller named the attribute.
 */
const VALUE_SHAPE_ROWS: Row[] = [
  {
    label: "Authorization: Bearer x",
    key: "http.request.header.custom",
    value: "Bearer sk-abc123",
    secret: "sk-abc123",
  },
  {
    label: "Authorization: Basic abc",
    key: "http.request.header.custom2",
    value: "Basic dXNlcjpwYXNz",
    secret: "dXNlcjpwYXNz",
  },
  {
    label: "Cookie string carrying next-auth.session-token",
    key: "mira.request.raw_header",
    value: "next-auth.session-token=abc.def.ghi; Path=/",
    secret: "abc.def.ghi",
  },
  {
    label: "Langfuse public key pk-lf-…",
    key: "mira.config.snippet",
    value: "pk-lf-11111111-2222-3333",
    secret: "11111111-2222-3333",
  },
  {
    label: "Langfuse secret key sk-lf-…",
    key: "mira.config.snippet2",
    value: "sk-lf-44444444-5555-6666",
    secret: "44444444-5555-6666",
  },
  {
    label: "Groq key gsk_…",
    key: "mira.config.snippet3",
    value: "gsk_abcdefghijklmnop",
    secret: "abcdefghijklmnop",
  },
  {
    label: "Cerebras key csk-…",
    key: "mira.config.snippet4",
    value: "csk-abcdefghijklmnop",
    secret: "abcdefghijklmnop",
  },
];

/**
 * KEY-shape rows: a secret-NAMED key carrying a benign value — proves
 * `SECRET_KEY_PATTERN` redacts the whole value regardless of its shape.
 */
const KEY_SHAPE_ROWS: Row[] = [
  {
    label: "key named http.request.header.cookie",
    key: "http.request.header.cookie",
    value: "sessionid=abc123",
    secret: "abc123",
  },
  {
    label: "key named mira.api_key",
    key: "mira.api_key",
    value: "unrelated-benign-value",
    secret: "unrelated-benign-value",
  },
];

describe("secret-shaped VALUES under a neutral key are redacted (marker scan)", () => {
  it.each(VALUE_SHAPE_ROWS)(
    "$label — redacted whether set before start (withSpan attrs) or after (raw span.setAttribute)",
    async ({ key, value, secret }) => {
      const name = `value-shape-${key}`;
      await withSpan(name, { [key]: value }, async (span) => {
        span.setAttribute(`${key}.late`, value);
      });
      const span = finishedSpan(name);
      const attrs = span.attributes as Record<string, unknown>;
      expect(attrs[key]).toBe("[REDACTED]");
      expect(attrs[`${key}.late`]).toBe("[REDACTED]");
      const serialized = JSON.stringify(attrs);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain(value);
    },
  );
});

describe("secret-shaped KEYS redact their whole value regardless of shape", () => {
  it.each(KEY_SHAPE_ROWS)("$label", async ({ key, value, secret }) => {
    const name = `key-shape-${key}`;
    await withSpan(name, { [key]: value }, async (span) => {
      span.setAttribute(key, value);
    });
    const span = finishedSpan(name);
    const attrs = span.attributes as Record<string, unknown>;
    expect(attrs[key]).toBe("[REDACTED]");
    expect(JSON.stringify(attrs)).not.toContain(secret);
  });
});

describe("a Doppler-looking value ('dp.st.…') under a NEUTRAL key — CURRENT GAP", () => {
  // `tracing.ts`'s SECRET_VALUE_MARKERS (read directly from the file) is
  // ["Bearer ", "Basic ", "pk-lf-", "sk-lf-", "gsk_", "csk-", "session-token",
  // "Cookie", "cookie=", "Authorization"] — there is no Doppler-shaped entry
  // (e.g. "dp.st.", "dp.ct.", "dp.sa."). So a Doppler service-token value
  // stored under a key that does NOT itself match SECRET_KEY_PATTERN
  // (authorization|cookie|token|secret|password|api[_-]?key) survives to the
  // exporter today. That is a real gap, not a test bug — `tracing.ts` is
  // lane I1's file, out of this lane's edit scope (design §10 lane table).
  // `it.fails` keeps this honest instead of silently weakening the
  // assertion: it passes ONLY because the redaction currently does NOT
  // happen, and turns red the moment `dp.st.`/`dp.ct.`/`dp.sa.` is added to
  // SECRET_VALUE_MARKERS — at which point delete this describe block and
  // fold the row into VALUE_SHAPE_ROWS above. Filed as a cross-lane need in
  // the final report.
  it.fails("is redacted (expected to fail until a Doppler value marker is added)", async () => {
    const name = "doppler-value-shape-gap";
    const secretValue = "dp.st.stg.AbCdEfGhIjKlMnOpQrStUvWxYz123456";
    await withSpan(name, { "mira.config.value": secretValue }, async () => {});
    const span = finishedSpan(name);
    const attrs = span.attributes as Record<string, unknown>;
    expect(attrs["mira.config.value"]).toBe("[REDACTED]");
    expect(JSON.stringify(attrs)).not.toContain(secretValue);
  });

  it("IS caught today when the SAME value lands under a realistic token-named key (the mitigation available now)", async () => {
    const name = "doppler-value-under-token-key";
    const secretValue = "dp.st.stg.AbCdEfGhIjKlMnOpQrStUvWxYz123456";
    await withSpan(name, { "mira.config.doppler_token": secretValue }, async () => {});
    const span = finishedSpan(name);
    const attrs = span.attributes as Record<string, unknown>;
    expect(attrs["mira.config.doppler_token"]).toBe("[REDACTED]");
    expect(JSON.stringify(attrs)).not.toContain(secretValue);
  });
});

describe("non-allowlisted keys are DROPPED entirely, not merely left unredacted", () => {
  it("drops foo.bar and password (no allowed prefix) while keeping an allowlisted sibling", async () => {
    const name = "non-allowlisted";
    await withSpan(name, { "foo.bar": "x", password: "hunter2", "mira.ok": "kept" }, async (span) => {
      span.setAttribute("password", "late-hunter2");
    });
    const span = finishedSpan(name);
    const attrs = span.attributes as Record<string, unknown>;
    expect(attrs["mira.ok"]).toBe("kept");
    expect(attrs["foo.bar"]).toBeUndefined();
    expect(attrs["password"]).toBeUndefined();
    expect(isAllowedAttributeKey("foo.bar")).toBe(false);
    expect(isAllowedAttributeKey("password")).toBe(false);
    expect(JSON.stringify(attrs)).not.toContain("hunter2");
  });
});

describe("TurnEvidencePacket carries no content fields by construction", () => {
  const FORBIDDEN_EXACT_KEYS = ["message", "question", "answer", "prompt", "cookie", "authorization"];

  function walkKeys(obj: unknown, keys: Set<string>): void {
    if (obj === null || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      keys.add(k);
      walkKeys(v, keys);
    }
  }

  it("emptyPacket has no field whose KEY is exactly one of the forbidden content-field names", () => {
    // NOTE: a naive substring check (`JSON.stringify(packet).includes("answer")`)
    // is the WRONG assertion here and is guaranteed to fail on the real
    // shape — `answer_gate`, `answer_chars`, and `message_chars` all contain
    // "answer"/"message" as substrings while carrying no free text. The
    // actual guarantee is schema-level: no field is exactly named one of the
    // forbidden content-field names, so there is no destination for a
    // caller to put raw text into even by mistake.
    const p = emptyPacket({
      kind: "chat",
      environment: "staging",
      git_sha: "abc123",
      service_version: "v1",
      tenant_id: "t-1",
    });
    const keys = new Set<string>();
    walkKeys(p, keys);
    for (const forbidden of FORBIDDEN_EXACT_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("a question-like string pushed through TurnRecorder.stage() has no packet field named for it — documents the discipline this schema relies on", () => {
    // `TurnRecorder.stage()` (turn-recorder.ts) is a plain `Object.assign`
    // merge with NO length cap and NO content stripping — verified by
    // reading the file. So if a route carelessly pushed a full technician
    // question into a string field (e.g. `identity.unresolved_reason`, the
    // one free-ish string in the "identity" section), it WOULD survive
    // verbatim in that field. That is asserted below, honestly, rather than
    // hidden — this test is NOT claiming the recorder scrubs content; it is
    // claiming the schema gives that content nowhere named "message"/
    // "question"/"answer"/"prompt" to land, which is the guarantee the
    // design actually makes (§4: "Never in the packet: message text, answer
    // text, chunk text, prompts...").
    const planted =
      "how do I reset the E-stop on line 4, it says F0004 and I'm not sure it's safe";
    const rec = startTurnRecorder({ kind: "chat", tenantId: "t-1", notebookId: "nb-1" });
    rec.stage("identity", { unresolved_reason: planted });
    const { packet } = rec.finish({ anomalyChecks: false });

    // The recorder does not scrub — this is the documented hazard, not a bug.
    expect(packet.identity.unresolved_reason).toBe(planted);

    // But no field carrying it is named one of the forbidden content keys.
    const keys = new Set<string>();
    walkKeys(packet, keys);
    for (const forbidden of FORBIDDEN_EXACT_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });
});
