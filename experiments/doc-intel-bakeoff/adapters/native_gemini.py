"""Provider-native lane: Gemini with NATIVE PDF input (the only configured
provider with a document API — Groq/Together/Cerebras are image-only).

Honesty rules honored here:
- No key → the lane FAILS LOUD (records error rows), never fabricates.
- Page citations are elicited in-prompt (Gemini returns no document anchors);
  they are scored as claims, which is exactly the metric the bake-off needs
  (page-citation precision of a native-doc provider).
- temperature=0; one designated question is asked twice to record repeatability.

Uses the REST API via httpx. Model is auto-negotiated from a candidate list so
the lane keeps working across Gemini model-line renames; the chosen model is
recorded in every row.
"""

from __future__ import annotations

import base64
import json
import os
import time

import httpx

API = "https://generativelanguage.googleapis.com/v1beta"

MODEL_CANDIDATES = [
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
]

# $/1M tokens (input, output) — for cost ESTIMATES in results; 0 on free tier.
PRICING = {
    "gemini-3.6-flash": (1.50, 7.50),
    "gemini-3.5-flash": (1.50, 9.00),
    "gemini-2.5-flash": (0.30, 2.50),
}

PROMPT = """You are answering a question about the ATTACHED technical manual ONLY.

Question: {q}

Rules:
- Use ONLY the attached document. If it does not contain the answer, abstain.
- Reply with STRICT JSON, nothing else:
  {{"answer": "<concise answer, or empty when abstaining>",
    "pages": [<1-based PDF page number(s) the answer comes from>],
    "abstain": <true|false>}}
"""


def _key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set — run under doppler (factorylm/dev)")
    return key


def pick_model(client: httpx.Client) -> str:
    listed = client.get(f"{API}/models", params={"key": _key(), "pageSize": 1000})
    listed.raise_for_status()
    names = {m["name"].split("/")[-1] for m in listed.json().get("models", [])}
    for cand in MODEL_CANDIDATES:
        if cand in names:
            return cand
    raise RuntimeError(f"no candidate model available; have e.g. {sorted(names)[:8]}")


def upload_pdf(client: httpx.Client, path: str) -> str:
    """Files API raw upload → file URI (needed for >20MB inline limit)."""
    with open(path, "rb") as f:
        data = f.read()
    r = client.post(
        f"https://generativelanguage.googleapis.com/upload/v1beta/files?key={_key()}",
        headers={
            "X-Goog-Upload-Protocol": "raw",
            "Content-Type": "application/pdf",
        },
        content=data,
        timeout=300,
    )
    r.raise_for_status()
    info = r.json()["file"]
    name, uri = info["name"], info["uri"]
    # poll until ACTIVE
    for _ in range(60):
        st = client.get(f"{API}/{name}", params={"key": _key()}).json()
        if st.get("state") == "ACTIVE":
            return uri
        time.sleep(2)
    raise RuntimeError(f"file {name} never became ACTIVE")


def ask(
    client: httpx.Client,
    model: str,
    question: str,
    *,
    file_uri: str | None = None,
    inline_pdf: bytes | None = None,
) -> tuple[dict, dict, float]:
    """Returns (parsed_json, usage, latency_s)."""
    doc_part = (
        {"file_data": {"mime_type": "application/pdf", "file_uri": file_uri}}
        if file_uri
        else {
            "inline_data": {
                "mime_type": "application/pdf",
                "data": base64.b64encode(inline_pdf or b"").decode(),
            }
        }
    )
    body = {
        "contents": [{"parts": [doc_part, {"text": PROMPT.format(q=question)}]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
        },
    }
    t0 = time.monotonic()
    r = client.post(
        f"{API}/models/{model}:generateContent",
        params={"key": _key()},
        json=body,
        timeout=180,
    )
    latency = time.monotonic() - t0
    r.raise_for_status()
    data = r.json()
    usage = data.get("usageMetadata", {})
    text = data["candidates"][0]["content"]["parts"][0].get("text", "{}")
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        parsed = {"answer": text, "pages": [], "abstain": False, "_unparsed": True}
    return parsed, usage, latency


def est_cost(model: str, usage: dict) -> float:
    inp, out = PRICING.get(model, (0.0, 0.0))
    return (
        usage.get("promptTokenCount", 0) * inp
        + usage.get("candidatesTokenCount", 0) * out
    ) / 1_000_000
