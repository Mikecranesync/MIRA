/**
 * Jev shadow judgment — the seam is exercised end-to-end with an injected
 * fetch: exact request body, vendor scrub, every fail-open branch, and the
 * success mapping. Nothing here touches the network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  JEV_ENDPOINT,
  JEV_INSTRUCTIONS,
  JEV_INSTRUCTIONS_VERSION,
  JEV_MODEL,
  buildJevSufficiencyRequest,
  judgeEvidenceSufficiencyShadow,
  scrubForVendor,
} from "../jev-shadow";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.useRealTimers();
});

function enable() {
  process.env.MIRA_JEV_SHADOW = "1";
  process.env.JEV_API_KEY = "test-key-never-logged";
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("scrubForVendor", () => {
  it("replaces IPv4, MAC and serial-number shapes and leaves ratings alone", () => {
    expect(scrubForVendor("PLC at 192.168.1.100, MAC 00:1A:2B:3C:4D:5E, S/N ABC123456, rated 24 VDC 0.5 A")).toBe(
      "PLC at [IP], MAC [MAC], S/N [SN], rated 24 VDC 0.5 A",
    );
    expect(scrubForVendor("Serial number: XK99-77-2201 shipped")).toBe("Serial number: [SN] shipped");
  });
});

describe("buildJevSufficiencyRequest", () => {
  it("is the exact pinned request shape: model, one state, one noul question", () => {
    const req = buildJevSufficiencyRequest("What is the input voltage of the TP700 Comfort?", [
      { content: "Rated input voltage 24 V DC (19.2 – 28.8 V DC).", title: "TP700 Comfort manual" },
      { content: "Generic mounting instructions.", title: null },
    ]);
    expect(req).toEqual({
      model: JEV_MODEL,
      state:
        "Question: What is the input voltage of the TP700 Comfort?\n" +
        "Evidence:\n" +
        "[1 TP700 Comfort manual] Rated input voltage 24 V DC (19.2 – 28.8 V DC).\n" +
        "[2] Generic mounting instructions.",
      questions: { sufficient: { type: "noul", instructions: JEV_INSTRUCTIONS } },
    });
    expect(JEV_MODEL).toBe("jev-1.13.0");
    expect(JEV_ENDPOINT).toBe("https://api.typesafe.ai/v1/systemone");
  });

  it("caps the question at 600 chars and each of at most six chunks at 700", () => {
    const req = buildJevSufficiencyRequest("q".repeat(2000), [{ content: "c".repeat(5000) }, ...Array(10).fill({ content: "x" })]);
    expect(req.state.startsWith("Question: " + "q".repeat(600) + "\nEvidence:\n[1] " + "c".repeat(700) + "\n")).toBe(true);
    expect(req.state.split("\n").length).toBe(2 + 6); // header lines + MAX_CHUNKS
  });

  it("scrubs the question and the chunks before they leave the process", () => {
    const req = buildJevSufficiencyRequest("drive at 10.0.0.7 faulted", [{ content: "S/N 5551234567 on the nameplate" }]);
    expect(req.state).not.toContain("10.0.0.7");
    expect(req.state).not.toContain("5551234567");
  });
});

describe("judgeEvidenceSufficiencyShadow — fail-open branches", () => {
  it("is disabled by default and makes no network call", async () => {
    delete process.env.MIRA_JEV_SHADOW;
    process.env.JEV_API_KEY = "present";
    const fetchImpl = vi.fn();
    const r = await judgeEvidenceSufficiencyShadow("q", [{ content: "c" }], { fetchImpl: fetchImpl as never });
    expect(r).toEqual({
      noul: null,
      skipped_reason: "disabled",
      latency_ms: null,
      model: null,
      input_tokens: null,
      instructions_version: JEV_INSTRUCTIONS_VERSION,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips with no_evidence when nothing was retrieved — no metered call for a known answer", async () => {
    enable();
    const fetchImpl = vi.fn();
    const r = await judgeEvidenceSufficiencyShadow("what is a VFD", [], { fetchImpl: fetchImpl as never });
    expect(r).toMatchObject({ noul: null, skipped_reason: "no_evidence", latency_ms: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips with no_key when enabled but the key is absent", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    delete process.env.JEV_API_KEY;
    const fetchImpl = vi.fn();
    const r = await judgeEvidenceSufficiencyShadow("q", [{ content: "c" }], { fetchImpl: fetchImpl as never });
    expect(r.skipped_reason).toBe("no_key");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the bearer key only in the Authorization header and the pinned body", async () => {
    enable();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ model: "jev-1.13.0", answers: { sufficient: { noul: 0.91 } }, usage: { input_tokens: 123, output_tokens: 1 } }),
    );
    const r = await judgeEvidenceSufficiencyShadow("What is the rated current?", [{ content: "Rated current 2.5 A", title: "Manual" }], {
      fetchImpl: fetchImpl as never,
    });
    expect(r.noul).toBe(0.91);
    expect(r.model).toBe("jev-1.13.0");
    expect(r.input_tokens).toBe(123);
    expect(r.skipped_reason).toBeNull();
    expect(typeof r.latency_ms).toBe("number");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(JEV_ENDPOINT);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key-never-logged");
    expect(JSON.parse(init.body as string)).toEqual(
      buildJevSufficiencyRequest("What is the rated current?", [{ content: "Rated current 2.5 A", title: "Manual" }]),
    );
    expect(init.body as string).not.toContain("test-key-never-logged");
  });

  it("maps a non-2xx to http_<status> with noul null", async () => {
    enable();
    const r = await judgeEvidenceSufficiencyShadow("q", [{ content: "c" }], {
      fetchImpl: (async () => jsonResponse({ detail: "nope" }, 422)) as never,
    });
    expect(r).toMatchObject({ noul: null, skipped_reason: "http_422" });
  });

  it("maps a response without a numeric noul to malformed", async () => {
    enable();
    const r = await judgeEvidenceSufficiencyShadow("q", [{ content: "c" }], {
      fetchImpl: (async () => jsonResponse({ answers: { sufficient: { noul: "0.5" } } })) as never,
    });
    expect(r).toMatchObject({ noul: null, skipped_reason: "malformed" });
  });

  it("never throws: a thrown fetch becomes skipped_reason=error", async () => {
    enable();
    const r = await judgeEvidenceSufficiencyShadow("q", [{ content: "c" }], {
      fetchImpl: (async () => {
        throw new TypeError("ECONNRESET");
      }) as never,
    });
    expect(r).toMatchObject({ noul: null, skipped_reason: "error" });
  });

  it("aborts at the timeout and reports timeout", async () => {
    enable();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );
    const started = Date.now();
    const r = await judgeEvidenceSufficiencyShadow("q", [{ content: "c" }], { fetchImpl: fetchImpl as never, timeoutMs: 30 });
    expect(r).toMatchObject({ noul: null, skipped_reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
