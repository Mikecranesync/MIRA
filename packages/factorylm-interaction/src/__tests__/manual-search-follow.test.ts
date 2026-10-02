// Codex round 2 (#4195 F4/F6/F8/F9) — the shared, pure, framework-free
// follower both UnifiedChat.tsx (mobile) and hub-host.tsx (Hub) drive with
// their own setTimeout chain. No timers live here; this file proves the
// STATE MACHINE only — generation keying, the budget's stability across
// `running` responses, null-is-inconclusive, the terminal unresolved state,
// and the one-shot refresh signal on success.
import { describe, expect, it } from "bun:test";
import {
  advanceManualSearchFollow,
  isManualSearchFollowActive,
  reseedManualSearchFollow,
  startManualSearchFollow,
  MANUAL_SEARCH_UNRESOLVED_MESSAGE,
  type ManualSearchFollowState,
} from "@factorylm/interaction";
import type { ManualSearchStatus } from "@factorylm/interaction";

const NB = "nb-1";
const RUNNING: ManualSearchStatus = { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" };
const SETTLED: ManualSearchStatus = { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" };
const SETTLED_GEN2: ManualSearchStatus = { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it (2).", startedAt: "gen-2" };
const RUNNING_GEN2: ManualSearchStatus = { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-2" };

describe("startManualSearchFollow", () => {
  it("starts in 'following' for a running status", () => {
    const s = startManualSearchFollow(NB, RUNNING);
    expect(s.phase).toBe("following");
    expect(s.attempts).toBe(0);
    expect(isManualSearchFollowActive(s)).toBe(true);
  });

  it("starts already 'resolved' for a settled status — nothing to follow", () => {
    const s = startManualSearchFollow(NB, SETTLED);
    expect(s.phase).toBe("resolved");
    expect(isManualSearchFollowActive(s)).toBe(false);
  });
});

describe("advanceManualSearchFollow — budget stability across `running` (Codex F8)", () => {
  it("does NOT reset attempts on a running response — reaches unresolved at the fixed budget", () => {
    let s = startManualSearchFollow(NB, RUNNING, 5);
    for (let i = 0; i < 4; i++) {
      const r = advanceManualSearchFollow(s, NB, RUNNING);
      s = r.state;
      expect(s.phase).toBe("following");
      expect(s.attempts).toBe(i + 1);
      expect(r.refreshSources).toBe(false);
    }
    // 5th attempt exhausts the budget.
    const r5 = advanceManualSearchFollow(s, NB, RUNNING);
    expect(r5.state.phase).toBe("unresolved");
    expect(r5.state.attempts).toBe(5);
    expect(r5.state.status.message).toBe(MANUAL_SEARCH_UNRESOLVED_MESSAGE);
    expect(r5.state.status.running).toBe(false);
    expect(r5.refreshSources).toBe(false);
    expect(isManualSearchFollowActive(r5.state)).toBe(false);
  });

  it("a stray late read after the budget is spent changes nothing further", () => {
    let s = startManualSearchFollow(NB, RUNNING, 1);
    s = advanceManualSearchFollow(s, NB, RUNNING).state; // spends the only attempt -> unresolved
    expect(s.phase).toBe("unresolved");
    const r = advanceManualSearchFollow(s, NB, RUNNING);
    expect(r.state.phase).toBe("unresolved");
    expect(r.state.attempts).toBe(1); // not incremented again
    expect(r.refreshSources).toBe(false);
  });
});

describe("advanceManualSearchFollow — a null/unavailable read (Codex F9)", () => {
  it("is inconclusive: consumes one attempt but never stops following on its own", () => {
    let s = startManualSearchFollow(NB, RUNNING, 5);
    const r1 = advanceManualSearchFollow(s, NB, null);
    expect(r1.state.phase).toBe("following");
    expect(r1.state.attempts).toBe(1);
    expect(r1.refreshSources).toBe(false);
    // Keeps rendering the last known status rather than blanking the card.
    expect(r1.state.status).toEqual(RUNNING);
  });

  it("several inconclusive reads in a row still terminate at the SAME fixed budget as running reads", () => {
    let s = startManualSearchFollow(NB, RUNNING, 3);
    s = advanceManualSearchFollow(s, NB, null).state;
    s = advanceManualSearchFollow(s, NB, null).state;
    expect(s.phase).toBe("following");
    const r3 = advanceManualSearchFollow(s, NB, null);
    expect(r3.state.phase).toBe("unresolved");
    expect(r3.state.attempts).toBe(3);
  });

  it("a settle AFTER some inconclusive reads still resolves and signals refresh", () => {
    let s = startManualSearchFollow(NB, RUNNING, 5);
    s = advanceManualSearchFollow(s, NB, null).state;
    const r = advanceManualSearchFollow(s, NB, SETTLED);
    expect(r.state.phase).toBe("resolved");
    expect(r.state.status).toEqual(SETTLED);
    expect(r.refreshSources).toBe(true);
  });
});

describe("advanceManualSearchFollow — success (Codex F4/F6)", () => {
  it("resolves on a settled (running:false) read and signals refreshSources exactly once", () => {
    const s0 = startManualSearchFollow(NB, RUNNING);
    const r1 = advanceManualSearchFollow(s0, NB, SETTLED);
    expect(r1.state.phase).toBe("resolved");
    expect(r1.refreshSources).toBe(true);
    // A second advance against the now-resolved state never re-signals.
    const r2 = advanceManualSearchFollow(r1.state, NB, SETTLED);
    expect(r2.refreshSources).toBe(false);
  });
});

describe("advanceManualSearchFollow — generation reset (Codex F8)", () => {
  it("a read reporting a DIFFERENT known generation resets the budget", () => {
    let s: ManualSearchFollowState = startManualSearchFollow(NB, RUNNING, 3);
    s = advanceManualSearchFollow(s, NB, RUNNING).state;
    s = advanceManualSearchFollow(s, NB, RUNNING).state;
    expect(s.attempts).toBe(2);
    const nextGen: ManualSearchStatus = { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-2" };
    const r = advanceManualSearchFollow(s, NB, nextGen);
    expect(r.state.key).toContain("gen-2");
    expect(r.state.attempts).toBe(1); // fresh follow, one attempt spent on this very read
    expect(r.state.phase).toBe("following");
  });

  it("a read with NO startedAt (unknown generation) never resets — treated as the same search", () => {
    let s = startManualSearchFollow(NB, RUNNING, 5);
    s = advanceManualSearchFollow(s, NB, RUNNING).state;
    const unknownGen: ManualSearchStatus = { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true };
    const r = advanceManualSearchFollow(s, NB, unknownGen);
    expect(r.state.attempts).toBe(2); // continued, not reset
    expect(r.state.key).toBe(s.key);
  });

  it("starting a follow with no generation yet, then observing one, does not itself count as a reset mid-follow", () => {
    const noGen: ManualSearchStatus = { manufacturer: "SMC", model: "X", running: true };
    let s = startManualSearchFollow(NB, noGen, 5);
    const r = advanceManualSearchFollow(s, NB, { ...noGen, startedAt: "gen-1" });
    // The first read that CARRIES a generation is, by this module's contract,
    // a "different known generation" from the key-less start — it resets,
    // which is safe (adopts the generation) and still inside budget.
    expect(r.state.phase).toBe("following");
    expect(r.state.key).toContain("gen-1");
  });

  it("Codex F11 — a brand-new generation observed ALREADY SETTLED on the very first tick still resolves and signals refresh (never skips running→settled)", () => {
    // The optimistic, generation-less follow a confirm seeds BEFORE the first
    // real read — exactly F11's reproduction.
    const noGen: ManualSearchStatus = { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true };
    const s = startManualSearchFollow(NB, noGen, 5);
    const r = advanceManualSearchFollow(s, NB, SETTLED); // the search finished before the first tick
    expect(r.state.phase).toBe("resolved");
    expect(r.state.status).toEqual(SETTLED);
    expect(r.state.attempts).toBe(1);
    expect(r.refreshSources).toBe(true); // F11: this was false before the fix
  });

  it("Codex F11 — a DIFFERENT known generation observed already settled on the first tick also resolves and signals refresh", () => {
    let s: ManualSearchFollowState = startManualSearchFollow(NB, RUNNING, 3);
    s = advanceManualSearchFollow(s, NB, RUNNING).state;
    const r = advanceManualSearchFollow(s, NB, SETTLED_GEN2);
    expect(r.state.key).toContain("gen-2");
    expect(r.state.phase).toBe("resolved");
    expect(r.state.attempts).toBe(1); // fresh budget, one attempt spent on this very read
    expect(r.refreshSources).toBe(true);
  });
});

describe("reseedManualSearchFollow — the state machine every 'seed' moment goes through (Codex round 3 F6/F11)", () => {
  // (a) a NEW generation (nothing tracked, or a different startedAt) — fresh budget.
  it("(a) nothing tracked yet + a running read -> fresh 'following' state, no refresh", () => {
    const r = reseedManualSearchFollow(null, NB, RUNNING);
    expect(r.state.phase).toBe("following");
    expect(r.state.attempts).toBe(0);
    expect(r.refreshSources).toBe(false);
  });

  it("(d) nothing tracked yet + an ALREADY-SETTLED read -> resolved, but refreshSources is FALSE (nothing stale to refresh on a bare first hydration)", () => {
    const r = reseedManualSearchFollow(null, NB, SETTLED);
    expect(r.state.phase).toBe("resolved");
    expect(r.refreshSources).toBe(false);
  });

  it("(a) a DIFFERENT generation than the one tracked -> fresh budget, following", () => {
    const current = startManualSearchFollow(NB, RUNNING, 5);
    const r = reseedManualSearchFollow(current, NB, RUNNING_GEN2);
    expect(r.state.key).toContain("gen-2");
    expect(r.state.attempts).toBe(0);
    expect(r.state.phase).toBe("following");
  });

  it("(d) a DIFFERENT generation than the one tracked, already settled on arrival -> resolved AND refreshSources fires (something WAS tracked before)", () => {
    const current = startManualSearchFollow(NB, RUNNING, 5);
    const r = reseedManualSearchFollow(current, NB, SETTLED_GEN2);
    expect(r.state.key).toContain("gen-2");
    expect(r.state.phase).toBe("resolved");
    expect(r.refreshSources).toBe(true);
  });

  // (b) the SAME generation, still following, confirmed still running -> pure no-op.
  it("(b) same generation, already following, read confirms still running -> no-op (reference-equal state, tick owns it)", () => {
    const current = startManualSearchFollow(NB, RUNNING, 5);
    const r = reseedManualSearchFollow(current, NB, RUNNING);
    expect(r.state).toBe(current); // reference equality: a true no-op
    expect(r.refreshSources).toBe(false);
  });

  // (c) the SAME generation, otherwise -> an authoritative update replaces the display.
  it("(c) same generation, TERMINAL (resolved) + a DIFFERENT message on reseed (confirmation/promotion) -> replaces the display and refreshes again", () => {
    const resolved = { ...startManualSearchFollow(NB, RUNNING, 5), phase: "resolved" as const, status: SETTLED };
    const promoted: ManualSearchStatus = { ...SETTLED, message: "Promoted — ready to answer from." };
    const r = reseedManualSearchFollow(resolved, NB, promoted);
    expect(r.state.status).toEqual(promoted);
    expect(r.state.phase).toBe("resolved");
    expect(r.refreshSources).toBe(true);
  });

  it("(c) same generation, TERMINAL (resolved) + an IDENTICAL reseed -> replaces nothing meaningfully and does NOT refresh again", () => {
    const resolved = { ...startManualSearchFollow(NB, RUNNING, 5), phase: "resolved" as const, status: SETTLED };
    const r = reseedManualSearchFollow(resolved, NB, SETTLED);
    expect(r.refreshSources).toBe(false);
  });

  it("(c) same generation, TERMINAL (unresolved/exhausted) + a later settle arrives via reseed -> resolves and refreshes", () => {
    const unresolved: ManualSearchFollowState = {
      key: `${NB}|gen-1`, attempts: 5, maxAttempts: 5, phase: "unresolved",
      status: { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: MANUAL_SEARCH_UNRESOLVED_MESSAGE, startedAt: "gen-1" },
    };
    const r = reseedManualSearchFollow(unresolved, NB, SETTLED);
    expect(r.state.phase).toBe("resolved");
    expect(r.state.status).toEqual(SETTLED);
    expect(r.refreshSources).toBe(true);
  });

  it("(c) same generation, ACTIVELY following, but the reseed itself reports already settled -> resolves immediately and refreshes (a settle arriving outside the tick)", () => {
    const following = startManualSearchFollow(NB, RUNNING, 5);
    const r = reseedManualSearchFollow(following, NB, SETTLED);
    expect(r.state.phase).toBe("resolved");
    expect(r.refreshSources).toBe(true);
  });

  it("Codex F6 worked example — settled candidate, confirm, promoted readiness replaces the message, then a second (different) search in the SAME notebook is followed", () => {
    // 1. Hydration: a candidate search already settled with a 'preparing' style message.
    const candidateDone = reseedManualSearchFollow(null, NB, {
      manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found a candidate — not yet confirmed.", startedAt: "gen-1",
    });
    expect(candidateDone.state.phase).toBe("resolved");

    // 2. Confirm promotes it — SAME generation, new message, now ready.
    const promoted = reseedManualSearchFollow(candidateDone.state, NB, {
      manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Confirmed — ready to answer from.", startedAt: "gen-1",
    });
    expect(promoted.state.status.message).toBe("Confirmed — ready to answer from.");
    expect(promoted.refreshSources).toBe(true); // the old decline-style message is gone

    // 3. A second, different confirmed identity starts a NEW search in the same notebook.
    const secondSearch = reseedManualSearchFollow(promoted.state, NB, {
      manufacturer: "Rockwell", model: "1756-L71", running: true, startedAt: "gen-2",
    });
    expect(secondSearch.state.phase).toBe("following"); // F6: this used to stay stuck on gen-1's resolved state
    expect(secondSearch.state.key).toContain("gen-2");
  });
});

describe("reseedManualSearchFollow — a generation-less read never clobbers a known generation (Codex round 4 F14)", () => {
  // A live SSE `manual_search_status` frame never carries `startedAt` (the
  // Hub's chat/route.ts frame builder omits it). An unrelated rerender can
  // re-feed that SAME historical, generation-less frame long after the real
  // search has settled or exhausted its budget — this must be a pure no-op,
  // not a reset.
  it("a generation-less RUNNING replay against an already-RESOLVED known generation is a no-op (reference-equal, no refresh)", () => {
    const resolved = reseedManualSearchFollow(null, NB, SETTLED).state; // key contains "gen-1"
    expect(resolved.phase).toBe("resolved");
    const staleReplay: ManualSearchStatus = { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true };
    const r = reseedManualSearchFollow(resolved, NB, staleReplay);
    expect(r.state).toBe(resolved); // reference equality: a true no-op
    expect(r.refreshSources).toBe(false);
  });

  it("a generation-less RUNNING replay against an already-UNRESOLVED (budget-exhausted) known generation is a no-op — never replenishes", () => {
    const exhausted: ManualSearchFollowState = {
      key: `${NB}|gen-1`, attempts: 5, maxAttempts: 5, phase: "unresolved",
      status: { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: MANUAL_SEARCH_UNRESOLVED_MESSAGE, startedAt: "gen-1" },
    };
    const staleReplay: ManualSearchStatus = { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true };
    const r = reseedManualSearchFollow(exhausted, NB, staleReplay);
    expect(r.state).toBe(exhausted);
    expect(r.state.attempts).toBe(5); // not replenished
    expect(r.refreshSources).toBe(false);
  });

  it("a generation-less RUNNING replay against an ACTIVELY FOLLOWING known generation does not erase it either", () => {
    const following = startManualSearchFollow(NB, RUNNING, 5); // key contains "gen-1"
    const staleReplay: ManualSearchStatus = { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true };
    const r = reseedManualSearchFollow(following, NB, staleReplay);
    expect(r.state.key).toContain("gen-1"); // not reset to the empty-generation key
    expect(r.state.attempts).toBe(following.attempts);
  });

  it("control: a read that DOES carry its own startedAt still starts a genuinely new search, even right after a settled one", () => {
    const resolved = reseedManualSearchFollow(null, NB, SETTLED).state; // "gen-1", resolved
    const r = reseedManualSearchFollow(resolved, NB, RUNNING_GEN2); // real generation, "gen-2"
    expect(r.state.phase).toBe("following");
    expect(r.state.key).toContain("gen-2");
  });

  it("control: a generation-less read is still honored when NOTHING is tracked yet (the optimistic first-seed case)", () => {
    const noGen: ManualSearchStatus = { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true };
    const r = reseedManualSearchFollow(null, NB, noGen);
    expect(r.state.phase).toBe("following");
    expect(r.state.key).toBe(`${NB}|`);
  });
});
