# Independent Review Provider Conflict

**Status:** Open decision required from Mike  
**Date:** 2026-09-17  
**Context:** IR verdict contract (PR #3836)

## The Conflict

`mission_loop.py` `dispatch_reviewer()` enforces `provider="codex"` on `node="charlie"` for adversarial review:

```python
def dispatch_reviewer(
    self,
    git_ref: str,
    session_id: str,
    node: str = "charlie",
    provider: str = "codex",
) -> PolicyResult:
    """Register a reviewer worker on Charlie/Codex against an exact SHA (AC C)."""
    # ...
    if provider != "codex":
        return PolicyResult(
            allowed=False,
            reason=f"Reviewer must use codex provider, got {provider!r}.",
        )
```

**BUT:** Fleet standing order (as of 2026-09-17) is Claude-only. Codex is not available on Charlie for IR validation.

## The Decision Required

Mike must choose one:

### Option A: Keep Codex requirement (mission_loop.py unchanged)
- **Pro:** Already encoded in AC C of the mission policy
- **Pro:** Codex was the original choice for adversarial review
- **Con:** Cannot run live IR validation until Codex is available on Charlie
- **Action:** Defer IR validation until Codex is provisioned

### Option B: Allow Claude for adversarial review
- **Pro:** Unblocks live IR validation immediately
- **Pro:** Claude is the current Fleet standard
- **Con:** Requires changing mission_loop.py `dispatch_reviewer` to accept `provider in ("codex", "claude")`
- **Con:** Weakens the original AC C requirement (Codex-only)
- **Action:** Update `dispatch_reviewer()` line 290-293 to allow both providers

### Option C: Codex for adversarial review, Claude for verifier (already implemented)
- `dispatch_reviewer()` stays Codex-only (line 290-293)
- `dispatch_verifier()` already allows `provider in ("codex", "claude")` (line 393-396)
- **Pro:** Preserves adversarial review's Codex requirement
- **Pro:** Allows verification step to run with Claude
- **Con:** IR validation still blocked until Codex is available

## Current State

- **Verifier** (`dispatch_verifier`) already accepts `provider in ("codex", "claude")`
- **Reviewer** (`dispatch_reviewer`) enforces `provider == "codex"` only
- IR verdict contract (PR #3836) adds BLOCKED|ERROR terminal incomplete outcomes
- Tests cover both reviewer and verifier verdict paths

## Recommendation

Choose **Option B** (allow Claude for adversarial review) IF:
- Live IR validation is required before Codex is provisioned on Charlie
- Fleet standing order remains Claude-only

Choose **Option A** (keep Codex-only) IF:
- Codex will be provisioned soon
- The adversarial-review distinction is important enough to wait

Choose **Option C** IF:
- Verification (not adversarial review) is sufficient for IR validation
- The distinction between "is it correct?" (reviewer/Codex) and "did it run?" (verifier/Claude) is preserved

## Implementation (if Option B chosen)

```python
# mission_loop.py line 290-293
if provider not in ("codex", "claude"):
    return PolicyResult(
        allowed=False,
        reason=f"Reviewer must use codex or claude provider, got {provider!r}.",
    )
```

Add test:
```python
def test_reviewer_accepts_claude_provider(self):
    policy = _fresh_policy()
    result = policy.dispatch_reviewer(git_ref=HEAD_SHA, session_id="rev-claude", provider="claude")
    assert result.allowed is True
```

## Related

- PR #3836 — IR verdict contract (BLOCKED|ERROR terminal incomplete outcomes)
- `mira-bots/foreman/mission_loop.py` line 274-305 — `dispatch_reviewer()`
- `mira-bots/foreman/mission_loop.py` line 361-416 — `dispatch_verifier()` (already allows both)
- `mira-bots/foreman/specialists/adversarial-reviewer.md` — "Codex on Charlie" requirement
- docs/missions/AUTONOMOUS-FOREMAN-V1.md — AC C (exact SHA + Charlie/Codex)
