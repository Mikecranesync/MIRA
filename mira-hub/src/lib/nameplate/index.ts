/**
 * NameplateRecognizer — provider adapter boundary (PRD §10, §23).
 *
 * The vision provider is a candidate generator, never an authority: results are
 * normalized, carry confidence, and the UI always requires user confirmation
 * before an identity becomes authoritative. Providers are swappable without
 * UI/schema churn.
 */

export type EquipmentIdentityCandidate = {
  manufacturer?: string | null;
  model?: string | null;
  catalogNumber?: string | null;
  serialNumber?: string | null;
  equipmentType?: string | null;
  otherIdentifiers?: Record<string, string>;
  confidence?: number;
  rawText?: string[];
};

export interface NameplateRecognizer {
  readonly name: string;
  recognize(imageBase64: string, mimeType: string): Promise<EquipmentIdentityCandidate>;
}

/** Clamp/normalize whatever a provider returns into the candidate contract. */
export function normalizeCandidate(raw: unknown): EquipmentIdentityCandidate {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    // Providers must return null for unreadable fields — treat placeholder
    // junk as null instead of presenting it as an extraction.
    if (!t || /^(null|none|unknown|n\/a|not visible|unreadable)$/i.test(t)) return null;
    return t.slice(0, 200);
  };
  const conf = typeof o.confidence === "number" ? Math.min(1, Math.max(0, o.confidence)) : undefined;
  return {
    manufacturer: str(o.manufacturer),
    model: str(o.model),
    catalogNumber: str(o.catalogNumber ?? o.catalog_number),
    serialNumber: str(o.serialNumber ?? o.serial_number),
    equipmentType: str(o.equipmentType ?? o.equipment_type),
    confidence: conf,
    rawText: Array.isArray(o.rawText)
      ? (o.rawText as unknown[]).map((t) => String(t)).slice(0, 40)
      : undefined,
  };
}

// ── Provider selection / model configuration ─────────────────────────────────
//
// ⚠️ THE VISION MODEL MUST BE QUALIFIED BEFORE DEPLOYMENT. Vision catalogs churn
// fast and a delisted id fails as a 404 on every photo, which reads to the
// technician as "the camera thing is broken". This file previously pinned
// `meta-llama/llama-4-scout-17b-16e-instruct` — Groq delisted ALL vision models
// on 2026-07-18 (see mira-bots/shared/inference/router.py, which is the repo's
// documented source of truth for provider vision config), so that pin was dead.
//
// Env contract (mirrors router.py exactly, including the `||` fallback form —
// compose maps `${VAR:-}` which delivers an EMPTY STRING in-container, so a
// plain `??` default would leave vision dead):
//   NAMEPLATE_VISION_MODEL   — overrides the model for THIS feature on either provider
//   TOGETHERAI_API_KEY       — enables the Together vision path (the only live one)
//   TOGETHERAI_VISION_MODEL  — Together model id, default google/gemma-3n-E4B-it
//   GROQ_API_KEY + GROQ_VISION_MODEL — Groq path, live ONLY if the model is set
//   NAMEPLATE_RECOGNIZER=fixture — deterministic test switch (no module mocking)

const TOGETHER_VISION_DEFAULT = "google/gemma-3n-E4B-it";

export function togetherVisionModel(): string {
  return (
    process.env.NAMEPLATE_VISION_MODEL ||
    process.env.TOGETHERAI_VISION_MODEL ||
    TOGETHER_VISION_DEFAULT
  );
}

/** Groq has no default: it ships no vision model today, so it is opt-in only. */
export function groqVisionModel(): string {
  return process.env.NAMEPLATE_VISION_MODEL || process.env.GROQ_VISION_MODEL || "";
}

function fixtureSelected(): boolean {
  return (process.env.NAMEPLATE_RECOGNIZER || "").toLowerCase() === "fixture";
}

export function isRecognizerConfigured(): boolean {
  if (fixtureSelected()) return true;
  if (process.env.TOGETHERAI_API_KEY) return true;
  // A Groq key alone is NOT a vision provider — it needs an explicit model.
  return Boolean(process.env.GROQ_API_KEY && groqVisionModel());
}

const VISION_PROMPT = `You are reading an industrial equipment NAMEPLATE photograph.
Extract ONLY text that is visible or strongly inferable from the image.
Rules: do not invent missing serial/model digits; preserve punctuation exactly;
distinguish model vs catalog vs serial numbers when possible; use null for any
unreadable field; include a confidence between 0 and 1 for the overall identity.
Respond ONLY with JSON:
{"manufacturer": string|null, "model": string|null, "catalogNumber": string|null,
 "serialNumber": string|null, "equipmentType": string|null,
 "confidence": number, "rawText": string[]}`;

/** Shared OpenAI-compatible vision call — Groq and Together speak the same shape. */
async function openAiCompatVision(
  apiUrl: string,
  apiKey: string,
  model: string,
  imageBase64: string,
  mimeType: string,
): Promise<EquipmentIdentityCandidate> {
  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: VISION_PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
          ],
        },
      ],
    }),
  });
  if (!resp.ok) {
    // Scrub any credential-bearing detail from provider errors (PRD §20).
    throw new Error(`recognizer_provider_error_${resp.status}`);
  }
  const body = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content ?? "{}";
  return normalizeCandidate(JSON.parse(text));
}

/**
 * Groq vision provider. Opt-in only: Groq ships no vision model as of
 * 2026-07-18, so this throws unless GROQ_VISION_MODEL (or
 * NAMEPLATE_VISION_MODEL) names one that has been qualified.
 */
export class GroqVisionRecognizer implements NameplateRecognizer {
  readonly name = "groq-vision";

  async recognize(imageBase64: string, mimeType: string): Promise<EquipmentIdentityCandidate> {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("recognizer_not_configured");
    const model = groqVisionModel();
    if (!model) throw new Error("recognizer_no_vision_model");
    return openAiCompatVision(
      "https://api.groq.com/openai/v1/chat/completions",
      key,
      model,
      imageBase64,
      mimeType,
    );
  }
}

/**
 * Together vision provider — the repo's only live vision path
 * (mira-bots/shared/inference/router.py). Model id from
 * NAMEPLATE_VISION_MODEL || TOGETHERAI_VISION_MODEL || google/gemma-3n-E4B-it.
 */
export class TogetherVisionRecognizer implements NameplateRecognizer {
  readonly name = "together-vision";

  async recognize(imageBase64: string, mimeType: string): Promise<EquipmentIdentityCandidate> {
    const key = process.env.TOGETHERAI_API_KEY;
    if (!key) throw new Error("recognizer_not_configured");
    return openAiCompatVision(
      "https://api.together.xyz/v1/chat/completions",
      key,
      togetherVisionModel(),
      imageBase64,
      mimeType,
    );
  }
}

/** Deterministic fixture provider for tests — never calls the network. */
export class FixtureRecognizer implements NameplateRecognizer {
  readonly name = "fixture";
  constructor(private readonly fixture: EquipmentIdentityCandidate) {}
  async recognize(): Promise<EquipmentIdentityCandidate> {
    return normalizeCandidate(this.fixture);
  }
}

/**
 * Fixture payload for NAMEPLATE_RECOGNIZER=fixture. NAMEPLATE_FIXTURE_JSON may
 * carry a candidate; anything unparseable falls back to a neutral fixture so a
 * misconfigured test env fails loudly at the assertion, not at JSON.parse.
 */
function fixtureCandidate(): EquipmentIdentityCandidate {
  const raw = process.env.NAMEPLATE_FIXTURE_JSON;
  if (raw) {
    try {
      return normalizeCandidate(JSON.parse(raw));
    } catch {
      /* fall through */
    }
  }
  return normalizeCandidate({
    manufacturer: "Fixture Manufacturing",
    model: "FIX-100",
    confidence: 0.5,
    rawText: ["FIXTURE NAMEPLATE"],
  });
}

/**
 * Provider order: explicit fixture switch → Together (the only live vision
 * path) → Groq (opt-in, needs an explicitly qualified model).
 */
export function defaultRecognizer(): NameplateRecognizer {
  if (fixtureSelected()) return new FixtureRecognizer(fixtureCandidate());
  if (process.env.TOGETHERAI_API_KEY) return new TogetherVisionRecognizer();
  return new GroqVisionRecognizer();
}
