/**
 * Mira AI chat — SSE proxy to mira-pipeline /v1/chat/completions endpoint.
 *
 * The pipeline accepts POST /v1/chat/completions (OpenAI-compat) and returns
 * choices[0].message.content. This module wraps it in SSE for the browser.
 *
 * Migrated from mira-sidecar :5000/rag → mira-pipeline :9099 (ADR-0008).
 */

const PIPELINE_URL =
  process.env.PIPELINE_URL || "http://mira-pipeline:9099";
const PIPELINE_API_KEY = process.env.PIPELINE_API_KEY || "";

export interface MiraChatRequest {
  query: string;
  assetId?: string;
}

export interface MiraSource {
  file: string;
  page: string;
  excerpt: string;
  brain: string;
}

export interface MiraChatResponse {
  answer: string;
  sources: MiraSource[];
}

/**
 * Call mira-pipeline /v1/chat/completions and return the structured response.
 * Sources are parsed from the 📚 citation footer injected by the citation gate.
 */
export async function queryMira(
  req: MiraChatRequest
): Promise<MiraChatResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (PIPELINE_API_KEY) {
    headers["Authorization"] = `Bearer ${PIPELINE_API_KEY}`;
  }

  const userContent = req.assetId
    ? `[Asset: ${req.assetId}] ${req.query}`
    : req.query;

  const resp = await fetch(`${PIPELINE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "mira-diagnostic",
      messages: [{ role: "user", content: userContent }],
      stream: false,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Pipeline /v1/chat/completions failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  const answer: string = data.choices?.[0]?.message?.content || "Unable to generate a response.";

  return {
    answer,
    sources: parseCitationFooter(answer),
  };
}

/**
 * Parse 📚 citation footer lines injected by the engine citation gate.
 * Format: "📚 Source: Manufacturer Model — Section (url)"
 */
function parseCitationFooter(answer: string): MiraSource[] {
  const sources: MiraSource[] = [];
  const lines = answer.split("\n");
  for (const line of lines) {
    const match = line.match(/^📚 Source:\s*(.+?)(?:\s*\((.+?)\))?\s*$/);
    if (match) {
      sources.push({
        file: match[2] || "",
        page: "",
        excerpt: match[1].trim(),
        brain: "pipeline",
      });
    }
  }
  return sources;
}

/**
 * Build an SSE stream from a Mira response.
 * Events: thinking → answer → done
 */
export function buildSSEStream(response: MiraChatResponse): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      // Event 1: thinking indicator
      controller.enqueue(
        encoder.encode(`event: thinking\ndata: {}\n\n`)
      );

      // Event 2: the answer with sources
      const payload = JSON.stringify({
        answer: response.answer,
        sources: response.sources,
      });
      controller.enqueue(
        encoder.encode(`event: answer\ndata: ${payload}\n\n`)
      );

      // Event 3: done
      controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
      controller.close();
    },
  });
}

/**
 * Check if a Mira response recommends creating a work order.
 * Looks for "WO RECOMMENDED:" in the answer text.
 */
export function parseWORecommendation(
  answer: string
): { recommended: boolean; title: string; priority: string } | null {
  const match = answer.match(/WO RECOMMENDED:\s*(.+?)(?:\s*\|\s*Priority:\s*(\w+))?$/m);
  if (!match) return null;
  return {
    recommended: true,
    title: match[1].trim(),
    priority: match[2]?.trim() || "HIGH",
  };
}
