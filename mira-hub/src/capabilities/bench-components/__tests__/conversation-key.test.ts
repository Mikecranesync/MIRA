import { describe, expect, it } from "vitest";
import { LEGACY_THREAD_ID } from "@/lib/equipment-notebooks";
import { DEFAULT_CONVERSATION_KEY } from "../chat-turn";

// The chat route's scope check keys the default conversation without importing equipment-notebooks;
// it must be the key the selection routes write (http.ts threadKeyOf → LEGACY_THREAD_ID).
describe("the default conversation's selection key", () => {
  it("is the same value the selection routes use", () => {
    expect(DEFAULT_CONVERSATION_KEY).toBe(LEGACY_THREAD_ID);
  });
});
