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
    from factorylm import gateway_live_snapshot   # recommended: project script library
except ImportError:
    try:
        import gateway_live_snapshot              # flat fallback (script path)
    except ImportError:
        gateway_live_snapshot = None
        # logged in _read_readings; the stream refuses to fall back to a second
        # read path, because a second read path is the defect being removed.

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

def _read_readings(folder):
    """Read all leaf tags under folder via THE shared reader.

    This used to be its own browse+read loop. It is now a thin adapter over
    gateway_live_snapshot.read_tag_readings — the same function the chat path
    uses — because "both transports render the same reading" was only true by
    coincidence while two separate loops both happened to call
    collector.build_reading. Two loops meant two behaviours:

      * this one recursed into folders/UDTs; the chat path did not, so it missed
        nested tags and tried to read folder nodes as tags
      * this one wrapped the WHOLE read in one try, so a short/ragged
        readBlocking result silently truncated the batch; the shared reader
        skips the individual tag instead and keeps the rest

    Only the wire format is injected here. All Ignition I/O stays in this file;
    the shared reader imports nothing from Ignition.
    """
    if gateway_live_snapshot is None:
        logger.error(
            "gateway_live_snapshot not importable — deploy it beside collector.py; "
            "streaming is disabled rather than falling back to a second read path"
        )
        return []

    def _browse(f):
        return system.tag.browseTags(parentPath=f)

    def _read(paths):
        return system.tag.readBlocking(paths)

    return gateway_live_snapshot.read_tag_readings(_browse, _read, folder)


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
    # Canonical property names first, legacy second — the same shim as
    # api/chat/doPost.py. Both transports must accept BOTH spellings, or a
    # gateway configured for one of them silently loses the other. Before this,
    # the activation handler wrote only TENANT_ID and the chat path only read
    # MIRA_TENANT_ID, so activation enabled streaming and broke chat.
    tenant_id = (getMiraConfig("MIRA_TENANT_ID", "")
                 or getMiraConfig("TENANT_ID", ""))
    hmac_key = (getMiraConfig("MIRA_IGNITION_HMAC_KEY", "")
                or getMiraConfig("MIRA_HMAC_KEY", ""))
    tag_folder = getMiraConfig("STREAM_TAG_FOLDER", "[default]Mira_Monitored")
    source_conn = getMiraConfig("STREAM_SOURCE_CONNECTION_ID", "") or None

    if not tenant_id or not hmac_key:
        logger.warn(
            "MIRA tag-stream not configured — need MIRA_TENANT_ID (or legacy "
            "TENANT_ID) and MIRA_IGNITION_HMAC_KEY (or legacy MIRA_HMAC_KEY)"
        )
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
