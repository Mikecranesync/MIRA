# Web Dev Module Handler: GET /system/webdev/FactoryLM/api/namespace
# Maps Ignition tags in a given folder to UNS paths and i3X element proposals.
# Produces the "proposed" namespace mapping that the NamespaceMapper Perspective
# view presents for human Accept/Reject decisions.
#
# Query params:
#   folder     -- tag provider+folder path (default: "[default]")
#   recurse    -- "true" to recurse sub-folders (default: "true")
#   enterprise -- UNS enterprise slug override (falls back to [default]MIRA/uns_enterprise)
#   site       -- UNS site slug override       (falls back to [default]MIRA/uns_site)
#   area       -- UNS area slug override       (falls back to [default]MIRA/uns_area)
#   line       -- UNS line slug override       (falls back to [default]MIRA/uns_line)
#
# Returns:
#   {folder, uns_prefix, proposals: [...], i3x: {...}, count, truncated}
#
# Each proposal: {tag_path, tag_name, data_type, folder_path, roles,
#                 uns_path, i3x_element_id, i3x_type_id, i3x_parent_id, status}
#
# Dual Python 2.7 + 3.12-clean (no f-strings, no annotations, % formatting).
# Jython 2.7 -- runs inside Ignition Gateway JVM.
# Ref: docs/plans/2026-06-02-ignition-module-self-serve-build.md Phase C1/C2

import json
import re

MAX_TAGS = 200
NAMESPACE_URI = "urn:mira:ignition:uns"

# ── Role classification keywords (mirrors mira_plc_parser/analyze.py _kw vocab) ──
FAULT_KW  = ["fault", "alarm", "error", "err", "trip", "fail"]
VFD_KW    = ["freq", "hz", "current", "amp", "volt", "speed", "spd", "vfd", "drive"]
OUTPUT_KW = ["run", "cmd", "enable", "coil", "output"]
TIMER_KW  = ["timer", "ton", "tof", "tmr", "delay", "elapsed"]
ASSET_KW  = ["status", "state", "mode", "ready", "online", "active"]

# i3X type URIs (mirrors mira_plc_parser/i3x.py TYPE_* constants)
T_FAULT  = "urn:mira:type:fault"
T_VFD    = "urn:mira:type:vfd_signal"
T_OUTPUT = "urn:mira:type:output"
T_TIMER  = "urn:mira:type:timer"
T_ASSET  = "urn:mira:type:asset_state"
T_SIGNAL = "urn:mira:type:signal"

ALL_TYPES = [
    {"elementId": T_FAULT,  "displayName": "Fault Signal",  "namespaceUri": NAMESPACE_URI, "isComposition": False},
    {"elementId": T_VFD,    "displayName": "VFD Signal",    "namespaceUri": NAMESPACE_URI, "isComposition": False},
    {"elementId": T_OUTPUT, "displayName": "Output Signal", "namespaceUri": NAMESPACE_URI, "isComposition": False},
    {"elementId": T_TIMER,  "displayName": "Timer Signal",  "namespaceUri": NAMESPACE_URI, "isComposition": False},
    {"elementId": T_ASSET,  "displayName": "Asset State",   "namespaceUri": NAMESPACE_URI, "isComposition": False},
    {"elementId": T_SIGNAL, "displayName": "Generic Signal","namespaceUri": NAMESPACE_URI, "isComposition": False},
    {"elementId": "urn:mira:type:container", "displayName": "Container", "namespaceUri": NAMESPACE_URI, "isComposition": True},
]


def _slug(s):
    """Lowercase + collapse non-alphanumeric runs to underscore. Mirrors uns.slug()."""
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_") or "unknown"


def _classify(name):
    """Return a list of role strings for a tag name by keyword matching."""
    n = name.lower()
    roles = []
    for kw in FAULT_KW:
        if kw in n:
            roles.append("fault")
            break
    for kw in VFD_KW:
        if kw in n:
            roles.append("vfd_signal")
            break
    for kw in OUTPUT_KW:
        if kw in n and "fault" not in n:
            roles.append("output")
            break
    for kw in TIMER_KW:
        if kw in n:
            roles.append("timer")
            break
    if not roles:
        for kw in ASSET_KW:
            if kw in n:
                roles.append("asset")
                break
    if not roles:
        roles.append("review")
    return roles


def _type_uri(roles):
    """Select the primary i3X type URI based on roles list."""
    if "fault"      in roles: return T_FAULT
    if "vfd_signal" in roles: return T_VFD
    if "output"     in roles: return T_OUTPUT
    if "timer"      in roles: return T_TIMER
    if "asset"      in roles: return T_ASSET
    return T_SIGNAL


def _read_uns_prefix():
    """Read UNS prefix slugs from MIRA gateway tags. Returns dict with defaults."""
    out = {"enterprise": "enterprise", "site": "site", "area": "area", "line": "line"}
    paths = [
        "[default]MIRA/uns_enterprise",
        "[default]MIRA/uns_site",
        "[default]MIRA/uns_area",
        "[default]MIRA/uns_line",
    ]
    keys = ["enterprise", "site", "area", "line"]
    try:
        qvs = system.tag.readBlocking(paths)
        for i, key in enumerate(keys):
            val = str(qvs[i].value).strip()
            if val and val not in ("null", "None", ""):
                out[key] = _slug(val)
    except Exception:
        pass
    return out


def _bare_path(tag_path):
    """Strip provider prefix: '[default]ConvLine/Motor' -> 'ConvLine/Motor'."""
    return re.sub(r"^\[[^\]]+\]/?", "", tag_path)


def _build_uns(enterprise, site, area, line, folder_path, tag_name):
    """Build ISA-95 UNS path: enterprise.site.area.line.<asset_chain>.<signal>"""
    bare_folder = _bare_path(folder_path)
    folder_parts = [p for p in bare_folder.split("/") if p]
    # Last folder segment = asset; deeper nesting = asset sub-chain
    asset_chain = ".".join(_slug(p) for p in folder_parts) if folder_parts else "asset"
    signal = _slug(tag_name)
    return "%s.%s.%s.%s.%s.%s" % (enterprise, site, area, line, asset_chain, signal)


def _browse_recursive(folder, logger):
    """Recursively browse tags in folder, returning a flat list of dicts."""
    results = []
    queue = [folder]
    visited = set()

    while queue and len(results) < MAX_TAGS:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)
        try:
            tags = system.tag.browseTags(parentPath=current)
        except Exception as exc:
            logger.warn("browseTags failed for %s: %s" % (current, str(exc)))
            continue
        for tag in tags:
            if len(results) >= MAX_TAGS:
                break
            tag_path = str(tag.fullPath)
            is_folder = str(tag.type).lower() in ("folder", "udtinst", "udt")
            if is_folder:
                queue.append(tag_path)
            else:
                results.append({
                    "path":        tag_path,
                    "name":        str(tag.name),
                    "data_type":   str(tag.dataType) if hasattr(tag, "dataType") else "String",
                    "folder_path": current,
                })
    return results


def doGet(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Namespace")

    params  = request.get("params", {}) or {}
    folder  = str(params.get("folder",  "[default]")).strip() or "[default]"
    recurse = str(params.get("recurse", "true")).strip().lower() != "false"

    prefix = _read_uns_prefix()
    for key in ("enterprise", "site", "area", "line"):
        v = str(params.get(key, "")).strip()
        if v:
            prefix[key] = _slug(v)

    enterprise = prefix["enterprise"]
    site       = prefix["site"]
    area       = prefix["area"]
    line       = prefix["line"]

    logger.info("Namespace map request -- folder: %s, recurse: %s" % (folder, recurse))

    if recurse:
        raw_tags = _browse_recursive(folder, logger)
    else:
        raw_tags = []
        try:
            for tag in system.tag.browseTags(parentPath=folder):
                if len(raw_tags) >= MAX_TAGS:
                    break
                if str(tag.type).lower() not in ("folder", "udtinst", "udt"):
                    raw_tags.append({
                        "path":        str(tag.fullPath),
                        "name":        str(tag.name),
                        "data_type":   str(tag.dataType) if hasattr(tag, "dataType") else "String",
                        "folder_path": folder,
                    })
        except Exception as exc:
            return {"json": {"error": "Tag browse failed: %s" % str(exc)}, "status": 500}

    # ── Build proposals and i3X structure ──────────────────────────────────
    proposals   = []
    containers  = {}   # elementId -> container object (ISA-95 hierarchy nodes)

    for t in raw_tags:
        tag_name    = t["name"]
        tag_path    = t["path"]
        folder_path = t["folder_path"]
        data_type   = t["data_type"]

        roles     = _classify(tag_name)
        uns_path  = _build_uns(enterprise, site, area, line, folder_path, tag_name)
        type_uri  = _type_uri(roles)
        i3x_parent = uns_path.rsplit(".", 1)[0]

        # Accumulate container nodes for the ISA-95 hierarchy levels above the signal
        path_parts = uns_path.split(".")
        for depth in range(2, len(path_parts)):
            cid = ".".join(path_parts[:depth])
            if cid not in containers:
                parent_id = ".".join(path_parts[:depth - 1]) if depth > 2 else ""
                containers[cid] = {
                    "elementId":    cid,
                    "displayName":  path_parts[depth - 1],
                    "typeElementId":"urn:mira:type:container",
                    "parentId":     parent_id,
                    "isComposition": True,
                    "namespaceUri": NAMESPACE_URI,
                }

        proposals.append({
            "tag_path":       tag_path,
            "tag_name":       tag_name,
            "data_type":      data_type,
            "folder_path":    folder_path,
            "roles":          roles,
            "uns_path":       uns_path,
            "i3x_element_id": uns_path,
            "i3x_type_id":    type_uri,
            "i3x_parent_id":  i3x_parent,
            "status":         "pending",
        })

    # Signal instances (leaf nodes in i3X)
    i3x_instances = list(containers.values()) + [
        {
            "elementId":    p["i3x_element_id"],
            "displayName":  p["tag_name"],
            "typeElementId":p["i3x_type_id"],
            "parentId":     p["i3x_parent_id"],
            "isComposition": False,
            "namespaceUri": NAMESPACE_URI,
            "metadata": {
                "tagPath":  p["tag_path"],
                "dataType": p["data_type"],
                "roles":    p["roles"],
                "source":   "ignition",
            },
        }
        for p in proposals
    ]

    i3x = {
        "namespace": {
            "namespaceUri": NAMESPACE_URI,
            "displayName":  "MIRA Ignition Namespace",
            "version":      "1.0",
        },
        "objectTypes":     ALL_TYPES,
        "objectInstances": i3x_instances,
    }

    logger.info("Namespace map complete -- folder: %s, proposals: %d" % (folder, len(proposals)))

    return {
        "json": {
            "folder":     folder,
            "uns_prefix": prefix,
            "proposals":  proposals,
            "i3x":        i3x,
            "count":      len(proposals),
            "truncated":  len(proposals) >= MAX_TAGS,
        }
    }
