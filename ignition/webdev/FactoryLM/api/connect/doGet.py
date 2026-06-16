# Web Dev Module Handler: GET /system/webdev/FactoryLM/api/connect
# Returns the current MIRA Connect activation status.
# Jython 2.7 — runs inside Ignition Gateway JVM.


def doGet(request, session):
    import java.io.FileInputStream as FileInputStream
    import java.util.Properties as Properties
    import java.io.File as File

    paths = [
        "C:/Program Files/Inductive Automation/Ignition/data/factorylm/factorylm.properties",
        "/usr/local/bin/ignition/data/factorylm/factorylm.properties",
        "/var/lib/ignition/data/factorylm/factorylm.properties",
    ]

    tenant_id = ""
    relay_url = ""
    tag_folder = "[default]Mira_Monitored"

    for p in paths:
        f = File(p)
        if f.exists():
            props = Properties()
            fis = FileInputStream(f)
            try:
                props.load(fis)
                tenant_id = props.getProperty("TENANT_ID", "")
                relay_url = props.getProperty("RELAY_URL", "")
                tag_folder = props.getProperty("STREAM_TAG_FOLDER", tag_folder)
            finally:
                fis.close()
            break

    connected = bool(tenant_id and relay_url)

    tag_count = 0
    if connected:
        try:
            results = system.tag.browseTags(parentPath=tag_folder)
            tag_count = len(results)
        except Exception:
            pass

    return {
        "json": {
            "connected": connected,
            "tenant_id": tenant_id,
            "relay_url": relay_url,
            "tag_folder": tag_folder,
            "tag_count": tag_count,
        }
    }
