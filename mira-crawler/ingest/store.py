"""NeonDB storage for crawled document chunks.

Inserts embedded chunks into the knowledge_entries table using the same
connection pattern as mira-core/mira-ingest/db/neon.py (SQLAlchemy +
NullPool, sslmode=require).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import uuid

logger = logging.getLogger("mira-crawler.store")

_ENGINE = None


def _log_ref(url: str) -> str:
    """A log-safe reference to a source URL: its host (plus an explicit port)
    and a short hash of the exact URL — enough for an operator to correlate a
    refusal with a row, never the path or query (which can carry a document
    name or a token) and never the userinfo (which can carry credentials —
    ``netloc`` includes it; ``hostname``/``port`` do not). Gate 7 round P on
    #3481, code F1; round W observation."""
    if not url:
        return "<no url>"
    return f"{_safe_origin(url)} sha256:{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}"


def _safe_origin(url: str) -> str:
    """host[:port] only — never userinfo, path, query, fragment, and never a
    hash. The only thing a credential-bearing refusal may log (round AD on
    #3481): a hash of a URL that embeds a secret is a hash of the secret."""
    from urllib.parse import urlsplit

    try:
        parts = urlsplit(str(url).strip())
        host = parts.hostname or "<no host>"
        if ":" in host:  # an IPv6 literal is written bracketed, so host:port stays unambiguous
            host = f"[{host}]"
        port = parts.port  # raises ValueError for non-numeric port text
        return host if port is None else f"{host}:{port}"
    except ValueError:
        return "<unparseable>"


_SCHEME_RE = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*")
# RFC 3986 §6.2.3: for these schemes an explicit default port names the same
# authority as no port. Only the schemes the crawler stores are listed; any
# other scheme keeps its port text byte-exact.
_DEFAULT_PORTS = {"http": 80, "https": 443}
# RFC 3986 §6.2.2.1: the hex digits of a percent-encoding triplet are
# case-insensitive; the canonical form is upper-case. Only a complete, valid
# `%HH` matches — `%7`, `%`, `%zz`, `%7g` are not escapes and stay as given.
_PCT_ESCAPE_RE = re.compile(r"%[0-9A-Fa-f]{2}")
_ASCII_DIGITS_RE = re.compile(r"[0-9]+")
# Surrounding whitespace is stripped only from URLs of the schemes the hop-0
# gate admits (http/https/file). A padded value of any other scheme, a padded
# bare path or a padded drive-letter path keeps every byte: not ours to change.
_STRIP_SCHEMES = frozenset({"http", "https", "file"})


def _upper_escapes(component: str) -> str:
    """Upper-case the hex digits of every valid ``%HH`` escape; decode nothing."""
    return _PCT_ESCAPE_RE.sub(lambda m: m.group(0).upper(), component)


def _canonical_port(scheme: str, port: str) -> str:
    """``port`` is the port text INCLUDING its leading colon (or ``""``). It is
    dropped only when it is a run of ASCII digits equal to the scheme's default
    (``:443``, ``:0443``); non-default, empty (``:``), non-numeric or non-ASCII
    port text is returned exactly as given. The comparison strips leading zeros
    and compares strings — never ``int()``: the URL is untrusted text and
    CPython refuses to convert a decimal string past its digit limit."""
    default = _DEFAULT_PORTS.get(scheme)
    digits = port[1:]
    if default is None or not port or not _ASCII_DIGITS_RE.fullmatch(digits):
        return port
    return "" if (digits.lstrip("0") or "0") == str(default) else port


def canonical_source_url(url: str) -> str:
    """The one storage identity of a source URL — the exact behaviour, nothing more:

    * the scheme and the host are lower-cased (a host is case-insensitive;
      origin classification already lower-cases it);
    * an explicit **default port** is removed for ``http`` (80) and ``https``
      (443), including an equivalent digit spelling such as ``:0443``
      (RFC 3986 §6.2.3); non-default, empty (``:``) or invalid port text and the
      ports of every other scheme are preserved byte-exact;
    * the hex digits of every valid ``%HH`` escape are **upper-cased** in the
      userinfo, path, query and fragment (RFC 3986 §6.2.2.1); nothing is ever
      decoded, and invalid ``%`` text (``%7``, ``%``, ``%zz``) is preserved;
    * surrounding whitespace is not part of a URL and is stripped from a
      recognised URL before any of the above (round Z on #3481); a value that
      is not a URL by the scheme rule — a bare path, a Windows drive letter —
      keeps every byte including its whitespace, so a non-URL identity is never
      silently changed;
    * every other byte is preserved exactly as given. The transform is
      idempotent.

    Userinfo (``user:password@host``) is neither stripped into another identity
    nor persisted: such a URL is refused at the hop-0 gate and at the store
    boundary before this function is ever consulted for a write
    (``ingest.provenance.url_has_userinfo``).

    Why: the dedup key ``(tenant_id, source_url, chunk_index)`` is an exact-match
    UNIQUE index (migration 003), so any two spellings of one logical document
    that differ only in a semantics-preserving way stored as two rows — two
    casings of one origin (Gate 7 on PR #3481, code F1, SUSTAINED), then a
    default port and the case of an escape (round T, code F2 + F3, SUSTAINED).
    BOTH constructors of the key — chunk_exists and insert_chunk — and the
    ledger probe apply this, so lookup and write can never disagree. Bare
    filesystem paths (no scheme, or a one-letter Windows drive) are untouched;
    authority-less URLs (``file:/x``) get a lower-cased scheme and the escape
    rule on their path.

    Historical residual, documented not migrated: rows written before this
    function keep their stored spelling; ``chunk_exists`` and the ledger probe
    also look up the exact raw spelling they were given, so a recrawl of such a
    row finds it. A one-off dedup migration is the follow-up, never a silent
    rewrite here.
    """
    if not url:
        return url
    candidate = url.strip()
    head, sep, rest = candidate.partition(":")
    if not sep or not _SCHEME_RE.fullmatch(head) or (len(head) < 2 and not rest.startswith("//")):
        return url  # not a URL (bare path, Windows drive letter `C:\…`) — untouched, bytes and all
    scheme = head.lower()
    if candidate != url and scheme not in _STRIP_SCHEMES:
        return url  # padded, but not an allowed scheme: its bytes are not ours to change
    # From here every part is taken from `candidate`: an allowed-scheme URL's
    # surrounding whitespace is not identity.
    if not rest.startswith("//"):
        # no authority component (e.g. file:/allowed/doc.pdf): the rest is a path
        return f"{scheme}:{_upper_escapes(rest)}"
    body = rest[2:]
    end = len(body)
    for stop in "/?#":
        idx = body.find(stop)
        if idx != -1:
            end = min(end, idx)
    authority, tail = body[:end], body[end:]
    userinfo, at, hostport = authority.rpartition("@")
    if hostport.startswith("["):  # IPv6 literal
        close = hostport.find("]")
        host, port = (
            (hostport[: close + 1], hostport[close + 1 :]) if close != -1 else (hostport, "")
        )
    else:
        host, colon, port = hostport.partition(":")
        port = colon + port
    port = _canonical_port(scheme, port)
    return f"{scheme}://{_upper_escapes(userinfo)}{at}{host.lower()}{port}{_upper_escapes(tail)}"


def _refuse_credentials(url: str) -> bool:
    """True — with a credential-free warning — when ``url`` is credential-bearing
    (userinfo in any ``scheme://authority`` form, or a credential-family query
    parameter name). The store boundary's half of the hop-0 rule
    (``provenance.url_credential_reason``): every route that reaches SQL passes
    through here first. The warning carries only the safe origin (host[:port])
    and the reason — **no hash of any byte derived from the credential-bearing
    URL** (round AD on #3481); the exact-URL correlation hash of ``_log_ref`` is
    for ordinary policy refusals only."""
    try:
        from .provenance import url_credential_reason
    except ImportError:  # pragma: no cover — flat-path layout
        from provenance import url_credential_reason  # type: ignore[no-redef]

    reason = url_credential_reason(url)
    if not reason:
        return False
    logger.warning(
        "Refusing knowledge_entries access for %s — the URL carries %s; authenticated "
        "sources use secret-backed request headers, never a credential in the URL",
        _safe_origin(url),
        reason,
    )
    return True


def _engine():
    """Get or create SQLAlchemy engine with NullPool."""
    global _ENGINE  # noqa: PLW0603
    if _ENGINE is not None:
        return _ENGINE

    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")

    _ENGINE = create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    return _ENGINE


def chunk_exists(tenant_id: str, source_url: str, chunk_index: int) -> bool:
    """Check if a chunk has already been stored (dedup guard)."""
    from sqlalchemy import text

    if _refuse_credentials(source_url):
        return False  # no query: a credential never reaches the DB, not even as a bind
    # Look up the canonical key insert_chunk writes AND the spelling we were
    # given: rows written before canonicalisation keep their raw casing, and the
    # freshness recrawl re-supplies exactly that stored spelling — a canonical-
    # only lookup would miss such a row and the recrawl would write a duplicate.
    raw_url = source_url
    source_url = canonical_source_url(source_url)
    # The two exact spellings are ONE array probe on the UNIQUE index's column —
    # an index condition by construction (round AD on #3481, round-27 scope B
    # F1 SUSTAINED against the earlier `OR` of two predicates). Only the two
    # safe spellings are ever bound; one when they coincide.
    urls = [source_url] if source_url == raw_url else [source_url, raw_url]
    try:
        with _engine().connect() as conn:
            count = conn.execute(
                text("""
                    SELECT COUNT(*) FROM knowledge_entries
                    WHERE tenant_id = :tid
                      AND source_url = ANY(:urls)
                      AND metadata->>'chunk_index' = :idx
                """),
                {"tid": tenant_id, "urls": urls, "idx": str(chunk_index)},
            ).scalar()
        return (count or 0) > 0
    except Exception as e:
        logger.warning("Dedup check failed: %s", e)
        return False


def insert_chunk(
    tenant_id: str,
    content: str,
    embedding: list[float],
    source_url: str = "",
    source_type: str = "equipment_manual",
    manufacturer: str = "",
    model_number: str = "",
    equipment_id: str = "",
    page_num: int | None = None,
    section: str = "",
    chunk_index: int = 0,
    chunk_type: str = "text",
    image_embedding: list[float] | None = None,
    verified: bool = False,
    *,
    is_private: bool,
) -> str:
    """Insert a single chunk into knowledge_entries. Returns entry ID or empty string.

    is_private is REQUIRED (CU-03, finding I-1): the caller must make an
    explicit visibility decision. Shared OEM/public-crawl content passes
    False; a customer's own document passes True — never rely on a default
    (the #1833 leak shape). Write law:
    .claude/rules/knowledge-entries-tenant-scoping.md.
    """
    from sqlalchemy import text

    from .manufacturer_normalize import normalize_manufacturer

    # Collapse OCR/extraction manufacturer variants at the write boundary so
    # the knowledge_entries.manufacturer column (which the Hub KB catalog
    # GROUPs BY) stays canonical regardless of which caller wrote it (#1596).
    manufacturer = normalize_manufacturer(manufacturer).canonical

    # A URL carrying userinfo is refused HERE — before canonicalisation, before
    # the dedup lookup, before any SQL (Gate 7 round Z on #3481, code F2). The
    # credential is never stripped into another identity and never persisted;
    # an authenticated source uses out-of-band secret-backed headers.
    if _refuse_credentials(source_url):
        return ""

    # One canonical key for every casing of an origin — before provenance and
    # before binding, so the classified URL and the stored URL are the same
    # string, and chunk_exists() looks up exactly what this writes.
    raw_url = source_url
    source_url = canonical_source_url(source_url)

    # ── Provenance enforcement at the write boundary (Gate 9 round 1, F1) ──
    # Every storage route passes through here, which is the point: enforcing in
    # tasks/ingest.py only meant reddit/patents/youtube/manualslib_scraper and
    # the Apify coverage tool published policy-private and policy-BLOCKED
    # sources to the shared corpus with a hardcoded is_private=False. Patching
    # those five callers would not have been the fix — the sixth would
    # reintroduce it.
    #
    # This can make a row more private than the caller asked, or refuse it
    # outright. It can never grant sharing the caller did not request.
    try:
        from .provenance import enforce_visibility
    except ImportError:  # pragma: no cover — flat-path layout
        from provenance import enforce_visibility  # type: ignore[no-redef]

    allowed, is_private, prov_reason = enforce_visibility(source_url, is_private)
    if not allowed:
        logger.warning(
            "Refusing knowledge_entries write for %s — %s",
            _log_ref(source_url),
            prov_reason,
        )
        return ""

    # The historical-spelling guard lives HERE, at the boundary every route
    # passes through (Gate 7 round U on #3481, code F1): a row stored before
    # canonicalisation under the exact spelling the caller supplied wins, just
    # as ON CONFLICT DO NOTHING lets an existing canonical row win — this never
    # writes a second row beside it, whether or not the caller ran
    # chunk_exists() first. Skipped when the spelling is already canonical:
    # there is no historical twin to look for, and the conflict target handles
    # the canonical row. (Documented residual, unchanged: a historical row is
    # only found when the caller supplies its exact spelling — #3482.)
    if raw_url != source_url and chunk_exists(tenant_id, raw_url, chunk_index):
        return ""

    entry_id = str(uuid.uuid4())
    metadata = {
        "chunk_index": chunk_index,
        "section": section,
        "equipment_id": equipment_id,
        "source": "mira_crawler",
        "chunk_type": chunk_type,
    }

    img_emb_val = str(image_embedding) if image_embedding else None

    try:
        with _engine().connect() as conn:
            # The DATABASE says whether a row was written: `RETURNING id`
            # yields the inserted row's id, and yields nothing when the
            # conflict target fired (DO NOTHING). The minted `entry_id` is
            # only what the statement binds — it is never reported on its own.
            written_id = conn.execute(
                text("""
                    INSERT INTO knowledge_entries
                        (id, tenant_id, source_type, manufacturer, model_number,
                         content, embedding, source_url, source_page,
                         metadata, is_private, verified, chunk_type, image_embedding)
                    VALUES
                        (:id, :tenant_id, :source_type, :manufacturer, :model_number,
                         :content, cast(:embedding AS vector), :source_url, :source_page,
                         cast(:metadata AS jsonb), :is_private, :verified, :chunk_type,
                         cast(:image_embedding AS vector))
                    ON CONFLICT (tenant_id, source_url, ((metadata->>'chunk_index')::int))
                    WHERE (metadata->>'chunk_index') IS NOT NULL
                    DO NOTHING
                    RETURNING id
                """),
                {
                    "id": entry_id,
                    "tenant_id": tenant_id,
                    "source_type": source_type,
                    "manufacturer": manufacturer,
                    "model_number": model_number,
                    "content": content,
                    "embedding": str(embedding),
                    "source_url": source_url,
                    "source_page": page_num,
                    "metadata": json.dumps(metadata),
                    "chunk_type": chunk_type,
                    "is_private": is_private,
                    "verified": verified,
                    "image_embedding": img_emb_val,
                },
            ).scalar_one_or_none()
            conn.commit()
        # A conflict is not a write (Gate 7 round V on #3481, code F1 + F2): the
        # canonical row already existed, or the other of two concurrent writers
        # of one document got there first. Nothing was written, so there is no
        # id to report — store_chunks must neither count nor KG-link it.
        if written_id is None:
            return ""  # DO NOTHING fired
        return str(written_id)
    except Exception as e:
        logger.error("Insert failed: %s", e)
        return ""


def store_chunks(
    chunks_with_embeddings: list[tuple[dict, list[float]]],
    tenant_id: str,
    manufacturer: str = "",
    model_number: str = "",
    image_embedding: list[float] | None = None,
    verified: bool = False,
    *,
    is_private: bool,
) -> int:
    """Store a batch of (chunk, embedding) pairs into NeonDB.

    Skips chunks that already exist (dedup by source_url + chunk_index).
    Returns number of chunks inserted.
    image_embedding: optional 768-dim visual vector stored alongside text embedding.
    verified: when True the chunk is written as trusted (citable while
    MIRA_ENFORCE_APPROVED_RETRIEVAL is on). Only OEM-trusted crawlers pass
    True — see .claude/rules/oem-crawler-trusted.md.
    is_private: REQUIRED (CU-03, I-1) — the caller's explicit visibility
    decision, threaded to every insert_chunk. False = shared corpus;
    True = the owning tenant only. Visibility is orthogonal to trust
    (verified).

    UNS+KG flywheel (spec §4.4): when manufacturer+model are known, this
    upserts an `equipment` and a `manual` entity, links the chunk row to
    the equipment via `equipment_entity_id`, and runs the fault-code
    extractor over chunk text to densify the KG. All entity writes are
    idempotent (UNIQUE on tenant_id+entity_type+name).

    Manufacturer normalization (#1596) happens at the write boundaries —
    `insert_chunk` for the chunk row and `kg_writer.register_*` for the KG
    entities — so direct callers of those (e.g. tasks/ingest.py) are covered
    too, not just this orchestrator.
    """
    # Lazy-import KG modules so a misconfigured KG layer cannot break
    # the chunk-insert hot path. Failures degrade to "we still wrote
    # the vectors, we just didn't densify the graph this batch."
    try:
        from . import kg_writer
        from .extractors.fault_codes import extract_fault_codes
    except Exception as e:  # pragma: no cover — defensive
        logger.warning("KG modules unavailable, skipping graph densification: %s", e)
        kg_writer = None  # type: ignore[assignment]
        extract_fault_codes = None  # type: ignore[assignment]

    inserted = 0
    equipment_id: str | None = None
    manual_id: str | None = None

    # Step 1 (per-batch): register the equipment + manual once. The same
    # batch always carries chunks for one (mfr, model) combination — the
    # caller is the per-URL processor in mira-crawler/tasks/ingest.py.
    if kg_writer is not None and manufacturer and model_number:
        manual_url = next(
            (c.get("source_url") for c, _ in chunks_with_embeddings if c.get("source_url")),
            None,
        )
        manual_title = next(
            (c.get("title") for c, _ in chunks_with_embeddings if c.get("title")),
            None,
        )
        equipment_id, manual_id = kg_writer.register_equipment_and_manual(
            tenant_id=tenant_id,
            manufacturer=manufacturer,
            model=model_number,
            manual_title=manual_title,
            manual_url=manual_url,
        )

    for chunk, embedding in chunks_with_embeddings:
        source_url = chunk.get("source_url", "")
        chunk_index = chunk.get("chunk_index", 0)

        # Dedup
        if chunk_exists(tenant_id, source_url, chunk_index):
            continue

        entry_id = insert_chunk(
            tenant_id=tenant_id,
            content=chunk["text"],
            embedding=embedding,
            source_url=source_url,
            source_type=chunk.get("source_type", "equipment_manual"),
            manufacturer=manufacturer,
            model_number=model_number,
            equipment_id=chunk.get("equipment_id", ""),
            page_num=chunk.get("page_num"),
            section=chunk.get("section", ""),
            chunk_index=chunk_index,
            chunk_type=chunk.get("chunk_type", "text"),
            image_embedding=image_embedding,
            verified=verified,
            is_private=is_private,
        )
        if not entry_id:
            continue
        inserted += 1

        # Step 2: bridge the chunk row to its equipment entity, if known.
        if kg_writer is not None and equipment_id:
            kg_writer.link_chunk_to_equipment(entry_id, equipment_id)

            # Step 3: extract fault codes from chunk text and densify the KG.
            if extract_fault_codes is not None:
                for match in extract_fault_codes(chunk.get("text", "")):
                    kg_writer.register_fault_code(
                        tenant_id=tenant_id,
                        equipment_id=equipment_id,
                        manufacturer=manufacturer,
                        fault_code=match.normalized(),
                        # Anchoring the fault under its model in the KB
                        # tree gives the Hub a navigable
                        # mfr/family/model/fault_codes/<code> path.
                        model=model_number,
                        confidence=0.85,
                        source_chunk_id=entry_id,
                    )

    logger.info(
        "Stored %d/%d chunks (equipment_id=%s, manual_id=%s)",
        inserted,
        len(chunks_with_embeddings),
        equipment_id,
        manual_id,
    )
    return inserted


def ingested_source_urls(source_urls: list[str], tenant_id: str = "") -> set[str]:
    """Return which of ``source_urls`` actually have rows in knowledge_entries.

    The authority for "was this ingested?" — used by
    `ingest.ingest_ledger.reconcile` to promote pending items to committed. The
    corpus is the only definition of success that cannot drift from reality: a
    Celery ack proves a message was delivered, not that a document landed.

    One batched query, not one per URL. Returns an empty set on any error so a
    DB blip leaves items pending (retryable) rather than falsely committing or
    falsely dead-lettering them.
    """
    if not source_urls:
        return set()
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        # Fail closed — empty, None, whitespace-only or non-string is not a
        # tenant. (A whitespace tenant would still be scoped — `tenant_id = ' '`
        # matches no row — but it is invalid input and must not reach SQL.) (Gate 7 round M on #3481): without a tenant this probe
        # would have queried EVERY tenant's rows. Nothing is reported as
        # ingested, so ledger items stay pending — the retryable direction.
        logger.warning("ingested_source_urls called without a tenant_id — refusing the probe")
        return set()
    from sqlalchemy import text

    # Rows written since the canonical key landed carry the canonical spelling;
    # rows written before it keep their raw casing. Ask for BOTH and answer in
    # the caller's own spelling, so the ledger's keys match either way and a
    # mixed-case enqueued URL can never stay pending forever.
    asked = list(source_urls)
    # A credential-bearing URL is refused before it is canonicalised or bound:
    # only the safe values are queried, and a refused spelling is never answered
    # (Gate 7 round Z on #3481, code F2). All refused → no query at all.
    asked = [u for u in asked if not _refuse_credentials(u)]
    if not asked:
        return set()
    lookup = sorted({*asked, *(canonical_source_url(u) for u in asked)})
    try:
        with _engine().connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT DISTINCT source_url FROM knowledge_entries "
                    "WHERE source_url = ANY(:urls) AND tenant_id = :tid"
                ),
                {"urls": lookup, "tid": tenant_id},
            ).fetchall()
        found = {r[0] for r in rows if r and r[0]}
        return {u for u in asked if u in found or canonical_source_url(u) in found}
    except Exception as e:
        logger.warning("ingested_source_urls check failed (treating as none): %s", e)
        return set()
