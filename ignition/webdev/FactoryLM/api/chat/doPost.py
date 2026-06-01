# Web Dev Module Handler: POST /system/webdev/FactoryLM/api/chat
#
# Reads live tag snapshot for an asset, forwards query + context to
# mira-pipeline's OpenAI-compatible /v1/chat/completions endpoint, splits
# inline "--- Sources ---" citations off the answer, persists to
# mira_chat_history, and returns {answer, sources} to the iframe UI.
#
# This handler used to call the legacy mira-sidecar /rag endpoint
# (ChromaDB RAG on localhost:5000). It now targets mira-pipeline so the
# Ignition portal inherits the GSD engine (intent classifier, UNS gate,
# hybrid RAG, citation compliance, cascade Groq -> Cerebras -> Gemini).
#
# Config is read from data/factorylm/factorylm.properties — see SECTION 1
# of factorylm.properties.template for the keys.
#
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev

import re


logger = system.util.getLogger("FactoryLM.Mira.Chat")


# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------

def _getMiraConfig(key, default_value=""):
    """Read a key from factorylm.properties on the Gateway host.

    Returns default_value if the file is missing or the key is absent.
    """
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
        if not f.exists():
            continue
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
# Source-splitting (matches mira-scan-monday/backend/mira_rag.py)
#
# mira-pipeline returns plain text in choices[0].message.content. The engine
# appends a trailing "--- Sources ---" block with "[N] Title" lines. We split
# that off so the Ignition UI's collapsible Sources panel can render them.
# ---------------------------------------------------------------------------

_SOURCE_LINE_RE = re.compile(r"^\s*\[(\d+)\]\s*(.+?)\s*$")
_SOURCE_HEADER_RE = re.compile(r"\n\s*-{3,}\s*Sources\s*-{3,}\s*\n")


def _split_sources(content):
    """Return (answer_without_trailing_sources, [{file, page, excerpt}, ...])."""
    if not content:
        return "", []
    parts = _SOURCE_HEADER_RE.split(content, maxsplit=1)
    answer = parts[0].strip()
    sources = []
    if len(parts) > 1:
        for line in parts[1].splitlines():
            m = _SOURCE_LINE_RE.match(line)
            if not m:
                continue
            title = m.group(2)
            # Surface "filename — page N" as separate fields when present,
            # otherwise leave page empty. The UI renders both.
            page = ""
            file_title = title
            page_match = re.search(r"\s+[-—]\s+page\s+([\w.-]+)\s*$", title, re.IGNORECASE)
            if page_match:
                page = page_match.group(1)
                file_title = title[: page_match.start()].strip()
            sources.append({"file": file_title, "page": page, "excerpt": ""})
    return answer, sources


# ---------------------------------------------------------------------------
# Live tag snapshot
# ---------------------------------------------------------------------------

def _read_tag_snapshot(asset_id):
    """Read all tags under [default]Mira_Monitored/<asset_id>.

    Returns a {tag_path: {value, quality, timestamp}} dict. Never raises.
    """
    snapshot = {}
    if not asset_id:
        return snapshot

    tag_folder = "[default]Mira_Monitored/%s" % asset_id
    try:
        tag_results = system.tag.browseTags(parentPath=tag_folder)
        tag_paths = [str(t.fullPath) for t in tag_results]
        if not tag_paths:
            logger.debug("No tags found under %s" % tag_folder)
            return snapshot

        tag_values = system.tag.readBlocking(tag_paths)
        for i, path in enumerate(tag_paths):
            qv = tag_values[i]
            snapshot[path] = {
                "value": str(qv.value),
                "quality": str(qv.quality),
                "timestamp": str(qv.timestamp),
            }
        logger.debug("Tag snapshot for %s: %d tags read" % (asset_id, len(snapshot)))
    except Exception as e:
        logger.warn("Tag read failed for asset %s: %s" % (asset_id, str(e)))

    return snapshot


def _format_tag_snapshot(snapshot):
    """Render a tag snapshot dict into a compact text block for the LLM."""
    if not snapshot:
        return "No live tag data available."
    lines = ["Current tag values:"]
    for tag_path, qv in snapshot.items():
        # Trim the [default]Mira_Monitored/<asset>/ prefix for readability
        short = tag_path.split("/")[-1] if "/" in tag_path else tag_path
        lines.append("  %s = %s (quality=%s)" % (short, qv["value"], qv["quality"]))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Pipeline call
# ---------------------------------------------------------------------------

def _call_pipeline(base_url, api_key, model, timeout_sec, chat_id, user_message):
    """POST to {base_url}/v1/chat/completions and return parsed JSON.

    Raises urllib2.HTTPError / urllib2.URLError on transport errors so the
    caller can map them to HTTP status codes.
    """
    import urllib2
    import json

    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": user_message}],
        "stream": False,
        "user": chat_id,
    })

    url = "%s/v1/chat/completions" % base_url.rstrip("/")
    req = urllib2.Request(url, payload)
    req.add_header("Content-Type", "application/json")
    if api_key:
        req.add_header("Authorization", "Bearer %s" % api_key)
    # mira-pipeline reads this header to scope FSM state per Ignition asset
    if chat_id:
        req.add_header("X-OpenWebUI-Chat-Id", chat_id)

    response = urllib2.urlopen(req, timeout=timeout_sec)
    return json.loads(response.read())


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------

def doPost(request, session):
    import urllib2

    data = request.get("postData", {})
    if data is None:
        data = {}

    query = data.get("query", "").strip()
    asset_id = data.get("asset_id", "").strip()
    operator = data.get("operator", "")

    if not query:
        logger.warn("Chat request received with empty query")
        return {"json": {"error": "query is required"}, "status": 400}

    logger.debug(
        "Chat request -- asset: %s, query: %.80s" % (asset_id or "(none)", query)
    )

    # Load pipeline config
    base_url = _getMiraConfig("PIPELINE_BASE_URL", "https://app.factorylm.com")
    api_key = _getMiraConfig("PIPELINE_API_KEY", "")
    model = _getMiraConfig("PIPELINE_MODEL", "mira-diagnostic")
    try:
        timeout_sec = int(_getMiraConfig("PIPELINE_TIMEOUT_SEC", "60"))
    except (TypeError, ValueError):
        timeout_sec = 60

    # Build the user message with live tag context prepended. The engine sees
    # the snapshot as part of the user turn; the system prompt and UNS gate
    # are owned by mira-pipeline and should not be re-templated here.
    snapshot = _read_tag_snapshot(asset_id)
    snapshot_block = _format_tag_snapshot(snapshot)
    asset_line = "Asset: %s" % asset_id if asset_id else "Asset: (unspecified)"
    user_message = "%s\n%s\n\nQuestion: %s" % (asset_line, snapshot_block, query)

    # chat_id scopes FSM state per asset; technician identity (if known) is
    # appended so the same asset, used by different operators, gets distinct
    # sessions. Fall back to asset_id or a generic key.
    chat_id_parts = []
    if asset_id:
        chat_id_parts.append("ignition-%s" % asset_id)
    if operator:
        chat_id_parts.append(operator)
    chat_id = "-".join(chat_id_parts) if chat_id_parts else "ignition-anonymous"

    try:
        result = _call_pipeline(
            base_url=base_url,
            api_key=api_key,
            model=model,
            timeout_sec=timeout_sec,
            chat_id=chat_id,
            user_message=user_message,
        )
    except urllib2.HTTPError as e:
        body = ""
        try:
            body = e.read()
        except Exception:
            pass
        logger.error(
            "mira-pipeline returned HTTP %d: %s" % (e.code, body[:200])
        )
        return {
            "json": {
                "error": "mira-pipeline returned an error",
                "http_status": e.code,
                "detail": body[:200],
            },
            "status": 502,
        }
    except urllib2.URLError as e:
        logger.error("mira-pipeline unreachable: %s" % str(e))
        return {
            "json": {
                "error": "mira-pipeline unreachable",
                "detail": str(e),
            },
            "status": 503,
        }
    except Exception as e:
        logger.error("Unexpected error calling mira-pipeline: %s" % str(e))
        return {
            "json": {
                "error": "Internal error",
                "detail": str(e),
            },
            "status": 500,
        }

    # Extract assistant content from the OpenAI-compat envelope
    try:
        raw_content = result["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        logger.warn("Unexpected mira-pipeline payload: %s" % str(result)[:200])
        raw_content = ""

    answer, sources = _split_sources(raw_content)

    # Persist to chat history (non-fatal; audit trail only)
    try:
        import json as _json
        sources_json = _json.dumps(sources)
        system.db.runPrepUpdate(
            "INSERT INTO mira_chat_history "
            "(asset_id, query, answer, sources_json, operator, created_at) "
            "VALUES (?, ?, ?, ?, ?, NOW())",
            [asset_id, query, answer, sources_json, operator],
        )
    except Exception as e:
        logger.warn("Chat history save failed: %s" % str(e))

    logger.info(
        "Chat query completed -- asset: %s, chat_id: %s, query: %.80s" % (
            asset_id, chat_id, query,
        )
    )

    return {"json": {"answer": answer, "sources": sources}}
