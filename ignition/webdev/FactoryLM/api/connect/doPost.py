# Web Dev Module Handler: POST /system/webdev/FactoryLM/api/connect
# Accepts an activation code from the Perspective ConnectSetup page,
# validates it against mira-web, and writes tenant_id + relay_url to
# factorylm.properties so tag-stream.py can begin streaming.
# Jython 2.7 — runs inside Ignition Gateway JVM.

import json


def doPost(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Connect")

    data = request.get("postData", {})
    if data is None:
        data = {}

    code = data.get("code", "").strip()
    if not code:
        return {"json": {"error": "code is required"}, "status": 400}

    activate_url = _get_config("MIRA_WEB_URL", "https://factorylm.com") + "/api/connect/activate"
    hostname = system.net.getHostName()

    payload = json.dumps({
        "code": code,
        "agent_id": "ignition-%s" % hostname,
        "gateway_hostname": hostname,
    })

    try:
        client = system.net.httpClient()
        response = client.post(
            activate_url,
            data=payload,
            headers={"Content-Type": "application/json"},
            timeout=10000,
        )

        if response.statusCode != 200:
            body = response.text[:200] if response.text else "unknown error"
            logger.warn("Activation failed (%d): %s" % (response.statusCode, body))
            try:
                err = json.loads(response.text)
                return {"json": {"error": err.get("error", body)}, "status": response.statusCode}
            except Exception:
                return {"json": {"error": body}, "status": response.statusCode}

        result = json.loads(response.text)
        tenant_id = result.get("tenant_id", "")
        relay_url = result.get("relay_url", "")

        if not tenant_id or not relay_url:
            logger.warn("Activation response missing tenant_id or relay_url")
            return {"json": {"error": "Invalid activation response"}, "status": 502}

        # Write BOTH spellings of the tenant id. Activation previously wrote only
        # TENANT_ID, which the tag stream reads — but the chat handler reads
        # MIRA_TENANT_ID, so a successful activation enabled streaming and left
        # chat unconfigured. Both readers now accept either name; writing both
        # keeps a gateway activated by an OLD build working with a NEW script and
        # vice versa, which is the only reason this is a pair and not a rename.
        #
        # RELAY_URL is what the stream reads when no manual INGEST_URL override
        # is set (tag-stream.py reads INGEST_URL first, then RELAY_URL).
        # Deliberately NOT writing INGEST_URL: that key is the operator's manual
        # override, and activation must not clobber it.
        persisted = True
        persisted = _write_config("MIRA_TENANT_ID", tenant_id) and persisted
        persisted = _write_config("TENANT_ID", tenant_id) and persisted
        persisted = _write_config("RELAY_URL", relay_url) and persisted

        if not persisted:
            # Reporting "activated" here would be a lie the operator cannot
            # see: the server accepted the code, but this gateway persisted
            # nothing, so the stream and chat would stay unconfigured with no
            # visible error anywhere.
            logger.error(
                "Activation for tenant %s was ACCEPTED by the server but "
                "factorylm.properties could not be created or written on this "
                "gateway — configuration was NOT persisted" % tenant_id
            )
            return {
                "json": {
                    "error": (
                        "Activation was accepted but this gateway could not "
                        "persist its configuration (no writable "
                        "factorylm.properties location). Configure tenant %s "
                        "manually — see docs/integrations/"
                        "ignition-tag-collector.md." % tenant_id
                    ),
                    "tenant_id": tenant_id,
                    "relay_url": relay_url,
                },
                "status": 500,
            }

        # NOTE: activation does not provision the HMAC key — it is a per-tenant
        # secret installed out of band (see docs/integrations/ignition-tag-collector.md).
        # Chat fails closed with HTTP 503 until it is present, by design.

        logger.info("MIRA Connect activated — tenant: %s, relay: %s" % (tenant_id, relay_url))

        return {
            "json": {
                "status": "activated",
                "tenant_id": tenant_id,
                "relay_url": relay_url,
            }
        }

    except Exception as e:
        logger.error("Activation request failed: %s" % str(e))
        return {"json": {"error": "Activation request failed: %s" % str(e)}, "status": 503}


def _get_config(key, default_value=""):
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
            except Exception:
                pass
            finally:
                fis.close()

    return default_value


def _write_config(key, value):
    """Persist key=value to factorylm.properties. Returns True ONLY when the
    value actually reached disk.

    This used to silently no-op when no properties file existed: it logged a
    warning and fell off the end, and doPost() reported "activated" anyway —
    a clean gateway (fresh install, properties file never deployed) accepted
    the activation code, persisted nothing, and gave the operator no visible
    error. Now: an existing file is updated in place; with no file anywhere,
    one is CREATED under the first Ignition data dir present on this install;
    if neither works, return False so the caller fails the activation loudly.
    """
    import java.io.FileInputStream as FileInputStream
    import java.io.FileOutputStream as FileOutputStream
    import java.util.Properties as Properties
    import java.io.File as File

    logger = system.util.getLogger("FactoryLM.Mira.Connect")

    paths = [
        "C:/Program Files/Inductive Automation/Ignition/data/factorylm/factorylm.properties",
        "/usr/local/bin/ignition/data/factorylm/factorylm.properties",
        "/var/lib/ignition/data/factorylm/factorylm.properties",
    ]

    # 1) Update an existing file in place.
    for p in paths:
        try:
            f = File(p)
            if f.exists():
                props = Properties()
                fis = FileInputStream(f)
                try:
                    props.load(fis)
                finally:
                    fis.close()

                props.setProperty(key, value)
                fos = FileOutputStream(f)
                try:
                    props.store(fos, "Updated by MIRA Connect activation")
                finally:
                    fos.close()
                return True
        except Exception as e:
            logger.warn("Could not update %s in %s: %s" % (key, p, str(e)))
            # fall through and try the next candidate

    # 2) No file anywhere — create one under the first Ignition data dir that
    #    exists (paths are <data>/factorylm/factorylm.properties, so the
    #    grandparent is the data dir).
    for p in paths:
        try:
            f = File(p)
            factorylm_dir = f.getParentFile()
            data_dir = factorylm_dir.getParentFile() if factorylm_dir is not None else None
            if data_dir is None or not data_dir.exists():
                continue
            if not factorylm_dir.exists():
                factorylm_dir.mkdirs()
            props = Properties()
            props.setProperty(key, value)
            fos = FileOutputStream(f)
            try:
                props.store(fos, "Created by MIRA Connect activation")
            finally:
                fos.close()
            logger.info("Created %s to persist %s" % (p, key))
            return True
        except Exception as e:
            logger.warn("Could not create %s for %s: %s" % (p, key, str(e)))

    logger.error(
        "Could not persist %s — no factorylm.properties exists and no Ignition "
        "data directory was writable" % key
    )
    return False
