"""
MIRA Ignition Exchange — Tag Installer (standalone)

Run this once from the Designer Script Console to bootstrap the
[default]MIRA/* configuration tags. Equivalent to the gateway startup script;
provided for users who want a one-time install without touching gateway events.

Usage (Designer → Tools → Script Console):
    exec(open('/path/to/install_tags.py').read())

Idempotent: re-running does not overwrite existing values.
"""

import system

MIRA_FOLDER_PATH = "[default]MIRA"

TAGS = [
    ("endpoint_url",          "https://app.factorylm.com",          "MIRA chat endpoint URL"),
    ("scan_api_url",          "https://app.factorylm.com/api/scanbe", "MIRA Scan backend base URL"),
    ("factorylm_onboard_url", "https://factorylm.com/onboard",       "FactoryLM onboarding URL")
]


def install():
    if not system.tag.exists(MIRA_FOLDER_PATH)[0]:
        system.tag.configure("[default]", [{"name": "MIRA", "tagType": "Folder"}], "a")

    created = 0
    for name, value, doc in TAGS:
        full = MIRA_FOLDER_PATH + "/" + name
        if system.tag.exists(full)[0]:
            continue
        system.tag.configure(MIRA_FOLDER_PATH, [{
            "name": name,
            "tagType": "AtomicTag",
            "valueSource": "memory",
            "dataType": "String",
            "value": value,
            "documentation": doc
        }], "a")
        created += 1
        print("Created %s = %s" % (full, value))

    print("MIRA tag install complete — %d new tag(s)" % created)


install()
