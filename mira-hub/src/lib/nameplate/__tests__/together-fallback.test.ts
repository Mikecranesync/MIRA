// Together vision model fallback (2026-08-25 prod outage).
//
// google/gemma-3n-E4B-it silently became dedicated-only on Together; every
// nameplate read returned 400 model_not_available, the route mapped it to an
// opaque 502, and the phone said "Server error". These tests pin the three
// behaviours that turn that class of failure into a config change:
//   1. the default model is one Together still serves,
//   2. a model_not_available answer moves on to the next configured model,
//   3. any other provider error stops immediately and keeps its status + code.
//
// Run: cd mira-hub && npx vitest run src/lib/nameplate/__tests__/together-fallback

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TogetherVisionRecognizer,
  togetherVisionModel,
  togetherVisionFallbackModels,
  isModelUnavailableError,
} from "../index";

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const providerError = (status: number, code?: string) =>
  new Response(JSON.stringify({ error: { code, message: "provider says no" } }), { status });

const env = { ...process.env };
beforeEach(() => {
  process.env.TOGETHERAI_API_KEY = "test-key";
  delete process.env.NAMEPLATE_VISION_MODEL;
  delete process.env.TOGETHERAI_VISION_MODEL;
  delete process.env.NAMEPLATE_VISION_FALLBACK_MODELS;
});
afterEach(() => {
  process.env = { ...env };
  vi.restoreAllMocks();
});

describe("default model", () => {
  it("is a model Together serves serverless (not the retired gemma-3n)", () => {
    expect(togetherVisionModel()).toBe("MiniMaxAI/MiniMax-M3");
    expect(togetherVisionModel()).not.toContain("gemma-3n");
  });
  it("parses the fallback list from env, tolerating spaces and empties", () => {
    process.env.NAMEPLATE_VISION_FALLBACK_MODELS = " a/b , ,c/d";
    expect(togetherVisionFallbackModels()).toEqual(["a/b", "c/d"]);
    delete process.env.NAMEPLATE_VISION_FALLBACK_MODELS;
    expect(togetherVisionFallbackModels()).toEqual([]);
  });
});

describe("TogetherVisionRecognizer fallback", () => {
  it("moves to the next model on model_not_available and returns its answer", async () => {
    process.env.NAMEPLATE_VISION_FALLBACK_MODELS = "fallback/one";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(providerError(400, "model_not_available"))
      .mockResolvedValueOnce(ok(JSON.stringify({ manufacturer: "Harrington", model: "NER005L" })));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const out = await new TogetherVisionRecognizer().recognize("QUJD", "image/jpeg");
    expect(out.manufacturer).toBe("Harrington");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const models = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).model);
    expect(models).toEqual(["MiniMaxAI/MiniMax-M3", "fallback/one"]);
  });

  it("surfaces status + provider code when every model is unavailable", async () => {
    process.env.NAMEPLATE_VISION_FALLBACK_MODELS = "fallback/one";
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerError(400, "model_not_available"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(new TogetherVisionRecognizer().recognize("QUJD", "image/jpeg")).rejects.toThrow(
      "recognizer_provider_error_400_model_not_available",
    );
  });

  it("does NOT fall back on other provider errors (a 500 is not a retired model)", async () => {
    process.env.NAMEPLATE_VISION_FALLBACK_MODELS = "fallback/one";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerError(500));
    await expect(new TogetherVisionRecognizer().recognize("QUJD", "image/jpeg")).rejects.toThrow(
      "recognizer_provider_error_500",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never leaks provider free text into the error (PRD §20)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "bad code with spaces?key=SECRET", message: "x" } }), {
        status: 400,
      }),
    );
    await expect(new TogetherVisionRecognizer().recognize("QUJD", "image/jpeg")).rejects.toThrow(
      /^recognizer_provider_error_400$/,
    );
  });
});

describe("isModelUnavailableError", () => {
  it("matches model_not_available and 404, nothing else", () => {
    expect(isModelUnavailableError(new Error("recognizer_provider_error_400_model_not_available"))).toBe(true);
    expect(isModelUnavailableError(new Error("recognizer_provider_error_404"))).toBe(true);
    expect(isModelUnavailableError(new Error("recognizer_provider_error_429"))).toBe(false);
    expect(isModelUnavailableError(new Error("recognizer_provider_timeout"))).toBe(false);
  });
});
