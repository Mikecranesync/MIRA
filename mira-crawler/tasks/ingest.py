"""Document ingest tasks — download, extract, chunk, embed, store.

Reuses existing mira-crawler pipeline modules:
- converter.py for PDF/HTML extraction
- chunker.py for semantic chunking
- embedder.py for Ollama embedding
- store.py for NeonDB insert + dedup

Reliability:
  - HEAD pre-flight + post-download size check, default 50MB cap (env-tunable)
  - Streams to tempfile instead of loading body into memory
  - autoretry only on transient errors (httpx, OS, conn) — MemoryError bubbles
  - acks_late=False so OOM kills don't trigger redelivery loop
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

import httpx

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.ingest")

DOWNLOAD_TIMEOUT = int(os.getenv("INGEST_DOWNLOAD_TIMEOUT", "60"))
# Default lowered from 150MB to 50MB — Docling's PDF parser uses 5-10× the file
# size during extraction (image OCR pass), so 50MB ≈ 250–500MB working set.
MAX_PDF_BYTES = int(os.getenv("INGEST_MAX_PDF_BYTES", str(50 * 1024 * 1024)))

_TRANSIENT = (
    httpx.HTTPError,
    httpx.TimeoutException,
    ConnectionError,
    TimeoutError,
    OSError,
)

# ── Shared-corpus curation gate (CU-03, finding I-2) ─────────────────────────
# ingest_url writes to the shared corpus (is_private=false). Sharing is only
# legitimate for curated sources: the human gate is sources.yaml membership
# (.claude/rules/oem-crawler-trusted.md — "the human gate is sources.yaml
# curation, not per-chunk review"). An uncurated URL must be refused, not
# quietly shared.

_CURATED_HOSTS: frozenset[str] | None = None


def _curated_hosts() -> frozenset[str]:
    """Hosts of every url in sources.yaml (cached). Raises if unreadable."""
    global _CURATED_HOSTS  # noqa: PLW0603
    if _CURATED_HOSTS is not None:
        return _CURATED_HOSTS

    from urllib.parse import urlparse

    import yaml

    manifest = Path(__file__).resolve().parents[1] / "sources.yaml"
    data = yaml.safe_load(manifest.read_text(encoding="utf-8"))

    hosts: set[str] = set()

    def _walk(node) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key == "url" and isinstance(value, str):
                    host = urlparse(value).hostname
                    if host:
                        hosts.add(host.lower())
                else:
                    _walk(value)
        elif isinstance(node, list):
            for item in node:
                _walk(item)

    _walk(data)
    _CURATED_HOSTS = frozenset(hosts)
    return _CURATED_HOSTS


MAX_REDIRECT_HOPS = 5


class _UncuratedHop(Exception):
    """A redirect hop failed the curation gate (reason in str)."""


def _allowed_base() -> Path:
    """The one operator-controlled ingest dir (resolved). Trusted config —
    the dir itself may be a symlinked mount; everything BELOW it is not."""
    return Path(
        os.getenv(
            "INGEST_LOCAL_ALLOWED_DIR",
            os.getenv("GDRIVE_SYNC_DEST", "/data/gdrive_sync"),
        )
    ).resolve()


def _read_validated(local_path: Path) -> bytes:
    """Open the validated path with symlink resolution refused for EVERY
    component below the allowed base, on platforms that support dir_fd
    (POSIX — the production platform; crawler workers run in Linux
    containers). The walk starts from a directory fd of the resolved base
    and opens each component with O_NOFOLLOW, so neither a final-component
    nor a parent-component symlink swapped in after validation can redirect
    the read outside the base (Gate 7/9 TOCTOU findings, both rounds).
    Any component outside the base, or any symlink below it, raises and the
    caller refuses the ingest (fail closed). On Windows dev boxes dir_fd
    and O_NOFOLLOW do not exist and the plain open of the resolved path
    remains — that residual is recorded in units/CU-03.md; production does
    not run there."""
    if os.open not in os.supports_dir_fd or not hasattr(os, "O_NOFOLLOW"):
        return local_path.read_bytes()
    base = _allowed_base()
    rel = local_path.relative_to(base)  # ValueError -> caller refuses
    dir_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    fd = os.open(str(base), os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in rel.parts[:-1]:
            next_fd = os.open(part, dir_flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        file_fd = os.open(rel.parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
    finally:
        os.close(fd)
    with os.fdopen(file_fd, "rb") as fh:
        return fh.read()


def _validated_local_path(url: str) -> Path | None:
    """Resolve a file:// URL and return the path ONLY if it is contained in
    the operator ingest dir; None otherwise (fail closed on any error).

    The caller must open THIS returned resolved path via _read_validated —
    never re-parse the URL. That closes the validate-one-path/open-another
    bug (Gate 9 round 1); _read_validated then refuses symlinks on every
    component below the allowed base via a dir_fd walk on POSIX (the
    production platform), closing both the final-component and the
    parent-component swap (Gate 9 round 2). The remaining residual
    (Windows dev boxes only) is recorded in units/CU-03.md.
    """
    from urllib.parse import urlparse
    from urllib.request import url2pathname

    try:
        local = Path(url2pathname(urlparse(url).path)).resolve()
        base = _allowed_base()
        if local.is_relative_to(base):
            return local
        return None
    except Exception:
        return None


def shared_corpus_source_allowed(url: str) -> tuple[bool, str]:
    """May this URL land in the shared corpus? Returns (allowed, reason).

    file:// is allowed ONLY under the operator ingest dir (Gate 7 finding:
    an unrestricted carve-out is an arbitrary-local-file-read door into the
    shared corpus). The dir is INGEST_LOCAL_ALLOWED_DIR, defaulting to the
    Drive-inbox sync dest (tasks/gdrive.py) — the one legitimate file://
    producer. Paths are resolved first, so ../ cannot escape. http(s)
    requires the host to be a sources.yaml host (or a subdomain of one).
    Any resolution/manifest failure fails CLOSED — an unvalidatable shared
    write is a refused write.
    """
    from urllib.parse import urlparse as _up

    scheme = _up(url).scheme.lower()
    if scheme == "file":
        local = _validated_local_path(url)
        if local is not None:
            return True, "operator-initiated local ingest (allowed dir)"
        return False, "file:// path outside the allowed dir (or unresolvable) — fail closed"
    if scheme not in ("http", "https"):
        # Hop-0 contract (Gate 9 round 2): only http/https/file are ever
        # eligible — ftp://curated-host must fail at the GATE, not in transport.
        return False, f"unsupported scheme {scheme!r} — http/https/file only"
    # CANONICAL POLICY (CU-03a / Gate 6). One list decides this, for both the
    # gate and the feeders — `mira-crawler/provenance_policy.yaml`, read through
    # ingest.provenance. Previously this consulted sources.yaml directly while
    # 17 feeder manifests kept their own origins, 31 of which the gate refused.
    # An origin with no policy entry classifies `unclassified` and is REFUSED,
    # so the consistency test's finding is a production behaviour, not a
    # CI-only warning.
    try:
        from ingest.provenance import shared_corpus_allowed as _policy_allows
    except ImportError:  # container layout
        from mira_crawler.ingest.provenance import shared_corpus_allowed as _policy_allows

    try:
        return _policy_allows(url)
    except Exception as e:
        return False, f"provenance policy unreadable ({e}) — fail closed"


@app.task(
    bind=True,
    max_retries=3,
    soft_time_limit=600,
    time_limit=900,
    acks_late=False,
    reject_on_worker_lost=False,
    autoretry_for=_TRANSIENT,
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def ingest_url(self, url: str, manufacturer: str = "",
               model: str = "", source_type: str = "equipment_manual",
               *, is_private: bool = True):
    """Download, extract, chunk, embed, and store one document.

    Works with PDFs and HTML pages. Skips already-ingested chunks (dedup).

    ``is_private`` is the corpus visibility this ingest writes. The curation
    gate below decides whether a source is *allowed* to be shared; this
    argument is the calling feeder declaring what it *intends*. Both must agree
    before a row reaches the shared corpus — authorization and intent are
    different questions, and a feeder that never states its intent is exactly
    how a private document ends up shared.

    **Why this has a default when `insert_chunk`'s is required.** That is an
    in-process call; this is a Celery task signature, i.e. a wire contract. At
    deploy time the queue still holds messages enqueued by the previous
    release, carrying no ``is_private`` kwarg — a required parameter would make
    those drain as ``TypeError``. So it takes a default, and the default is the
    **safe direction: private**. Re-sharing a wrongly-privatized row is a
    recrawl; un-sharing a leaked one is an incident.

    It is **keyword-only** (Gate 7 finding): a positional 5th argument could
    otherwise set corpus visibility by accident, and a static contract that
    scans keywords would not see it. Celery dispatch is keyword-based, so this
    costs nothing.

    **Any URL whose parsed scheme is ``file`` is forced private**, regardless of
    what the caller declares, of letter case, and of slash count — ``file://x``
    and ``file:/x`` alike. Local files reach this task from ``tasks/gdrive.py``
    (a Google Drive mirror) and from operator drops: non-public provenance by
    construction.

    The containment check in ``_validated_local_path`` answers "may we read this
    path"; it cannot answer "may every tenant read its contents". Those are
    different questions, and **being inside the allowed directory never lowers a
    file's privacy classification** — it only decides whether it may be ingested
    at all.
    """
    from ingest.chunker import chunk_blocks
    from ingest.converter import extract_from_html, extract_from_pdf_with_fallback
    from ingest.embedder import embed_text
    from ingest.store import chunk_exists, insert_chunk

    tenant_id = os.getenv("MIRA_TENANT_ID", "").strip()
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    embed_model = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")

    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set — cannot ingest")
        return {"url": url, "inserted": 0, "error": "no_tenant_id"}

    # Parse the URL ONCE and derive every local-file decision from that single
    # answer. Two different recognizers is how the bypass below happened.
    from urllib.parse import urlparse as _up

    is_file_url = _up(url).scheme.lower() == "file"

    # Visibility floor: a local file has no public provenance, so no caller
    # declaration can put it in the shared corpus. Passing the containment
    # check means "we may read this path", never "everyone may read it" —
    # allowed-directory validation gates INGESTION, never privacy.
    #
    # This keys on the PARSED SCHEME, not on a `startswith("file://")` string
    # test. That string test was the bypass: `file:/allowed/path/doc.pdf` (one
    # slash — an empty authority, which RFC 8089 permits and `urlparse`
    # resolves to scheme "file") took the local branch at `is_file_url` below
    # while sliding past the prefix check, so a caller-supplied
    # `is_private=False` survived all the way to `insert_chunk`. Same URL, two
    # recognizers, opposite answers.
    if not is_private and is_file_url:
        logger.warning(
            "Forcing is_private=True for local-file ingest %s — a local file has "
            "no public provenance and cannot enter the shared corpus",
            url[:120],
        )
        is_private = True

    # 0. Curation gate (I-2) — BEFORE any network access. This task writes
    # shared rows; an uncurated source must be refused, not shared. To ingest
    # a new OEM domain, add it to sources.yaml (minutes, auditable forever).
    # file:// is validated inside its branch below so the SAME resolved path
    # that passed validation is the one opened (Gate 9 TOCTOU finding).
    final_url = url
    if not is_file_url:
        # The policy has THREE outcomes for a remote origin, and collapsing them
        # into allow/refuse would make `private` a lie:
        #
        #   curated  -> ingest; visibility is the caller's declaration
        #   private  -> ingest, but FORCE tenant-scoped. The origin is real and
        #               fetchable, it just may not enter the shared corpus.
        #   anything else (blocked / infrastructure / unclassified) -> refuse
        #
        # Before this, `private` behaved exactly like `blocked` — the URL was
        # refused outright — so classifying an origin "private, ingestible,
        # tenant-scoped" silently stopped ingesting it altogether. A policy whose
        # runtime does not match its stated semantics is worse than no policy.
        try:
            from ingest.provenance import classify_origin as _classify
        except ImportError:  # container layout
            from mira_crawler.ingest.provenance import classify_origin as _classify

        try:
            origin_class, gate_reason = _classify(url)
        except Exception as e:
            logger.warning("Provenance policy unreadable for %s (%s) — fail closed", url[:80], e)
            return {"url": url, "inserted": 0, "error": "uncurated_source"}

        if origin_class == "private":
            if not is_private:
                logger.info(
                    "Forcing is_private=True for %s — origin classified private: %s",
                    url[:80], gate_reason,
                )
            is_private = True
        elif origin_class != "curated":
            logger.warning(
                "Refusing ingest of %s: origin classified %s — %s",
                url[:80], origin_class, gate_reason,
            )
            return {"url": url, "inserted": 0, "error": "uncurated_source"}

    # 1. Download (supports http(s):// and file:// schemes)
    is_pdf_url = url.lower().endswith(".pdf")

    if is_file_url:
        local_path = _validated_local_path(url)
        if local_path is None:
            logger.warning(
                "Refusing shared-corpus ingest of %s: file:// outside allowed dir", url[:80]
            )
            return {"url": url, "inserted": 0, "error": "uncurated_source"}
        try:
            # Open the exact resolved path validation returned — never a
            # re-parse of the URL; O_NOFOLLOW on POSIX (see _read_validated).
            data = _read_validated(local_path)
            content_type = (
                "application/pdf" if local_path.suffix.lower() == ".pdf" else "text/html"
            )
            if len(data) > MAX_PDF_BYTES and is_pdf_url:
                logger.warning(
                    "Skipping %s — %d MB exceeds limit",
                    url[:80], len(data) // 1024 // 1024,
                )
                return {"url": url, "inserted": 0, "error": "file_too_large"}
        except Exception as exc:
            logger.warning("Local file read failed for %s: %s", url[:80], exc)
            return {"url": url, "inserted": 0, "error": f"local_read_failed: {exc}"}
    else:
        # Stream download to a tempfile so a misbehaving server (no
        # Content-Length, chunked-encoding bomb, etc.) can't OOM the worker.
        # Abort mid-stream if we cross the size cap. Redirects are followed
        # MANUALLY: every hop is scheme-checked and curation-gated BEFORE its
        # request is sent (Gate 9 finding: follow_redirects=True let a curated
        # host bounce the crawler to an uncurated/internal target). The final
        # validated URL becomes the provenance/dedup key.
        tmp = tempfile.NamedTemporaryFile(prefix="mira-ingest-", suffix=".bin", delete=False)
        tmp_path = Path(tmp.name)
        downloaded = 0
        try:
            with httpx.Client(
                timeout=DOWNLOAD_TIMEOUT,
                follow_redirects=False,
                headers={"User-Agent": "MIRA-IngestBot/1.0 (KB builder)"},
            ) as client:
                current = url
                for _hop in range(MAX_REDIRECT_HOPS + 1):
                    with client.stream("GET", current) as resp:
                        if resp.status_code in (301, 302, 303, 307, 308):
                            location = resp.headers.get("location", "")
                            nxt = str(httpx.URL(current).join(location))
                            if _up(nxt).scheme.lower() not in ("http", "https"):
                                raise _UncuratedHop(f"non-http redirect target {nxt[:80]}")
                            hop_ok, hop_reason = shared_corpus_source_allowed(nxt)
                            if not hop_ok:
                                raise _UncuratedHop(f"{nxt[:80]}: {hop_reason}")
                            current = nxt
                            continue
                        resp.raise_for_status()
                        content_type = resp.headers.get("content-type", "")
                        for chunk in resp.iter_bytes(chunk_size=64 * 1024):
                            downloaded += len(chunk)
                            if downloaded > MAX_PDF_BYTES and (
                                "application/pdf" in content_type or is_pdf_url
                            ):
                                tmp.close()
                                tmp_path.unlink(missing_ok=True)
                                logger.warning(
                                    "Aborted streaming download of %s — exceeded %d MB cap mid-stream",
                                    url[:80], MAX_PDF_BYTES // 1024 // 1024,
                                )
                                return {"url": url, "inserted": 0, "error": "file_too_large"}
                            tmp.write(chunk)
                        final_url = current
                        break
                else:
                    raise _UncuratedHop(f"more than {MAX_REDIRECT_HOPS} redirect hops")
            tmp.close()
            data = tmp_path.read_bytes()
        except _UncuratedHop as exc:
            tmp.close()
            tmp_path.unlink(missing_ok=True)
            logger.warning("Refusing redirected ingest of %s: %s", url[:80], exc)
            return {"url": url, "inserted": 0, "error": "uncurated_redirect"}
        except _TRANSIENT as exc:
            tmp.close()
            tmp_path.unlink(missing_ok=True)
            logger.warning("Download failed for %s: %s — Celery will retry", url[:80], exc)
            raise  # autoretry_for handles the retry
        finally:
            # Close before unlink: on Windows an unlink of an open file raises
            # WinError 32, which would mask the original exception.
            try:
                tmp.close()
            except Exception:
                pass
            tmp_path.unlink(missing_ok=True)

    # 3. Extract text blocks
    is_pdf = final_url.lower().endswith(".pdf") or "application/pdf" in content_type
    if is_pdf:
        blocks = extract_from_pdf_with_fallback(data)
    else:
        blocks = extract_from_html(data)

    if not blocks:
        logger.warning("No extractable text from %s", url[:80])
        return {"url": url, "inserted": 0, "error": "no_content"}

    # 4. Chunk
    chunks = chunk_blocks(
        blocks,
        source_url=final_url,
        max_chars=2000,
        min_chars=80,
        overlap=200,
    )
    total = len(chunks)
    logger.info("Extracted %d blocks → %d chunks from %s", len(blocks), total, url[:80])

    # 5. Embed + store (with dedup and progress)
    inserted = 0
    skipped = 0

    # Open ONE NeonDB connection per document — the quality gate's semantic
    # dedup stage runs one SELECT per chunk. Reusing the connection avoids
    # 1 TLS handshake per chunk (#112). Fail-open if connection fails.
    from ingest.store import _engine

    dedup_conn = None
    try:
        dedup_conn = _engine().connect()
    except Exception as e:
        logger.warning("Could not open shared dedup connection (fail open): %s", e)

    try:
        for i, chunk in enumerate(chunks):
            chunk_idx = chunk.get("chunk_index", i)

            # Dedup
            if chunk_exists(tenant_id, final_url, chunk_idx):
                skipped += 1
                continue

            # Progress logging every 50 chunks
            if (i + 1) % 50 == 0:
                logger.info("Embedding chunk %d/%d for %s...", i + 1, total, url[:60])

            embedding = embed_text(
                chunk["text"],
                ollama_url=ollama_url,
                model=embed_model,
            )
            if embedding is None:
                continue

            # Quality gate: content filter → relevance → semantic dedup
            try:
                from ingest.quality import quality_gate
                passed, reason = quality_gate(
                    chunk, embedding, tenant_id, conn=dedup_conn
                )
                if not passed:
                    logger.debug("Quality gate rejected chunk %d: %s", chunk_idx, reason)
                    skipped += 1
                    continue
            except Exception as e:
                logger.warning("Quality gate error (fail open): %s", e)

            entry_id = insert_chunk(
                tenant_id=tenant_id,
                content=chunk["text"],
                embedding=embedding,
                source_url=final_url,
                source_type=source_type,
                manufacturer=manufacturer,
                model_number=model,
                page_num=chunk.get("page_num"),
                section=chunk.get("section", ""),
                chunk_index=chunk_idx,
                chunk_type=chunk.get("chunk_type", "text"),
                # Visibility is the caller's declaration (defaulting private),
                # after the file:// floor above. The sources.yaml gate decides
                # whether sharing is AUTHORIZED; this says whether it was
                # INTENDED. Unverified either way — trust stays with the OEM
                # crawler class, not this task.
                is_private=is_private,
            )
            if entry_id:
                inserted += 1
    finally:
        if dedup_conn is not None:
            try:
                dedup_conn.close()
            except Exception:
                pass

    logger.info(
        "Completed %s: %d inserted, %d skipped, %d total chunks",
        url[:60], inserted, skipped, total,
    )

    # Auto-extract a component_templates row when fresh chunks landed for a
    # branded source. Dispatched async on the same queue — the ingest task
    # never blocks on the LLM cascade. Issue #1257.
    if inserted > 0 and manufacturer and model:
        try:
            try:
                from mira_crawler.tasks.component_template import (
                    extract_component_template,
                )
            except ImportError:
                from tasks.component_template import (  # type: ignore[no-redef]
                    extract_component_template,
                )
            extract_component_template.delay(
                manufacturer=manufacturer,
                model=model,
                source_type=source_type,
            )
            logger.info(
                "Queued component_template extraction for %s %s (%d new chunks)",
                manufacturer, model, inserted,
            )
        except Exception as exc:
            logger.warning(
                "Failed to queue component_template extraction for %s %s: %s",
                manufacturer, model, exc,
            )

    return {"url": url, "inserted": inserted, "skipped": skipped, "total": total}


@app.task
def ingest_all_pending():
    """Queue ingest tasks for all pending URLs in manual_cache.

    Reads from NeonDB manual_cache table (pdf_stored=false) and queues
    each URL as a separate ingest task.
    """
    import sys

    # Add mira-ingest to path for db.neon imports
    _ingest_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "..", "mira-core", "mira-ingest",
    )
    if _ingest_dir not in sys.path:
        sys.path.insert(0, os.path.abspath(_ingest_dir))

    try:
        from db.neon import get_pending_urls
    except ImportError:
        logger.error("Cannot import db.neon — check PYTHONPATH")
        return {"queued": 0, "error": "import_failed"}

    pending = get_pending_urls()
    logger.info("Found %d pending URLs to ingest", len(pending))

    queued = 0
    for record in pending:
        url = record.get("url", "")
        manufacturer = record.get("manufacturer", "")
        model = record.get("model", "")
        if url:
            ingest_url.delay(
                url=url,
                manufacturer=manufacturer,
                model=model,
                source_type="manual",
                # FAIL CLOSED (Gate 7 finding). This queue is assembled by
                # `mira-core db.neon.get_pending_urls` from several upstream
                # tables (`source_fingerprints` and friends); no column on
                # those rows records who submitted a URL or whether it is
                # public. "They are OEM manuals" was an assumption, not a
                # fact — and this whole unit exists because a feeder must
                # declare only what it can establish. It cannot, so it takes
                # the private floor. #3268's sources.yaml gate still refuses
                # uncurated hosts independently. Restoring shared status for
                # this path needs recoverable provenance first — filed.
                is_private=True,
            )
            queued += 1

    return {"queued": queued}
