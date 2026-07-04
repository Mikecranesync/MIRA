# Gateway Timer Script — MIRA Connect Tag Streamer (customer-deployable collector)
# Schedule: Fixed Rate, default 2000 ms (configurable via STREAM_INTERVAL_MS in
#           the timer-script settings — NOT read here; it's the schedule itself).
#
# WHAT IT DOES
#   Browses the configured tag folder, reads every leaf tag (READ-ONLY — never
#   writes a tag), keeps only allowlisted tags, and POSTs them to the MIRA
#   cloud tag-ingest endpoint (POST /api/v1/tags/ingest) as an HMAC-signed
#   Phase-2 batch. The relay enforces the allowlist again (defense in depth),
#   resolves UNS paths, appends to tag_events, and upserts current_tag_state.
#
# WHY THE CHANGE (gap-closure plan §3 G8)
#   The previous version posted the legacy {type:"tags", equipment:{...}} shape
#   UNSIGNED to /ingest. This version signs every request with HMAC-SHA256
#   (X-MIRA-* headers) using the per-tenant key, enforces the allowlist
#   gateway-side, and uses the Phase-2 contract. The cloud relay's
#   MIRA_IGNITION_HMAC_KEY must match (see docs/integrations/ignition-tag-collector.md).
#
# READ-ONLY GUARANTEE
#   Only system.tag.browseTags + system.tag.readBlocking are used. No
#   system.tag.write*, no PLC write of any kind — per ADR-0021 and
#   .claude/rules/fieldbus-readonly.md.
#
# CONFIG (factorylm.properties, via getMiraConfig):
#   INGEST_URL                 — MIRA tag-ingest endpoint
#                                (default https://api.factorylm.com/api/v1/tags/ingest)
#   TENANT_ID                  — tenant UUID from activation
#   MIRA_HMAC_KEY              — per-tenant HMAC signing key (matches the relay)
#   STREAM_TAG_FOLDER          — root tag folder (default [default]Mira_Monitored)
#   STREAM_SOURCE_CONNECTION_ID— optional connection id stamped on every row
#   STREAM_MAX_RETRIES         — POST retry attempts (default 3)
#
# DEPLOYMENT
#   collector.py, signing.py, allowlist.py (the pure logic) must be importable.
#   Recommended: place them in the Ignition project script library as
#   `factorylm` so this timer does `from factorylm import collector`. The
#   integration doc covers both that and the flat-script-path fallback.
#
# Jython 2.7 — runs inside the Ignition Gateway JVM.
# ruff: noqa: F821, I001  — `system` is injected by the Jython runtime; imports
#   inside try/except blocks are intentional fallback chains, not sortable.

logger = system.util.getLogger("FactoryLM.Mira.TagStream")


# ---------------------------------------------------------------------------
# Collector core import (pure logic — see api/tags/collector.py)
# ---------------------------------------------------------------------------

try:
    from factorylm import collector            # recommended: project script library
except ImportError:
    try:
        import collector                       # flat fallback (modules on script path)
    except ImportError:
        collector = None
        logger.error(
            "MIRA collector module not importable — deploy collector.py/signing.py/"
            "allowlist.py to the project script library. See "
            "docs/integrations/ignition-tag-collector.md"
        )


# ---------------------------------------------------------------------------
# Config helper — shared with other MIRA gateway scripts
# ---------------------------------------------------------------------------

def getMiraConfig(key, default_value=""):
    import java.io.FileInputStream as FileInputStream
    import java.util.Properties as Properties
    import java.io.File as File

    paths = [
        "C:/Program Files/Inductive Automation/Ignition/data/factorylm/factorylm.properties",
        "/usr/local/bin/ignition/data/factorylm/factorylm.properties",
        "/var/lib/ignition/data/factorylm/factorylm.properties",
    ]

    for p in paths:
        f = File(p)
        if f.exists():
            props = Properties()
            fis = FileInputStream(f)
            try:
                props.load(fis)
                return props.getProperty(key, default_value)
            except Exception as load_err:
                logger.warn("Failed to load properties from %s: %s" % (p, str(load_err)))
            finally:
                fis.close()

    return default_value


# ---------------------------------------------------------------------------
# Tag reading (READ-ONLY)
# ---------------------------------------------------------------------------

def _browse_leaf_tags(folder):
    """Browse a tag folder recursively; return full paths of all leaf tags."""
    leaf_paths = []
    try:
        results = system.tag.browseTags(parentPath=folder)
        for tag in results:
            tag_type = str(tag.type).lower()
            if tag_type in ("folder", "udtinst"):
                leaf_paths.extend(_browse_leaf_tags(str(tag.fullPath)))
            else:
                leaf_paths.append(str(tag.fullPath))
    except Exception as e:
        logger.warn("Browse failed for %s: %s" % (folder, str(e)))
    return leaf_paths


def _read_readings(folder):
    """Read all leaf tags under folder. Returns a list of Phase-2 reading dicts
    (full tag path retained so the allowlist + relay can match)."""
    paths = _browse_leaf_tags(folder)
    if not paths:
        return []

    readings = []
    try:
        qvs = system.tag.readBlocking(paths)
        for i, path in enumerate(paths):
            qv = qvs[i]
            readings.append(
                collector.build_reading(
                    tag_path=path,
                    value=qv.value,
                    ignition_quality=str(qv.quality),
                    ts=str(qv.timestamp),
                )
            )
    except Exception as e:
        logger.warn("Bulk tag read failed: %s" % str(e))
    return readings


# ---------------------------------------------------------------------------
# HTTP POST adapter — wraps system.net for collector.post_with_retry
# ---------------------------------------------------------------------------

def _make_post_fn():
    import system.net

    def _post(url, body_bytes, headers, timeout_ms):
        # HTTP/1.1 pinned: Java's HttpClient defaults to HTTP_2 and sends an
        # h2c Upgrade on plain http://, which uvicorn/httptools answers by
        # dropping the request body — the relay then hashes an empty body and
        # rejects every POST with 401 signature_mismatch (bench-proven 2026-07-03).
        client = system.net.httpClient(version="HTTP_1_1")
        return client.post(
            url,
            data=body_bytes,
            headers=headers,
            timeout=timeout_ms,
        )

    return _post


# ---------------------------------------------------------------------------
# Main timer entry point
# ---------------------------------------------------------------------------

def run():
    if collector is None:
        return  # error already logged at import

    ingest_url = getMiraConfig("INGEST_URL", collector.DEFAULT_INGEST_URL)
    tenant_id = getMiraConfig("TENANT_ID", "")
    hmac_key = getMiraConfig("MIRA_HMAC_KEY", "")
    tag_folder = getMiraConfig("STREAM_TAG_FOLDER", "[default]Mira_Monitored")
    source_conn = getMiraConfig("STREAM_SOURCE_CONNECTION_ID", "") or None

    if not tenant_id or not hmac_key:
        logger.warn("MIRA tag-stream not configured (TENANT_ID / MIRA_HMAC_KEY missing)")
        return

    try:
        max_retries = int(getMiraConfig("STREAM_MAX_RETRIES", "3"))
    except ValueError:
        max_retries = 3

    readings = _read_readings(tag_folder)
    if not readings:
        logger.trace("No tags found in %s" % tag_folder)
        return

    # Allowlist enforcement (fail-closed) — gateway-side filter before egress.
    allowed = collector.filter_allowlisted(readings, collector.load_allowlist_set())
    if not allowed:
        logger.trace("No allowlisted tags to stream (browsed %d)" % len(readings))
        return

    payload = collector.build_payload(tenant_id, allowed, source_connection_id=source_conn)
    result = collector.post_with_retry(
        _make_post_fn(),
        ingest_url,
        hmac_key,
        tenant_id,
        payload,
        max_retries=max_retries,
        sleep_fn=lambda s: __import__("time").sleep(s),
    )

    if result["ok"]:
        logger.trace(
            "Streamed %d/%d allowlisted tags (attempts=%d)"
            % (len(allowed), len(readings), result["attempts"])
        )
    else:
        logger.warn(
            "Tag ingest failed status=%s attempts=%s"
            % (result["status"], result["attempts"])
        )


run()
