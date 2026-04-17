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

        _write_config("TENANT_ID", tenant_id)
        _write_config("RELAY_URL", relay_url)

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
    import java.io.FileInputStream as FileInputStream
    import java.io.FileOutputStream as FileOutputStream
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
            finally:
                fis.close()

            props.setProperty(key, value)
            fos = FileOutputStream(f)
            try:
                props.store(fos, "Updated by MIRA Connect activation")
            finally:
                fos.close()
            return

    logger = system.util.getLogger("FactoryLM.Mira.Connect")
    logger.warn("No properties file found to write %s" % key)
