# Web Dev Module Handler: POST /system/webdev/FactoryLM/api/ingest
# Receives document file path (written by Perspective onFileReceived),
# validates the file exists on the Gateway filesystem,
# then relays to RAG sidecar for chunking + embedding.
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev

# Allowed document extensions for ingest
ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".xlsx", ".csv"]

# Maximum file size: 50 MB
MAX_FILE_BYTES = 50 * 1024 * 1024


def doPost(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Ingest")

    # --- Parse request body ---
    data = request.get("postData", {})
    if data is None:
        data = {}

    filename = data.get("filename", "").strip()
    asset_id = data.get("asset_id", "").strip()
    file_path = data.get("path", "").strip()
    doc_type = data.get("doc_type", "manual")  # e.g. "manual", "sop", "schematic"

    # Validate required fields
    if not filename:
        logger.warn("Ingest request missing filename")
        return {"json": {"error": "filename is required"}, "status": 400}

    if not file_path:
        logger.warn("Ingest request missing path for file: %s" % filename)
        return {"json": {"error": "path is required"}, "status": 400}

    if not asset_id:
        logger.warn("Ingest request missing asset_id for file: %s" % filename)
        return {"json": {"error": "asset_id is required"}, "status": 400}

    # --- Validate file extension ---
    import java.io.File as File

    lower_name = filename.lower()
    extension_ok = False
    for ext in ALLOWED_EXTENSIONS:
        if lower_name.endswith(ext):
            extension_ok = True
            break

    if not extension_ok:
        logger.warn(
            "Ingest rejected — unsupported file type: %s (asset: %s)"
            % (filename, asset_id)
        )
        return {
            "json": {
                "error": "Unsupported file type",
                "allowed": ALLOWED_EXTENSIONS
            },
            "status": 400
        }

    # --- Validate file exists on Gateway filesystem ---
    f = File(file_path)

    if not f.exists():
        logger.warn(
            "Ingest rejected — file not found at path: %s (asset: %s)"
            % (file_path, asset_id)
        )
        return {
            "json": {
                "error": "File not found on Gateway filesystem",
                "path": file_path
            },
            "status": 404
        }

    if not f.isFile():
        logger.warn(
            "Ingest rejected — path is not a regular file: %s" % file_path
        )
        return {
            "json": {
                "error": "Path is not a regular file",
                "path": file_path
            },
            "status": 400
        }

    # --- Check file size ---
    file_size = f.length()
    if file_size > MAX_FILE_BYTES:
        logger.warn(
            "Ingest rejected — file too large: %s is %d bytes (max %d)"
            % (filename, file_size, MAX_FILE_BYTES)
        )
        return {
            "json": {
                "error": "File exceeds maximum allowed size of 50 MB",
                "size_bytes": file_size,
                "max_bytes": MAX_FILE_BYTES
            },
            "status": 413
        }

    logger.info(
        "Ingest request validated — file: %s, asset: %s, size: %d bytes"
        % (filename, asset_id, file_size)
    )

    # --- Forward ingest request to RAG sidecar ---
    import urllib2
    import json

    sidecar_payload = json.dumps({
        "filename": filename,
        "asset_id": asset_id,
        "path": file_path,
        "doc_type": doc_type,
        "size_bytes": file_size
    })

    try:
        req = urllib2.Request(
            "http://localhost:5000/ingest",
            sidecar_payload,
            {"Content-Type": "application/json"}
        )
        # Longer timeout — ingest can involve parsing + embedding large PDFs
        response = urllib2.urlopen(req, timeout=120)
        result = json.loads(response.read())

        logger.info(
            "Ingest queued by sidecar — file: %s, asset: %s, job_id: %s"
            % (filename, asset_id, result.get("job_id", "unknown"))
        )

        return {
            "json": {
                "status": "queued",
                "filename": filename,
                "asset_id": asset_id,
                "job_id": result.get("job_id", ""),
                "message": result.get("message", "Document queued for processing")
            }
        }

    except urllib2.HTTPError as e:
        body = ""
        try:
            body = e.read()
        except Exception:
            pass
        logger.error(
            "RAG sidecar ingest returned HTTP %d for %s: %s"
            % (e.code, filename, body[:200])
        )
        return {
            "json": {
                "error": "RAG sidecar returned error during ingest",
                "http_status": e.code,
                "detail": body[:200]
            },
            "status": 502
        }
    except urllib2.URLError as e:
        logger.error(
            "RAG sidecar unreachable during ingest of %s: %s" % (filename, str(e))
        )
        return {
            "json": {
                "error": "RAG sidecar unreachable",
                "detail": str(e)
            },
            "status": 503
        }
    except Exception as e:
        logger.error(
            "Unexpected error during ingest of %s: %s" % (filename, str(e))
        )
        return {
            "json": {
                "error": "Internal error during ingest",
                "detail": str(e)
            },
            "status": 500
        }
