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
import contextvars
import ipaddress
import json
import logging
import os
import re
import socket
import ssl
import time
from collections.abc import Callable, Generator, Iterable
from contextlib import contextmanager
from dataclasses import dataclass, field
from urllib.parse import unquote, urljoin, urlparse, urlsplit

import httpcore
import httpx

from . import quota as _quota

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
    # SMC publishes manuals on regional first-party hosts. Verified 2026-09-29:
    # discovery found the VQ(C)1000 instruction manual at static.smc.eu, but
    # with only smcusa.com listed it scored as non-OEM and stopped at review.
    "smc": ("smcusa.com", "smc.eu", "smcworld.com", "smcetech.com"),
    "smc corporation": ("smcusa.com", "smc.eu", "smcworld.com", "smcetech.com"),
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
    # #4402: Emerson took over GE's PLC/HMI line (GE Fanuc -> GE Intelligent
    # Platforms -> Emerson); technicians read "GE Fanuc" off the hardware and the
    # manuals are served from www.emerson.com. Exact keys only. Never a bare
    # "ge" or "general electric": GE's motor, relay and power lines are not
    # Emerson's, and an entry here makes Emerson's site count as the maker's own
    # documentation (the auto-import gate).
    "emerson": ("emerson.com",),
    "emerson automation solutions": ("emerson.com",),
    "emerson process management": ("emerson.com",),
    # Not "emerson electric": also the old motor brand (now Nidec / US Motors).
    "ge fanuc": ("emerson.com",),
    "ge intelligent platforms": ("emerson.com",),
    "ge automation": ("emerson.com",),
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
        # Preprint servers are never equipment documentation (2026-09-29: an
        # MG17 gearbox search returned a bioRxiv tissue-imaging paper).
        "biorxiv.org",
        "medrxiv.org",
        "arxiv.org",
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
# door is this form). A curated, static link: the technician's own browser
# opens it. The server never fetches it (Manual-First PRD R7, Codex G1 —
# the old live probe read an uncapped body before any search admission).
OEM_MANUAL_REQUEST: dict[str, str] = {
    "keyence": "https://www.keyence.com/support/user/safety/manual/",
    "harrington": "https://www.harringtonhoists.com/owners-manual-request",
    "harrington hoists": "https://www.harringtonhoists.com/owners-manual-request",
    "harrington hoists and cranes": "https://www.harringtonhoists.com/owners-manual-request",
}


async def oem_request_link(make: str) -> str | None:
    """A curated manual-request page or known OEM domain, or None.

    No network I/O: the link comes only from the OEM directory, never from
    search results, and is opened by the technician's browser. Kept async so
    existing awaiting callers are unchanged."""
    curated = OEM_MANUAL_REQUEST.get(_norm(make))
    domains = _oem_domains_for(make)
    return curated or (f"https://{domains[-1]}/" if domains else None)


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _oem_domains_for(make: str) -> tuple[str, ...]:
    return OEM_DOMAINS.get(_norm(make), ())


def _is_oem_host(host: str, make: str) -> bool:
    """True if `host` (case-insensitive) is on the OEM list for `make`."""
    host = host.lower()
    return any(host == d or host.endswith("." + d) for d in _oem_domains_for(make))


def _make_spellings(make: str) -> set[str]:
    """The make, plus the spellings that share its OEM_DOMAINS entry
    ("AutomationDirect" and "Automation Direct")."""
    m = _norm(make)
    domains = OEM_DOMAINS.get(m)
    return {m} | ({k for k, v in OEM_DOMAINS.items() if v == domains} if domains else set())


# What may join the words of a make name: "Automation-Direct", "Automation_Direct"
# and a "+" slug are "Automation Direct" (#5826). A slash, a bar, a colon or a full
# stop may not, so "Home Automation | Direct-Drive" and "/automation/direct-drive"
# still do not name it.
_MAKE_JOINER = r"[\s\-_+]{1,3}"


def _make_name_pattern(name: str) -> str | None:
    """A whole-name pattern for one spelling of a make: its words in order, any gap
    of spaces, hyphens, underscores or "+" between them matching any such gap, and
    any other gap ("Co., Ltd.") matching only itself. No letter or digit may touch
    either end; an underscore there ends the name, as a hyphen does."""
    spans = [m.span() for m in re.finditer(r"[^\W_]+", name)]
    if len(name) < 2 or not spans:
        return None
    out = [re.escape(name[spans[0][0] : spans[0][1]])]
    for (_, end), (start, stop) in zip(spans, spans[1:]):
        gap = name[end:start]
        out.append(_MAKE_JOINER if re.fullmatch(r"[\s\-_+]+", gap) else re.escape(gap))
        out.append(re.escape(name[start:stop]))
    return r"(?<![^\W_])" + "".join(out) + r"(?![^\W_])"


def _names_make(c: dict, make: str) -> bool:
    """Whether the title or the URL path names the make as a whole name.

    A fragment does not count: "direct" in "Direct-Drive Amplifier" is not
    "Automation Direct" (#5789 Codex F1), while "GE" in "GE 5KS184SAA205 Motor
    Manual" is GE. The words of a make name may be joined by a space, hyphen,
    underscore or "+" (#5826). The host is not read: ".ge" in a Georgian catalog's
    domain is not GE (#5826), and the make's own site is `_is_oem_host`'s job. The
    query and the fragment are not read either. Title and path are the texts the
    part-number check reads (`_part_number_texts`), each read on its own; when the
    URL cannot be parsed only the title is read. The spellings are folded the way
    those texts are, so "Allen‑Bradley" typed with a non-breaking hyphen still
    names itself (#5890 F4)."""
    texts = _part_number_texts(c)
    if texts is None:
        texts = ((c.get("title") or "").translate(_CATALOG_HYPHENS).lower(),)
    spellings = {s.translate(_CATALOG_HYPHENS) for s in _make_spellings(make)}
    patterns = [p for p in map(_make_name_pattern, spellings) if p]
    return any(re.search(p, text, re.I) for p in patterns for text in texts)


# What may follow a part number without making it a longer one (#5827, #5837).
# A letter or digit may not, as before ("GS10-20P5X"), and neither may an order
# option ("+B063"): those two always name a different part. Nor may a further code
# group after a hyphen, underscore or dash: a group with a digit ("-2", "_B063") or
# of one or two letters ("-X"). A space, punctuation, a path or file-extension
# separator, or a word ("-user-manual") still ends it.
_DIFFERENT_PART = r"(?:[a-z0-9]|\+[a-z0-9])"
_CODE_GROUP = r"(?:[\-_\u2013\u2014\ufe58](?:[a-z0-9]*\d|[a-z]{1,2}(?![a-z0-9])))"
_PART_NUMBER_END = "(?!" + _DIFFERENT_PART + "|" + _CODE_GROUP + ")"

# The Hub's catalog hyphens (mira-hub/src/capabilities/detection-fold.ts
# HYPHEN_EQUIV_CHARS) read as "-" for the match only (#5843). An en or em dash is
# not one, as in the Hub: it joins no groups, though it still starts a code group.
_CATALOG_HYPHENS = str.maketrans(dict.fromkeys("\u2010\u2011\u2012\u2212\ufe63\uff0d", "-"))

# No query value is read, in either direction (#5855 round 3). A referral or
# related-file value may name another part, so it cannot admit a page (#5853), and
# a product page can carry a related file's name there, so it cannot refuse one
# either (#5855 Codex F7). A real PDF behind a download endpoint is still found by
# the content probe, which runs before this screen. A path parameter, the fragment
# and the host are not read either.


def _part_number_texts(c: dict) -> tuple[str, str] | None:
    """An unread page's title and its URL path (percent-decoded, cut at a decoded
    "?" or "#", without ";" parameters), each folded for the match. None when the
    URL cannot be parsed, so the page is refused."""
    try:
        url = urlsplit(c.get("url") or "")
    except ValueError:
        return None
    path = re.split(r"[?#]", unquote(url.path), maxsplit=1)[0]
    path = re.sub(r";[^/]*", "", path)

    def fold(text: str) -> str:
        return text.translate(_CATALOG_HYPHENS).lower()

    return fold(c.get("title") or ""), fold(path)


def _names_part_number(c: dict, part_number: str) -> bool:
    """Whether the page names the whole part number, allowing the usual separator
    differences ("GS10-20P5", "GS10 20P5", "GS1020P5") but not a prefix of it
    ("GS10") or a longer number that starts with it ("GS10-20P5X", "GS10-20P5-X",
    "ACS355-03U-06A7-2+B063").

    Only the title or the URL path can name it, and each is read on its own (#5842):
    - a title that names a longer number and not the exact one is about a different
      part, whatever the URL says. A title that lists the exact part as well still
      covers it ("GS10-20P5 and GS10-20P5X user manual");
    - a URL path with an attached letter, digit or "+" option names a different part
      that a shortened title cannot outvote. A code group after a hyphen there does
      not refuse a clean title, because slugs join words that way
      ("Gis-Gs10-150-260" for "Gis GS10/150/260").
    Only the match reads the decoded forms, never the fetch or the display."""
    chunks = re.findall(r"[a-z0-9]+", (part_number or "").lower())
    texts = _part_number_texts(c) if chunks else None
    if texts is None:
        return False
    title, path = texts
    number = r"(?<![a-z0-9])" + r"[\s\-_./]*".join(map(re.escape, chunks))
    exact = re.compile(number + _PART_NUMBER_END)
    longer_title = re.search(number + "(?=" + _DIFFERENT_PART + "|" + _CODE_GROUP + ")", title)
    if longer_title and not exact.search(title):
        return False
    different = re.compile(number + "(?=" + _DIFFERENT_PART + ")")
    if different.search(path):
        return False
    return bool(exact.search(title) or exact.search(path))


def _may_offer_unread(c: dict, make: str, part_number: str | None = None) -> bool:
    """Whether a candidate that did not prove to be the manual may still be offered for review.

    A web page is never read, so all it shares with the machine may be the model
    string: "GS10" is an AutomationDirect drive and a Boss Audio amplifier (#5789).
    Such a page is offered only if it names the confirmed make, sits on that make's
    own site, or names the whole exact part number when the lookup is for one. A
    direct PDF keeps the older rule, since the judge tried to read it, and so does
    anything the content probe found to be a PDF; the caller only screens what did
    not probe as one. A link that only looks like a PDF loses that rule once the
    probe got a successful answer that is a page, and it is screened as one
    (#5830). The caller skips this check when there is no make.
    """
    if c.get("is_direct_pdf") and not c.get("probed_not_pdf"):
        return True
    host = c.get("host") or urlparse(c.get("url") or "").netloc
    if _names_make(c, make) or _is_oem_host(host, make):
        return True
    return bool(part_number) and _names_part_number(c, part_number)


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
    if parsed.scheme not in ("http", "https"):
        return -1  # never a candidate: it is rendered as a tappable link downstream
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


# ── Provider-query budget (Manual-First PRD R13, Codex G2) ───────────────────
#
# One search_manual() call can send pass 1, one pass-2 query per model variant
# (up to 4), and pass 3 — six paid provider queries. Caps and the dollar
# budget must count those queries, not operations. A caller opens a budget
# around its search_manual() call; every query checks and spends it here, at
# the single place a query leaves this process. A query past the ceiling is
# not sent and reads as "no results" to the caller.
_DEFAULT_MAX_PROVIDER_QUERIES = 4


def max_provider_queries() -> int:
    """Per-call ceiling on provider queries (MANUAL_SEARCH_MAX_PROVIDER_QUERIES)."""
    try:
        n = int(os.environ.get("MANUAL_SEARCH_MAX_PROVIDER_QUERIES", ""))
    except ValueError:
        return _DEFAULT_MAX_PROVIDER_QUERIES
    return n if n >= 1 else _DEFAULT_MAX_PROVIDER_QUERIES


@dataclass
class ProviderQueryBudget:
    limit: int
    used: int = 0
    refused: int = 0
    # Set to the quota denial reason ("user_cap"/"tenant_cap"/"global_cap"/
    # "quota_unavailable"/"no_identity") the FIRST time one occurs in this
    # call. Once set, every remaining query in the call is refused WITHOUT
    # touching Postgres again — a DB outage must not cost up to six
    # connect-timeouts inside one search_manual() call (#4160 S4).
    quota_denied: str | None = None
    # Candidate documents this call actually EXAMINED — read by the judge or
    # HEAD-validated — keyed by URL (#4160 R15, Codex #4194 F4). Recorded as
    # they are examined, so a timeout keeps the partial count.
    examined: set[str] = field(default_factory=set)


_provider_budget: contextvars.ContextVar[ProviderQueryBudget | None] = contextvars.ContextVar(
    "manual_search_provider_budget", default=None
)


def _note_examined(urls: Iterable[str]) -> None:
    """Record candidate documents examined in this call (no-op outside a budget)."""
    budget = _provider_budget.get()
    if budget is not None:
        budget.examined.update(urls)


@contextmanager
def provider_query_budget(limit: int | None = None) -> Generator[ProviderQueryBudget]:
    """Scope one search_manual() call to at most `limit` provider queries.

    The budget object is mutable, so tasks spawned inside the block (e.g.
    asyncio.wait_for) spend the same budget; read `.used` after the call."""
    budget = ProviderQueryBudget(limit=limit or max_provider_queries())
    token = _provider_budget.set(budget)
    try:
        yield budget
    finally:
        _provider_budget.reset(token)


# ── Acquisition trail (Golden Walk 2026-10-05) ──────────────────────────────
#
# Why did THIS document win? Until now the answer lived only in mira-ask log
# lines nobody can read on staging (ABB ACS580 picked a Portuguese manual on
# staging and an English one in every local replay). A caller opens a trail
# around its search_manual() call; the search records what it asked, every
# candidate it considered, how each one was read, how they ranked and why the
# judge stopped. Observability only: nothing here changes which candidate wins.
TRAIL_VERSION = 1
TRAIL_MAX_CANDIDATES = 20
_TRAIL_JUDGE_FIELDS = (
    "is_manual",
    "doc_type",
    "scope",
    "lists_fault_codes",
    "language",
    "text_language",
    "fault_heading",
    "confidence",
    "provider",
    "model",
)


def trail_url(url: str) -> str:
    """The URL without its query string or fragment: signed download tokens
    (ABB's ``x-sign``) are credentials-like and would make one document look
    like many."""
    p = urlparse(url or "")
    return f"{p.scheme}://{p.netloc}{p.path}" if p.scheme and p.netloc else (url or "")[:200]


@dataclass
class AcquisitionTrail:
    # Browser handoff only, never a manual candidate or source-admission signal.
    search_page_url: str | None = None
    search_page_score: int = -1
    queries: list[dict] = field(default_factory=list)
    candidates: list[dict] = field(default_factory=list)  # the deduped pool, mutated by the judge
    ranked: list[dict] | None = None
    judge: dict = field(default_factory=dict)  # filled by judge_candidates(trace=...)

    def to_dict(self, selected_url: str | None = None) -> dict:
        order = self.ranked if self.ranked is not None else self.candidates
        queued = {u: i for i, u in enumerate(self.judge.get("queue") or [])}
        not_queued = self.judge.get("not_queued") or {}
        rows = []
        for rank, c in enumerate(order):
            j = c.get("judge") or {}
            url = c.get("url", "")
            row = {
                "rank": rank,
                "url": trail_url(url),
                "host": c.get("host", ""),
                "title": (c.get("title") or "")[:120],
                "score": c.get("score"),
                "pass": c.get("pass"),
                "direct_pdf": bool(c.get("is_direct_pdf")),
                "queue_pos": queued.get(url),
                "not_queued": not_queued.get(url),
                "read": j.get("status") or "unread",
                "read_reason": None if j.get("status") == "judged" else j.get("reason"),
                "selected": bool(selected_url) and url == selected_url,
            }
            if j.get("status") == "judged":
                row.update({k: j.get(k) for k in _TRAIL_JUDGE_FIELDS})
            rows.append(row)
        return {
            "version": TRAIL_VERSION,
            "queries": self.queries,
            "stop": self.judge.get("stop"),
            "candidates": _capped_keeping_winner(rows),
            "candidate_count": len(rows),
        }


def _capped_keeping_winner(rows: list[dict]) -> list[dict]:
    """The first TRAIL_MAX_CANDIDATES rows, but never without the winner: a fallback
    winner ranked past the cap takes the last slot, keeping its real rank (Codex
    #4253 F1)."""
    kept = rows[:TRAIL_MAX_CANDIDATES]
    if any(r["selected"] for r in kept):
        return kept
    winner = next((r for r in rows if r["selected"]), None)
    return kept if winner is None else kept[: TRAIL_MAX_CANDIDATES - 1] + [winner]


_trail: contextvars.ContextVar[AcquisitionTrail | None] = contextvars.ContextVar(
    "manual_search_trail", default=None
)


@contextmanager
def acquisition_trail() -> Generator[AcquisitionTrail]:
    """Record one search_manual() call's queries, candidates and ranking."""
    trail = AcquisitionTrail()
    token = _trail.set(trail)
    try:
        yield trail
    finally:
        _trail.reset(token)


async def _serper_search(query: str, num: int = 10) -> list[dict]:
    """The one place a provider query leaves this process.

    Order matters (code-review follow-up, #4160 S4): the per-call ceiling is checked FIRST
    (free — no I/O) and does not touch the quota accounting at all. Only a
    query that passes the ceiling spends a Postgres reservation. `used` is
    incremented ONLY on an actual send, so a quota-denied query is never
    double-counted as both used and refused.
    """
    if not SERPER_API_KEY:
        raise RuntimeError("SERPER_API_KEY is not configured")
    budget = _provider_budget.get()
    if budget is not None:
        if budget.used >= budget.limit:
            budget.refused += 1
            logger.info(
                "MANUAL_SEARCH_PROVIDER_CEILING limit=%d refused_query=%s",
                budget.limit,
                query[:120],
            )
            return []
        if budget.quota_denied is not None:
            # A prior query in THIS call already hit the quota gate — stop
            # re-reserving (see the ProviderQueryBudget.quota_denied comment).
            budget.refused += 1
            return []

    identity = _quota.current_quota_identity()
    if identity is None:
        # PRD R14: a caller that cannot supply a tenant/user identity gets no
        # web search at all — never invent one. The bot-vision web rung
        # (shared/visual/equipment.py) supplies none and is meant to land here.
        if budget is not None:
            budget.refused += 1
            budget.quota_denied = "no_identity"
        logger.info("MANUAL_SEARCH_QUOTA_DENIED reason=no_identity")
        return []

    reason = await _quota.reserve_provider_query(identity)
    if reason != "ok":
        if budget is not None:
            budget.refused += 1
            budget.quota_denied = reason
        logger.info("MANUAL_SEARCH_QUOTA_DENIED reason=%s", reason)
        return []

    if budget is not None:
        budget.used += 1
    return await _serper_post(query, num)


async def _serper_post(query: str, num: int) -> list[dict]:
    """The one paid provider request. Only _serper_search calls it."""
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
# and reads are streamed with a hard byte cap. DNS rebinding between the check
# and the connect is closed by _PinnedNetworkBackend below (#4160 S3a): the
# connection dials the address that passed the check, never a second lookup.

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


# ── DNS resolve-and-pin (Manual-First PRD R6, #4160 S3a) ─────────────────────
#
# _url_is_probeable resolves the name and checks it, but the socket layer used
# to resolve it AGAIN at connect time — a rebinding host could answer "public"
# to the check and "10.0.0.5" to the connect. This backend closes that window:
# it resolves once, refuses the connection if ANY answer is non-public, and
# dials the checked address. httpcore still passes the URL hostname as the TLS
# server_hostname, so SNI and certificate/hostname verification are unchanged.
# Every redirect hop and every retry opens its connection through here.


def _inner_network_backend() -> httpcore.AsyncNetworkBackend:
    """The real socket layer (test seam: tests swap in a recorder)."""
    return httpcore.AnyIOBackend()


def _resolve_public(host: str, port: int) -> list[str]:
    """Sync (DNS-blocking) — call via asyncio.to_thread. Returns every checked
    public address for `host` (answer order, de-duplicated), or raises
    ConnectError if resolution fails or ANY answer is non-public."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError as e:
        raise httpcore.ConnectError(f"manual-search dns failed for {host[:80]}") from e
    addrs = list(dict.fromkeys(str(info[4][0]).split("%")[0] for info in infos))
    if not addrs:
        raise httpcore.ConnectError(f"manual-search dns empty for {host[:80]}")
    for a in addrs:
        try:
            public = _ip_is_public(ipaddress.ip_address(a))
        except ValueError:
            public = False
        if not public:
            raise httpcore.ConnectError(
                f"manual-search connect blocked: {host[:80]} -> non-public address"
            )
    return addrs


# RFC 8305 "Connection Attempt Delay" — the stagger between address attempts.
_HAPPY_EYEBALLS_DELAY_S = 0.25


class _PinnedNetworkBackend(httpcore.AsyncNetworkBackend):
    def __init__(self) -> None:
        self._inner = _inner_network_backend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        # One deadline covers resolution AND dialing, as AnyIOBackend's own
        # fail_after did before pinning (#4163 Codex F2). The checked addresses
        # are then raced happy-eyeballs style, so a dead or stalled first address
        # (e.g. a broken IPv6 route) falls back without re-resolving (Codex F1/r2).
        loop = asyncio.get_running_loop()
        deadline = None if timeout is None else loop.time() + timeout

        def remaining() -> float | None:
            return None if deadline is None else deadline - loop.time()

        try:
            addrs = await asyncio.wait_for(
                asyncio.to_thread(_resolve_public, host, port), remaining()
            )
        except TimeoutError as e:
            raise httpcore.ConnectTimeout(f"manual-search dns timed out for {host[:80]}") from e
        return await self._staggered_connect(
            host, addrs, port, remaining, local_address, socket_options
        )

    async def _staggered_connect(self, host, addrs, port, remaining, local_address, socket_options):
        """Happy-eyeballs over the CHECKED literals (#4163 Codex r2): start the
        next address after _HAPPY_EYEBALLS_DELAY_S (or at once when an attempt
        fails), first success wins, losers are cancelled and closed. A stalled
        first address can no longer eat the whole connect budget."""

        async def attempt(ip: str):
            return await self._inner.connect_tcp(
                ip,
                port,
                timeout=remaining(),
                local_address=local_address,
                socket_options=socket_options,
            )

        pending: set[asyncio.Task] = set()
        errors: list[BaseException] = []
        winner = None
        idx = 0
        try:
            while winner is None:
                if idx < len(addrs):
                    pending.add(asyncio.ensure_future(attempt(addrs[idx])))
                    idx += 1
                if not pending:
                    break  # every address failed
                left = remaining()
                if left is not None and left <= 0:
                    break  # overall deadline
                wait = _HAPPY_EYEBALLS_DELAY_S if idx < len(addrs) else left
                if left is not None and wait is not None:
                    wait = min(wait, left)
                done, pending = await asyncio.wait(
                    pending, timeout=wait, return_when=asyncio.FIRST_COMPLETED
                )
                for t in done:
                    if t.exception() is not None:
                        errors.append(t.exception())
                    elif winner is None:
                        winner = t.result()
                    else:
                        await t.result().aclose()  # a second success loses: close it
        finally:
            for t in pending:
                t.cancel()
            for t in pending:
                try:
                    loser = await t
                except BaseException:  # noqa: BLE001 — cancelled/failed losers are expected
                    continue
                if loser is not winner:
                    await loser.aclose()
        if winner is not None:
            return winner
        left = remaining()
        if left is not None and left <= 0:
            raise httpcore.ConnectTimeout(f"manual-search connect timed out for {host[:80]}")
        last = errors[-1] if errors else None
        raise httpcore.ConnectError(f"manual-search could not connect to {host[:80]}") from last

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise httpcore.ConnectError("manual-search never connects to unix sockets")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


def _probe_transport() -> httpx.AsyncBaseTransport:
    """Transport for every probe/fetch of an untrusted URL: the pinned backend
    with TLS verification on. The test seam, when set, wins."""
    if _transport_for_tests is not None:
        return _transport_for_tests
    transport = httpx.AsyncHTTPTransport()
    # httpx does not expose httpcore's network_backend; rebuild its pool with
    # the pinned backend. tests/test_manual_search_dns_pin.py asserts this
    # wiring so an httpx upgrade that moves `_pool` fails loudly instead of
    # silently resolving through the default backend again.
    transport._pool = httpcore.AsyncConnectionPool(
        ssl_context=ssl.create_default_context(),
        network_backend=_PinnedNetworkBackend(),
    )
    return transport


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


# #5830: the URLs whose probe got a successful answer that is a page (it starts with
# markup), as opposed to a probe that failed, was refused or could not tell.
# _probe_candidate sets it for one call; validate_pdf's own answer stays a bool.
_probed_not_pdf: contextvars.ContextVar[set[str] | None] = contextvars.ContextVar(
    "manual_search_probed_not_pdf", default=None
)


async def validate_pdf(url: str) -> bool:
    """Confirm the URL actually serves a PDF.

    Strategy: HEAD first, fall back to Range GET (some CDNs don't honour HEAD
    or strip Content-Type). Returns False on any error so a flaky OEM CDN
    doesn't crash the search. Every request — including every redirect hop —
    passes the SSRF guard above; the GET is streamed and capped at
    _PROBE_READ_CAP bytes so a server that ignores Range cannot make us buffer
    an arbitrary body.

    For a candidate probe (#5830), a PDF content type is trusted only until the
    bytes say otherwise: the GET is still read, and a successful answer that
    starts with markup is a page, whatever type it was served as. When the bytes
    prove nothing either way, a PDF content type still validates, as before.
    Reading those bytes must not make the probe slower than the caller's
    deadline allows (each probe is budgeted HEAD_TIMEOUT): once a PDF content
    type is seen, the rest of the probe ends HEAD_TIMEOUT after it began, and
    an unfinished read leaves the content type standing.
    """
    noted = _probed_not_pdf.get()  # set only by _probe_candidate
    says_pdf = False  # a PDF content type seen during a candidate probe
    started = asyncio.get_running_loop().time()
    try:
        async with (
            asyncio.timeout(None) as confirm_by,
            httpx.AsyncClient(
                timeout=HEAD_TIMEOUT,
                follow_redirects=False,
                transport=_probe_transport(),
                trust_env=False,  # never route an untrusted probe through an env proxy
                headers={"User-Agent": "Mozilla/5.0 (compatible; mira-manual-search/0.1)"},
            ) as client,
        ):
            try:
                r = await _guarded_probe(client, "HEAD", url)
                if r is not None:
                    ct = (r.headers.get("content-type") or "").lower()
                    if "pdf" in ct and r.status_code < 400:
                        if noted is None:
                            return True
                        says_pdf = True
                        confirm_by.reschedule(started + HEAD_TIMEOUT)
            except httpx.HTTPError:
                pass

            # Some hosts 405 on HEAD or strip Content-Type — pull the first
            # bytes and look for the PDF magic number. Stream + cap: a server
            # that ignores the Range header must not be able to flood us. The
            # range asks for the whole cap, so a page whose markup follows some
            # leading whitespace is still seen as one (#5871 Codex F2).
            rng = {"Range": f"bytes=0-{_PROBE_READ_CAP - 1}"}
            current = url
            for _ in range(_MAX_REDIRECT_HOPS + 1):
                if not await asyncio.to_thread(_url_is_probeable, current):
                    logger.info("manual-search probe blocked by SSRF guard: %s", current[:120])
                    return says_pdf
                async with client.stream("GET", current, headers=rng) as r:
                    if r.status_code in (301, 302, 303, 307, 308):
                        loc = r.headers.get("location")
                        if not loc:
                            return says_pdf
                        current = urljoin(current, loc)
                        continue
                    if r.status_code >= 400:
                        return says_pdf
                    ct = (r.headers.get("content-type") or "").lower()
                    if "pdf" in ct:
                        if noted is None:
                            return True
                        if not says_pdf:
                            says_pdf = True
                            confirm_by.reschedule(started + HEAD_TIMEOUT)
                    head = b""
                    async for chunk in r.aiter_bytes():
                        head += chunk
                        if len(head) >= _PROBE_READ_CAP:
                            break
                    if head[:5] == b"%PDF-":
                        return True
                    # Not proof of a PDF. Only a successful answer that starts with
                    # markup is proof of a page (#5830); bytes before a PDF header, an
                    # empty body or an error status prove nothing either way.
                    if noted is not None and 200 <= r.status_code < 300:
                        if head.lstrip(b"\xef\xbb\xbf \t\r\n").startswith(b"<"):
                            noted.add(url)
                            return False
                    return says_pdf
            return says_pdf
    except TimeoutError:
        logger.info("PDF validation ran out of its probe budget for %s", url[:120])
        return says_pdf
    except Exception:
        logger.info("PDF validation failed for %s — skipping", url[:120])
        return says_pdf


async def _probe_candidate(c: dict) -> bool:
    """validate_pdf for one candidate. When the probe got a successful answer that is
    a page, the candidate is marked, so the make screen treats a link that only looks
    like a PDF as the page it serves (#5830)."""
    noted: set[str] = set()
    token = _probed_not_pdf.set(noted)
    try:
        ok = await validate_pdf(c["url"])
    finally:
        _probed_not_pdf.reset(token)
    if not ok and c["url"] in noted:
        c["probed_not_pdf"] = True
    return ok


def _tagged(found: list[dict], label: str) -> list[dict]:
    """Which query pass produced each candidate (acquisition trail only)."""
    for c in found:
        c["pass"] = label
    return found


def _collect(
    organic: list[dict],
    make: str,
    model: str,
    part_number: str | None = None,
    set_aside: list[dict] | None = None,
) -> list[dict]:
    """Score and keep the hits worth a candidate, exactly as main does.

    On a part-number lookup, `_score` looks for the hyphenated spelling only, so a
    hit that names the whole number another way ("6ES7214_1AG40_0XB0", as
    `_names_part_number` reads it) and has no other credit scores 0 and is dropped
    (#5829). Such a hit is appended to ``set_aside`` instead. It is never a
    candidate, so it changes nothing the search reads, sends or answers; the search
    offers it only where it would otherwise end with no manual (#5890 F1, F5)."""
    out: list[dict] = []
    for hit in organic:
        url = hit.get("link") or ""
        title = hit.get("title") or ""
        if not url:
            continue
        s = _score(url, title, make, model)
        if s <= 0:
            if (
                s == 0
                and part_number
                and set_aside is not None
                and _norm(part_number) not in f"{title} {url}".lower()
                and _names_part_number({"url": url, "title": title}, part_number)
            ):
                set_aside.append(_candidate(url, title, s))
            continue
        out.append(_candidate(url, title, s))
    return out


def _candidate(url: str, title: str, score: int) -> dict:
    return {
        "url": url,
        "title": _clean_title(title),
        "host": urlparse(url).netloc,
        "score": score,
        "doc_type": _guess_doc_type(title, url),
        "is_direct_pdf": _is_direct_pdf(url),
    }


class ManualSearchUnavailable(RuntimeError):
    """Every search pass failed: the search could not run (#4150 F3).

    Distinct from ``None`` (the search ran and found nothing), so a caller can
    tell a technician "I couldn't search" instead of "there is no manual".
    """


async def search_manual(
    make: str,
    model: str,
    deadline_at: float | None = None,
    identification_link: str | None = None,
    exact_part_number: bool = False,
) -> dict | None:
    """Multi-pass real-time search for a (make, model) manual.

    Returns the best HEAD-validated PDF candidate, or a lower-confidence
    unvalidated candidate (``validated=False``) if nothing HEAD-validates,
    or ``None`` if nothing scored at all. Callers MUST check ``validated``
    and ``is_direct_pdf`` before treating a result as a trustable manual
    link — this function never decides trust on the caller's behalf.

    ``deadline_at`` (``time.monotonic()`` seconds) is the caller's own timeout; the
    judge's optional upgrade batch is capped by it so a timeout never costs the
    match already found.

    ``identification_link`` is a URL decoded from the nameplate's own QR code
    (#5070). It joins the pool as the top-ranked candidate ONLY when it is https
    on the OEM list for ``make``; it never changes the queries (the nameplate
    reading drives them) and, like any hit, must validate to be trusted.

    ``exact_part_number`` says ``model`` is a full catalog number read off a label
    (the photo part search). An unread page that names that whole number may be the
    part, so it passes the make check on unread pages (#5789), which exists because
    short model strings are reused by other makers. A page naming less than the
    whole number is checked like any other.
    """
    started_at = time.monotonic()  # the judge's upgrade deadline counts from here
    make = (make or "").strip()
    model = (model or "").strip()
    if not (make or model):
        return None
    screen_unread = bool(make)
    part_number = model if exact_part_number else None

    candidates: list[dict] = []
    # Pages the search leaves aside although they name the make, or on a part-number
    # lookup the whole part number, in a spelling the judge's relevance check and
    # `_score` miss (#5826, #5829). They get a turn only where the search would end
    # without a manual (`_unless_extras`), so they never change what it reads, sends,
    # retries or answers before then (#5890 round 2).
    set_aside: list[dict] = []  # hits `_collect` drops
    retry_extras: list[dict] = []  # extra PDFs the typed-pass retry did not read
    retry_read: list[dict] = []  # PDFs the typed-pass retry sent to the judge

    def _rejected_documents() -> set[tuple[str, str]]:
        """Every PDF this search has read and the judge rejected, in any round, as
        :func:`_judge.same_document_key`. A form of one of these is never read again or
        offered unread: the server never sees a fragment, so the judge would get the
        text it already rejected, under the same title (#5850, #5900, #5897). Round
        one's reads and the extra reads are in ``candidates``; the retry's are kept in
        ``retry_read``, since its result is discarded on a miss."""
        return {
            _judge.same_document_key(c) for c in (*candidates, *retry_read) if _judge.is_rejected(c)
        }

    def _extra(c: dict) -> bool:
        """The judge's relevance check misses it, but it names the make as a whole
        name in another joining ("Automation-Direct" for "AutomationDirect") or, on a
        part-number lookup, the whole number in another spelling."""
        return not _judge.relevant(c, make, model) and (
            _names_make(c, make) or bool(part_number and _names_part_number(c, part_number))
        )

    async def _judged_extra(pdfs: list[dict], rejected: list[dict]) -> dict | None:
        """Read ``pdfs`` in whatever time the deadline leaves and return a judged match
        among them, with ``rejected`` and the new rejections; otherwise None."""
        if not pdfs:
            return None
        trace: dict = {}
        try:
            read = await _judge.judge_candidates(
                make,
                model,
                pdfs,
                started_at=started_at,
                deadline_at=deadline_at,
                trace=trace,
            )
        finally:
            if trail is not None:
                # One trail for every round, as for the retry: these queue
                # positions follow the others, a URL keeps the first position it
                # was queued at, a PDF queued here is no longer listed as not
                # queued, and one this round left out carries this round's reason
                # unless an earlier round queued it (#5899 Codex F2).
                queued = list(trace.get("queue") or [])
                prior = list(trail.judge.get("queue") or [])
                queue = prior + [u for u in queued if u not in prior]
                trail.judge["queue"] = queue
                not_queued = trail.judge.setdefault("not_queued", {})
                for u in queued:
                    not_queued.pop(u, None)
                for u, why in (trace.get("not_queued") or {}).items():
                    if u not in queue:
                        not_queued[u] = why
                if trace.get("stop"):
                    trail.judge["stop"] = trace["stop"]
        if read and _judge.is_match(read[0]):
            return _as_judged_match(read[0], rejected + _rejections(read))
        return None

    async def _exact_part_match(pool: list[dict], rejected: list[dict]) -> dict | None:
        """Main is about to offer a candidate it could not validate (#5895). On a
        part-number lookup, the unread PDFs in ``pool`` that name the whole number in a
        spelling the judge's relevance check misses are read first, and a judged match
        among them is returned. Otherwise None, and main's offer stands. PDFs naming
        only the make still wait for main's miss endings (``_unless_extras``)."""
        if not part_number:
            return None
        # A form of a PDF the judge read and rejected is not read again (#5899 Codex F1).
        rejected_documents = _rejected_documents()
        pdfs = [
            c
            for c in pool
            if c.get("is_direct_pdf")
            and not c.get("judge")
            and not _judge.relevant(c, make, model)
            and _names_part_number(c, part_number)
            and _judge.same_document_key(c) not in rejected_documents
        ]
        return await _judged_extra(pdfs, rejected)

    async def _unless_extras(
        answer: Callable[[], dict | None],
        pool: list[dict],
        judged: bool,
        rejected: list[dict],
    ) -> dict | None:
        """The search is about to end with no manual. ``answer`` gives what it
        returns there: a judged rejection, or nothing.

        With the judge on, the extra PDFs in ``pool`` and from the retry that were
        never read are read first, in whatever time the deadline leaves, and a judged
        match among them is returned. Otherwise ``answer`` stands, untouched. Where
        that is nothing, the first extra page in ``pool`` or ``set_aside`` the make
        screen accepts is offered unread, as the search offers an unread page. The
        retry's extras are read but never offered (#5844 Codex F5, F6).

        A form of a document the judge rejected, in any round, is neither read nor
        offered (#5900, #5897)."""
        extras = [c for c in pool if _extra(c)]
        if judged:
            rejected_documents = _rejected_documents()
            pdfs = [
                c
                for c in (*extras, *retry_extras)
                if c.get("is_direct_pdf")
                and not c.get("judge")
                and _judge.same_document_key(c) not in rejected_documents
            ]
            match = await _judged_extra(pdfs, rejected)
            if match is not None:
                return match
        result = answer()
        if result is not None:
            return result
        # After the reads above, whose rejections count too: a form of a rejected
        # document that went unread (its read failed) is that rejection (#5897).
        rejected_documents = _rejected_documents()
        # A set-aside hit whose URL is also a candidate is that candidate's business.
        offered = {c["url"] for c in candidates} - {c["url"] for c in extras}
        for c in (*extras, *set_aside):
            if (
                c["url"] in offered
                or _judge.is_rejected(c)
                or _judge.same_document_key(c) in rejected_documents
            ):
                continue
            offered.add(c["url"])
            # Every unread offer goes through the one make screen. It cannot refuse
            # one of these today, since each names the make or the whole part number,
            # but a stricter screen must apply to them too.
            if screen_unread and not _may_offer_unread(c, make, part_number):
                continue
            c["validated"] = False
            if judged:
                c.setdefault("reason", _judge.REASON_JUDGE_UNAVAILABLE)
                c.setdefault(
                    "reason_detail", "Could not read the candidate PDF — review before use."
                )
                c["judged_rejected"] = rejected
            return c
        return None

    # Availability is judged from requests actually SENT (#4171 Codex F2): a
    # pass refused by the per-call ceiling or the quota returns [] without a
    # request, and must not count as "searched and found nothing" — otherwise a
    # total provider outage reads as "no manual exists".
    sent = 0
    failures = 0

    trail = _trail.get()

    async def _website_handoff(
        ranked: list[dict] | None = None, judge_trace: dict | None = None
    ) -> bool:
        # On a miss, look for the make's own website to hand the technician, unless
        # one was already found or this same query was already sent in this call.
        # ``ranked`` and ``judge_trace`` are passed where the typed-pass retry follows.
        # Returns True only when the send was cut off where that retry follows.
        query = f"{make} {model} manual support"
        if (
            trail is not None
            and not trail.search_page_url
            and not any(q.get("query") == query for q in trail.queries)
            and (deadline_at is None or deadline_at - time.monotonic() > SEARCH_TIMEOUT)
        ):
            # The handoff only adds a support page, so it must answer while the return
            # still fits, or it is abandoned and the search's answer stands (#5848).
            # Where the typed-pass retry follows and can still start, the retry may find
            # the manual, so it keeps its whole window plus a return reserve, and the
            # handoff gets what is left. A window no longer than one more return reserve
            # is not worth a query, so the handoff is then not sent (#5866 Codex F2).
            # The retry condition is `_manual_from_retry`'s own. Only the cutoff's own
            # expiry becomes TimeoutError, so a caller's cancellation still propagates.
            retry_follows = (
                ranked is not None
                and use_judge
                and not typed_pass_ran
                and _every_queued_pdf_rejected(ranked, judge_trace or {})
            )
            cutoff = None
            if deadline_at is not None:
                left = deadline_at - time.monotonic()
                retry_window = SEARCH_TIMEOUT + _judge.UPGRADE_MIN_BATCH_S
                retry_window += _judge.RETURN_RESERVE_S
                if retry_follows and left >= retry_window:
                    cutoff = left - retry_window - _judge.RETURN_RESERVE_S
                    if cutoff <= _judge.RETURN_RESERVE_S:
                        logger.info("MANUAL_SEARCH_HANDOFF_SKIPPED_FOR_RETRY")
                        return False
                else:
                    cutoff = left - _judge.RETURN_RESERVE_S
            try:
                async with asyncio.timeout(cutoff):
                    await _send(query, "q3 (website handoff)")
            except TimeoutError:
                logger.info("MANUAL_SEARCH_HANDOFF_CUTOFF")
                trail.queries.append({"pass": "q3", "query": query, "result": "timeout"})
                return retry_follows
        return False

    def _unfinished_after_handoff_cutoff(stalled: bool, retried: dict | None) -> None:
        """After a handoff cut off before the typed-pass retry, a retry that did not
        finish ends as main ends a stalled search, unless it found the manual: in the
        timeout the caller reports as a retryable outage. A judged rejection there
        would be recorded as final (#5866 Codex F2, F4). Not finished means it could
        not start, a spelling was skipped, cut off, failed or refused, a PDF it queued
        went unread, or it raised. A retry that ran to its end, every spelling
        answered and every queued PDF read, keeps its judged rejection, as it does
        when the handoff answers; so does one stopped by the query ceiling."""
        if stalled and retried is None and retry_unfinished:
            logger.info("MANUAL_SEARCH_UNFINISHED_AFTER_HANDOFF_CUTOFF")
            raise TimeoutError("the website handoff stalled before the typed-pass retry")

    async def _send(query: str, label: str) -> list[dict] | None:
        nonlocal sent, failures
        budget = _provider_budget.get()
        before = budget.used if budget is not None else None
        try:
            hits = await _serper_search(query)
        except Exception:
            sent += 1
            failures += 1
            logger.exception("Serper %s failed", label)
            if trail is not None:
                trail.queries.append(
                    {"pass": label.split(" ")[0], "query": query, "result": "error"}
                )
            return None
        if trail is not None:
            for hit in hits:
                url, title = hit.get("link") or "", hit.get("title") or ""
                try:
                    parsed = urlparse(url)
                    host = parsed.hostname or ""
                    if (
                        parsed.scheme != "https"
                        or not host
                        or parsed.username
                        or parsed.password
                        or parsed.port not in (None, 443)
                        or _is_denied(host)
                        or re.search(r"[\\\s<>\"']", url)
                        or _is_direct_pdf(url)
                    ):
                        continue
                    # Do not retain signed credentials as a browser handoff.
                    if re.search(
                        r"(?:token|signature|x-sign|credential|secret|password|api.?key)",
                        parsed.query,
                        re.I,
                    ):
                        continue
                    official = _is_oem_host(host, make)
                    names_make = len(make) >= 2 and re.search(
                        r"(?<!\w)" + re.escape(make) + r"(?!\w)", title, re.I
                    )
                    helpful = re.search(
                        r"manual|support|download|documentation", title + " " + parsed.path, re.I
                    )
                    homepage = parsed.path in ("", "/")
                    if not (official or names_make) or not (helpful or homepage):
                        continue
                    score = (100 if official else 0) + (20 if helpful else 0)
                    if score > trail.search_page_score:
                        trail.search_page_url, trail.search_page_score = url, score
                except ValueError:
                    continue
        sent_now = before is None or (budget is not None and budget.used > before)
        if sent_now:
            sent += 1
        if trail is not None:
            trail.queries.append(
                {
                    "pass": label.split(" ")[0],
                    "query": query,
                    "result": "sent" if sent_now else "refused",
                    "hits": len(hits),
                }
            )
        return hits

    # Pass 1: site-scoped PDF — highest precision.
    oem_domains = _oem_domains_for(make)
    if oem_domains:
        q1 = f'"{model}" manual filetype:pdf site:{oem_domains[0]}'
        hits = await _send(q1, "q1 (site-scoped)")
        if hits:
            candidates.extend(_tagged(_collect(hits, make, model, part_number, set_aside), "q1"))

    typed_in_flight: str | None = None  # the retry's unanswered query, for the trail
    retry_unfinished = False  # the retry left a spelling unanswered or a PDF unread

    async def _typed_pdf_pass(
        second: bool = False, found_all: list[dict] | None = None
    ) -> list[dict]:
        """Pass 2: typed PDF — broader, still PDFs only.

        ``second`` is the retry after every site-scoped PDF was read and judged not
        the manual (#5822). Its caller has already sent the website handoff, so it
        keeps no query back for one, and it sends a query only while the caller's
        deadline still covers one plus a judge batch. That check only saves a query
        that could not be used; what bounds the retry is the cutoff its caller sets
        (:func:`_retry_typed_pass`). Hits are added to ``found_all`` as each query
        answers, so a cutoff keeps what already came back."""
        nonlocal typed_in_flight, retry_unfinished
        found_all = [] if found_all is None else found_all
        for i, variant in enumerate(_model_variants(model) or [model]):
            budget = _provider_budget.get()
            if budget is not None and not second and i and budget.used >= budget.limit - 1:
                break
            if budget is not None and second and budget.used >= budget.limit:
                break
            if (
                second
                and deadline_at is not None
                and (
                    deadline_at - time.monotonic()
                    < SEARCH_TIMEOUT + _judge.UPGRADE_MIN_BATCH_S + _judge.RETURN_RESERVE_S
                )
            ):
                retry_unfinished = True
                break
            q2 = f"{make} {variant} manual filetype:pdf"
            if second:
                typed_in_flight = q2
            before = budget.used if budget is not None else None
            hits = await _send(q2, "q2 (filetype:pdf)")
            typed_in_flight = None
            if second and (hits is None or (budget is not None and budget.used == before)):
                # The spelling failed, or a quota denial refused it: it was not answered.
                retry_unfinished = True
            if hits is None:
                continue
            found = _tagged(
                _collect(hits, make, model, part_number, None if second else set_aside), "q2"
            )
            if i:
                # A hit from a re-hyphenated form is a weaker signal than one
                # from the nameplate's own spelling: it must not win a tie.
                for c in found:
                    c["score"] -= 5
            found_all.extend(found)
        return found_all

    async def _retry_typed_pass(ranked: list[dict], judge_trace: dict) -> list[dict]:
        """#5822: every site-scoped PDF was read and judged not the manual, which is
        what skipped the typed pass. Run it once and read only what it adds, at most
        one judge batch; both rounds rank together. Returns ``ranked`` unchanged when
        the retry adds nothing or runs out of time. Round one is already on the trail,
        so a cancelled retry still shows it."""
        nonlocal typed_in_flight, retry_unfinished
        try:
            found: list[dict] = []
            try:
                # The typed queries must answer while one judge batch still fits; past
                # that they are abandoned and today's answer stands (#5844 Codex F1).
                # The judge stays outside this block: it stops itself at the deadline.
                cutoff = (
                    None
                    if deadline_at is None
                    else deadline_at
                    - _judge.UPGRADE_MIN_BATCH_S
                    - _judge.RETURN_RESERVE_S
                    - time.monotonic()
                )
                async with asyncio.timeout(cutoff):
                    await _typed_pdf_pass(second=True, found_all=found)
            except TimeoutError:
                retry_unfinished = True
                logger.info("MANUAL_SEARCH_RETRY_CUTOFF query=%s", (typed_in_flight or "")[:120])
                if trail is not None and typed_in_flight:
                    trail.queries.append(
                        {"pass": "q2", "query": typed_in_flight, "result": "timeout"}
                    )
                typed_in_flight = None
            # A fragment form of a PDF the judge read and rejected, under the same
            # title, would give the judge what it already saw: the server never
            # sees a fragment, so the text is the same (#5850). Anything else is
            # compared by its exact URL, as before, so an unread first-round copy,
            # a second form of a new document, or a form whose title tells the
            # judge something new stays readable (#5870 Codex F1, F2, F4).
            judged = _rejected_documents()
            seen_urls = {c["url"] for c in ranked}
            more: list[dict] = []
            for c in sorted(found, key=lambda c: -c["score"]):
                if c["url"] in seen_urls:
                    continue
                if _judge.same_document_key(c) in judged:
                    continue
                seen_urls.add(c["url"])
                more.append(c)
            if not more:
                return ranked
            if trail is not None:
                # On the trail before any read, after round one, so a read the caller
                # cancels is still listed (#5844 Codex F3).
                trail.candidates = list(trail.candidates) + more
                trail.ranked = ranked + more
            second_trace: dict = {}
            try:
                more = await _judge.judge_candidates(
                    make,
                    model,
                    more,
                    started_at=started_at,
                    deadline_at=deadline_at,
                    trace=second_trace,
                    max_total=_judge.MAX_CANDIDATES,
                )
            finally:
                # One trail for both rounds, kept even when a read is cancelled: round
                # one's queue positions first, then round two's.
                judge_trace["queue"] = list(judge_trace.get("queue") or []) + list(
                    second_trace.get("queue") or []
                )
                judge_trace.setdefault("not_queued", {}).update(
                    second_trace.get("not_queued") or {}
                )
                if second_trace.get("stop"):
                    judge_trace["stop"] = second_trace["stop"]
            # Its rejections hold for the rest of the search, though a miss discards
            # what this returns (#5900).
            retry_read.extend(more)
            # Read at the end, only where the search would end without a manual.
            retry_extras.extend(
                c for c in more if c.get("is_direct_pdf") and not c.get("judge") and _extra(c)
            )
            queued = set(second_trace.get("queue") or [])
            if any(
                (c.get("judge") or {}).get("status") != "judged" for c in more if c["url"] in queued
            ):
                # A PDF it queued went unread: not fetched, no text, the judge
                # unavailable, or its read stopped at the deadline.
                retry_unfinished = True
            ranked = _judge.rank(ranked + more)
            if trail is not None:
                trail.ranked = ranked
            return ranked
        except asyncio.CancelledError:
            # The caller's own timeout cancelled the search during the retry. This
            # handler sits outside the cutoff, whose expiry arrives as TimeoutError.
            judge_trace["stop"] = "cancelled"
            raise
        except Exception:
            retry_unfinished = True  # the caller logs it and today's answer stands
            raise

    async def _manual_from_retry(ranked: list[dict], judge_trace: dict) -> dict | None:
        """#5822: this search is about to end without a manual: with the judged
        rejection, after the website handoff, or (#5904) by offering a candidate it
        could not validate, at either of the two places it does each. If round one
        read every site-scoped PDF and judged none the manual, which is what skipped
        the typed pass, run it once and return a judged match from it. Otherwise
        return None, and the caller returns what it returns without the retry, except
        that a quota denial the retry's own queries met stays on the budget. Only
        ``return`` follows this call, so nothing the retry adds is ever probed or
        offered unread (#5844 Codex F5, F6).

        Before an offer no website handoff is sent: the retry is bounded by its own
        cutoff, and on a miss, a stall or an error the offer stands, so the retry
        never costs it (#5844 Codex F5).

        A quota denial is never cached as a miss (PRD R5, #4168): the endpoint reports
        a cap as the limit and an infrastructure denial as an outage, which the Hub
        retries, where it would record the judged rejection as a terminal
        no_manual_found (#5849). An offer stands over a denial, as it does over one in
        round one."""
        if not use_judge or typed_pass_ran or not every_pdf_rejected:
            return None
        try:
            both = await _retry_typed_pass(ranked, judge_trace)
        except Exception:
            logger.exception("MANUAL_SEARCH_RETRY_FAILED")  # today's answer stands
            both = []
        if both and _judge.is_match(both[0]):
            logger.info("MANUAL_SEARCH_RETRY_MATCH url=%s", both[0]["url"][:200])
            return _as_judged_match(both[0], _rejections(both))
        return None

    async def _retry_before_offer(ranked: list[dict], judge_trace: dict) -> dict | None:
        """The retry before an unvalidated offer (#5904). On a miss the offer goes out
        with round one's browser handoff: a support page the retry's queries found
        must not replace it, since the Hub prefers that page to the OEM request link
        (#5907 Codex F1). The retry's queries stay on the trail. A cancelled retry
        restores it too, so the trail the endpoint exports is round one's."""
        page = (trail.search_page_url, trail.search_page_score) if trail is not None else None
        match = None
        try:
            match = await _manual_from_retry(ranked, judge_trace)
        finally:
            if match is None and trail is not None and page is not None:
                trail.search_page_url, trail.search_page_score = page
        return match

    typed_pass_ran = not any(c["is_direct_pdf"] for c in candidates)
    if typed_pass_ran:
        candidates.extend(await _typed_pdf_pass())

    # Pass 3: widest fallback — websites as well as PDFs. A bounded call
    # reserves its final query for this instead of spending it on spelling variants.
    if not candidates:
        q3 = f"{make} {model} manual support"
        hits = await _send(q3, "q3 (wide)")
        if hits:
            candidates.extend(_tagged(_collect(hits, make, model, part_number, set_aside), "q3"))

    if identification_link:
        from ..drive_packs.identification_link import classify_payload  # noqa: PLC0415

        if classify_payload(identification_link, make).kind == "oem_url":
            link = identification_link.strip()
            top = max((c["score"] for c in candidates), default=0)
            candidates.insert(
                0,
                {
                    "url": link,
                    "title": "Nameplate identification link",
                    "host": urlparse(link).netloc,
                    "score": top + 1,
                    "doc_type": _guess_doc_type("", link),
                    "is_direct_pdf": _is_direct_pdf(link),
                    "pass": "identification_link",
                },
            )

    if not candidates:
        if sent and failures == sent:
            raise ManualSearchUnavailable(f"all {sent} sent search requests failed")
        return await _unless_extras(lambda: None, [], bool(make) and _judge.judge_enabled(), [])

    # Dedupe on URL while preserving order, then sort by score desc.
    seen: set[str] = set()
    deduped: list[dict] = []
    for c in candidates:
        if c["url"] in seen:
            continue
        seen.add(c["url"])
        deduped.append(c)
    deduped.sort(key=lambda c: c["score"], reverse=True)
    if trail is not None:
        trail.candidates = deduped

    # Read before choosing (2026-08-26): fetch the top direct-PDF candidates,
    # extract their first pages, and let the canonical text cascade judge
    # whether each is THE manual for (make, model). A judged match wins and is
    # already byte-validated; a judged rejection is returned unvalidated so the
    # caller holds it for review (DOC-003) instead of downloading a brochure.
    # Any judge failure leaves the legacy HEAD-validate path below untouched.
    judged_any = False
    rejected_out: list[dict] = []
    worst_rejected: dict | None = None
    ranked: list[dict] = []
    judge_trace: dict = {}
    # Round one's verdict, taken before any later read: an exact-part read before an
    # offer joins the trail's judge record, so the live record would make the retry
    # depend on whether the caller opened a trail (#5904).
    every_pdf_rejected = False
    # A catalog-only query may be based on text read from a user photo. Keep
    # that narrowly scoped lookup from sending candidate PDF text to the LLM
    # judge; the result remains an unconfirmed search candidate.
    use_judge = bool(make) and _judge.judge_enabled()
    if use_judge:
        judge_trace = trail.judge if trail is not None else {}
        ranked = await _judge.judge_candidates(  # records what it reads
            make,
            model,
            deduped,
            started_at=started_at,
            deadline_at=deadline_at,
            trace=judge_trace,
        )
        if trail is not None:
            trail.ranked = ranked
        # What discovery hands downstream, and why — pairs with MANUAL_JUDGE_VERDICT
        # lines so a false positive can be traced from the phone back to the read.
        _top = ranked[0] if ranked else None
        logger.info(
            "MANUAL_JUDGE_PICK %s",
            json.dumps(
                {
                    "make": make,
                    "model_number": model,
                    "pool": len(ranked),
                    "judged": sum(
                        1 for c in ranked if (c.get("judge") or {}).get("status") == "judged"
                    ),
                    "matches": sum(1 for c in ranked if _judge.is_match(c)),
                    "rejected": sum(1 for c in ranked if _judge.is_rejected(c)),
                    "top_url": (_top or {}).get("url", "")[:200],
                    "top_is_match": bool(_top and _judge.is_match(_top)),
                    "top_is_rejected": bool(_top and _judge.is_rejected(_top)),
                }
            ),
        )
        rejected = _rejections(ranked)
        judged_any = bool(rejected) or any(_judge.is_match(c) for c in ranked)
        rejected_out = rejected
        every_pdf_rejected = _every_queued_pdf_rejected(ranked, judge_trace)
        top = ranked[0]
        if _judge.is_match(top):
            return _as_judged_match(top, rejected)
        # No judged match. Rejections are NEVER returned as validated; the
        # legacy HEAD path below may still pick an UNJUDGED candidate — but
        # only one that at least names the make/model. If every relevant
        # candidate was read and rejected, say so (top rejection + reasons)
        # rather than surfacing an unread stranger. A form that went unread (its read
        # failed, or it was past the cap) of a document another form of which was
        # read and rejected is that rejection, not an unread candidate (#5897).
        rejected_documents = _rejected_documents()
        unread = [
            c
            for c in ranked
            if not _judge.is_rejected(c) and _judge.same_document_key(c) not in rejected_documents
        ]
        deduped = [c for c in unread if _judge.relevant(c, make, model)]
        worst_rejected = next((c for c in ranked if _judge.is_rejected(c)), None)
        if not deduped and not rejected:
            # #4400: nothing names the make or the model and nothing was judged. The
            # old fallback to EVERY unread candidate offered a reseller's company
            # profile as "a possible manual"; a stranger may win only by being read
            # and judged the manual (above). An honest miss instead.
            await _website_handoff()
            return await _unless_extras(lambda: None, ranked, True, rejected)
        if not deduped:
            stalled = await _website_handoff(ranked, judge_trace)
            retried = await _manual_from_retry(ranked, judge_trace)
            _unfinished_after_handoff_cutoff(stalled, retried)
            if retried is not None:
                return retried
            return await _unless_extras(
                lambda: _as_judged_rejection(worst_rejected or ranked[0], rejected),
                ranked,
                True,
                rejected,
            )

    # HEAD-validate the top few; first one that confirms PDF wins. This probe runs
    # before the #5789 screen below, so a real PDF served from a URL that does not
    # look like one is still found (#5789 Codex F4).
    for c in deduped[:5]:
        if not c.get("validated"):
            # #4401: a probe that cannot finish before the caller's deadline is not
            # sent (each may take HEAD_TIMEOUT). The top candidate is returned
            # unvalidated for review below, instead of the whole search being
            # cancelled upstream and reported as an outage.
            if deadline_at is not None and (
                deadline_at - time.monotonic() < HEAD_TIMEOUT + _judge.RETURN_RESERVE_S
            ):
                break
            _note_examined([c["url"]])
        if c.get("validated") or await _probe_candidate(c):
            if use_judge:
                # It is offered unread below. An exact-part PDF is read first, then
                # the typed-pass retry runs if round one rejected every PDF (#5904).
                match = await _exact_part_match(ranked, rejected_out)
                if match is None:
                    match = await _retry_before_offer(ranked, judge_trace)
                if match is not None:
                    return match
            c["validated"] = True
            if use_judge:
                # The judge is on but this candidate was never READ (fetch
                # blocked / too big / no text / model output unparseable).
                # Canary run 1 (2026-08-26): the only real GS10 hit came back
                # unparseable and the old OEM-host exception blessed it unread.
                # Owner rule: uncertain stays uncertain — a judged match is the
                # ONLY thing that validates while the judge is on.
                c.setdefault("reason", _judge.REASON_JUDGE_UNAVAILABLE)
                c["reason_detail"] = (
                    "Judged candidates were rejected; this one could not be read — review before use."
                    if judged_any
                    else "Could not read the candidate PDF — review before use."
                )
                c["validated"] = False
                c["judged_rejected"] = rejected_out
            else:
                c.setdefault("reason", "ok")
            return c

    # Nothing validated — return the top scorer as a candidate so the
    # caller can hold it for human review. Never promote an unvalidated
    # candidate to a trusted manual link. A page that only shares the model
    # string with the machine is not offered (#5789): what is left is the judged
    # rejection, if there was one, or an honest miss.
    if screen_unread:
        deduped = [c for c in deduped if _may_offer_unread(c, make, part_number)]
    if not deduped:
        stalled = await _website_handoff(ranked, judge_trace)
        retried = await _manual_from_retry(ranked, judge_trace)
        _unfinished_after_handoff_cutoff(stalled, retried)
        if retried is not None:
            return retried
        worst = worst_rejected
        return await _unless_extras(
            lambda: _as_judged_rejection(worst, rejected_out) if worst else None,
            ranked,
            use_judge,
            rejected_out,
        )
    if use_judge:
        # As before the probe's offer: the exact-part read, then the retry (#5904).
        match = await _exact_part_match(ranked, rejected_out)
        if match is None:
            match = await _retry_before_offer(ranked, judge_trace)
        if match is not None:
            return match
    deduped[0]["validated"] = False
    if use_judge:
        deduped[0].setdefault("reason", _judge.REASON_JUDGE_UNAVAILABLE)
        deduped[0].setdefault(
            "reason_detail", "Could not read the candidate PDF — review before use."
        )
        deduped[0]["judged_rejected"] = rejected_out
    return deduped[0]


def _every_queued_pdf_rejected(ranked: list[dict], trace: dict) -> bool:
    """Whether the judge read every PDF it queued and rejected each one (#5822).

    Not when a queued PDF went unread (unfetched, no text, cut off by the deadline),
    when the queue was over its cap, or when nothing was queued: any of those can
    still be the manual, and the existing review path handles them."""
    queue = trace.get("queue") or []
    by_url = {c["url"]: c for c in ranked}
    return (
        trace.get("stop") == "queue_exhausted"
        and bool(queue)
        and all(u in by_url and _judge.is_rejected(by_url[u]) for u in queue)
        and "over_max_total" not in (trace.get("not_queued") or {}).values()
    )


def _rejections(ranked: list[dict]) -> list[dict]:
    """Every judged rejection in ``ranked``, with the judge's reason. Two forms of one
    document read side by side can get verdicts that disagree. The document is then
    the manual, as main returns it, and its rejected form is not listed: one result
    never calls a document both the manual and not the manual (#5902). The trail
    keeps both verdicts as the judge gave them."""
    matched = {_judge.same_document_key(c) for c in ranked if _judge.is_match(c)}
    return [
        {"url": c["url"], "reason": (c.get("judge") or {}).get("reason", "")}
        for c in ranked
        if _judge.is_rejected(c) and _judge.same_document_key(c) not in matched
    ]


def _as_judged_match(top: dict, rejected: list[dict]) -> dict:
    """The judge's match, validated, with every other candidate's rejection reason."""
    code, line = _judge.judge_summary(top)
    top["reason"], top["reason_detail"] = code, line
    top["judged_rejected"] = [r for r in rejected if r["url"] != top["url"]]
    top["validated"] = True
    return top


def _as_judged_rejection(worst: dict, rejected: list[dict]) -> dict:
    """The judge's top rejection, returned unvalidated with every rejection's reason."""
    code, line = _judge.judge_summary(worst)
    worst["reason"], worst["reason_detail"] = code, line
    worst["judged_rejected"] = rejected
    worst["validated"] = False
    return worst


from . import judge as _judge  # noqa: E402 — circular-safe: judge imports this module lazily
