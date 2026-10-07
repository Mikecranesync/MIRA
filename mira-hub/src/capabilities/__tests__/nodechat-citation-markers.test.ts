/**
 * NodeChat (`/api/namespace/node/[id]/chat`) — the beta-gate door — forwards
 * provider deltas verbatim. gpt-oss sometimes writes its citation as `【1】`
 * (or `【1†L3-L4】`) instead of `[1]`; the client and the beta gate only
 * recognise `[n]`, so a correctly grounded answer read as UNCITED (beta gate
 * on PR #4303 head 59ef8d7b5: "…then reset the fault【1】", citation=False).
 * The notebook route already normalizes these markers; NodeChat must too,
 * including a marker split across two deltas.
 *
 * Run: cd mira-hub && ./node_modules/.bin/vitest run src/capabilities/__tests__/nodechat-citation-markers.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/workspace-files", () => ({ linkedDocIdsForNode: vi.fn(async () => []) }));
vi.mock("@/lib/manual-rag", () => ({
  retrieveNodeChunks: vi.fn(),
  appendManualContext: vi.fn((prompt: string) => prompt),
  buildManualUserContent: vi.fn((content: string) => content),
  chunksToSources: vi.fn(() => []),
}));

import { drainProviderStream } from "@/app/api/namespace/node/[id]/chat/route";

const enc = new TextEncoder();
const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

async function forward(deltas: string[]): Promise<{ text: string; buffered: string }> {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const d of deltas) c.enqueue(enc.encode(delta(d)));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  const chunks: string[] = [];
  const controller = {
    enqueue: (u: Uint8Array) => chunks.push(new TextDecoder().decode(u)),
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  const responseBuffer: string[] = [];
  await drainProviderStream(body, controller, enc, responseBuffer);
  const text = chunks
    .flatMap((c) => c.split("\n\n"))
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => (JSON.parse(l) as { content?: string }).content ?? "")
    .join("");
  return { text, buffered: responseBuffer.join("") };
}

describe("NodeChat normalizes provider citation markers to [n]", () => {
  it("a whole 【1】 marker reaches the client as [1]", async () => {
    const { text, buffered } = await forward(["Increase the acceleration time, then reset the fault【1】."]);
    expect(text).toBe("Increase the acceleration time, then reset the fault[1].");
    expect(buffered).toBe(text);
  });

  it("a marker split across deltas, with a line range, still becomes [1] and never leaks a 【", async () => {
    const { text } = await forward(["Check the DC bus voltage ", "【", "1†L3-L4】 first."]);
    expect(text).toBe("Check the DC bus voltage [1] first.");
    expect(text).not.toContain("【");
  });

  it("text held after an unclosed 【 is still delivered when the stream ends — never silently dropped", async () => {
    const { text, buffered } = await forward(["See the wiring table ", "【note"]);
    expect(text).toBe("See the wiring table 【note");
    expect(buffered).toBe(text);
  });

  it("control: plain [n] markers and ordinary text pass through unchanged", async () => {
    const { text } = await forward(["Set P9.01 to 2 ", "for Modbus control [2]."]);
    expect(text).toBe("Set P9.01 to 2 for Modbus control [2].");
  });
});
