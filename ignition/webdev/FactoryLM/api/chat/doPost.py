# Web Dev Module Handler: POST /system/webdev/FactoryLM/api/chat
# Reads live tag snapshot for an asset, forwards query + context to MIRA Cloud,
# persists result to mira_chat_history, returns answer + sources.
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev
#
# D2: repointed from localhost:5000/rag (legacy sidecar) to MIRA Cloud
#     POST /api/v1/ignition/chat.  URL is env-var driven via getMiraConfig
#     so staging/dev installations can override the default.
#
# HMAC signing: matches the contract expected by mira-pipeline/ignition_chat.py
#   _verify_hmac().  Four required headers:
#     X-MIRA-Tenant   — tenant UUID from factorylm.properties TENANT_ID
#     X-MIRA-Nonce    — millisecond epoch (uniqueness token, NOT constrained)
#     X-MIRA-Timestamp — UNIX seconds (constrained to ±300 s by cloud verifier)
#     X-MIRA-Signature — lowercase hex HMAC-SHA256 over signed_string
#   signed_string = tenant + "\n" + nonce + "\n" + timestamp + "\n" + sha256_hex(body_bytes)
#   Key: getMiraConfig("MIRA_HMAC_KEY") — must equal cloud MIRA_IGNITION_HMAC_KEY
#
# IMPORTANT: If MIRA_HMAC_KEY is absent the request is sent WITHOUT auth headers.
#   The current cloud endpoint (_verify_hmac) will reject unsigned requests with
#   HTTP 401.  Configure MIRA_HMAC_KEY in factorylm.properties to enable signed
#   chat.  The unsigned fallback is retained only so that the WebDev handler does
#   not hard-fail on gateways that have not yet set the key — the 401 response is
#   surfaced to the Perspective panel as a clear error rather than a silent crash.
#
# Response mapping:
#   Cloud returns: {answer, sources[], citations[], confidence, suggested_actions[]}
#   This handler passes the full dict through to the Perspective ChatPanel.
#   sources[] is currently [] (engine returns empty list until D3 populates it).
#   ChatPanel renders answer + sources when present; degrades cleanly when empty.


# ---------------------------------------------------------------------------
# Config helper — copied verbatim from gateway-scripts/tag-stream.py
# ---------------------------------------------------------------------------

def _getMiraConfig(key, default_value=""):
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
                pass
            finally:
                fis.close()

    return default_value


# ---------------------------------------------------------------------------
# HMAC signing — matches mira-pipeline/ignition_chat.py _verify_hmac exactly
# ---------------------------------------------------------------------------

def _sha256_hex(data_bytes):
    """Return lowercase hex SHA-256 of data_bytes using javax.security."""
    import java.security.MessageDigest as MessageDigest

    md = MessageDigest.getInstance("SHA-256")
    raw = md.digest(data_bytes)

    hex_chars = "0123456789abcdef"
    out = []
    for b in raw:
        b_int = b if b >= 0 else b + 256
        out.append(hex_chars[b_int >> 4])
        out.append(hex_chars[b_int & 0xF])
    return "".join(out)


def _hmac_sha256_hex(key_str, message_str):
    """Return lowercase hex HMAC-SHA256(key_str, message_str)."""
    import javax.crypto.Mac as Mac
    import javax.crypto.spec.SecretKeySpec as SecretKeySpec

    mac = Mac.getInstance("HmacSHA256")
    secret = SecretKeySpec(key_str.encode("UTF-8"), "HmacSHA256")
    mac.init(secret)
    raw = mac.doFinal(message_str.encode("UTF-8"))

    hex_chars = "0123456789abcdef"
    out = []
    for b in raw:
        b_int = b if b >= 0 else b + 256
        out.append(hex_chars[b_int >> 4])
        out.append(hex_chars[b_int & 0xF])
    return "".join(out)


def _build_signed_headers(body_str, tenant_id, hmac_key, logger):
    """Return headers dict with HMAC auth for a MIRA Cloud chat request.

    signed_string = tenant + "\\n" + nonce + "\\n" + timestamp_secs + "\\n" + sha256_hex(body_bytes)

    This exactly matches the _verify_hmac contract in mira-pipeline/ignition_chat.py.
    Nonce is millisecond epoch (uniqueness only, not constrained by the verifier).
    Timestamp is UNIX seconds (constrained to +-300 s by the verifier).
    """
    import java.lang.System as JSystem

    millis = str(JSystem.currentTimeMillis())
    # Timestamp must be UNIX seconds, not millis
    timestamp_secs = str(int(JSystem.currentTimeMillis() / 1000))

    body_hash = _sha256_hex(body_str.encode("UTF-8"))
    signed_string = tenant_id + "\n" + millis + "\n" + timestamp_secs + "\n" + body_hash

    try:
        signature = _hmac_sha256_hex(hmac_key, signed_string)
    except Exception as sign_err:
        logger.warn(
            "HMAC signing failed — falling back to unsigned POST (will receive 401): %s"
            % str(sign_err)
        )
        return {"Content-Type": "application/json"}

    return {
        "Content-Type": "application/json",
        "X-MIRA-Tenant": tenant_id,
        "X-MIRA-Nonce": millis,
        "X-MIRA-Timestamp": timestamp_secs,
        "X-MIRA-Signature": signature,
    }


# ---------------------------------------------------------------------------
# WebDev handler
# ---------------------------------------------------------------------------

def doPost(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Chat")

    # --- Parse request body ---
    # 'postData' is a dict when Content-Type is application/json
    data = request.get("postData", {})
    if data is None:
        data = {}

    query = data.get("query", "").strip()
    asset_id = data.get("asset_id", "").strip()
    extra_context = data.get("context", "")
    operator = data.get("operator", "")

    # Validate required field
    if not query:
        logger.warn("Chat request received with empty query")
        return {"json": {"error": "query is required"}, "status": 400}

    logger.debug(
        "Chat request — asset: %s, query: %.80s" % (asset_id or "(none)", query)
    )

    # --- Read live tag snapshot for this asset ---
    snapshot = {}

    if asset_id:
        tag_folder = "[default]Mira_Monitored/%s" % asset_id
        try:
            # Browse all tags (OPC + Memory) in the asset folder
            tag_results = system.tag.browseTags(parentPath=tag_folder)
            tag_paths = [str(t.fullPath) for t in tag_results]

            if tag_paths:
                tag_values = system.tag.readBlocking(tag_paths)
                for i, path in enumerate(tag_paths):
                    qv = tag_values[i]
                    snapshot[path] = {
                        "value": str(qv.value),
                        "quality": str(qv.quality),
                        "timestamp": str(qv.timestamp)
                    }
                logger.debug(
                    "Tag snapshot for %s: %d tags read" % (asset_id, len(snapshot))
                )
            else:
                logger.debug("No tags found under %s" % tag_folder)

        except Exception as e:
            # Non-fatal — proceed without snapshot; log for debugging
            logger.warn(
                "Tag read failed for asset %s: %s" % (asset_id, str(e))
            )

    # --- Build cloud request payload ---
    # NOTE: D1 (allowlist enforcement) is not applied here — that is the
    # responsibility of ignition/webdev/FactoryLM/api/tags/doGet.py.  When D1
    # ships, snapshot will already be limited to allowlisted paths upstream.
    # The cloud endpoint receives whatever snapshot this handler assembled.
    cloud_payload = system.util.jsonEncode({
        "query": query,
        "asset_id": asset_id,
        "asset_context": {},
        "tag_snapshot": snapshot,
        "context": extra_context
    })

    # --- Load config ---
    tenant_id = _getMiraConfig("TENANT_ID", "")
    hmac_key = _getMiraConfig("MIRA_HMAC_KEY", "")
    cloud_url = _getMiraConfig(
        "MIRA_CLOUD_CHAT_URL",
        "https://api.factorylm.com/api/v1/ignition/chat"
    )
    # Timeout in ms for system.net.httpClient
    timeout_ms = 30000

    # --- Build headers (signed if MIRA_HMAC_KEY is set) ---
    if hmac_key and tenant_id:
        try:
            headers = _build_signed_headers(cloud_payload, tenant_id, hmac_key, logger)
        except Exception as header_err:
            logger.warn(
                "Header build failed — sending unsigned POST (will receive 401): %s"
                % str(header_err)
            )
            headers = {"Content-Type": "application/json"}
    else:
        if not hmac_key:
            logger.warn(
                "MIRA_HMAC_KEY not set in factorylm.properties — "
                "sending unsigned POST. Cloud endpoint requires HMAC auth "
                "and will return 401. Configure MIRA_HMAC_KEY to enable signed chat."
            )
        if not tenant_id:
            logger.warn(
                "TENANT_ID not set in factorylm.properties — "
                "X-MIRA-Tenant header will be missing. "
                "Run MIRA Connect activation to set it."
            )
        headers = {"Content-Type": "application/json"}

    # --- POST to MIRA Cloud ---
    try:
        client = system.net.httpClient()
        response = client.post(
            cloud_url,
            data=cloud_payload,
            headers=headers,
            timeout=timeout_ms
        )

        if response.statusCode != 200:
            logger.error(
                "MIRA Cloud returned HTTP %d: %s"
                % (response.statusCode, (response.text or "")[:200])
            )
            return {
                "json": {
                    "error": "MIRA Cloud returned error",
                    "http_status": response.statusCode,
                    "detail": (response.text or "")[:200]
                },
                "status": 502
            }

        import json
        result = json.loads(response.text)

    except Exception as e:
        err_str = str(e)
        logger.error("MIRA Cloud POST failed: %s" % err_str)
        return {
            "json": {
                "error": "MIRA Cloud unreachable",
                "detail": err_str
            },
            "status": 503
        }

    # --- Persist to chat history ---
    try:
        import json as _json
        sources_json = _json.dumps(result.get("sources", []))
        answer = result.get("answer", "")

        system.db.runPrepUpdate(
            "INSERT INTO mira_chat_history "
            "(asset_id, query, answer, sources_json, operator, created_at) "
            "VALUES (?, ?, ?, ?, ?, NOW())",
            [asset_id, query, answer, sources_json, operator]
        )
    except Exception as e:
        # Non-fatal — chat history is audit trail, not critical path
        logger.warn("Chat history save failed: %s" % str(e))

    logger.info(
        "Chat query completed — asset: %s, query: %.80s" % (asset_id, query)
    )

    return {"json": result}
