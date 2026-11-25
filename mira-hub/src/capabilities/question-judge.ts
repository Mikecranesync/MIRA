/**
 * Pre-retrieval question judge for Hub equipment-notebook chat (#5905).
 *
 * Classifies each technician question into: clear (answer as usual),
 * unclear/gibberish, or unsafe. Runs BEFORE retrieval, at the same point where
 * the #5905 deterministic hazard detector runs.
 *
 * Owner decisions (Mike, 2026-11-24, on #5905):
 *   - Unsafe questions get the PLAIN blanket reply only (same "please ask that
 *     again" style; no extra LOTO/make-it-safe line).
 *   - KEEP #5905's existing deterministic hazard warning for the cases it
 *     already catches; the judge is additive, never a replacement.
 *   - Fail-OPEN: if the judge errors or times out, let the question through;
 *     existing deterministic safety checks still run as backstops.
 *   - SHADOW MODE first: behind a config flag defaulting to shadow, the judge
 *     logs its verdict but blocks nothing. Enforcement mode (unsafe >= 0.75,
 *     unclear >= 0.90 -> blanket reply) must exist but be OFF by default.
 */

import { canonicalProviders, buildRequestBody, maxOutputTokens } from "@/lib/inference/canonical-cascade";
import { reserveOpenAiAttempt, boundInputTokens } from "./openai-run-budget";

export type QuestionVerdict = "clear" | "unclear" | "unsafe";

export type QuestionJudgeResult = {
  verdict: QuestionVerdict;
  confidence: number;
  latencyMs: number;
  model: string | null;
  provider: string | null;
  error: string | null;
};

/**
 * Is the question judge enabled? Default OFF (never enabled without an explicit
 * switch-on). When enabled, the mode determines whether verdicts block turns.
 */
export function questionJudgeEnabled(): boolean {
  return process.env.MIRA_QUESTION_JUDGE_ENABLED === "1";
}

/**
 * Question judge mode: "shadow" (logs only, never blocks) or "enforce" (blocks
 * based on thresholds). Default "shadow" when the judge is enabled.
 */
export function questionJudgeMode(): "shadow" | "enforce" {
  return process.env.MIRA_QUESTION_JUDGE_MODE === "enforce" ? "enforce" : "shadow";
}

/**
 * Confidence threshold for UNSAFE blocking (enforcement mode only). Default 0.75.
 * An unsafe verdict >= this confidence blocks the turn with a blanket reply.
 */
export function unsafeThreshold(): number {
  const raw = Number(process.env.MIRA_QUESTION_JUDGE_UNSAFE_THRESHOLD);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.75;
}

/**
 * Confidence threshold for UNCLEAR blocking (enforcement mode only). Default 0.90.
 * An unclear verdict >= this confidence blocks the turn with a blanket reply.
 */
export function unclearThreshold(): number {
  const raw = Number(process.env.MIRA_QUESTION_JUDGE_UNCLEAR_THRESHOLD);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.9;
}

/**
 * Request timeout for the judge LLM call (milliseconds). Default 1500ms.
 * Short timeout keeps latency ~0.2–0.8s typical; fail-open on timeout.
 */
export function judgeTimeoutMs(): number {
  const raw = Number(process.env.MIRA_QUESTION_JUDGE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 1500;
}

/**
 * The blanket reply for blocked unclear/unsafe questions. Plain, non-technical,
 * no extra LOTO/make-it-safe line (owner decision 2026-11-24).
 */
export const QUESTION_JUDGE_BLANKET_REPLY =
  "I didn't understand that question. Please ask again, clearly describing the equipment, fault code, or symptom you need help with.";

/**
 * Judge one technician question. Returns the verdict, confidence, latency, and
 * the provider/model that served, or an error when the judge fails.
 *
 * Fail-OPEN: errors and timeouts return verdict "clear" with error details so
 * the question proceeds through existing safety backstops.
 */
export async function judgeQuestion(message: string): Promise<QuestionJudgeResult> {
  const start = Date.now();
  const timeoutMs = judgeTimeoutMs();

  const providers = canonicalProviders();
  if (!providers.length || !providers[0].key) {
    return {
      verdict: "clear",
      confidence: 0,
      latencyMs: Date.now() - start,
      model: null,
      provider: null,
      error: "no_provider_configured",
    };
  }

  // Use the first provider (OpenAI gpt-5.4-mini if key is set, else first configured).
  const provider = providers[0];

  const systemPrompt = `You are a question classifier for an industrial maintenance AI assistant. Your job is to quickly classify each technician question into exactly one category:

- **clear**: A clear, answerable question about equipment, faults, procedures, or symptoms. Even if brief, it's clear. Examples: "What does fault F004 mean?", "How do I reset the VFD?", "My conveyor keeps stopping".

- **unclear**: Gibberish, nonsense, random characters, or completely unintelligible input. The question makes no sense at all. Examples: "asdfjkl", "????", "jjjjjjj", random emojis only.

- **unsafe**: A question asking about an unsafe practice, defeating safety devices, working on energized equipment without lockout, or any action that could cause injury or death. Examples: "Can I bypass the E-stop?", "How do I work on this while it's running?", "Should I leave the cabinet door open?".

Respond with ONLY a JSON object in this exact format:
{"verdict": "clear"|"unclear"|"unsafe", "confidence": 0.0-1.0}

No other text. Just the JSON.`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: message },
  ];
  const body = buildRequestBody(provider, messages, maxOutputTokens());

  // Gate the provider attempt through the Hub's budget/attempt gate (#4355).
  const inputBound = boundInputTokens(messages);
  const outputBound = maxOutputTokens();
  const gate = reserveOpenAiAttempt(provider.name, "question-judge", inputBound, outputBound, provider.model);

  if (!gate.ok) {
    // Fail-open: budget exhausted, let the question through.
    return {
      verdict: "clear",
      confidence: 0,
      latencyMs: Date.now() - start,
      model: provider.model,
      provider: provider.name,
      error: "budget_exhausted",
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(provider.key ? { Authorization: `Bearer ${provider.key}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      gate.reservation?.release();
      return {
        verdict: "clear",
        confidence: 0,
        latencyMs: Date.now() - start,
        model: provider.model,
        provider: provider.name,
        error: `http_${response.status}`,
      };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      gate.reservation?.release();
      return {
        verdict: "clear",
        confidence: 0,
        latencyMs: Date.now() - start,
        model: provider.model,
        provider: provider.name,
        error: "no_response_body",
      };
    }

    let fullText = "";
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((line) => line.trim().startsWith("data: "));

      for (const line of lines) {
        const data = line.replace(/^data: /, "").trim();
        if (data === "[DONE]") break;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) fullText += content;
        } catch {
          // Ignore parse errors in streaming chunks
        }
      }
    }

    // Parse the JSON response
    const jsonMatch = fullText.match(/\{[^}]*"verdict"[^}]*\}/);
    if (!jsonMatch) {
      gate.reservation?.release();
      return {
        verdict: "clear",
        confidence: 0,
        latencyMs: Date.now() - start,
        model: provider.model,
        provider: provider.name,
        error: "no_json_in_response",
      };
    }

    const result = JSON.parse(jsonMatch[0]);
    const verdict = result.verdict as QuestionVerdict;
    const confidence = typeof result.confidence === "number" ? result.confidence : 0;

    if (!["clear", "unclear", "unsafe"].includes(verdict)) {
      gate.reservation?.release();
      return {
        verdict: "clear",
        confidence: 0,
        latencyMs: Date.now() - start,
        model: provider.model,
        provider: provider.name,
        error: `invalid_verdict_${verdict}`,
      };
    }

    gate.reservation?.release();
    return {
      verdict,
      confidence,
      latencyMs: Date.now() - start,
      model: provider.model,
      provider: provider.name,
      error: null,
    };
  } catch (err) {
    gate.reservation?.release();
    const error = err instanceof Error ? err.message : String(err);
    return {
      verdict: "clear",
      confidence: 0,
      latencyMs: Date.now() - start,
      model: provider.model,
      provider: provider.name,
      error: error.includes("abort") ? "timeout" : error,
    };
  }
}

/**
 * Should this judge result block the turn in enforcement mode?
 * Unsafe >= 0.75, unclear >= 0.90. Never blocks in shadow mode.
 */
export function shouldBlock(result: QuestionJudgeResult): boolean {
  if (questionJudgeMode() !== "enforce") return false;
  if (result.error) return false; // Fail-open on error
  if (result.verdict === "unsafe") return result.confidence >= unsafeThreshold();
  if (result.verdict === "unclear") return result.confidence >= unclearThreshold();
  return false;
}

/**
 * Log the judge result (every invocation, shadow and enforce modes).
 */
export function logJudgeResult(
  scope: { tenantId: string; notebookId: string },
  message: string,
  result: QuestionJudgeResult,
  blocked: boolean,
): void {
  console.log(
    JSON.stringify({
      service: "mira-hub",
      component: "question-judge",
      event: "question.judged",
      mode: questionJudgeMode(),
      tenantId: scope.tenantId,
      notebookId: scope.notebookId,
      messageLength: message.length,
      verdict: result.verdict,
      confidence: result.confidence,
      latencyMs: result.latencyMs,
      provider: result.provider,
      model: result.model,
      error: result.error,
      blocked,
      thresholds: {
        unsafe: unsafeThreshold(),
        unclear: unclearThreshold(),
      },
    }),
  );
}
