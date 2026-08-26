"""Real-time OEM manual search — the shared, product-agnostic core.

Ported verbatim (logic unchanged) from ``mira-scan-monday/backend/manual_search.py``
(built 2026-05-05 for an unrelated monday.com marketplace integration, commit
``8fa3dce3``). That copy is left in place and unmodified; this is Phase 1 of
``docs/plans/2026-07-31-visual-intake-asset-identity-manualsense-audit.md``
("port, don't rebuild") — it makes the searcher reachable from any bot
adapter without touching the product it was originally written for.

This module has ZERO knowledge of any product's state machine or DB schema —
it is a pure ``(manufacturer, model) -> validated candidate | None`` function.
Callers own what happens with the result (attach it, queue it, discard it).
See ``crawler_bridge.py`` in this package for the one existing, reusable way
to hand a validated candidate to MIRA's canonical ingestion path.

ManualsLib's search is fully client-side rendered (Vue.js), so static HTTP
scraping doesn't work. DuckDuckGo HTML returns 202 / CAPTCHA from VPS IPs.

Solution: use Serper (google.serper.dev) — a thin Google Search wrapper that
returns clean JSON. The key is already in Doppler `factorylm/prd` as
SERPER_API_KEY (the lead-hunter tool uses it too).

Search strategy (multi-pass to beat SEO spam):

    1. site-scoped:    `"{model}" manual filetype:pdf site:{oem_domain}`
    2. filetype:pdf:   `{make} {model} manual filetype:pdf`
    3. wider net:      `{make} {model} manual pdf`

Each query feeds into a single ranked candidate pool. The top candidate is
then HEAD-validated (`Content-Type: application/pdf` or `%PDF-` magic bytes)
before being promoted — this protects against query results that 404 or
redirect to HTML, and is the mechanism that satisfies ManualSense's "verify
the URL resolves" / "verify PDF/document type" requirements (audit §4.5).

Never silently substitutes a neighboring OEM or a different model: a manual
is either matched against this exact (make, model) pair via ``_score`` and
HEAD-validated, or the caller gets ``None`` / an unvalidated candidate marked
as such — it is the caller's job to refuse or ask for a clearer identity
rather than guess.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import re
import socket
from urllib.parse import urljoin, urlparse

import httpx

logger = logging.getLogger("mira.manual_search")

SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")
SERPER_URL = os.getenv("SERPER_URL", "https://google.serper.dev/search")
SEARCH_TIMEOUT = float(os.getenv("MANUAL_SEARCH_TIMEOUT", "15"))
HEAD_TIMEOUT = float(os.getenv("MANUAL_HEAD_TIMEOUT", "8"))

# Manufacturer -> primary download/support hosts. The first entry is also
# used as the `site:` filter for the high-precision pass. Aliases on the
# left side (lowercased) keep the lookup robust to common OCR variations
# of the make string (Allen-Bradley vs AB vs Rockwell, etc.).
OEM_DOMAINS: dict[str, tuple[str, ...]] = {
    "beckhoff": (
        "download.beckhoff.com",
        "infosys.beckhoff.com",
        "beckhoff.com",
    ),
    "rockwell": (
        "literature.rockwellautomation.com",
        "ab.rockwellautomation.com",
        "rockwellautomation.com",
    ),
    "rockwell automation": (
        "literature.rockwellautomation.com",
        "ab.rockwellautomation.com",
        "rockwellautomation.com",
    ),
    "allen-bradley": (
        "literature.rockwellautomation.com",
        "ab.rockwellautomation.com",
        "rockwellautomation.com",
    ),
    "allen bradley": (
        "literature.rockwellautomation.com",
        "ab.rockwellautomation.com",
        "rockwellautomation.com",
    ),
    "ab": (
        "literature.rockwellautomation.com",
        "ab.rockwellautomation.com",
    ),
    "siemens": (
        "support.industry.siemens.com",
        "cache.industry.siemens.com",
        "industry.siemens.com",
    ),
    "abb": (
        "library.e.abb.com",
        "new.abb.com",
        "abb.com",
    ),
    "yaskawa": (
        "yaskawa.com",
        "yaskawa.eu.com",
    ),
    "automationdirect": (
        "cdn.automationdirect.com",
        "automationdirect.com",
    ),
    "automation direct": (
        "cdn.automationdirect.com",
        "automationdirect.com",
    ),
    "schneider": ("se.com", "schneider-electric.com"),
    "schneider electric": ("se.com", "schneider-electric.com"),
    "square d": ("se.com",),
    "square-d": ("se.com",),
    "omron": ("automation.omron.com", "omron.com"),
    # Oriental Motor publishes its operating manuals directly under
    # www.orientalmotor.com/products/pdfs/opmanuals/ (verified 2026-08-15 against
    # the DGII-series actuator manual HL-80002-12E.pdf). Without this entry the
    # searcher still FINDS the right document, but scores it as a non-OEM host,
    # so an auto-import gate keyed on oem_host refuses it and the technician is
    # sent to manual review for a genuine first-party manual.
    "oriental motor": (
        "www.orientalmotor.com",
        "orientalmotor.com",
        "orientalmotor.co.jp",
    ),
    "orientalmotor": (
        "www.orientalmotor.com",
        "orientalmotor.com",
        "orientalmotor.co.jp",
    ),
    "oriental motor co., ltd.": (
        "www.orientalmotor.com",
        "orientalmotor.com",
        "orientalmotor.co.jp",
    ),
    "phoenix contact": ("phoenixcontact.com",),
    "phoenix-contact": ("phoenixcontact.com",),
    "mitsubishi": ("mitsubishielectric.com", "mitsubishifa.co.jp"),
    "mitsubishi electric": ("mitsubishielectric.com",),
    "danfoss": ("danfoss.com",),
    "lenze": ("lenze.com",),
    "sew": ("sew-eurodrive.com",),
    "sew eurodrive": ("sew-eurodrive.com",),
    "eaton": ("eaton.com",),
    "eaton-bussmann": ("eaton.com",),
    "fluke": ("fluke.com",),
    "panduit": ("panduit.com",),
    "idec": ("idec.com",),
    "meanwell": ("meanwell.com",),
    "mean well": ("meanwell.com",),
    "baldor": ("baldor.com", "abb.com"),
    "weg": ("weg.net",),
    "festo": ("festo.com",),
    "smc": ("smcusa.com",),
    "ifm": ("ifm.com",),
    "balluff": ("balluff.com",),
    # Hoists / cranes (2026-08-26, UMS3-0335 end-truck case): the OEM hosts its
    # manuals at harringtonhoists.com; without this entry the site-scoped pass is
    # skipped and the OEM host boost never applies.
    "harrington": ("harringtonhoists.com",),
    "harrington hoists": ("harringtonhoists.com",),
    "harrington hoists and cranes": ("harringtonhoists.com",),
    "banner": ("bannerengineering.com",),
    "pepperl": ("pepperl-fuchs.com",),
    "pepperl+fuchs": ("pepperl-fuchs.com",),
}

# Domains whose `.pdf` URLs are SEO spam, third-party scrapes, or random
# Webflow CDN dumps that should NEVER be promoted to manual_url. They get
# filtered out before scoring.
DENY_HOSTS: frozenset[str] = frozenset(
    {
        "cdn.prod.website-files.com",
        "uploads-ssl.webflow.com",
        "assets.website-files.com",
        "global-uploads.webflow.com",
        "pdfslide.net",
        "pdfcoffee.com",
        "studylib.net",
        "studocu.com",
        "academia.edu",
        "scribd.com",
        "issuu.com",
        "yumpu.com",
        "dokumen.tips",
        "researchgate.net",
        "slideshare.net",
        "kupdf.net",
        "pdf4pro.com",
        "vdocuments.net",
    }
)

# Score boost for results hosted on known OEM CDNs / curated repositories.
# Higher = preferred. Only domains here can earn the trusted-domain bonus;
# the OEM map above is consulted *additionally* with a make-aware bonus so
# e.g. Beckhoff results get the boost without pre-listing every Beckhoff
# subdomain here.
TRUSTED_DOMAINS: tuple[tuple[str, int], ...] = (
    ("literature.rockwellautomation.com", 100),
    ("cache.industry.siemens.com", 100),
    ("support.industry.siemens.com", 100),
    ("library.e.abb.com", 100),
    ("download.beckhoff.com", 100),
    ("infosys.beckhoff.com", 100),
    ("new.abb.com", 80),
    ("yaskawa.com", 80),
    ("automationdirect.com", 90),
    ("cdn.automationdirect.com", 90),
    ("rockwellautomation.com", 75),
    ("docs.rs-online.com", 50),
)


# Manufacturer -> the OEM's own "request an owner's manual" form. Offered when
# discovery cannot find or validate a manual (2026-08-26, Harrington UMS3-0335:
# every copy of the Series 3 manual is bot-walled or JS-rendered; the OEM's
# door is this form). Always re-probed before it is offered — never a dead link.
OEM_MANUAL_REQUEST: dict[str, str] = {
    "harrington": "https://www.harringtonhoists.com/owners-manual-request",
    "harrington hoists": "https://www.harringtonhoists.com/owners-manual-request",
    "harrington hoists and cranes": "https://www.harringtonhoists.com/owners-manual-request",
}


async def oem_request_link(make: str) -> str | None:
    """The OEM's manual-request page for `make`, only if it answers 200 right
    now (SSRF-guarded probe, redirects re-validated). None otherwise."""
    url = OEM_MANUAL_REQUEST.get(_norm(make))
    if not url:
        return None
    try:
        async with httpx.AsyncClient(
            timeout=HEAD_TIMEOUT,
            follow_redirects=False,
            transport=_transport_for_tests,
            headers={"User-Agent": "Mozilla/5.0 (compatible; mira-manual-search/0.1)"},
        ) as client:
            r = await _guarded_probe(client, "GET", url)
            return url if r is not None and r.status_code == 200 else None
    except httpx.HTTPError:
        return None


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _oem_domains_for(make: str) -> tuple[str, ...]:
    return OEM_DOMAINS.get(_norm(make), ())


def _is_oem_host(host: str, make: str) -> bool:
    """True if `host` (case-insensitive) is on the OEM list for `make`."""
    host = host.lower()
    return any(host == d or host.endswith("." + d) for d in _oem_domains_for(make))


def _is_denied(host: str) -> bool:
    host = host.lower()
    return any(host == d or host.endswith("." + d) for d in DENY_HOSTS)


def _model_tokens(model: str) -> list[str]:
    """Progressively-shorter substrings of the model number so EK1100 still
    matches an OEM PDF named ek110x_ek15xx_en.pdf — the OEM family wildcard."""
    m = _norm(model)
    if not m:
        return []
    tokens = [m]
    # If the model has a digit prefix, also accept the family-prefix:
    # "EK1100" -> "ek110", "EK1101" -> "ek110", "ACS580" -> "acs58".
    if len(m) >= 5:
        tokens.append(m[: len(m) - 1])
    if len(m) >= 6:
        tokens.append(m[: len(m) - 2])
    return tokens


def _model_variants(model: str) -> list[str]:
    """Search-string variants of a model number, original first.

    One hyphen flips the result: measured 2026-08-26, ``Harrington UMS3-0335``
    surfaces the Series 3 end-truck manual while ``UMS-3-0335`` (how the OEM
    prints it in the manual) surfaces a tax form. Nameplates, OEM manuals and
    distributors disagree on hyphenation, so the typed-PDF pass runs each
    variant and the candidates are pooled.
    """
    m = (model or "").strip()
    if not m:
        return []
    out = [m]
    flat = m.replace("-", "").replace(" ", "")
    if flat and flat != m:
        out.append(flat)
    # family prefix: GS10-20P5 → GS10, UMS3-0335 → UMS3 (OEMs publish one
    # manual per family; the exact model is a row in its table)
    fam = re.match(r"[A-Za-z]+\d+", m)
    if fam and fam.group(0) != m and fam.group(0) not in out:
        out.append(fam.group(0))
    # letters→digits boundary gets a hyphen: UMS3-0335 → UMS-3-0335, GS10 → GS-10
    dashed = re.sub(r"(?<=[A-Za-z])(?=\d)", "-", m, count=1)
    if dashed != m and dashed not in out:
        out.append(dashed)
    return out[:4]


def _score(url: str, title: str, make: str, model: str) -> int:
    """Heuristic relevance: deny-list, OEM domain, .pdf, model tokens, title."""
    if not url:
        return 0
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    if _is_denied(host):
        return -1  # filtered out

    score = 0
    if _is_oem_host(host, make):
        score += 120  # outranks TRUSTED_DOMAINS — manufacturer's own host
    else:
        for domain, boost in TRUSTED_DOMAINS:
            if host == domain or host.endswith("." + domain):
                score += boost
                break

    path = (parsed.path or "").lower()
    if path.endswith(".pdf"):
        score += 30
    elif "pdf" in path or "format=pdf" in (parsed.query or "").lower():
        score += 15

    title_lc = (title or "").lower()
    if any(
        t in title_lc
        for t in (
            "manual",
            "datasheet",
            "data sheet",
            "user guide",
            "instruction",
            "operating",
        )
    ):
        score += 10

    haystack = f"{title_lc} {url.lower()}"
    for tok in _model_tokens(model):
        if tok and tok in haystack:
            # Full token worth more than a family-prefix.
            score += 25 if tok == _norm(model) else 10
            break
    return score


def _is_direct_pdf(url: str) -> bool:
    if not url:
        return False
    p = urlparse(url)
    if (p.path or "").lower().endswith(".pdf"):
        return True
    # Siemens supports format=pdf query param on teddatasheet endpoints.
    return "format=pdf" in (p.query or "").lower()


def _guess_doc_type(title: str, url: str) -> str:
    text = f"{title} {url}".lower()
    if "data sheet" in text or "datasheet" in text:
        return "technical_data"
    if "installation" in text:
        return "installation_manual"
    if "user manual" in text or "user guide" in text:
        return "user_manual"
    if "quick start" in text or "getting started" in text:
        return "quick_start"
    return "installation_manual"


def _clean_title(title: str) -> str:
    t = (title or "").strip()
    if t.startswith("[PDF]"):
        t = t[5:]
    return t.strip(" -|")


async def _serper_search(query: str, num: int = 10) -> list[dict]:
    if not SERPER_API_KEY:
        raise RuntimeError("SERPER_API_KEY is not configured")
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}
    body = {"q": query, "num": num}
    async with httpx.AsyncClient(timeout=SEARCH_TIMEOUT) as client:
        resp = await client.post(SERPER_URL, headers=headers, json=body)
        resp.raise_for_status()
        return resp.json().get("organic", []) or []


# ── SSRF guard (Codex P1, 2026-08-16) ────────────────────────────────────────
#
# The URLs probed here come from an EXTERNAL search engine — attacker-reachable
# input — and this service runs inside the production network. An unguarded
# probe (or an unguarded redirect hop) is a free port-scan / metadata read of
# the internal network. The guard mirrors the hardened Hub downloader's rules:
# http(s) only, every hop's hostname must resolve EXCLUSIVELY to public
# addresses (private / loopback / link-local / reserved / multicast / v4-mapped
# all rejected), redirects are followed MANUALLY with each hop re-validated,
# and reads are streamed with a hard byte cap. Residual risk, same as the Hub
# side: DNS rebinding between the resolve and the connect — no allowlist can
# exist for open-web discovery, so this is documented rather than closed.

_MAX_REDIRECT_HOPS = 5
_PROBE_READ_CAP = 512


# CGNAT (RFC 6598) — carrier-grade NAT space. `is_global` already excludes it
# on Python 3.12, but we reject it EXPLICITLY too (Codex reproduced a bypass on
# an older classification), matching the hand-rolled guard in
# mira-hub/src/lib/safe-download.ts.
_CGNAT_V4 = ipaddress.ip_network("100.64.0.0/10")


def _ip_is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if ip.version == 4 and ip in _CGNAT_V4:
        return False
    # `is_global` is the authoritative allow-test: True only for addresses that
    # are globally routable (excludes private/loopback/link-local/reserved/
    # multicast/unspecified/CGNAT/benchmarking/documentation ranges). We keep
    # the individual negatives below as belt-and-suspenders for any stdlib
    # version whose is_global is narrower than expected.
    return bool(ip.is_global) and not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _url_is_probeable(url: str) -> bool:
    """Sync (DNS-blocking) — call via asyncio.to_thread. True iff the URL is
    http(s) AND its hostname resolves to public addresses only."""
    try:
        p = urlparse(url)
    except ValueError:
        return False
    if p.scheme not in ("http", "https") or not p.hostname:
        return False
    try:
        infos = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == "https" else 80))
    except OSError:
        return False
    # sockaddr[0] is typed loosely by the stdlib stubs (AF_INET6 tuples carry
    # ints later in the tuple) — coerce to str before the zone-id strip.
    addrs = {str(info[4][0]) for info in infos}
    if not addrs:
        return False
    for a in addrs:
        try:
            if not _ip_is_public(ipaddress.ip_address(a.split("%")[0])):
                return False
        except ValueError:
            return False
    return True


# Test seam: unit tests inject an httpx.MockTransport here to exercise the
# redirect loop without any network. None = real transport.
_transport_for_tests: httpx.AsyncBaseTransport | None = None


async def _guarded_probe(
    client: httpx.AsyncClient, method: str, url: str, headers: dict | None = None
) -> httpx.Response | None:
    """Issue method on url, following at most _MAX_REDIRECT_HOPS redirects
    MANUALLY, re-validating every hop against the SSRF guard. Returns None if
    any hop is blocked or the hop budget is exhausted."""
    current = url
    for _ in range(_MAX_REDIRECT_HOPS + 1):
        if not await asyncio.to_thread(_url_is_probeable, current):
            logger.info("manual-search probe blocked by SSRF guard: %s", current[:120])
            return None
        r = await client.request(method, current, headers=headers)
        if r.status_code in (301, 302, 303, 307, 308):
            loc = r.headers.get("location")
            if not loc:
                return None
            current = urljoin(current, loc)
            continue
        return r
    logger.info("manual-search probe exceeded redirect budget: %s", url[:120])
    return None


async def validate_pdf(url: str) -> bool:
    """Confirm the URL actually serves a PDF.

    Strategy: HEAD first, fall back to Range GET (some CDNs don't honour HEAD
    or strip Content-Type). Returns False on any error so a flaky OEM CDN
    doesn't crash the search. Every request — including every redirect hop —
    passes the SSRF guard above; the GET is streamed and capped at
    _PROBE_READ_CAP bytes so a server that ignores Range cannot make us buffer
    an arbitrary body.
    """
    try:
        async with httpx.AsyncClient(
            timeout=HEAD_TIMEOUT,
            follow_redirects=False,
            transport=_transport_for_tests,
            headers={"User-Agent": "Mozilla/5.0 (compatible; mira-manual-search/0.1)"},
        ) as client:
            try:
                r = await _guarded_probe(client, "HEAD", url)
                if r is not None:
                    ct = (r.headers.get("content-type") or "").lower()
                    if "pdf" in ct and r.status_code < 400:
                        return True
            except httpx.HTTPError:
                pass

            # Some hosts 405 on HEAD or strip Content-Type — pull the first
            # bytes and look for the PDF magic number. Stream + cap: a server
            # that ignores the Range header must not be able to flood us.
            current = url
            for _ in range(_MAX_REDIRECT_HOPS + 1):
                if not await asyncio.to_thread(_url_is_probeable, current):
                    logger.info("manual-search probe blocked by SSRF guard: %s", current[:120])
                    return False
                async with client.stream("GET", current, headers={"Range": "bytes=0-7"}) as r:
                    if r.status_code in (301, 302, 303, 307, 308):
                        loc = r.headers.get("location")
                        if not loc:
                            return False
                        current = urljoin(current, loc)
                        continue
                    if r.status_code >= 400:
                        return False
                    ct = (r.headers.get("content-type") or "").lower()
                    if "pdf" in ct:
                        return True
                    head = b""
                    async for chunk in r.aiter_bytes():
                        head += chunk
                        if len(head) >= _PROBE_READ_CAP:
                            break
                    return head[:5] == b"%PDF-"
            return False
    except Exception:
        logger.info("PDF validation failed for %s — skipping", url[:120])
        return False


def _collect(organic: list[dict], make: str, model: str) -> list[dict]:
    out: list[dict] = []
    for hit in organic:
        url = hit.get("link") or ""
        title = hit.get("title") or ""
        if not url:
            continue
        s = _score(url, title, make, model)
        if s <= 0:
            continue
        out.append(
            {
                "url": url,
                "title": _clean_title(title),
                "host": urlparse(url).netloc,
                "score": s,
                "doc_type": _guess_doc_type(title, url),
                "is_direct_pdf": _is_direct_pdf(url),
            }
        )
    return out


async def search_manual(make: str, model: str) -> dict | None:
    """Multi-pass real-time search for a (make, model) manual.

    Returns the best HEAD-validated PDF candidate, or a lower-confidence
    unvalidated candidate (``validated=False``) if nothing HEAD-validates,
    or ``None`` if nothing scored at all. Callers MUST check ``validated``
    and ``is_direct_pdf`` before treating a result as a trustable manual
    link — this function never decides trust on the caller's behalf.
    """
    make = (make or "").strip()
    model = (model or "").strip()
    if not (make or model):
        return None

    candidates: list[dict] = []

    # Pass 1: site-scoped PDF — highest precision.
    oem_domains = _oem_domains_for(make)
    if oem_domains:
        q1 = f'"{model}" manual filetype:pdf site:{oem_domains[0]}'
        try:
            candidates.extend(_collect(await _serper_search(q1), make, model))
        except Exception:
            logger.exception("Serper q1 (site-scoped) failed")

    # Pass 2: typed PDF — broader, still PDFs only.
    if not any(c["is_direct_pdf"] for c in candidates):
        for i, variant in enumerate(_model_variants(model) or [model]):
            q2 = f"{make} {variant} manual filetype:pdf"
            try:
                found = _collect(await _serper_search(q2), make, model)
            except Exception:
                logger.exception("Serper q2 (filetype:pdf) failed")
                continue
            if i:
                # A hit from a re-hyphenated form is a weaker signal than one
                # from the nameplate's own spelling: it must not win a tie.
                for c in found:
                    c["score"] -= 5
            candidates.extend(found)

    # Pass 3: widest fallback — accept landing pages too if nothing above.
    if not candidates:
        q3 = f"{make} {model} manual pdf"
        try:
            candidates.extend(_collect(await _serper_search(q3), make, model))
        except Exception:
            logger.exception("Serper q3 (wide) failed")

    if not candidates:
        return None

    # Dedupe on URL while preserving order, then sort by score desc.
    seen: set[str] = set()
    deduped: list[dict] = []
    for c in candidates:
        if c["url"] in seen:
            continue
        seen.add(c["url"])
        deduped.append(c)
    deduped.sort(key=lambda c: c["score"], reverse=True)

    # Read before choosing (2026-08-26): fetch the top direct-PDF candidates,
    # extract their first pages, and let the canonical text cascade judge
    # whether each is THE manual for (make, model). A judged match wins and is
    # already byte-validated; a judged rejection is returned unvalidated so the
    # caller holds it for review (DOC-003) instead of downloading a brochure.
    # Any judge failure leaves the legacy HEAD-validate path below untouched.
    judged_any = False
    rejected_out: list[dict] = []
    if _judge.judge_enabled():
        ranked = await _judge.judge_candidates(make, model, deduped)
        rejected = [
            {"url": c["url"], "reason": (c.get("judge") or {}).get("reason", "")}
            for c in ranked
            if _judge.is_rejected(c)
        ]
        judged_any = bool(rejected) or any(_judge.is_match(c) for c in ranked)
        rejected_out = rejected
        top = ranked[0]
        if _judge.is_match(top):
            code, line = _judge.judge_summary(top)
            top["reason"], top["reason_detail"] = code, line
            top["judged_rejected"] = [r for r in rejected if r["url"] != top["url"]]
            top["validated"] = True
            return top
        # No judged match. Rejections are NEVER returned as validated; the
        # legacy HEAD path below may still pick an UNJUDGED candidate — but
        # only one that at least names the make/model. If every relevant
        # candidate was read and rejected, say so (top rejection + reasons)
        # rather than surfacing an unread stranger.
        unread = [c for c in ranked if not _judge.is_rejected(c)]
        deduped = [c for c in unread if _judge.relevant(c, make, model)]
        if not deduped and rejected:
            deduped = []
        elif not deduped:
            deduped = unread
        if not deduped:
            worst = next((c for c in ranked if _judge.is_rejected(c)), ranked[0])
            code, line = _judge.judge_summary(worst)
            worst["reason"], worst["reason_detail"] = code, line
            worst["judged_rejected"] = rejected
            worst["validated"] = False
            return worst

    # HEAD-validate the top few; first one that confirms PDF wins.
    for c in deduped[:5]:
        if c.get("validated") or await validate_pdf(c["url"]):
            c["validated"] = True
            if _judge.judge_enabled():
                # The judge is on but this candidate was never READ (fetch
                # blocked / too big / no text / provider down). A byte-valid
                # PDF nobody has read is not a manual we vouch for: hold it for
                # review unless it sits on the manufacturer's own host. (Live
                # 2026-08-26: this path handed back a state tax form and an
                # education-archive PDF as validated=True.)
                c.setdefault("reason", _judge.REASON_JUDGE_UNAVAILABLE)
                c["reason_detail"] = (
                    "Judged candidates were rejected; this one could not be read — review before use."
                    if judged_any
                    else "Could not read the candidate PDF — review before use."
                )
                c["validated"] = _is_oem_host(c.get("host") or "", make)
                c["judged_rejected"] = rejected_out
            else:
                c.setdefault("reason", "ok")
            return c

    # Nothing validated — return the top scorer as a candidate so the
    # caller can hold it for human review. Never promote an unvalidated
    # candidate to a trusted manual link.
    deduped[0]["validated"] = False
    return deduped[0]


from . import judge as _judge  # noqa: E402 — circular-safe: judge imports this module lazily
