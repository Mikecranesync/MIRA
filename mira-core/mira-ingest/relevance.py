"""Magic-inbox relevance gate (Unit 3.5).

Groq llama-3.1-8b-instant classifier that decides whether the first 1-2
pages of a PDF look like an industrial equipment manual / datasheet /
service bulletin / wiring diagram. Anything else (meeting agendas,
purchase orders, marketing PDFs) gets rejected with a brief reason so
the inbox receipt email can explain why and offer the [force] override.

Cost: ~$0.00005 per file at current Groq pricing.
Latency: ~600ms typical; capped at 5s.

Fail-open: any error (no API key, network blip, parse failure, timeout)
returns (True, "skipped-error"). The KB pollution risk from a single
through-leak is far smaller than the trust-loss from rejecting a real
manual because the classifier hiccupped.
"""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger("mira-ingest.relevance")

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.1-8b-instant"
MAX_INPUT_CHARS = 4000  # ~1000 tokens; one page of dense text


_PROMPT = (
    "You decide whether a document is an industrial equipment reference. "
    "Reply with exactly one of:\n"
    "  YES <one-word category: manual|datasheet|bulletin|wiring|spec>\n"
    "  NO <short reason, max 10 words>\n"
    "\n"
    "Accept: equipment manuals, OEM datasheets, service bulletins, wiring "
    "diagrams, parts catalogs, instruction sheets, technical specifications.\n"
    "Reject: meeting notes, agendas, invoices, purchase orders, contracts, "
    "marketing, newsletters, resumes, generic letters.\n"
    "\n"
    "Document text:\n"
    "---\n"
    "{text}\n"
    "---\n"
    "Reply now (YES <category> or NO <reason>):"
)


async def classify_document(
    first_page_text: str, *, timeout_s: float = 5.0
) -> tuple[bool, str]:
    """Returns (is_manual, reason).

    On YES: returns (True, "<category>") e.g. (True, "manual").
    On NO: returns (False, "<reason>") e.g. (False, "looks like a meeting agenda").
    On any error: returns (True, "skipped-error") — fail-open.
    """
    if not first_page_text or not first_page_text.strip():
        return (True, "empty-text")

    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        logger.warning("GROQ_API_KEY not set; relevance gate failing open")
        return (True, "skipped-error")

    truncated = first_page_text[:MAX_INPUT_CHARS]
    prompt = _PROMPT.format(text=truncated)

    payload = {
        "model": GROQ_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 64,
        "temperature": 0,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(GROQ_URL, json=payload, headers=headers)
            resp.raise_for_status()
            body = resp.json()
    except Exception as exc:
        logger.warning("groq classifier error (fail-open): %s", exc)
        return (True, "skipped-error")

    try:
        content = body["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        logger.warning("groq response shape unexpected (fail-open): %s", exc)
        return (True, "skipped-error")

    return _parse_verdict(content)


def _parse_verdict(content: str) -> tuple[bool, str]:
    """Extract YES/NO + reason from the model's first line. Fail-open on parse miss."""
    first_line = content.splitlines()[0].strip() if content else ""
    if not first_line:
        return (True, "skipped-error")
    upper = first_line.upper()
    if upper.startswith("YES"):
        rest = first_line[3:].strip(" :-")
        return (True, rest or "manual")
    if upper.startswith("NO"):
        rest = first_line[2:].strip(" :-")
        return (False, rest or "not a manual")
    # Model didn't follow the format — fail open with a flag.
    logger.info("groq verdict unparseable: %r (fail-open)", first_line[:80])
    return (True, "skipped-error")
