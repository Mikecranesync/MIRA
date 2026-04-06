/**
 * Mira AI chat — SSE proxy to mira-sidecar /rag endpoint.
 *
 * The sidecar accepts POST /rag { query, asset_id, tag_snapshot, context }
 * and returns { answer, sources }. This module wraps it in SSE for the browser.
 */

const SIDECAR_URL =
  process.env.SIDECAR_URL || "http://mira-sidecar:5000";

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
 * Call mira-sidecar /rag and return the structured response.
 */
export async function queryMira(
  req: MiraChatRequest
): Promise<MiraChatResponse> {
  const resp = await fetch(`${SIDECAR_URL}/rag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: req.query,
      asset_id: req.assetId || "",
      tag_snapshot: {},
      context: "",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Sidecar /rag failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  return {
    answer: data.answer || "Unable to generate a response.",
    sources: data.sources || [],
  };
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
