import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/server.ts";

function pickPort(): number {
  return 8200 + Math.floor(Math.random() * 200);
}

// We swap the global fetch per-test. Outbound calls in the handler are
// either Ignition (matched by /data/tag/read) or LLM provider endpoints
// (matched by host). Local supertest calls go through Express's listener,
// not through fetch, so they're unaffected.
const realFetch = globalThis.fetch;

interface MockResponse {
  status: number;
  body: unknown;
}

function installFetchMock(
  router: (url: string, init: RequestInit | undefined) => MockResponse,
): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    // Let the test's own localhost calls fall through to the real fetch
    // so they actually hit the Express server.
    if (url.includes("127.0.0.1") || url.includes("localhost:8")) {
      // Only fall through for local Express server (ports 8200-8399 here).
      const m = url.match(/:(\d+)/);
      if (m && Number(m[1]) >= 8200 && Number(m[1]) < 8400) {
        return realFetch(input as RequestInfo, init);
      }
    }
    const mock = router(url, init);
    return new Response(JSON.stringify(mock.body), {
      status: mock.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.GROQ_API_KEY = "test-groq-key";
  delete process.env.CEREBRAS_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GROQ_API_KEY;
  delete process.env.CEREBRAS_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

describe("POST /projects/:id/live-troubleshoot", () => {
  test("404 for unknown project", async () => {
    const app = createApp();
    const port = pickPort();
    const server = app.listen(port);
    try {
      const r = await fetch(
        `http://127.0.0.1:${port}/projects/nope/live-troubleshoot`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: "x",
            ignitionUrl: "http://ignition",
            tagPrefix: "[default]MIRA_PLC",
          }),
        },
      );
      expect(r.status).toBe(404);
    } finally {
      server.close();
    }
  });

  test("400 when required fields missing", async () => {
    const app = createApp();
    const port = pickPort();
    const server = app.listen(port);
    try {
      const r = await fetch(
        `http://127.0.0.1:${port}/projects/micro820-conveyor/live-troubleshoot`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: "x" }),
        },
      );
      expect(r.status).toBe(400);
    } finally {
      server.close();
    }
  });

  test("502 when Ignition is unreachable", async () => {
    installFetchMock((url) => {
      if (url.includes("/data/tag/read")) {
        return { status: 500, body: { error: "ignition_down" } };
      }
      return { status: 200, body: {} };
    });
    const app = createApp();
    const port = pickPort();
    const server = app.listen(port);
    try {
      const r = await fetch(
        `http://127.0.0.1:${port}/projects/micro820-conveyor/live-troubleshoot`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: "why is conveyor stopped?",
            ignitionUrl: "http://fake-ignition:8088",
            tagPrefix: "[default]MIRA_PLC",
          }),
        },
      );
      expect(r.status).toBe(502);
      const body = (await r.json()) as { error: string };
      expect(body.error).toBe("ignition_unreachable");
    } finally {
      server.close();
    }
  });

  test("502 when no LLM provider key is set", async () => {
    delete process.env.GROQ_API_KEY;
    installFetchMock((url) => {
      if (url.includes("/data/tag/read")) {
        return {
          status: 200,
          body: { results: [{ path: "x", value: false, quality: "Good" }] },
        };
      }
      return { status: 500, body: {} };
    });
    const app = createApp();
    const port = pickPort();
    const server = app.listen(port);
    try {
      const r = await fetch(
        `http://127.0.0.1:${port}/projects/micro820-conveyor/live-troubleshoot`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: "why?",
            ignitionUrl: "http://fake-ignition:8088",
            tagPrefix: "[default]MIRA_PLC",
          }),
        },
      );
      expect(r.status).toBe(502);
      const body = (await r.json()) as { error: string };
      expect(body.error).toBe("llm_unavailable");
    } finally {
      server.close();
    }
  });

  test("200 happy path returns grounded answer", async () => {
    installFetchMock((url) => {
      if (url.includes("/data/tag/read")) {
        return {
          status: 200,
          body: {
            results: [
              {
                path: "[default]MIRA_PLC/motor_running",
                value: false,
                quality: "Good",
                timestamp: "2026-05-11T10:00:00Z",
              },
            ],
          },
        };
      }
      if (url.includes("api.groq.com")) {
        return {
          status: 200,
          body: {
            choices: [
              {
                message: {
                  content:
                    "motor_running = false [live]. Likely cause: e_stop_active = true [live].",
                },
              },
            ],
          },
        };
      }
      return { status: 500, body: {} };
    });

    const app = createApp();
    const port = pickPort();
    const server = app.listen(port);
    try {
      const r = await fetch(
        `http://127.0.0.1:${port}/projects/micro820-conveyor/live-troubleshoot`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: "why won't the motor run?",
            ignitionUrl: "http://fake-ignition:8088",
            tagPrefix: "[default]MIRA_PLC",
          }),
        },
      );
      expect(r.status).toBe(200);
      const body = (await r.json()) as {
        answer: string;
        tags_read: unknown[];
        context_used: string[];
        provider: string;
      };
      expect(body.answer).toContain("[live]");
      expect(body.provider).toBe("groq");
      expect(Array.isArray(body.tags_read)).toBe(true);
      expect(body.context_used.length).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  test("falls back to cerebras when groq fails", async () => {
    process.env.CEREBRAS_API_KEY = "test-cerebras-key";
    installFetchMock((url) => {
      if (url.includes("/data/tag/read")) {
        return {
          status: 200,
          body: { results: [{ path: "x", value: true, quality: "Good" }] },
        };
      }
      if (url.includes("api.groq.com")) {
        return { status: 500, body: { error: "groq_down" } };
      }
      if (url.includes("api.cerebras.ai")) {
        return {
          status: 200,
          body: {
            choices: [{ message: { content: "fallback answer [live]" } }],
          },
        };
      }
      return { status: 500, body: {} };
    });

    const app = createApp();
    const port = pickPort();
    const server = app.listen(port);
    try {
      const r = await fetch(
        `http://127.0.0.1:${port}/projects/micro820-conveyor/live-troubleshoot`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: "why?",
            ignitionUrl: "http://fake-ignition:8088",
            tagPrefix: "[default]MIRA_PLC",
          }),
        },
      );
      expect(r.status).toBe(200);
      const body = (await r.json()) as { provider: string };
      expect(body.provider).toBe("cerebras");
    } finally {
      server.close();
    }
  });
});
