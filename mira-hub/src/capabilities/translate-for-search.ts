import { cascadeComplete } from "@/lib/llm/cascade";

/** One short free-tier cascade call: translate a maintenance question to
 *  English for corpus search. Returns null on any provider failure. */
export async function translateForSearch(text: string): Promise<string | null> {
  const r = await cascadeComplete(
    [
      {
        role: "system",
        content:
          "Translate the maintenance technician's question to English for a manual search. " +
          "Keep model numbers, fault codes, parameter names and units exactly. Output only the translation.",
      },
      { role: "user", content: text },
    ],
    { maxTokens: 160, temperature: 0, timeoutMs: 8_000 },
  );
  return r?.content ?? null;
}
