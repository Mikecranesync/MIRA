# Independent Review Provider Conflict

**Status:** ✅ RESOLVED — Mike chose Option B (2026-09-17)  
**Decision:** Allow Claude for adversarial/independent review on Charlie  
**Implementation:** Landed in PR #3836 commit `[see final commit]`  
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

## Mike's Decision: Option B (2026-09-17)

**✅ CHOSEN: Allow Claude for adversarial review**

Mike chose Option B on 2026-09-17. `dispatch_reviewer()` now accepts `provider in ("claude", "codex")`.

**Rationale:**
- Unblocks live IR validation immediately with current Fleet standing order (Claude-only)
- Keeps Codex accepted for when it may return later
- Both providers now valid for adversarial review on Charlie

**Implementation:**
```python
# mission_loop.py dispatch_reviewer()
if provider not in ("claude", "codex"):
    return PolicyResult(
        allowed=False,
        reason=f"Reviewer must use claude or codex provider, got {provider!r}.",
    )
```

Default changed from `provider="codex"` to `provider="claude"` to match Fleet standing order.

### Option A: NOT CHOSEN
- Keep Codex-only requirement
- Would defer IR validation until Codex provisioned

### Option C: NOT CHOSEN
- Codex for reviewer, Claude for verifier only
- Would keep adversarial review blocked

## Implementation Landed

**Changes in this PR:**

1. **mission_loop.py `dispatch_reviewer()`:**
   - Default changed: `provider="claude"` (was `provider="codex"`)
   - Validation: `provider not in ("claude", "codex")` rejected (was `provider != "codex"`)
   - Docstring updated to reflect Mike's decision

2. **test_mission_loop.py:**
   - Old `test_reviewer_must_use_codex` replaced with `test_reviewer_accepts_claude_or_codex`
   - New `test_reviewer_rejects_unknown_provider` verifies invalid providers still rejected
   - Tests verify both claude and codex accepted, wrong providers rejected
   - Default provider assertion updated to `"claude"`

3. **Tests pass:** 88 mission_loop tests + 9 ir_verdict tests = 97 total green

## Current State (Post-Decision)

- **Reviewer** (`dispatch_reviewer`): accepts `provider in ("claude", "codex")` — ✅ Mike decision 2026-09-17
- **Verifier** (`dispatch_verifier`): accepts `provider in ("codex", "claude")` — unchanged, already flexible
- IR verdict contract (PR #3836) adds BLOCKED|ERROR terminal incomplete outcomes
- Tests cover both reviewer and verifier verdict paths
- Default is now `claude` to match Fleet standing order
- Codex remains accepted for when it returns

## Related

- PR #3836 — IR verdict contract (BLOCKED|ERROR terminal incomplete outcomes)
- `mira-bots/foreman/mission_loop.py` line 274-305 — `dispatch_reviewer()`
- `mira-bots/foreman/mission_loop.py` line 361-416 — `dispatch_verifier()` (already allows both)
- `mira-bots/foreman/specialists/adversarial-reviewer.md` — "Codex on Charlie" requirement
- docs/missions/AUTONOMOUS-FOREMAN-V1.md — AC C (exact SHA + Charlie/Codex)
