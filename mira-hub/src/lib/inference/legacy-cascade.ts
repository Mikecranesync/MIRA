/**
 * The LEGACY inline notebook cascade — the list the notebook chat route
 * dispatches when `MIRA_CANONICAL_SEAM` is off (the production Compose
 * default). It lived inline in `equipment-notebooks/[id]/chat/route.ts`; it
 * moved here, byte-identical (names, URLs, env-var names, model defaults,
 * order), so the runtime identity (#4507, #5048) can fingerprint the cascade
 * that actually serves instead of advertising the canonical one. It still
 * diverges from Hard Constraint #2 by listing Gemini; delete it when the seam
 * is default-on.
 */
import { canonicalProviders, canonicalSeamEnabled, type CanonicalProvider } from "./canonical-cascade";

export function legacyProviders(): CanonicalProvider[] {
  return [
    {
      name: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
      // llama-3.3-70b-versatile shuts down 2026-08-16 (Phase 1.5 bakeoff §7 P0);
      // default to the current gpt-oss model so the primary provider keeps serving.
      model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
    },
    {
      name: "Cerebras",
      url: "https://api.cerebras.ai/v1/chat/completions",
      key: process.env.CEREBRAS_API_KEY,
      model: process.env.CEREBRAS_MODEL ?? "gpt-oss-120b",
    },
    {
      name: "Gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    },
  ];
}

/**
 * The providers the notebook route can actually dispatch this turn: the list
 * its seam flag selects, minus every entry its serving loop skips
 * (`if (!provider.key) continue`). The one resolver the runtime identity reads.
 */
export function effectiveNotebookProviders(): CanonicalProvider[] {
  const list = canonicalSeamEnabled() ? canonicalProviders() : legacyProviders();
  return list.filter((p) => Boolean(p.key));
}
