# mira_chat - UNS-bound Ask-MIRA client for the Northwind CV-200 view.
#
# Calls POST /api/v1/ignition/chat (mira-pipeline) with HMAC auth, carrying the
# Northwind tenant + CV-200 asset_id + asset_context so the turn is UNS-certified
# (direct_connection -> no chat-gate) per PR #2362 handoff section 8. READ-ONLY:
# it asks and displays; it never writes a tag or commands the PLC.
#
# Config (read from factorylm.properties on the gateway, same mechanism as the
# tag-stream timer's getMiraConfig):
#   CHAT_URL       - defaults to https://api.factorylm.com/api/v1/ignition/chat
#   TENANT_ID      - Northwind tenant UUID (00000000-0000-0000-0000-0000000000b1)
#   MIRA_HMAC_KEY  - per-tenant HMAC key (matches the relay/pipeline MIRA_IGNITION_HMAC_KEY)
#
# DEPLOY-GATED: until MIRA_HMAC_KEY (and optionally CHAT_URL/TENANT_ID) are set in
# factorylm.properties this returns a clear, non-fatal error string shown in the
# panel - it never raises. The HMAC recipe matches mira-relay/auth.py:
#   signed = "{tenant}\n{nonce}\n{unix_seconds}\n{sha256_hex(body_bytes)}"
#   X-MIRA-Signature = hmac_sha256(MIRA_HMAC_KEY, signed)

CV200_ASSET_ID = "20000000-0002-0000-0000-000000000007"
CV200_ASSET_CONTEXT = {
    "equipment": "discharge_conveyor_cv200",
    "line": "line1",
    "area": "packaging",
    "site": "riverside",
}
DEFAULT_CHAT_URL = "https://api.factorylm.com/api/v1/ignition/chat"
DEFAULT_TENANT_ID = "00000000-0000-0000-0000-0000000000b1"

_PROP_PATHS = [
    "C:/Program Files/Inductive Automation/Ignition/data/factorylm/factorylm.properties",
    "/usr/local/bin/ignition/data/factorylm/factorylm.properties",
    "/var/lib/ignition/data/factorylm/factorylm.properties",
]


def _cfg(key, default=""):
    """Read one key from factorylm.properties (mirror of the tag-stream getMiraConfig)."""
    import java.io.FileInputStream as FileInputStream
    import java.util.Properties as Properties
    import java.io.File as File
    for p in _PROP_PATHS:
        try:
            if File(p).exists():
                props = Properties()
                fis = FileInputStream(p)
                try:
                    props.load(fis)
                finally:
                    fis.close()
                return props.getProperty(key, default)
        except:
            pass
    return default


def ask(question, tag_snapshot, log=None):
    """POST a UNS-bound, HMAC-signed chat turn for CV-200. Returns the parsed response dict.

    On misconfiguration or transport error it returns {"answer": "...", "sources": []}
    so the panel shows a message instead of throwing.
    """
    import hashlib
    import hmac
    from java.util import UUID

    chat_url = _cfg("CHAT_URL", DEFAULT_CHAT_URL)
    tenant = _cfg("TENANT_ID", DEFAULT_TENANT_ID)
    hkey = str(_cfg("MIRA_HMAC_KEY", ""))
    if not hkey:
        return {
            "answer": "Ask-MIRA is not configured yet: set MIRA_HMAC_KEY (and optionally "
                      "CHAT_URL / TENANT_ID) in factorylm.properties on this gateway.",
            "sources": [],
        }

    body = system.util.jsonEncode({
        "question": question,
        "asset_id": CV200_ASSET_ID,
        "asset_context": CV200_ASSET_CONTEXT,
        "tag_snapshot": tag_snapshot,
    })
    body_bytes = body.encode("utf-8")
    nonce = UUID.randomUUID().toString().replace("-", "")
    ts = str(int(system.date.now().getTime() / 1000))
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    signed = "%s\n%s\n%s\n%s" % (tenant, nonce, ts, body_hash)
    sig = hmac.new(hkey.encode("utf-8"), signed.encode("utf-8"), hashlib.sha256).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-MIRA-Tenant": tenant,
        "X-MIRA-Nonce": nonce,
        "X-MIRA-Timestamp": ts,
        "X-MIRA-Signature": sig,
    }

    client = system.net.httpClient(timeout=95000)
    resp = client.post(chat_url, data=body, headers=headers)
    status = getattr(resp, "statusCode", None)
    if log is not None:
        log.info("ASK post url=%s status=%s" % (chat_url, str(status)))
    if status == 422:
        # The endpoint enforces UNS: an asset-specific turn with no identifier is
        # rejected outright (never downgraded to a chat-gate). We always send
        # asset_id + asset_context, so this should not happen - surface it if it does.
        return {"answer": "MIRA rejected the turn as uns_required (422) - asset context missing.", "sources": []}
    return system.util.jsonDecode(resp.text)
