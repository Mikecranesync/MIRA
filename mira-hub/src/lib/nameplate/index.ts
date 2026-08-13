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

export function isRecognizerConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
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

/** Groq vision provider (uses the hub server's GROQ_API_KEY when present). */
export class GroqVisionRecognizer implements NameplateRecognizer {
  readonly name = "groq-llama4-vision";

  async recognize(imageBase64: string, mimeType: string): Promise<EquipmentIdentityCandidate> {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("recognizer_not_configured");
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
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
    const body = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content ?? "{}";
    return normalizeCandidate(JSON.parse(text));
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

export function defaultRecognizer(): NameplateRecognizer {
  return new GroqVisionRecognizer();
}
