// 086 §3 / round 5 — the in-flight turn must learn about a disputed identity
// the moment the marker frame lands, not only when answer text changes.
//
// Run: cd mira-mobile && bunx vitest run src/lib/__tests__/ask-notebook-dispute-update
import { describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ requestStream: vi.fn(), request: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/client")>();
  return { ...real, requestStream: client.requestStream, request: client.request };
});

import { askNotebook } from "../../api/resources";
import type { ChatTurn } from "../sse";

const frame = (o: Record<string, unknown>) => `data: ${JSON.stringify(o)}\n\n`;

describe("askNotebook onUpdate", () => {
  it("fires on the dispute marker frame BEFORE any content, with identityDisputed set", async () => {
    client.requestStream.mockImplementation(async (_path: string, o: { onChunk: (c: string) => void }) => {
      o.onChunk(frame({ kind: "evidence", identityDisputed: true }));
      o.onChunk(frame({ kind: "content", content: "An overcurrent" }));
      o.onChunk(frame({ kind: "status", status: "answered" }));
      return { status: 200, text: "" };
    });
    const updates: ChatTurn[] = [];
    const turn = await askNotebook("nb1", "q", [], { onUpdate: (t) => updates.push({ ...t }) });
    expect(updates[0]).toMatchObject({ answer: "", identityDisputed: true });
    expect(turn.identityDisputed).toBe(true);
  });
  it("an ordinary stream still updates only when text changes (control)", async () => {
    client.requestStream.mockImplementation(async (_path: string, o: { onChunk: (c: string) => void }) => {
      o.onChunk(frame({ kind: "sources", citations: [] }));
      o.onChunk(frame({ kind: "content", content: "The overload" }));
      o.onChunk(frame({ kind: "status", status: "answered" }));
      return { status: 200, text: "" };
    });
    const updates: ChatTurn[] = [];
    await askNotebook("nb1", "q", [], { onUpdate: (t) => updates.push({ ...t }) });
    expect(updates).toHaveLength(1);
    expect(updates[0].answer).toBe("The overload");
  });
});
