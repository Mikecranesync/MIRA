"""Parse-then-QA lane: parser IR chunks (held-constant FTS5 retrieval) + a
cheap text LLM composes the answer with page citations taken from the PARSER'S
anchors — not from the model's imagination.

This is the architecture the OmniDocBench trend favors (pipeline parse → text
QA) and the shape FactoryLM would actually ship: citations come from parser
provenance, the LLM only reads retrieved evidence.

Providers (OpenAI-compatible chat completions): Groq gpt-oss-120b primary,
Cerebras gpt-oss-120b fallback. Fails loud without keys.
"""

from __future__ import annotations

import json
import os
import time

import httpx

PROVIDERS = [
    # (name, base_url, env key, model)
    ("groq", "https://api.groq.com/openai/v1", "GROQ_API_KEY", "openai/gpt-oss-120b"),
    ("cerebras", "https://api.cerebras.ai/v1", "CEREBRAS_API_KEY", "gpt-oss-120b"),
]

PROMPT = """Answer the question using ONLY the numbered evidence excerpts.

Question: {q}

Evidence (each excerpt is labeled with its source page):
{evidence}

Rules:
- If the evidence does not answer the question, abstain.
- Reply with STRICT JSON only:
  {{"answer": "<concise answer, or empty when abstaining>",
    "pages": [<page number(s) of the excerpt(s) you used>],
    "abstain": <true|false>}}
"""


def ask(question: str, evidence: list[dict]) -> tuple[dict, str, dict, float]:
    """evidence: [{page, snippet}]. Returns (parsed, provider:model, usage, latency)."""
    ev_text = "\n\n".join(
        f"[{i+1}] (page {e['page']}) {e['snippet'][:1200]}" for i, e in enumerate(evidence)
    ) or "(no evidence retrieved)"
    body_msg = PROMPT.format(q=question, evidence=ev_text)
    last_err: Exception | None = None
    for name, base, env, model in PROVIDERS:
        key = os.environ.get(env, "")
        if not key:
            continue
        try:
            t0 = time.monotonic()
            r = httpx.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": model,
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "user", "content": body_msg}],
                },
                timeout=120,
            )
            latency = time.monotonic() - t0
            r.raise_for_status()
            data = r.json()
            text = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            try:
                parsed = json.loads(text)
            except (ValueError, TypeError):
                parsed = {"answer": text, "pages": [], "abstain": False, "_unparsed": True}
            return parsed, f"{name}:{model}", usage, latency
        except Exception as e:  # noqa: BLE001 — try next provider, record last error
            last_err = e
    raise RuntimeError(f"no text-QA provider available (last error: {last_err})")
