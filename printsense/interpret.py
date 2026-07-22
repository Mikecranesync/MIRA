"""PrintSense interpretation — paid multimodal model -> PrintSynth graph.

This is the "frontier multimodal interpretation -> strict typed JSON" stage of
the production pipeline. The paid vision model reads the print image(s)/PDF and
returns a ``PrintSynthGraph``; MIRA owns validation, evidence, persistence, and
approval.

⚠️ **ISOLATED, owner-authorized PAID print-vision seam (print-vision ONLY).**
Mike explicitly authorized a paid frontier-model exception for the print
interpreter (Anthropic 2026-07-12; provider swapped to **OpenAI** 2026-07-16
when Mike funded OpenAI credits instead). This module is the *only* place a
paid frontier vision provider is called. It is **NOT** wired into
``mira-bots/shared/inference`` — the Groq -> Cerebras -> Together free-tier
cascade stays No-Anthropic/No-OpenAI. Gated on ``PRINT_VISION_PROVIDER``
(``openai`` default | ``anthropic`` | ``together``) + that provider's key in
Doppler; inert without the key. Both paid SDKs (Apache-2.0 / MIT) are imported
lazily, so this module imports without them and tests mock the client.

ADR-0031 (PR 3): ``together`` (default model ``MiniMaxAI/MiniMax-M3``) is a
first-class typed provider — OpenAI-compatible chat/completions at the
CANONICAL Together host (from ``factorylm_ai.provider_registry``), httpx
direct (repo law), never the general chat router. Provider/model resolution is
CALL-TIME (the import-freeze defect is fixed); ``PRINT_PROVIDER_POLICY=
strict|allow_fallback`` governs whether an unavailable requested provider
stops the call (strict, default) or may fall through to another APPROVED
configured provider with every attempt recorded. Model authorization comes
from ``config/providers/approved.yml`` (fail-closed via the registry).
"""

from __future__ import annotations

import base64
import json
import logging
import os

from .models import PrintSynthGraph

logger = logging.getLogger("printsense.interpret")

# Import-time snapshot kept ONLY as the fallback for environments/tests that
# monkeypatch the module attribute; every runtime decision goes through
# _provider(), which reads the environment at CALL time (ADR-0031 — a changed
# provider is visible without a process restart).
PROVIDER = os.getenv("PRINT_VISION_PROVIDER", "openai")
_PROVIDER_KEYS = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "together": "TOGETHERAI_API_KEY",
}
# Owner doctrine (2026-07-12, reaffirmed 2026-07-16): default to the latest,
# most-capable mainline model for print perception. Configurable, never
# silently downgraded for cost. (gpt-5.5-pro exists as a slower/pricier tier —
# an explicit PRINT_VISION_MODEL choice, never a silent default.) together's
# default is the approved-policy operational model (ADR-0031).
_DEFAULT_MODELS = {
    "anthropic": "claude-opus-4-8",
    "openai": "gpt-5.5",
    "together": "MiniMaxAI/MiniMax-M3",
}


def _provider() -> str:
    """The ACTIVE provider — env first (call-time), module attr as fallback."""
    return (os.getenv("PRINT_VISION_PROVIDER") or "").strip().lower() or PROVIDER


def default_model(provider: str | None = None) -> str:
    """Call-time default model for ``provider`` (env override wins)."""
    prov = provider or _provider()
    return os.getenv("PRINT_VISION_MODEL") or _DEFAULT_MODELS.get(prov, "gpt-5.5")


# Import-time snapshot for backward compatibility (engine used to pass this
# explicitly). Prefer default_model() / interpret_print(model=None).
DEFAULT_MODEL = os.getenv("PRINT_VISION_MODEL") or _DEFAULT_MODELS.get(PROVIDER, "gpt-5.5")

# ADR-0031 §6.4 — strict (default): an unavailable requested provider STOPS
# the call; allow_fallback: other APPROVED configured providers may be tried,
# with every attempt recorded in the usage/attribution slot.
_POLICY_VALUES = {"strict", "allow_fallback"}


def _policy() -> str:
    raw = (os.getenv("PRINT_PROVIDER_POLICY") or "").strip().lower()
    return raw if raw in _POLICY_VALUES else "strict"


# ZTA-2 (spend law): 12k bounds a runaway reasoning chain at ~$0.36/call on
# gpt-5.5 ($30/M output) instead of ~$0.96 at 32k. medium-effort 8/8 runs fit
# comfortably; truncation is grader-visible, never silent.
MAX_TOKENS = int(os.getenv("PRINT_VISION_MAX_TOKENS") or "12000")
# xhigh is the best effort for reading-accuracy / self-verifying vision work on
# Opus 4.8 (roadmap Phase 0.4); high was leaving perception on the table.
EFFORT = os.getenv("PRINT_VISION_EFFORT", "xhigh")
# Structural confidence gate (roadmap Phase 0.5): any entity the model reads with
# confidence below this is demoted to UNREADABLE/unresolved. An honest "unreadable"
# beats a low-confidence guess -- the grader punishes confident misreads.
CONF_GATE = float(os.getenv("PRINT_VISION_CONF_GATE", "0.55"))

# ZTA-1 cost meter: reporting-only snapshot of the most recent interpreter
# call's token usage. The photo batch worker runs interpreter calls serially
# (concurrency=1), so a module-level slot is race-free in practice; treat it
# as best-effort telemetry for bench envelopes, never grading truth.
_LAST_USAGE: dict | None = None


def _record_usage(
    provider: str,
    model: str,
    usage,
    *,
    endpoint_class: str = "api",
    latency_ms: int | None = None,
    fallback_attempts: list[dict] | None = None,
) -> None:
    global _LAST_USAGE
    if usage is None:
        return
    _LAST_USAGE = {
        "provider": provider,
        "model": model,
        "input_tokens": getattr(usage, "input_tokens", None) or 0,
        "output_tokens": getattr(usage, "output_tokens", None) or 0,
        # FR-5 attribution (ADR-0031) — additive keys; token values may be 0
        # when the provider does not report them, but the keys are present.
        "endpoint_class": endpoint_class,
        "input_kind": "vision",
        "latency_ms": latency_ms,
        "fallback_attempts": list(fallback_attempts or []),
    }


def pop_last_usage() -> dict | None:
    """Return and clear the most recent interpreter call's token usage."""
    global _LAST_USAGE
    usage, _LAST_USAGE = _LAST_USAGE, None
    return usage


def record_sampled_usage(
    provider: str | None,
    model: str | None,
    input_tokens: int,
    output_tokens: int,
) -> None:
    """Record ALREADY-SUMMED token usage from a multi-sample print turn.

    The free-cascade self-consistency loop (``PRINT_THEORY_SELF_CONSISTENCY`` in
    ``mira-bots/shared/engine.py::_grounded_print_reply``) samples the
    theory(+verify) chain N times; each ``router.complete`` returns its own
    per-call usage. This writes the summed total into the same ``_LAST_USAGE``
    slot the paid path uses, so a bench envelope reads the cost of ALL samples
    via :func:`pop_last_usage` — not just the last call. Best-effort telemetry,
    never grading truth (see ``_LAST_USAGE``); the free cascade never touches the
    paid ``_record_usage`` object-shaped path, so this dict-shaped setter exists.
    """
    global _LAST_USAGE
    _LAST_USAGE = {
        "provider": provider,
        "model": model,
        "input_tokens": int(input_tokens),
        "output_tokens": int(output_tokens),
    }


_SYSTEM = (
    "You are a senior industrial-controls engineer and maintenance electrician "
    "interpreting an electrical print (schematic, wiring diagram, PLC I/O map, "
    "terminal plan, or panel layout).\n\n"
    "Interpret EVERY observable electrical object and relationship into a typed "
    "PrintSynth graph: devices, terminals, conductors, cables, contacts, power "
    "domains, PE bonds, off-page/continuation references, PLC I/O channels, and "
    "industrial-network links. Read the title block (drawing number, cabinet, "
    "sheet) — do NOT skip it. German / fiber-optic terms: Versorgung=supply, "
    "Heizung=heater, Montageplatte=mounting plate, Klixon=thermal switch, "
    "Klemme/Eingangsklemme/Ausgangsklemme=terminal/input/output terminal, "
    "belegt=occupied/assigned, LWL (Lichtwellenleiter)=fiber-optic cable, "
    "POF=plastic optical fiber, Opto-Koppler=opto-coupler, LAN=Ethernet.\n\n"
    "GROUNDING DOCTRINE (non-negotiable):\n"
    "- Ground every fact ONLY in what is visibly legible in the image. Use the "
    "printed designations verbatim.\n"
    "- NEVER invent a tag, terminal, rating, manufacturer model, cross-reference, "
    "contact logic, or connection. An unreadable/unclear item goes in "
    "`unresolved` with the specific issue and the crop/retake needed. "
    '"Unreadable" is a valid, superior result to a plausible guess.\n'
    "- Keep protective earth (PE) in `pe_bonds`, SEPARATE from current-carrying "
    "conductors — never mix PE into a line/neutral path.\n"
    "- Every entity carries `evidence` (what text/region supports it) and a "
    '`confidence` 0-1. Set `trust` to "proposed" on EVERYTHING (nothing is '
    "verified yet).\n"
    "- Distinguish visible fact from rule-derived inference; hedge inferences.\n\n"
    "READING DISCIPLINE (character-level):\n"
    "- Read each designation ONE CHARACTER AT A TIME. Never pattern-complete a "
    "partial, occluded, or blurry tag into a plausible whole — a fragment you "
    "cannot fully read goes in `unresolved`, not into a made-up complete tag.\n"
    "- Copy every digit exactly. A cross-reference like `15.7` is `15.7`, never "
    "`157` or `15.5`; a wire number `-W5497` is `-W5497`, never `-W5499`. Digit "
    "drift is the most damaging error you can make here.\n"
    "- If you are less than ~0.55 confident of a tag, set its `tag` to "
    '"UNREADABLE", put your best guess in `evidence`, and list it in '
    "`unresolved` with the crop/retake needed.\n\n"
    "TAG GRAMMAR — DIN/IEC 81346 (obey exactly; a violation means you misread):\n"
    "- Wire/cable number: `-W` followed by DIGITS ONLY (e.g. `-W5497`, `-W5469`). "
    "There is NO `-WK...` form — if you think you see `-WK902`, you misread a "
    "`-W####` wire number; re-read the digits.\n"
    "- Device tag: `-{sheet}/{Class}{n}` — a leading `-`, the sheet number, `/`, "
    "then an IEC class letter + number (e.g. `-21/A13`, `-3/F1`, `-5/A100`). "
    "`A`=assembly/module, `F`=fuse/protection, `G`=supply, `S`=switch/sensor, "
    "`X`=terminal, `U`=converter/coupler, `E`=heater/load, `W`=cable.\n"
    "- Cross-reference / sheet-target: `\\d+\\.\\d+` (e.g. `15.7`, `16.6`, "
    "`20.9`) — often paired with a terminal like `-X3.9`, `-X4.6`. Copy the exact "
    "digits.\n"
    "- Off-page / location prefix: `+{LOC}` copied VERBATIM (e.g. `+SCU2-BEL`, "
    "`+SCU1/21.2`, `+SD3/0/21.7`). Do not normalize or abbreviate it.\n"
    "- Terminal: `-X{n}` or `-X{n}.{n}` or `:{n}` (e.g. `-X3.9`, `-3/X0:2`).\n\n"
    "OUTPUT: return ONLY a single JSON object that conforms to the PrintSynth "
    "schema below. No prose, no explanation, no markdown code fences — JSON only."
)


class PrintVisionUnavailable(RuntimeError):
    """The paid print-vision provider is not configured/available.

    ``code`` (ADR-0031 FR-10), when set, is a stable machine-readable code from
    ``factorylm_ai.capability_codes`` — e.g. ``PROVIDER_KEY_MISSING``,
    ``NETWORK_DISABLED``, ``REQUIRED_PROVIDER_UNAVAILABLE``. Callers branch on
    the code, never the message. The engine's catch of this class (its labeled
    degraded fall-through) is unchanged.
    """

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


def is_configured() -> bool:
    """Single source of truth for "may the paid print-vision path run?".

    True when ``PRINT_VISION_PROVIDER`` names a supported provider AND that
    provider's API key is present. bot/engine gate on this — never re-derive
    the provider/key pairing at a call site. Call-time (ADR-0031).
    """
    key_var = _PROVIDER_KEYS.get(_provider())
    return bool(key_var and os.getenv(key_var))


def _client(provider: str | None = None):
    """Build the isolated paid-vision client, or raise PrintVisionUnavailable."""
    prov = provider or _provider()
    key_var = _PROVIDER_KEYS.get(prov)
    if key_var is None:
        raise PrintVisionUnavailable(
            f"PRINT_VISION_PROVIDER={prov!r} is not a supported print-vision "
            "provider ('openai', 'anthropic', or 'together')",
            code="REQUIRED_PROVIDER_UNAVAILABLE",
        )
    if not os.getenv(key_var):
        raise PrintVisionUnavailable(
            f"{key_var} is not set (add it to Doppler)", code="PROVIDER_KEY_MISSING"
        )
    if prov == "together":
        # No SDK: httpx direct against the canonical host (_together_generate).
        return "together-httpx"
    if prov == "openai":
        try:
            import openai  # noqa: PLC0415 — lazy Apache-2.0 SDK, isolated to this path
        except ImportError as exc:  # pragma: no cover
            raise PrintVisionUnavailable("the `openai` SDK is not installed") from exc
        # Long-poll headroom: a full package graph can take minutes to generate.
        return openai.OpenAI(timeout=900.0, max_retries=2)
    try:
        import anthropic  # noqa: PLC0415 — lazy MIT SDK, isolated to this path
    except ImportError as exc:  # pragma: no cover
        raise PrintVisionUnavailable("the `anthropic` SDK is not installed") from exc
    return anthropic.Anthropic()


def _source_block(data: bytes, media_type: str) -> dict:
    b64 = base64.standard_b64encode(data).decode("ascii")
    src = {"type": "base64", "media_type": media_type, "data": b64}
    block_type = "document" if media_type == "application/pdf" else "image"
    return {"type": block_type, "source": src}


def _user_prompt(package_context: dict | None, question: str | None) -> str:
    schema = json.dumps(PrintSynthGraph.model_json_schema(), separators=(",", ":"))
    parts = [
        "Interpret this electrical print into a PrintSynth graph.",
        f"Package context (may be empty): {json.dumps(package_context or {})}",
        "Emit ONLY a single JSON object conforming to this JSON Schema:",
        schema,
    ]
    if question and question.strip():
        parts.append(
            f"The technician specifically asked: {question.strip()} — make sure the "
            "graph directly supports answering it, grounded only in the print."
        )
    return "\n\n".join(parts)


def _first_text(message) -> str:
    for block in message.content:
        if getattr(block, "type", None) == "text":
            return block.text
    raise ValueError("no text block in the Anthropic response")


def _openai_effort(effort: str) -> str:
    """Map the configured effort onto OpenAI's reasoning-effort scale."""
    if effort in {"minimal", "low", "medium", "high"}:
        return effort
    return {"none": "minimal"}.get(effort, "high")  # xhigh/max/unknown -> high


def _openai_blocks(pages: list[tuple[bytes, str]]) -> list[dict]:
    blocks: list[dict] = []
    for data, media_type in pages:
        b64 = base64.standard_b64encode(data).decode("ascii")
        if media_type == "application/pdf":
            blocks.append(
                {
                    "type": "input_file",
                    "filename": "print.pdf",
                    "file_data": f"data:application/pdf;base64,{b64}",
                }
            )
        else:
            # detail=high: character-level tag reading is the whole job here.
            blocks.append(
                {
                    "type": "input_image",
                    "detail": "high",
                    "image_url": f"data:{media_type};base64,{b64}",
                }
            )
    return blocks


def _openai_generate(client, model: str, pages: list[tuple[bytes, str]], prompt: str) -> str:
    """One Responses-API call -> raw text. Reasoning only on models that take it."""
    content = _openai_blocks(pages) + [{"type": "input_text", "text": prompt}]
    kwargs: dict = {
        "model": model,
        "max_output_tokens": MAX_TOKENS,
        "instructions": _SYSTEM,
        "input": [{"role": "user", "content": content}],
    }
    if model.startswith(("gpt-5", "o3", "o4")):
        kwargs["reasoning"] = {"effort": _openai_effort(EFFORT)}
    response = client.responses.create(**kwargs)
    text = getattr(response, "output_text", "") or ""
    if not text:
        raise ValueError("no output text in the OpenAI response")
    usage = getattr(response, "usage", None)
    if usage is not None:
        _record_usage("openai", model, usage)
        logger.info(
            "PRINT_OPENAI_USAGE input=%s output=%s",
            getattr(usage, "input_tokens", None),
            getattr(usage, "output_tokens", None),
        )
    return text


class _TogetherPage:
    pass  # marker only — see _together_generate (no SDK client object needed)


def _first_json_object(raw: str) -> str:
    """Defensively extract the first balanced JSON object from model output.

    MiniMax and other reasoning models sometimes wrap the JSON in prose or
    fences despite instructions. Fence-stripping runs first; if the remainder
    still isn't a bare object, scan for the first balanced ``{...}`` (string-
    aware). Raises ValueError when no object exists at all.
    """
    s = _strip_fences(raw)
    if s.startswith("{"):
        return s
    start = s.find("{")
    if start < 0:
        raise ValueError("no JSON object in model output")
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return s[start : i + 1]
    raise ValueError("unbalanced JSON object in model output")


def _together_http_post(url: str, headers: dict, payload: dict, timeout: float) -> "object":
    """One httpx POST — module-level so tests monkeypatch it (no network in CI)."""
    import httpx  # noqa: PLC0415 — repo-standard HTTP client, lazy like the SDKs

    return httpx.post(url, headers=headers, json=payload, timeout=timeout)


def _together_generate(model: str, pages: list[tuple[bytes, str]], prompt: str) -> str:
    """One OpenAI-compatible chat/completions call to the CANONICAL Together host.

    Never the general chat router (ADR-0031 §6.3): the typed interpreter
    addresses Together directly through the shared provider registry. Raises
    typed errors (factorylm_ai.capability_codes.CapabilityError) for every
    failure class; availability-class failures are raised by the caller as
    PrintVisionUnavailable before this function runs.
    """
    from factorylm_ai.capability_codes import (  # noqa: PLC0415 — lazy, ships with bots (PR 2)
        EMPTY_MODEL_RESPONSE,
        MODEL_NOT_AVAILABLE,
        MODEL_NOT_SERVERLESS,
        PROVIDER_TIMEOUT,
        CapabilityError,
    )
    from factorylm_ai.provider_registry import resolve  # noqa: PLC0415

    provider = resolve("together")
    content: list[dict] = []
    for data, media_type in pages:
        if media_type == "application/pdf":
            raise CapabilityError(
                MODEL_NOT_AVAILABLE,
                "the together vision path takes raster page images; render PDF "
                "pages to images first (the bot pipeline already does)",
            )
        b64 = base64.standard_b64encode(data).decode("ascii")
        content.append(
            {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64}"}}
        )
    content.append({"type": "text", "text": prompt})
    payload: dict = {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": content},
        ],
    }
    # Strict JSON mode is opt-in (PRINT_VISION_JSON_MODE=1): not every Together
    # model accepts response_format, and a 400 there would cost the call. The
    # schema-reinforced prompt + defensive extraction is the always-on floor.
    if (os.getenv("PRINT_VISION_JSON_MODE") or "").strip() in {"1", "true", "on"}:
        payload["response_format"] = {"type": "json_object"}

    import time  # noqa: PLC0415

    started = time.monotonic()
    try:
        response = _together_http_post(
            f"{provider.spec.canonical_url}/chat/completions",
            {"Authorization": f"Bearer {provider.api_key}"},
            payload,
            provider.timeout,
        )
    except Exception as exc:  # httpx.TimeoutException et al — typed, never raw
        if type(exc).__name__.endswith(("TimeoutException", "ConnectTimeout", "ReadTimeout")):
            raise CapabilityError(
                PROVIDER_TIMEOUT, f"together timed out after {provider.timeout}s"
            ) from exc
        raise
    latency_ms = int((time.monotonic() - started) * 1000)

    status = getattr(response, "status_code", 0)
    if status == 400:
        body_text = getattr(response, "text", "") or ""
        if "serverless" in body_text.lower():
            raise CapabilityError(
                MODEL_NOT_SERVERLESS, f"model {model!r} is not serverless on this account"
            )
        raise CapabilityError(
            MODEL_NOT_AVAILABLE, f"together rejected model {model!r}: {body_text[:200]}"
        )
    if status != 200:
        raise CapabilityError(
            MODEL_NOT_AVAILABLE,
            f"together HTTP {status}: {(getattr(response, 'text', '') or '')[:200]}",
        )

    body = response.json()
    choices = body.get("choices") or []
    message = (choices[0] or {}).get("message") or {} if choices else {}
    raw = (message.get("content") or "").strip()
    # Reasoning models may put everything in reasoning_content and leave
    # content empty — that is an EMPTY visible response, not output.
    if not raw:
        raise CapabilityError(EMPTY_MODEL_RESPONSE, "together returned no visible content")

    usage = body.get("usage") or {}

    class _U:  # object-shaped for _record_usage
        input_tokens = usage.get("prompt_tokens") or 0
        output_tokens = usage.get("completion_tokens") or 0

    _record_usage("together", model, _U(), endpoint_class="serverless", latency_ms=latency_ms)
    logger.info(
        "PRINT_TOGETHER_USAGE model=%s input=%s output=%s latency_ms=%d",
        model,
        _U.input_tokens,
        _U.output_tokens,
        latency_ms,
    )
    return raw


def _strip_fences(raw: str) -> str:
    s = raw.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s.rsplit("```", 1)[0]
    return s.strip()


def _apply_confidence_gate(graph: PrintSynthGraph, threshold: float = CONF_GATE) -> PrintSynthGraph:
    """Demote every entity read below ``threshold`` to UNREADABLE/unresolved.

    A low-confidence read is worse than an honest "unreadable": the deterministic
    grader punishes confident misreads and rewards unresolved recall. The original
    guess is preserved in ``evidence`` (never silently dropped) so a later verify
    pass or a technician can recover it. Only fires when the model actually
    reported a ``confidence`` — a ``None`` is left alone. Roadmap Phase 0.5.
    """
    from .models import TrustState

    for e in graph.all_entities():
        if e.confidence is not None and e.confidence < threshold and e.tag != "UNREADABLE":
            guess = e.tag
            e.evidence = f"low-confidence guess: {guess}" + (
                f" — {e.evidence}" if e.evidence else ""
            )
            e.tag = "UNREADABLE"
            e.trust = TrustState.unresolved
    return graph


def _check_model_approved(provider: str, model: str, policy: str) -> bool:
    """Authorization check against config/providers/approved.yml (FR-9).

    Returns True when approved. Under ``strict`` an unapproved model raises
    PROVIDER_NOT_APPROVED; under ``allow_fallback`` it logs loudly and returns
    False (the attribution slot marks the run not-gold-eligible). When the
    registry package is absent (a dev context predating PR 2's image COPY),
    legacy providers proceed unenforced — but ``together`` REQUIRES the
    registry (it is a hardening-era path with no legacy carve-out).
    """
    try:
        from factorylm_ai.capability_codes import (  # noqa: PLC0415 — lazy
            PROVIDER_NOT_APPROVED,
            CapabilityError,
        )
        from factorylm_ai.provider_registry import model_approved  # noqa: PLC0415
    except ImportError:
        if provider == "together":
            raise PrintVisionUnavailable(
                "the together print-vision path requires factorylm_ai (provider "
                "registry) — image/deployment predates ADR-0031 PR 2",
                code="REQUIRED_PROVIDER_UNAVAILABLE",
            ) from None
        logger.warning("PRINT_POLICY_UNENFORCED provider=%s (no provider registry)", provider)
        return True
    try:
        approved = model_approved("printsense_interpreter", provider, model)
    except CapabilityError:
        # Fail closed on a missing/malformed policy file — but only where the
        # policy can exist (repo/image ships config/providers/ since PR 2).
        if provider == "together":
            raise
        logger.warning("PRINT_POLICY_MISSING provider=%s (approved.yml unreadable)", provider)
        return True
    if approved:
        return True
    # Enforcement scope (Phase A, ADR-0031): the together path is hardening-era
    # and ALWAYS enforced; legacy openai/anthropic callers (benches with
    # explicit model knobs) keep working with a loud log until the staging
    # activation PR flips PRINT_ENFORCE_APPROVED_MODELS=1.
    enforce = provider == "together" or (
        (os.getenv("PRINT_ENFORCE_APPROVED_MODELS") or "").strip() in {"1", "true", "on"}
    )
    if enforce and policy == "strict":
        raise CapabilityError(
            PROVIDER_NOT_APPROVED,
            f"model {model!r} on {provider!r} is not in config/providers/"
            "approved.yml for printsense_interpreter (strict policy)",
        )
    logger.warning(
        "PRINT_MODEL_UNAPPROVED provider=%s model=%s enforce=%s — run is NOT gold-eligible",
        provider,
        model,
        enforce,
    )
    return False


def _generate_with_provider(
    provider: str, model: str, pages: list[tuple[bytes, str]], prompt: str, client=None
) -> str:
    """Dispatch one generation call on an EXPLICIT provider branch.

    An unknown provider is a hard error here — the pre-ADR-0031 code routed
    every non-openai value into the Anthropic branch, which is exactly the
    silent-misrouting defect this function removes.
    """
    if provider == "together":
        return _together_generate(model, pages, prompt)
    if provider == "openai":
        return _openai_generate(client, model, pages, prompt)
    if provider == "anthropic":
        content: list[dict] = [_source_block(data, mt) for data, mt in pages]
        content.append({"type": "text", "text": prompt})
        # Adaptive thinking + xhigh effort for the hard perception task; stream
        # because a full package graph can exceed the non-streaming max_tokens
        # timeout guard.
        with client.messages.stream(
            model=model,
            max_tokens=MAX_TOKENS,
            system=_SYSTEM,
            thinking={"type": "adaptive"},
            output_config={"effort": EFFORT},
            messages=[{"role": "user", "content": content}],
        ) as stream:
            message = stream.get_final_message()
        _record_usage("anthropic", model, getattr(message, "usage", None))
        return _first_text(message)
    raise PrintVisionUnavailable(
        f"PRINT_VISION_PROVIDER={provider!r} is not a supported print-vision "
        "provider ('openai', 'anthropic', or 'together')",
        code="REQUIRED_PROVIDER_UNAVAILABLE",
    )


def _fallback_candidates(requested: str) -> list[str]:
    """Approved+configured alternates for allow_fallback, requested first."""
    order = [requested] + [p for p in ("together", "openai", "anthropic") if p != requested]
    out = []
    for prov in order:
        key_var = _PROVIDER_KEYS.get(prov)
        if prov == requested or (key_var and os.getenv(key_var)):
            out.append(prov)
    return out


def _network_gate_check(provider: str) -> None:
    """NETWORK_DISABLED for the together path when the canonical gate is closed.

    Scoped to together (the ADR-0031 path): gating the legacy openai/anthropic
    paths would break dev flows that never set a network mode — they join the
    gate at the Phase-E cleanup.
    """
    if provider != "together":
        return
    try:
        from factorylm_ai.network_gate import network_enabled  # noqa: PLC0415
    except ImportError:
        return  # registry absence is handled by _check_model_approved
    if not network_enabled():
        raise PrintVisionUnavailable(
            "provider network is disabled (set FACTORYLM_NETWORK_MODE=enabled, "
            "or legacy INFERENCE_BACKEND=cloud)",
            code="NETWORK_DISABLED",
        )


def interpret_print(
    pages: list[tuple[bytes, str]],
    *,
    package_context: dict | None = None,
    question: str | None = None,
    model: str | None = None,
    preprocess: bool = True,
) -> PrintSynthGraph:
    """Interpret one print (one or more page images/PDFs) into a validated graph.

    ``pages`` is a list of ``(bytes, media_type)`` — e.g.
    ``[(jpg_bytes, "image/jpeg")]`` or ``[(pdf_bytes, "application/pdf")]``.
    When ``preprocess`` is true (default) each image page is auto-uprighted and
    resized to the vision budget by :mod:`printsense.preprocess` before it is
    sent; it is defensive, so bad bytes pass through. Every entity comes back
    ``trust="proposed"`` (or ``unresolved`` if the confidence gate demoted it).

    Provider/model resolve at CALL time (ADR-0031). ``model=None`` (preferred)
    means the active provider's default. Under ``PRINT_PROVIDER_POLICY=strict``
    (default) an unavailable requested provider raises
    :class:`PrintVisionUnavailable` (``code=REQUIRED_PROVIDER_UNAVAILABLE`` /
    ``PROVIDER_KEY_MISSING`` / ``NETWORK_DISABLED``) and NOTHING else is tried;
    under ``allow_fallback`` other approved configured providers are attempted
    in order and every attempt lands in the attribution slot
    (:func:`pop_last_usage` → ``fallback_attempts``). Execution failures (bad
    JSON, schema, empty output) are typed ``CapabilityError``s and NEVER fall
    back — a provider that answered garbage is not "unavailable".
    """
    from factorylm_ai.capability_codes import (  # noqa: PLC0415 — lazy; see _check_model_approved
        INVALID_MODEL_JSON,
        PRINTSYNTH_VALIDATION_FAILED,
        CapabilityError,
    )

    requested = _provider()
    policy = _policy()
    candidates = [requested] if policy == "strict" else _fallback_candidates(requested)

    if preprocess:
        from . import preprocess as _pp  # noqa: PLC0415 -- lazy: Pillow/Tesseract optional

        pages = [_pp.prepare_print_image(data, mt) for data, mt in pages]
    prompt = _user_prompt(package_context, question)

    attempts: list[dict] = []
    raw: str | None = None
    active_provider = requested
    active_model = model or default_model(requested)
    for candidate in candidates:
        candidate_model = model or default_model(candidate)
        try:
            _network_gate_check(candidate)
            client = _client(candidate)  # availability gate (key/support) — typed raise
            _check_model_approved(candidate, candidate_model, policy)
            raw = _generate_with_provider(candidate, candidate_model, pages, prompt, client)
            active_provider, active_model = candidate, candidate_model
            break
        except PrintVisionUnavailable as exc:
            attempts.append(
                {
                    "provider": candidate,
                    "model": candidate_model,
                    "error": exc.code or "unavailable",
                }
            )
            if policy == "strict" or candidate == candidates[-1]:
                if candidate == requested and len(candidates) == 1:
                    raise
                raise PrintVisionUnavailable(
                    f"no approved provider available (attempts: {attempts})",
                    code="REQUIRED_PROVIDER_UNAVAILABLE",
                ) from exc
            logger.warning(
                "PRINT_PROVIDER_FALLBACK from=%s error=%s (allow_fallback)",
                candidate,
                exc.code,
            )
    assert raw is not None  # loop either broke with raw set or raised

    if attempts and _LAST_USAGE is not None:
        _LAST_USAGE["fallback_attempts"] = attempts

    try:
        data = json.loads(_first_json_object(raw))
    except (ValueError, json.JSONDecodeError) as exc:
        raise CapabilityError(INVALID_MODEL_JSON, f"model output was not JSON: {exc}") from exc
    logger.info(
        "PRINT_INTERPRETED provider=%s model=%s devices=%d fallback_attempts=%d",
        active_provider,
        active_model,
        len(data.get("devices") or []),
        len(attempts),
    )
    try:
        graph = PrintSynthGraph.model_validate(data)
    except Exception as exc:
        raise CapabilityError(
            PRINTSYNTH_VALIDATION_FAILED, f"model JSON failed PrintSynth validation: {exc}"
        ) from exc
    return _apply_confidence_gate(graph)
