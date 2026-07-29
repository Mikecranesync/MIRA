#!/usr/bin/env python3
"""Provider health canary — probe every LLM cascade provider INDEPENDENTLY.

The cascade (Groq → Cerebras → Together) is resilient by design: if a provider
dies, the next one answers. That resilience is also a trap — it MASKS a dead
provider. Gemini's 403 and Cerebras's `llama3.1-8b` 404 both went unnoticed for
a while because Groq kept answering. This probe exists to catch that: it checks
each provider on its own and reports degraded coverage BEFORE an outage.

It imports `_build_providers()` from the runtime router so the probe always uses
the EXACT url/model/key the cascade uses — no duplicated defaults to drift out of
sync (drift is precisely what let Cerebras die silently).

Reasoning-model safety: Cerebras `gpt-oss-120b` can return empty `content` if it
spends its whole token budget reasoning. To avoid false "DOWN" pages, the probe
uses a generous `max_tokens`, a trivial prompt, and one retry before declaring a
provider down. A canary that cries wolf gets muted — that's worse than none.

ADR-0031 PR 5: providers that carry a vision model (today: Together) get an
INDEPENDENT vision probe — a deterministic known-token image fixture
(tools/canary_fixtures/vision_canary.png, printed text "MIRA CANARY 7") the
model must actually READ back. Together answering text says nothing about
PrintSense readiness; a provider is NOT fully up for PrintSense unless the
vision probe passes. Text and vision are reported as separate rows and
separate GITHUB_OUTPUT counters.

Exit codes (distinct, so a probe failure is never mislabelled as a provider death):
  0 = all expected providers UP (text AND, where applicable, vision)
  1 = >=1 expected probe DOWN  (coverage degraded — page a human)
  2 = probe could not run (no keys at all / import failure / unexpected error)

Never prints API key values. Run:
  doppler run --project factorylm --config prd -- \
    env PYTHONPATH=mira-bots python tools/provider_health_check.py
"""

from __future__ import annotations

import os
import sys
import time

import httpx

# Expected cascade members. If one is missing from _build_providers() (its key
# is unset) that's itself a DOWN — coverage is silently reduced.
EXPECTED = ("groq", "cerebras", "together")

PROBE_PROMPT = [{"role": "user", "content": "Reply with the single word: OK"}]
# Generous budget so a reasoning model (gpt-oss-120b) emits real content rather
# than burning the budget on reasoning and returning empty (false DOWN).
PROBE_MAX_TOKENS = 2048
PROBE_TIMEOUT = 30.0

# ── Vision probe (ADR-0031 PR 5) ────────────────────────────────────────────
# Known-token fixture: the model must READ the printed text back. Both tokens
# must appear (case-insensitive) — reading "CANARY" and the digit "7" proves
# character-level perception, not a generic "an image with text" reply.
VISION_FIXTURE = os.path.join(os.path.dirname(__file__), "canary_fixtures", "vision_canary.png")
VISION_TOKENS = ("canary", "7")
VISION_PROBE_PROMPT = (
    "Read the text printed in this image and reply with it verbatim, nothing else."
)
# Reasoning vision models (MiniMax-M3) can burn a small budget entirely on
# reasoning; 4096 is the measured-safe headroom (R5 program). The latency
# ceiling doubles the text probe's — vision is legitimately slower, but >60s
# means the production print path would be timing out too.
VISION_PROBE_MAX_TOKENS = 4096
VISION_PROBE_TIMEOUT = 60.0


def _gh_annotate(level: str, msg: str) -> None:
    """Emit a GitHub Actions annotation if running in CI (no-op locally)."""
    if os.getenv("GITHUB_ACTIONS") == "true":
        print(f"::{level}::{msg}")


def _probe_once(api_url: str, api_key: str, model: str) -> tuple[bool, int, str]:
    """One completion attempt. Returns (ok, latency_ms, reason). Never logs the key."""
    t0 = time.monotonic()
    try:
        resp = httpx.post(
            api_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model, "messages": PROBE_PROMPT, "max_tokens": PROBE_MAX_TOKENS},
            timeout=PROBE_TIMEOUT,
        )
        latency_ms = int((time.monotonic() - t0) * 1000)
    except Exception as e:  # network / DNS / timeout
        return False, int((time.monotonic() - t0) * 1000), f"request error: {type(e).__name__}"

    if resp.status_code != 200:
        # Body may carry the model/billing reason; it does NOT contain the key.
        return False, latency_ms, f"HTTP {resp.status_code}: {resp.text[:160]}"
    try:
        content = resp.json()["choices"][0]["message"].get("content")
    except Exception as e:
        return False, latency_ms, f"unparseable response: {type(e).__name__}"
    if not (content and content.strip()):
        return False, latency_ms, "HTTP 200 but empty content"
    return True, latency_ms, ""


def _probe(api_url: str, api_key: str, model: str) -> tuple[bool, int, str]:
    """Probe with one retry — a single blip should not page."""
    ok, latency_ms, reason = _probe_once(api_url, api_key, model)
    if ok:
        return ok, latency_ms, reason
    time.sleep(2)
    return _probe_once(api_url, api_key, model)


def _vision_probe_once(api_url: str, api_key: str, model: str) -> tuple[bool, int, str]:
    """One vision attempt on the CONFIGURED vision model. Never logs the key.

    Pass requires ALL of: HTTP 200, parseable body, non-empty visible content,
    every known token read back, and (when the body names a model) the response
    model matching the requested one — a silent server-side model swap is a
    failure, not a pass (FR-4 "model identity in the response path").
    """
    import base64  # noqa: PLC0415

    t0 = time.monotonic()
    try:
        with open(VISION_FIXTURE, "rb") as fh:
            b64 = base64.standard_b64encode(fh.read()).decode("ascii")
    except OSError as e:
        return False, 0, f"fixture unreadable: {type(e).__name__}"
    payload = {
        "model": model,
        "max_tokens": VISION_PROBE_MAX_TOKENS,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    {"type": "text", "text": VISION_PROBE_PROMPT},
                ],
            }
        ],
    }
    try:
        resp = httpx.post(
            api_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=VISION_PROBE_TIMEOUT,
        )
        latency_ms = int((time.monotonic() - t0) * 1000)
    except Exception as e:  # network / DNS / timeout
        return False, int((time.monotonic() - t0) * 1000), f"request error: {type(e).__name__}"

    if resp.status_code != 200:
        return False, latency_ms, f"HTTP {resp.status_code}: {resp.text[:160]}"
    try:
        body = resp.json()
        content = body["choices"][0]["message"].get("content")
    except Exception as e:
        return False, latency_ms, f"unparseable response: {type(e).__name__}"
    if not (content and content.strip()):
        return False, latency_ms, "HTTP 200 but empty visible content"
    lowered = content.lower()
    missing = [tok for tok in VISION_TOKENS if tok not in lowered]
    if missing:
        return False, latency_ms, f"known-token mismatch (missing {missing}): {content[:120]!r}"
    responded_model = str(body.get("model") or "")
    if responded_model and model not in responded_model and responded_model not in model:
        return (
            False,
            latency_ms,
            f"model identity mismatch: asked {model!r} got {responded_model!r}",
        )
    return True, latency_ms, ""


def _vision_probe(api_url: str, api_key: str, model: str) -> tuple[bool, int, str]:
    """Vision probe with one retry — a single blip should not page."""
    ok, latency_ms, reason = _vision_probe_once(api_url, api_key, model)
    if ok:
        return ok, latency_ms, reason
    time.sleep(2)
    return _vision_probe_once(api_url, api_key, model)


def main() -> int:
    try:
        from shared.inference.router import _build_providers
    except Exception as e:
        _gh_annotate("error", f"provider-health probe could not import router: {e}")
        print(f"PROBE ERROR: cannot import router ({e})", file=sys.stderr)
        return 2

    built = {p.name: p for p in _build_providers()}
    if not built:
        _gh_annotate("error", "provider-health probe: NO providers configured (no API keys set)")
        print("PROBE ERROR: no providers configured — check API keys / Doppler", file=sys.stderr)
        return 2

    down: list[str] = []
    up: list[str] = []
    print(f"Provider health — checking {len(EXPECTED)} expected providers\n")
    for name in EXPECTED:
        prov = built.get(name)
        if prov is None:
            down.append(name)
            print(f"  {name:9s} DOWN  — missing API key (not in cascade)")
            _gh_annotate("error", f"LLM provider DOWN: {name} (missing API key)")
            continue
        ok, latency_ms, reason = _probe(prov.api_url, prov.api_key, prov.model)
        if ok:
            up.append(name)
            print(f"  {name:9s} UP    ({prov.model}, {latency_ms}ms)")
        else:
            down.append(name)
            print(f"  {name:9s} DOWN  ({prov.model}) — {reason}")
            _gh_annotate("error", f"LLM provider DOWN: {name} ({prov.model}) — {reason}")

    # Vision probes — every expected provider that carries a vision model
    # (today: together). Text-up alone is NOT PrintSense-ready (ADR-0031 PR 5).
    vision_up: list[str] = []
    vision_down: list[str] = []
    vision_targets = [
        name for name in EXPECTED if built.get(name) is not None and built[name].vision_model
    ]
    if vision_targets:
        print(f"\nVision probes ({len(vision_targets)} provider(s) with a vision model)\n")
    for name in vision_targets:
        prov = built[name]
        ok, latency_ms, reason = _vision_probe(prov.api_url, prov.api_key, prov.vision_model)
        if ok:
            vision_up.append(name)
            print(f"  {name + '-vision':16s} UP    ({prov.vision_model}, {latency_ms}ms)")
        else:
            vision_down.append(name)
            print(f"  {name + '-vision':16s} DOWN  ({prov.vision_model}) — {reason}")
            _gh_annotate(
                "error",
                f"PrintSense vision DOWN: {name} ({prov.vision_model}) — {reason} "
                "(text may be up; the provider is NOT fully up for PrintSense)",
            )

    n_up, n_total = len(up), len(EXPECTED)
    summary = f"{n_up}/{n_total} providers UP"
    if vision_targets:
        summary += f"; vision {len(vision_up)}/{len(vision_targets)} UP"
    print(
        f"\n{summary}  (up: {', '.join(up) or 'none'} | down: {', '.join(down) or 'none'}"
        f" | vision down: {', '.join(vision_down) or 'none'})"
    )

    # Machine-readable outputs for the workflow's alert step.
    out = os.getenv("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"up_count={n_up}\n")
            f.write(f"down_count={len(down)}\n")
            f.write(f"down_providers={','.join(down)}\n")
            f.write(f"vision_up_count={len(vision_up)}\n")
            f.write(f"vision_down_count={len(vision_down)}\n")
            f.write(f"vision_down_providers={','.join(vision_down)}\n")
            f.write(f"summary={summary}\n")

    if down or vision_down:
        # Coverage degraded — exit 1 pages a human. Cascade may still be serving
        # (Groq up) but we are one failure from a worse spot; a vision-down
        # provider means PrintSense specifically is degraded even if chat works.
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
