// Vitest coverage for the ADR-0017 Hub-side proposal transition helper.
//
// Run: cd mira-hub && npx vitest run src/lib/proposal-transition
//
// PROPOSAL_TRANSITIONS is the load-bearing mapping (ADR-0017 §Decision). The
// applier is exercised against a mock query client to assert it issues the
// right UPDATEs and keeps the paired ai_suggestions row in lockstep.

import { describe, it, expect, vi } from "vitest";
import {
  PROPOSAL_TRANSITIONS,
  applyHubProposalTransition,
  KG_EDGE_STATE_WHEN_SUPERSEDED,
  type QueryClient,
} from "@/lib/proposal-transition";

describe("PROPOSAL_TRANSITIONS mapping (ADR-0017)", () => {
  it("maps admin accept → ai accepted + rp verified", () => {
    expect(PROPOSAL_TRANSITIONS.accept).toEqual({
      aiSuggestion: "accepted",
      relationshipProposal: "verified",
    });
  });
  it("maps admin reject → both rejected", () => {
    expect(PROPOSAL_TRANSITIONS.reject).toEqual({
      aiSuggestion: "rejected",
      relationshipProposal: "rejected",
    });
  });
  it("defer touches only the ai queue", () => {
    expect(PROPOSAL_TRANSITIONS.defer).toEqual({
      aiSuggestion: "deferred",
      relationshipProposal: null,
    });
  });
  it("supersede → ai superseded + rp deprecated", () => {
    expect(PROPOSAL_TRANSITIONS.supersede).toEqual({
      aiSuggestion: "superseded",
      relationshipProposal: "deprecated",
    });
  });
});

describe("supersede takes the edge out of the verified set (ADR-0017 amended, #5523)", () => {
  it("issues one kg_relationships update, scoped to verified rows of that proposal's fact, and reports the count", async () => {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const client = {
      query: async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        return { rows: [], rowCount: /UPDATE kg_relationships/.test(text) ? 1 : 0 };
      },
    };
    const out = await applyHubProposalTransition(client, { trigger: "supersede", relationshipProposalId: "rp-1" });
    const kg = calls.filter((c) => /UPDATE kg_relationships/.test(c.text));
    expect(kg).toHaveLength(1);
    expect(kg[0].text).toContain(`approval_state = '${KG_EDGE_STATE_WHEN_SUPERSEDED}'`);
    expect(kg[0].text).toMatch(/k\.approval_state = 'verified'/);
    expect(kg[0].params).toEqual(["rp-1"]);
    expect(out.kgEdgesDemoted).toBe(1);
  });
  it("accept and supersede first take a per-fact transaction lock; other triggers do not", async () => {
    for (const trigger of ["new", "accept", "reject", "defer", "contradict", "flag_review", "supersede"] as const) {
      const calls: string[] = [];
      const client = { query: async (text: string) => (calls.push(text), { rows: [] }) };
      await applyHubProposalTransition(client, { trigger, relationshipProposalId: "rp-1" });
      const locked = /pg_advisory_xact_lock/.test(calls[0] ?? "");
      expect(locked).toBe(trigger === "accept" || trigger === "supersede");
      expect(calls.filter((t) => /pg_advisory_xact_lock/.test(t)).length).toBe(locked ? 1 : 0);
    }
  });
  it("no other trigger touches kg_relationships", async () => {
    for (const trigger of ["new", "accept", "reject", "defer", "contradict", "flag_review"] as const) {
      const calls: string[] = [];
      const client = { query: async (text: string) => (calls.push(text), { rows: [] }) };
      await applyHubProposalTransition(client, { trigger, relationshipProposalId: "rp-1" });
      expect(calls.some((t) => /kg_relationships/.test(t))).toBe(false);
    }
  });
});

function mockClient() {
  const calls: { text: string; params?: unknown[] }[] = [];
  const client: QueryClient = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      return { rows: [], rowCount: 1 };
    }),
  };
  return { client, calls };
}

describe("applyHubProposalTransition", () => {
  it("accept updates relationship_proposals → verified and the paired ai_suggestions → accepted", async () => {
    const { client, calls } = mockClient();
    const res = await applyHubProposalTransition(client, {
      trigger: "accept",
      relationshipProposalId: "rp-1",
      reviewerLabel: "human:u1",
    });
    // The per-fact lock comes first (accept decides whether a fact is current), then the two writes.
    expect(calls.length).toBe(3);
    expect(calls[0].text).toMatch(/pg_advisory_xact_lock/);
    expect(calls[1].text).toMatch(/UPDATE relationship_proposals/);
    expect(calls[1].params).toContain("verified");
    // ai_suggestions keyed off extracted_data (NOT payload), per mig 027 + canary.
    expect(calls[2].text).toMatch(/UPDATE ai_suggestions/);
    expect(calls[2].text).toMatch(/extracted_data->>'relationship_proposal_id'/);
    expect(calls[2].params).toContain("accepted");
    expect(res.relationshipProposalStatus).toBe("verified");
    expect(res.aiSuggestionStatus).toBe("accepted");
  });

  it("defer updates ONLY ai_suggestions (relationship_proposals unchanged)", async () => {
    const { client, calls } = mockClient();
    await applyHubProposalTransition(client, {
      trigger: "defer",
      relationshipProposalId: "rp-2",
    });
    expect(calls.length).toBe(1);
    expect(calls[0].text).toMatch(/UPDATE ai_suggestions/);
    expect(calls[0].params).toContain("deferred");
  });

  it("prefers an explicit aiSuggestionId when provided", async () => {
    const { client, calls } = mockClient();
    await applyHubProposalTransition(client, {
      trigger: "reject",
      relationshipProposalId: "rp-3",
      aiSuggestionId: "ai-9",
    });
    const aiCall = calls.find((c) => /UPDATE ai_suggestions/.test(c.text));
    expect(aiCall?.text).toMatch(/WHERE id = \$3/);
    expect(aiCall?.params).toContain("ai-9");
  });

  it("throws on an unknown trigger", async () => {
    const { client } = mockClient();
    await expect(
      // @ts-expect-error — deliberately invalid trigger
      applyHubProposalTransition(client, { trigger: "bogus" }),
    ).rejects.toThrow(/unknown proposal trigger/);
  });
});
