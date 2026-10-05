"""Model-judged manual candidates — read the PDF before choosing it.

Why this exists (2026-08-26, Harrington UMS3-0335 end truck):
``search.py``'s ``_score`` ranks by URL/title heuristics — ``.pdf`` +30, the
word "manual" in the title +10, the model token in the filename +25. The
correct *Series 3 End Trucks Owner's Manual* has neither the model number in
its filename nor a readable title (PDF-metadata glyph garbage), so it scored
30 — the same as any random Harrington PDF — and a distributor's "Manual
Hoists" brochure (title literally contains "manual") won with 40. A browsing
reasoning agent opened the PDF, found ``UMS-3`` in the table on page 10, and
also noticed it was the end-truck manual, not the hoist's.

This module does that step: for the top-N candidates it fetches the PDF
(through the same SSRF guard as ``validate_pdf``), extracts the first pages'
text, and asks the canonical text cascade (``shared.inference.router``) one
narrow question — *is this document the manual for ``{make} {model}``?* — with
a verbatim evidence quote. The verdict re-ranks the candidates; nothing here
downloads into a notebook, and a candidate the judge rejects is returned as
``validated=False`` so the caller holds it for human review (DOC-003).

Bounded by construction: N candidates, a byte cap per fetch, a page/char cap
on extraction, one model call per candidate, and every step degrades to
"unjudged" (never raises) so a slow host or a dead provider leaves the legacy
heuristic path intact.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import re
import time
from typing import Any

import httpx

from . import search as _search

logger = logging.getLogger("mira.manual_search.judge")


def judge_enabled() -> bool:
    """Env-gated (default ON). ``MANUAL_JUDGE_ENABLED=0`` restores pure heuristics."""
    return os.getenv("MANUAL_JUDGE_ENABLED", "1").strip() not in ("0", "false", "no", "")


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name) or default)
    except ValueError:
        return default


MAX_CANDIDATES = _int_env("MANUAL_JUDGE_MAX_CANDIDATES", 4)  # per batch
MAX_TOTAL = _int_env("MANUAL_JUDGE_MAX_TOTAL", 8)  # across batches, until a match
MAX_BYTES = _int_env("MANUAL_JUDGE_MAX_BYTES", 25 * 1024 * 1024)  # real OEM manuals are big
MAX_PAGES = _int_env("MANUAL_JUDGE_MAX_PAGES", 8)
MAX_CHARS = _int_env("MANUAL_JUDGE_MAX_CHARS", 7000)
FETCH_TIMEOUT = float(os.getenv("MANUAL_JUDGE_FETCH_TIMEOUT", "12"))
EXTRACT_TIMEOUT = float(os.getenv("MANUAL_JUDGE_EXTRACT_TIMEOUT", "15"))
LLM_TIMEOUT = float(os.getenv("MANUAL_JUDGE_LLM_TIMEOUT", "25"))

# Which VOLUME wins, not only "is it a manual" (2026-10-04, Golden Walk + Pixel 9a).
# "Is this a user manual for THIS model?" is truthfully yes for a PowerFlex 525
# COMMUNICATIONS manual (no F005 in 398 chunks), a Portuguese ACS580 firmware manual
# and an ATV320 Getting Started guide; stopping at the first yes made the pick a coin
# flip. Matches now rank by fault-code coverage and language, and a non-ideal first
# match buys at most one more batch inside UPGRADE_DEADLINE_S (the discovery call
# itself times out at 50 s and a timeout there loses the match already found).
# Docs: docs/plans/2026-10-04-manual-truth-table-three-fixes.md (Fix A).
# Constants, not env knobs: neither deploy manifest forwards a new variable to mira-ask
# (Codex #4233 r2 F4), and a knob that silently does nothing is worse than none. The
# technician's language becomes per-tenant when the Hub carries one.
PREFERRED_LANGUAGE = "en"
# Upgrade budget from the START of search_manual (provider queries included), further
# capped by the caller's own deadline minus RETURN_RESERVE_S when it passes one.
UPGRADE_DEADLINE_S = 30.0
UPGRADE_MIN_BATCH_S = 8.0
RETURN_RESERVE_S = 2.0

# Only these document kinds can ever be "the manual". Enforced in code, not just in the
# prompt: canary 2026-08-26 accepted a fuse-kit PARTS LIST for a GS1-45P0 as the manual
# (doc_type=parts_list, conf 0.92) — a false positive by the owner's rule.
MANUAL_DOC_TYPES = frozenset({"user_manual", "installation_manual"})

# Verdict strings the caller can show verbatim.
REASON_JUDGED_MATCH = "judged_manual_match"
REASON_JUDGED_REJECTED = "judged_not_applicable"
REASON_JUDGE_UNAVAILABLE = "judge_unavailable"


# ── fetch (SSRF-guarded, byte-capped) ────────────────────────────────────────


async def fetch_pdf_bytes(url: str, max_bytes: int = MAX_BYTES) -> bytes | None:
    """GET the candidate, following redirects manually through the SSRF guard
    (every hop re-validated), streaming with a hard byte cap. Returns ``None``
    on any failure, on a non-PDF body, or when the cap is exceeded."""
    try:
        async with httpx.AsyncClient(
            timeout=FETCH_TIMEOUT,
            follow_redirects=False,
            transport=_search._probe_transport(),
            trust_env=False,  # never route an untrusted fetch through an env proxy
            headers={"User-Agent": "Mozilla/5.0 (compatible; mira-manual-search/0.1)"},
        ) as client:
            current = url
            for _ in range(_search._MAX_REDIRECT_HOPS + 1):
                if not await asyncio.to_thread(_search._url_is_probeable, current):
                    logger.info("judge fetch blocked by SSRF guard: %s", current[:120])
                    return None
                async with client.stream("GET", current) as r:
                    if r.status_code in (301, 302, 303, 307, 308):
                        loc = r.headers.get("location")
                        if not loc:
                            return None
                        current = _search.urljoin(current, loc)
                        continue
                    if r.status_code >= 400:
                        return None
                    buf = io.BytesIO()
                    async for chunk in r.aiter_bytes():
                        buf.write(chunk)
                        if buf.tell() > max_bytes:
                            logger.info("judge fetch exceeded byte cap: %s", current[:120])
                            return None
                    data = buf.getvalue()
                    return data if data[:5] == b"%PDF-" else None
            return None
    except (httpx.HTTPError, OSError, asyncio.TimeoutError) as e:  # noqa: PERF203
        logger.info("judge fetch failed %s: %s", url[:120], e)
        return None


# ── extract ─────────────────────────────────────────────────────────────────


def _extract_text_sync(data: bytes, max_pages: int, max_chars: int) -> str:
    import pdfplumber  # MIT; already used by mira-ingest / mira-mcp / crawler

    out: list[str] = []
    total = 0
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages[:max_pages]:
            try:
                t = page.extract_text() or ""
            except Exception:  # noqa: BLE001 — one bad page must not kill the doc
                t = ""
            if not t:
                continue
            out.append(t)
            total += len(t)
            if total >= max_chars:
                break
    text = "\n".join(out)
    return text[:max_chars]


_EXTRACT_CHILD = (
    "import sys;from shared.manual_search.judge import _extract_text_sync as f;"
    "d=sys.stdin.buffer.read();"
    "sys.stdout.buffer.write(f(d,int(sys.argv[1]),int(sys.argv[2])).encode('utf-8','replace'))"
)


async def extract_text(data: bytes, max_pages: int = MAX_PAGES, max_chars: int = MAX_CHARS) -> str:
    """Parse untrusted PDF bytes in a KILLABLE child process, bounded by
    ``EXTRACT_TIMEOUT``. Review 2026-08-26: a decompression-bomb / pathologically
    nested PDF hangs pdfminer for minutes; in a thread that pin stays alive
    after the caller times out and, on the shared default executor, starves
    every other ``to_thread`` user in the process (including the SSRF guard).
    A child process is killed outright on timeout."""
    import sys

    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            _EXTRACT_CHILD,
            str(max_pages),
            str(max_chars),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        )
    except (OSError, ValueError) as e:
        logger.info("judge extraction could not start: %s", e)
        return ""
    try:
        out, _ = await asyncio.wait_for(proc.communicate(data), timeout=EXTRACT_TIMEOUT)
    except asyncio.CancelledError:
        # An upgrade batch cancelled at its deadline must not leave the parser
        # child running on a pathological PDF.
        proc.kill()
        raise
    except asyncio.TimeoutError:
        logger.info("judge text extraction timed out after %.0fs; killed", EXTRACT_TIMEOUT)
        proc.kill()
        try:
            await proc.wait()
        except Exception:  # noqa: BLE001
            pass
        return ""
    except Exception as e:  # noqa: BLE001
        logger.info("judge text extraction failed: %s", e)
        return ""
    if proc.returncode != 0:
        return ""
    return out.decode("utf-8", "replace")[:max_chars]


# ── judge ───────────────────────────────────────────────────────────────────

_JUDGE_SYSTEM = (
    "You are checking whether a PDF is the official documentation for a specific piece of "
    "industrial equipment. Answer ONLY with a JSON object, no prose:\n"
    '{"is_manual_for_model": true|false, "doc_type": "user_manual"|"installation_manual"|'
    '"parts_list"|"datasheet"|"brochure_or_catalog"|"other", "scope": "complete"|"section", '
    '"confidence": 0.0-1.0, "lists_fault_codes": true|false, '
    '"language": "<ISO 639-1 code of the document text, e.g. en>", '
    '"evidence_quote": "<verbatim text from the document that supports your answer, <=200 chars>", '
    '"reason": "<one sentence>"}\n'
    "Rules: is_manual_for_model is true ONLY for a user / owner's / installation / operation "
    "manual that covers THIS model (exact model, or a family/series the document explicitly "
    "lists this model under). A parts list, accessory or fuse kit sheet, datasheet, spec sheet, "
    "sales brochure, catalog, price list, revision history, or a manual for a different product "
    "line is false even when it names the model. If the text does not mention the model or its family, answer false "
    'with low confidence. scope is "section" when the PDF is one chapter/appendix/warning '
    "insert of a larger manual (page numbers like W-1, A-3, or a chapter title as the whole "
    'document), "complete" when it is the whole manual. lists_fault_codes is true only when '
    "this PDF itself contains this equipment's fault / alarm / error code list with what each "
    "code means (or is the complete manual whose contents list that section) — not only the "
    "status codes of an option card or communication adapter, and not a contents page that "
    "points to other files. Never invent a quote."
)


def _extract_json(text: str) -> dict[str, Any] | None:
    """The LAST parseable JSON object in ``text``. A reasoning model may emit
    prose containing braces before the answer; a greedy first-'{'..last-'}'
    span would swallow that prose and fail to parse (review 2026-08-26)."""
    if not text:
        return None
    end = text.rfind("}")
    if end < 0:
        return None
    for start in (i for i, ch in enumerate(text) if ch == "{"):
        if start > end:
            break
        try:
            obj = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            return obj
    return None


_router: Any = None


def _get_router() -> Any:
    """Lazy singleton over the canonical cascade — the ONLY model seam here."""
    global _router
    if _router is None:
        from shared.inference.router import InferenceRouter

        _router = InferenceRouter()
    return _router


async def judge_text(make: str, model: str, cand: dict, text: str) -> dict[str, Any] | None:
    """One narrow model call (retried once on unparseable output — canary run 1
    lost the only real GS10 hit to a malformed answer). Returns the parsed
    verdict, or ``None`` when the cascade is disabled/unavailable or both
    attempts returned nothing parseable."""
    router = _get_router()
    if not getattr(router, "enabled", False):
        return None
    for attempt in range(2):
        verdict = await _judge_text_once(make, model, cand, text, attempt)
        if verdict is not None:
            return verdict
    return None


async def _judge_text_once(
    make: str, model: str, cand: dict, text: str, attempt: int
) -> dict[str, Any] | None:
    router = _get_router()
    user = (
        f"Equipment: manufacturer={make!r} model={model!r}\n"
        f"Candidate URL: {cand.get('url', '')[:200]}\n"
        f"Candidate title: {cand.get('title', '')[:160]}\n\n"
        f"First pages of the PDF:\n<<<\n{text}\n>>>"
    )
    t0 = time.monotonic()
    try:
        content, _usage = await asyncio.wait_for(
            router.complete(
                [{"role": "system", "content": _JUDGE_SYSTEM}, {"role": "user", "content": user}],
                # 1200, not 400: gpt-oss reasons before it answers and a 400 cap
                # truncated the JSON mid-object (live 2026-08-26 → verdict None).
                max_tokens=1200,
                session_id="manual_judge",
            ),
            timeout=LLM_TIMEOUT,
        )
    except (asyncio.TimeoutError, Exception) as e:  # noqa: BLE001
        logger.info("judge model call failed: %s", e)
        return None
    latency_ms = int((time.monotonic() - t0) * 1000)
    verdict = _extract_json(content)
    if not verdict or "is_manual_for_model" not in verdict:
        logger.info(
            "MANUAL_JUDGE_VERDICT %s",
            json.dumps(
                {
                    "status": "unparseable",
                    "attempt": attempt,
                    "url": cand.get("url", "")[:200],
                    "provider": (_usage or {}).get("provider"),
                    "model": (_usage or {}).get("model"),
                    "latency_ms": latency_ms,
                }
            ),
        )
        return None
    try:
        conf = float(verdict.get("confidence", 0.0))
    except (TypeError, ValueError):
        conf = 0.0
    doc_type = str(verdict.get("doc_type") or "other")[:40]
    said_yes = bool(verdict.get("is_manual_for_model"))
    fault_codes = verdict.get("lists_fault_codes")
    language = str(verdict.get("language") or "").strip().lower()[:2] or None
    return {
        # A "yes" on anything but a real manual kind is downgraded to a rejection with
        # the model's own classification as the reason.
        "is_manual": said_yes and doc_type in MANUAL_DOC_TYPES,
        "doc_type": doc_type,
        "downgraded": said_yes and doc_type not in MANUAL_DOC_TYPES,
        "scope": "section"
        if str(verdict.get("scope") or "").lower().startswith("sec")
        else "complete",
        "confidence": max(0.0, min(1.0, conf)),
        # None = the model did not say (an older prompt or a terse answer).
        "lists_fault_codes": fault_codes if isinstance(fault_codes, bool) else None,
        "language": language,
        "evidence_quote": str(verdict.get("evidence_quote") or "")[:240],
        "reason": (
            f"Classified as {doc_type.replace('_', ' ')}, not a user/installation manual. "
            + str(verdict.get("reason") or "")
        )[:240]
        if (said_yes and doc_type not in MANUAL_DOC_TYPES)
        else str(verdict.get("reason") or "")[:240],
        "provider": (_usage or {}).get("provider"),
        "model": (_usage or {}).get("model"),
        "latency_ms": latency_ms,
    }


async def _judge_one(make: str, model: str, cand: dict) -> dict:
    """Annotate one candidate in place with ``judge`` = verdict | {"status": ...}."""
    # Counted as examined the moment the read starts, so a timeout that
    # cancels the batch keeps the partial count (#4160 R15, Codex #4194 r2 F4).
    _search._note_examined([cand["url"]])
    data = await fetch_pdf_bytes(cand["url"])
    if data is None:
        cand["judge"] = {"status": "unfetched"}
        return cand
    # The bytes are a real PDF — that is the same proof validate_pdf gives.
    cand["validated"] = True
    text = await extract_text(data)
    if not text.strip():
        cand["judge"] = {"status": "no_text"}
        return cand
    verdict = await judge_text(make, model, cand, text)
    if verdict is None:
        cand["judge"] = {"status": "unavailable"}
        return cand
    verdict["status"] = "judged"
    verdict["text_chars"] = len(text)
    # Deterministic signals from the text the judge read (zero-token).
    verdict["text_language"] = text_language(text)
    verdict["fault_heading"] = bool(_FAULT_HEADING.search(text))
    cand["judge"] = verdict
    # One auditable line per judgment (owner canary protocol, 2026-08-26):
    # what was read, what was decided, by which model, how fast.
    logger.info(
        "MANUAL_JUDGE_VERDICT %s",
        json.dumps(
            {
                "status": "judged",
                "make": make,
                "model_number": model,
                "url": cand.get("url", "")[:200],
                "host": cand.get("host", ""),
                "title": (cand.get("title") or "")[:120],
                "text_chars": len(text),
                "is_manual": verdict["is_manual"],
                "downgraded": verdict.get("downgraded", False),
                "doc_type": verdict["doc_type"],
                "scope": verdict.get("scope"),
                "lists_fault_codes": verdict.get("lists_fault_codes"),
                "language": verdict.get("language"),
                "text_language": verdict.get("text_language"),
                "fault_heading": verdict.get("fault_heading"),
                "confidence": verdict["confidence"],
                "evidence_quote": verdict["evidence_quote"],
                "reason": verdict["reason"],
                "provider": verdict.get("provider"),
                "model": verdict.get("model"),
                "latency_ms": verdict.get("latency_ms"),
            }
        ),
    )
    return cand


def is_match(c: dict) -> bool:
    j = c.get("judge") or {}
    return j.get("status") == "judged" and bool(j.get("is_manual"))


def is_rejected(c: dict) -> bool:
    j = c.get("judge") or {}
    return j.get("status") == "judged" and not j.get("is_manual")


def _make_tokens(make: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", (make or "").lower()) if len(t) >= 3]


def _mentions_make(c: dict, make: str) -> bool:
    hay = f"{c.get('title', '')} {c.get('url', '')}".lower()
    return any(t in hay for t in _make_tokens(make))


def _mentions_model(c: dict, model: str) -> bool:
    hay = f"{c.get('title', '')} {c.get('url', '')}".lower().replace("-", "").replace(" ", "")
    raw = (model or "").lower()
    m = raw.replace("-", "").replace(" ", "")
    fam = re.match(r"[a-z]+\d+", raw)  # on the ORIGINAL: GS10-20P5 → gs10, not gs1020
    toks = [t for t in (m, fam.group(0) if fam else "") if len(t) >= 3]
    return any(t in hay for t in toks)


def relevant(c: dict, make: str, model: str) -> bool:
    """Worth a read: names the make or the model (family) in URL/title.
    Live 2026-08-26: `filetype:pdf` variants pulled tax forms and health
    plans into the pool; reading them burned the whole budget."""
    return _mentions_make(c, make) or _mentions_model(c, model)


# A fault/alarm code LIST heading, in the languages OEM manuals ship in. Fallback
# only: it cannot tell a drive's fault list from an option card's, so the model's
# `lists_fault_codes` wins whenever the model gave one.
_FAULT_HEADING = re.compile(
    r"\b(?:fault|alarm|error|trip)s?\s*(?:codes?|lists?|descriptions?|messages?|tables?)\b"
    r"|\bfaults?\s+(?:and|&)\s+alarms?\b|\balarms?\s+(?:and|&)\s+faults?\b"
    r"|\bfehler(?:meldungen|codes?|liste)\b|\bst[öo]rungsmeldungen\b"
    r"|\bc[óo]digos?\s+de\s+(?:falla|falha|error|erro|alarma|alarme)\b"
    r"|\bcodes?\s+(?:de\s+)?d[ée]fauts?\b",
    re.I,
)

# Only words that are not also English or drive-table abbreviations: "En"
# (Enabled) appears 33 times in the first pages of a PowerFlex 525 parameter guide.
_STOPWORDS = {
    "en": frozenset("the and of to for with is this on be are or not if when from".split()),
    "pt": frozenset("da dos das para com não em uma que os ao pelo".split()),
    "es": frozenset("del la las los el para con que una por como".split()),
    "de": frozenset("der die das und mit für von zu im ist den nicht ein eine auf".split()),
    "fr": frozenset("le la les et des du pour avec dans est une un sur pas au".split()),
    "id": frozenset("dan yang untuk dengan di ini atau dari pada jika akan tidak ke".split()),
}


def text_language(text: str) -> str | None:
    """The language a technician would read this document in, from function-word
    counts: the preferred language whenever it is present as real prose (multilingual
    editions and parameter tables count), otherwise a clearly dominant other language,
    otherwise None. Short words in drive tables ("No", "En", "Se") read as Spanish, so a
    document is only called foreign when the preferred language is nearly absent.
    Deterministic; preferred over the model's guess."""
    words = re.findall(r"[^\W\d_]+", (text or "").lower())
    counts = {lang: sum(1 for w in words if w in sw) for lang, sw in _STOPWORDS.items()}
    preferred = counts.get(PREFERRED_LANGUAGE, 0)
    others = max(v for k, v in counts.items() if k != PREFERRED_LANGUAGE)
    # Present as prose AND clearly ahead of any other language: Portuguese and
    # Spanish share "para"/"que", so presence alone would call one the other.
    if preferred >= 8 and preferred >= 2 * others:
        return PREFERRED_LANGUAGE
    best = max(counts, key=lambda k: counts[k])
    runner_up = max(v for k, v in counts.items() if k != best)
    if counts[best] < 12 or counts[best] < 2 * runner_up:
        return None
    return best


def _fault_list(j: dict) -> bool | None:
    v = j.get("lists_fault_codes")
    if isinstance(v, bool):
        return v
    return True if j.get("fault_heading") else None


def _language_ok(j: dict) -> bool | None:
    lang = j.get("text_language") or j.get("language")
    return None if not lang else lang == PREFERRED_LANGUAGE


def _tri(v: bool | None) -> int:
    return 2 if v is True else 0 if v is False else 1


def is_ideal(c: dict) -> bool:
    """A match nothing in the queue could outrank: lists the fault codes, in the
    technician's language (confirmed, not merely unknown), as the whole manual. Kept
    consistent with :func:`rank` — anything rank could still prefer earns the bounded
    extra batch."""
    j = c.get("judge") or {}
    return (
        is_match(c)
        and _fault_list(j) is True
        and _language_ok(j) is True
        and j.get("scope") != "section"
    )


def rank(candidates: list[dict]) -> list[dict]:
    """matched > unjudged (score) > rejected (score). Among matches: lists the fault
    codes > technician's language > whole manual over a chapter > confidence > score.
    Coverage outranks scope: a fault-code chapter answers a fault question, a whole
    communications manual does not."""

    def key(c: dict) -> tuple:
        j = c.get("judge") or {}
        if is_match(c):
            return (
                2,
                _tri(_fault_list(j)),
                _tri(_language_ok(j)),
                1 if j.get("scope") != "section" else 0,
                float(j.get("confidence", 0.0)),
                c.get("score", 0),
            )
        if is_rejected(c):
            return (0, 0, 0, 0, 0.0, c.get("score", 0))
        return (1, 0, 0, 0, 0.0, c.get("score", 0))

    return sorted(candidates, key=key, reverse=True)


async def judge_candidates(
    make: str,
    model: str,
    candidates: list[dict],
    started_at: float | None = None,
    deadline_at: float | None = None,
) -> list[dict]:
    """Read direct-PDF candidates in batches of ``MAX_CANDIDATES`` — candidates
    that mention the make in their URL/title first, then by heuristic score —
    until one is judged the manual or ``MAX_TOTAL`` have been read. Returns the
    full list re-ranked via :func:`rank`. Never raises.

    Batches matter (measured 2026-08-26): a hyphen variant of the model pulled
    state tax forms into the pool at heuristic score 40, above the real
    Series 3 manual at 30; reading only the top four judged four tax forms and
    never opened the manual.
    """
    if not candidates:
        return candidates
    pdfs = [c for c in candidates if c.get("is_direct_pdf")]
    queue = [c for c in pdfs if relevant(c, make, model)] or pdfs
    queue.sort(key=lambda c: (_mentions_make(c, make), c.get("score", 0)), reverse=True)
    queue = queue[:MAX_TOTAL]
    # The upgrade deadline counts from when the whole search began (search_manual
    # passes it): judging that starts late must not run past the discovery timeout.
    t0 = time.monotonic() if started_at is None else started_at
    upgrade_until = t0 + UPGRADE_DEADLINE_S
    if deadline_at is not None:  # never outrun the caller's own timeout
        upgrade_until = min(upgrade_until, deadline_at - RETURN_RESERVE_S)
    while queue:
        batch, queue = queue[:MAX_CANDIDATES], queue[MAX_CANDIDATES:]
        # Searching (no match yet) behaves as before. Upgrading (a match is in hand,
        # just not an ideal one) is time-boxed so it can never cost that match.
        upgrading = any(is_match(c) for c in candidates)
        try:
            reads = asyncio.gather(*(_judge_one(make, model, c) for c in batch))
            if upgrading:
                remaining = upgrade_until - time.monotonic()
                if remaining < UPGRADE_MIN_BATCH_S:
                    reads.cancel()
                    logger.info("judge upgrade skipped: %.1fs left", max(remaining, 0.0))
                    break
                await asyncio.wait_for(reads, timeout=remaining)
            else:
                await reads
        except asyncio.TimeoutError:
            logger.info("judge upgrade batch hit its deadline; keeping the match in hand")
            break
        except Exception as e:  # noqa: BLE001 — belt and braces; _judge_one never raises
            logger.info("judge_candidates degraded: %s", e)
        # Stop on an ideal match. A plain match (wrong volume, wrong language, or
        # a chapter) earns one more batch, then the best match so far stands.
        if any(is_ideal(c) for c in batch):
            break
        if any(is_match(c) for c in candidates) and len(queue) > MAX_CANDIDATES:
            queue = queue[:MAX_CANDIDATES]
    return rank(candidates)


def judge_summary(cand: dict) -> tuple[str, str]:
    """(reason_code, human_line) for a judged/unjudged top candidate."""
    j = cand.get("judge") or {}
    if j.get("status") == "judged":
        if j.get("is_manual"):
            q = j.get("evidence_quote") or ""
            return (
                REASON_JUDGED_MATCH,
                f'Read the PDF: {j.get("reason", "")} Evidence: "{q}"'.strip(),
            )
        return REASON_JUDGED_REJECTED, f"Read the PDF: {j.get('reason', '')}".strip()
    return REASON_JUDGE_UNAVAILABLE, "Could not read the candidate PDF; ranked by URL/title only."
