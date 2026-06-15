# mira_setup -- backing logic for the TagMapper click-to-map setup view (Jython 2.7, Gateway scope).
#
# The installer maps each VFD-Analyzer signal ROLE to one of their tags + a scale, with a LIVE
# preview (raw -> scaled + unit + quality) as the correctness check, then Saves. The map is stored
# as JSON in the per-asset String config tag [default]MIRA/Config/<asset>/map; mira_diagnose +
# the trend read it. This module reads/writes that tag and computes the display rows + readiness gate.
#
# All heavy logic (validate / read-plan / coerce / catalog) lives in the CI-tested pure modules
# mira_asset_config + mira_signal_roles; this module only adds the system.* I/O on top.
#
# READ-ONLY w.r.t. process tags: it READS mapped tags for the live preview and WRITES only the
# config tag (never a drive/PLC tag). Jython 2.7: no f-strings/annotations; % formatting; ASCII.
# Ref: docs/specs/vfd-analyzer-auto-map-spec.md SS6.

import mira_asset_config as _cfg
import mira_signal_roles as _roles

CONFIG_TAG = "[default]MIRA/Config/%s/map"


def _logger():
    return system.util.getLogger("FactoryLM.Mira.Setup")


def _read_raw(asset):
    if not asset:
        return None
    try:
        qv = system.tag.readBlocking([CONFIG_TAG % asset])[0]
        if qv.quality.isGood() and qv.value is not None and str(qv.value).strip() != "":
            return str(qv.value)
    except Exception as e:
        _logger().warn("read config failed for %s: %s" % (asset, str(e)))
    return None


def _load(asset):
    raw = _read_raw(asset)
    if not raw:
        return None
    try:
        return _cfg.load_config(raw, valid_keys=_roles.valid_keys())
    except Exception as e:
        _logger().warn("config invalid for %s: %s" % (asset, str(e)))
        return None


def _family(asset):
    cfg = _load(asset)
    if cfg and cfg.get("driveFamily"):
        return cfg["driveFamily"]
    return "GS10"


def _live(tag, divisor):
    """Returns (scaled_value_or_None, good_quality_bool) for a tag path."""
    if not tag:
        return (None, None)
    try:
        qv = system.tag.readBlocking([tag])[0]
        good = qv.quality.isGood()
        if not good:
            return (None, False)
        return (_cfg.coerce(qv.value, divisor), True)
    except Exception:
        return (None, False)


# ---- entry points bound from TagMapper ----

def role_options():
    """Dropdown options for the role selector: [{value: key, label: 'Display (req)'}]."""
    out = []
    for r in _roles.ROLES:
        tag = ""
        if r["requirement"] == _roles.REQUIRED:
            tag = "  [required]"
        elif r["requirement"] == _roles.RECOMMENDED:
            tag = "  [recommended]"
        out.append({"value": r["key"], "label": r["display"] + tag})
    return out


def browse_tags(base):
    """Dropdown options for the tag picker: immediate child TAGS under `base` (not folders).
    Change `base` to navigate the tree. Read-only browse."""
    out = []
    if not base:
        return out
    try:
        results = system.tag.browse(base).getResults()
    except Exception as e:
        _logger().warn("browse %s failed: %s" % (base, str(e)))
        return out
    for r in results:
        try:
            full = str(r.getFullPath())
            has_children = r.hasChildren()
        except Exception:
            continue
        leaf = full.rsplit("/", 1)[-1]
        if has_children:
            out.append({"value": full, "label": "[folder] " + leaf})
        else:
            out.append({"value": full, "label": leaf})
    return out


def default_divisor(role, asset=None):
    return _roles.default_divisor(role, _family(asset))


# ---- tag auto-discovery (the scanner) ----
# Ignition already knows every tag, so "discover the network's tags" = recursively browse the
# gateway tag tree. Browse once, cache (the tree changes rarely), filter in-memory per keystroke.
_SCAN_TTL_MS = 30000
_scan_cache = {}   # root -> (expires_ms, [{path, dt}])


def _now_ms():
    return system.date.now().getTime()


def _scan_all(root):
    """Recursive browse of all ATOMIC tags under root. Cached. Returns [{path, dt}]."""
    if not root:
        root = "[default]"
    ent = _scan_cache.get(root)
    now = _now_ms()
    if ent is not None and ent[0] > now:
        return ent[1]
    out = []

    def _walk(path, depth):
        if depth > 25:
            return
        try:
            results = system.tag.browse(path).getResults()
        except Exception as e:
            _logger().warn("browse %s failed: %s" % (path, str(e)))
            return
        for r in results:
            try:
                full = str(r['fullPath'])
                ttype = str(r['tagType'])
                children = r['hasChildren']
            except Exception:
                continue
            if ttype == "AtomicTag":
                dt = r.get('dataType')
                out.append({"path": full, "dt": str(dt) if dt is not None else ""})
            elif children:
                _walk(full, depth + 1)

    _walk(root, 0)
    _scan_cache[root] = (now + _SCAN_TTL_MS, out)
    return out


def dtype_options():
    """Datatype filter chips for the scanner table."""
    return [{"value": "All", "label": "All types"},
            {"value": "Float", "label": "Float"},
            {"value": "Int", "label": "Integer"},
            {"value": "Bool", "label": "Boolean"},
            {"value": "String", "label": "String"}]


def scan_tags(root, search, dtype):
    """Table data for the picker: [{path, type, value, quality}] for tags under `root` matching the
    `search` substring + `dtype` filter. Bulk-reads live values only for the shown subset (capped)."""
    base = _scan_all(root or "[default]")
    s = (search or "").lower()
    dt = dtype or "All"
    sel = []
    for t in base:
        if s and s not in t["path"].lower():
            continue
        if dt != "All" and dt.lower() not in t["dt"].lower():
            continue
        sel.append(t)
    sel = sel[:200]   # cap rows so a huge plant stays responsive; refine the search to narrow
    paths = [t["path"] for t in sel]
    rows = []
    qvs = []
    if paths:
        try:
            qvs = system.tag.readBlocking(paths)
        except Exception as e:
            _logger().warn("scan readBlocking failed: %s" % str(e))
            qvs = []
    for i in range(len(sel)):
        val = None
        qual = ""
        if i < len(qvs):
            try:
                if qvs[i].quality.isGood():
                    val = qvs[i].value
                    qual = "good"
                else:
                    qual = "bad"
            except Exception:
                qual = ""
        rows.append({"path": sel[i]["path"], "type": sel[i]["dt"], "value": val, "quality": qual})
    return rows


def _norm_divisor(role, divisor):
    """Force the divisor to match the role KIND: bool -> None (passthrough), code -> 1.0
    (int passthrough), analog -> the provided numeric scale. Keeps the UI from having to express
    'null' for non-analog roles."""
    r = _roles.role(role)
    kind = r["kind"] if r else _roles.ANALOG
    if kind == _roles.BOOL:
        return None
    if kind == _roles.CODE:
        return 1.0
    try:
        return float(divisor)
    except (TypeError, ValueError):
        return 1.0


def preview(tag, divisor, role=None):
    """A one-line live sanity string for the picked tag: 'raw -> 47.3 Hz  (good)' / bad-quality."""
    if not tag:
        return "-- pick a tag --"
    if role is not None:
        divisor = _norm_divisor(role, divisor)
    val, good = _live(tag, divisor)
    if good is False:
        return "BAD QUALITY -- check the tag path"
    unit = ""
    if role is not None:
        r = _roles.role(role)
        if r and r.get("unit"):
            unit = " " + r["unit"]
    if val is None:
        return "(no value)"
    return "= %s%s  (good)" % (val, unit)


def gate_text(asset):
    cfg = _load(asset)
    req = _roles.required_keys()
    if cfg is None:
        return "No config yet -- map the %d required roles to begin." % len(req)
    missing = _cfg.required_unmapped(cfg, req)
    mapped = len(req) - len(missing)
    if missing:
        return "%d of %d required roles mapped -- incomplete" % (mapped, len(req))
    return "%d of %d required roles mapped -- ready" % (mapped, len(req))


def gate_color(asset):
    cfg = _load(asset)
    if cfg is None:
        return "#f0a90e"  # amber
    if _cfg.required_unmapped(cfg, _roles.required_keys()):
        return "#f0a90e"
    return "#1a7f37"      # green -- ready


def rows_markdown(asset):
    """The map as a markdown table: role / req / mapped tag / scale / live value+quality.
    ISA-101: amber marks a required-unmapped role; a bad-quality picked tag is flagged."""
    cfg = _load(asset)
    roles_map = (cfg or {}).get("roles", {})
    parts = ["| Role | Req | Mapped tag | Scale | Live |",
             "| --- | --- | --- | --- | --- |"]
    for r in _roles.ROLES:
        key = r["key"]
        req = {"required": "**req**", "recommended": "rec", "optional": ""}.get(r["requirement"], "")
        ent = roles_map.get(key)
        if ent is None:
            tag_disp = "_(unmapped)_"
            if r["requirement"] == "required":
                tag_disp = "**! unmapped**"
            scale = ""
            live = ""
        else:
            tag = ent.get("tag", "")
            div = ent.get("divisor")
            tag_disp = "`" + str(tag).rsplit("/", 1)[-1] + "`"
            scale = "1x" if div in (None, 1.0) else ("/%s" % div)
            val, good = _live(tag, div)
            if good is False:
                live = "BAD QUALITY"
            elif val is None:
                live = "-"
            else:
                unit = (" " + r["unit"]) if r.get("unit") else ""
                live = "%s%s" % (val, unit)
        parts.append("| %s | %s | %s | %s | %s |" % (r["display"], req, tag_disp, scale, live))
    return "\n".join(parts)


def _ensure_tag(asset):
    """Create the String memory config tag for `asset` if it does not exist yet."""
    path = CONFIG_TAG % asset
    try:
        qv = system.tag.readBlocking([path])[0]
        if qv.quality.isGood():
            return True
    except Exception:
        pass
    # configure a String memory tag under [default]MIRA/Config/<asset>/map
    parent = "[default]MIRA/Config/%s" % asset
    tag_def = {"name": "map", "tagType": "AtomicTag", "valueSource": "memory",
               "dataType": "String", "value": ""}
    try:
        system.tag.configure(parent, [tag_def], "o")  # 'o' = overwrite/merge
        return True
    except Exception as e:
        _logger().warn("could not create config tag %s: %s" % (path, str(e)))
        return False


def _coerce_asset(asset):
    """Force the asset id to a clean non-empty string, or '' if unusable. Perspective view
    params can arrive as None or a non-str object when a route passes no param; coercing here
    keeps a bad param from reaching the validator as a non-string assetId."""
    if asset is None:
        return ""
    try:
        return str(asset).strip()
    except Exception:
        return ""


def _scaffold(cfg, asset):
    """Ensure a config dict carries the required identity + scaffold BEFORE validate/write.
    This is the fix for the 'assetId is required and must be a non-empty string' save error:
    an existing or hand-edited config tag may lack assetId (or schemaVersion/roles), and the
    pure validator correctly rejects it -- so the gateway writer, which knows the asset
    identity, must re-assert it every time rather than only when building a brand-new config."""
    if not isinstance(cfg, dict):
        cfg = {}
    cfg["assetId"] = asset
    cfg["schemaVersion"] = 1
    if not isinstance(cfg.get("roles"), dict):
        cfg["roles"] = {}
    if "driveFamily" not in cfg:
        cfg["driveFamily"] = "GS10"
    if "unsPath" not in cfg:
        cfg["unsPath"] = ""
    return cfg


def set_role(asset, role, tag, divisor):
    """Map `role` -> `tag` (+divisor) in the asset's config and Save. Validates before writing;
    never writes an invalid config. Returns a human status string for the view."""
    asset = _coerce_asset(asset)
    if not asset:
        return "ERROR: no asset"
    if role not in _roles.valid_keys():
        return "ERROR: unknown role %s" % role
    if not tag:
        return "ERROR: pick a tag first"
    divisor = _norm_divisor(role, divisor)   # bool->None, code->1.0, analog->numeric
    cfg = _load(asset)
    if cfg is None:
        cfg = {"schemaVersion": 1, "assetId": asset, "driveFamily": "GS10",
               "unsPath": "", "roles": {}}
    cfg = _scaffold(cfg, asset)              # always re-assert identity (fixes assetId save error)
    cfg["roles"][role] = {"tag": tag, "divisor": divisor, "source": "manual",
                          "confidence": "verified", "evidence": "technician_confirm"}
    try:
        _cfg.load_config(cfg, valid_keys=_roles.valid_keys())
    except Exception as e:
        return "ERROR: %s" % str(e)
    _ensure_tag(asset)
    js = system.util.jsonEncode(cfg)
    try:
        q = system.tag.writeBlocking([CONFIG_TAG % asset], [js])[0]
        if q.isGood():
            return "Saved: %s -> %s" % (_roles.role(role)["display"], str(tag).rsplit("/", 1)[-1])
        return "WRITE FAILED (quality not good)"
    except Exception as e:
        return "ERROR writing: %s" % str(e)


def clear_role(asset, role):
    """Remove a role mapping and Save."""
    asset = _coerce_asset(asset)
    if not asset:
        return "ERROR: no asset"
    cfg = _load(asset)
    if cfg is None or role not in cfg.get("roles", {}):
        return "nothing to clear"
    cfg = _scaffold(cfg, asset)              # re-assert identity so the write stays valid
    del cfg["roles"][role]
    js = system.util.jsonEncode(cfg)
    try:
        q = system.tag.writeBlocking([CONFIG_TAG % asset], [js])[0]
        return "Cleared %s" % role if q.isGood() else "WRITE FAILED"
    except Exception as e:
        return "ERROR: %s" % str(e)


# ---- big-slot redesign helpers (matching-game TagMapper v2) ----
# The setup page shows the REQUIRED roles as big tap-able SLOTS; tap a slot and the right pane
# lists only the tags whose datatype could fill that role (the pre-filter that kills the
# "wall of irrelevant tags"). These feed that view. Read-only on process tags (live preview
# reads only; never writes a drive/PLC tag).

# One-line hint of which tag datatypes can fill a role, by role kind (drives the right-pane subhead).
_TYPEHINT = {"analog": "number tags  (Float / Int)",
             "bool": "on / off tags  (Boolean)",
             "code": "whole-number tags  (Int)"}
# Datatype substrings Ignition reports (Float4/Float8, Int2/Int4, Boolean, String), per role kind.
_DT_FOR_KIND = {"analog": ["float", "int"], "bool": ["bool"], "code": ["int"]}


def role_display(role_key):
    """Human label for a role key, e.g. 'Output frequency'. '' if unknown."""
    r = _roles.role(role_key)
    return r["display"] if r else ""


def role_typehint(role_key):
    """One-line hint of which tag datatypes can fill this role (right-pane subheader)."""
    r = _roles.role(role_key)
    if not r:
        return "any tag"
    return _TYPEHINT.get(r["kind"], "any tag")


def _slot_state(asset, role_key):
    """(status, value_str) for a role: status in unmapped / good / bad / novalue."""
    cfg = _load(asset)
    ent = (cfg or {}).get("roles", {}).get(role_key)
    if ent is None:
        return ("unmapped", None)
    val, good = _live(ent.get("tag", ""), ent.get("divisor"))
    if good is False:
        return ("bad", None)
    if val is None:
        return ("novalue", None)
    r = _roles.role(role_key)
    unit = (" " + r["unit"]) if (r and r.get("unit")) else ""
    return ("good", "%s%s" % (val, unit))


def slot_text(asset, role_key):
    """Status line shown inside a role slot. States the action (unmapped) or the live value (done)."""
    st, val = _slot_state(asset, role_key)
    if st == "unmapped":
        return "NEEDS A TAG  --  tap here, then pick a tag"
    if st == "bad":
        return "mapped, but BAD QUALITY -- check the tag"
    if st == "novalue":
        return "mapped  (waiting for a live value)"
    return "DONE   =  %s   (good)" % val


def slot_color(asset, role_key):
    """Slot status color. amber=needs a tag, green=done/good, red=bad quality (ISA-101)."""
    st, _v = _slot_state(asset, role_key)
    if st == "good" or st == "novalue":
        return "#1a7f37"   # green
    if st == "bad":
        return "#cf222e"   # red
    return "#f0a90e"       # amber -- still needs a tag


def scan_for_role(base, search, role_key):
    """Candidate tags for the right pane: ONLY tags whose datatype can fill `role_key`, under
    `base`, matching the `search` substring. Rows = [{tag(short), value(live), quality, path}].
    The datatype pre-filter is what removes the wall of irrelevant tags; the cap keeps a big
    plant responsive (narrow with search)."""
    r = _roles.role(role_key)
    kind = r["kind"] if r else "analog"
    allowed = _DT_FOR_KIND.get(kind)   # None -> show all datatypes
    items = _scan_all(base or "[default]")
    s = (search or "").lower()
    sel = []
    for t in items:
        if s and s not in t["path"].lower():
            continue
        if allowed is not None:
            dtl = t["dt"].lower()
            ok = False
            for a in allowed:
                if a in dtl:
                    ok = True
                    break
            if not ok:
                continue
        sel.append(t)
    sel = sel[:60]
    paths = [t["path"] for t in sel]
    qvs = []
    if paths:
        try:
            qvs = system.tag.readBlocking(paths)
        except Exception as e:
            _logger().warn("scan_for_role read failed: %s" % str(e))
            qvs = []
    rows = []
    for i in range(len(sel)):
        val = None
        qual = ""
        if i < len(qvs):
            try:
                if qvs[i].quality.isGood():
                    val = qvs[i].value
                    qual = "good"
                else:
                    qual = "bad"
            except Exception:
                qual = ""
        short = sel[i]["path"].rsplit("/", 1)[-1]
        rows.append({"tag": short, "value": val, "quality": qual, "path": sel[i]["path"]})
    return rows


def optional_role_options():
    """Dropdown options for the '+ add optional' picker: recommended + optional roles only."""
    out = []
    for r in _roles.ROLES:
        if r["requirement"] == _roles.REQUIRED:
            continue
        suffix = "  [recommended]" if r["requirement"] == _roles.RECOMMENDED else "  [optional]"
        out.append({"value": r["key"], "label": r["display"] + suffix})
    return out


def slot_divisor(role_key, asset):
    """Default scale divisor for a role on slot-tap, coerced so a numeric-entry never gets None.
    bool roles (divisor None) -> 1 for the field; set_role's _norm_divisor still forces the real
    semantics (bool->None, code->1.0) at write time, so the field value only matters for analog."""
    d = _roles.default_divisor(role_key, _family(asset))
    return 1 if d is None else d


# ---- 4-step wizard helpers (Connect -> Verify -> Map -> Save) ----
# These wrap the existing browse/scan/live machinery for the SetupWizard view. The wizard adds a
# CONNECT step (pick provider + folder), a VERIFY step (prove the source is live before mapping),
# the existing MAP step, and a SAVE step (readiness + train-before-deploy approval). Read-only on
# process tags throughout; only the per-asset config tag is written. Jython 2.7 safe (no f-strings).

# --- Step 1: CONNECT ---

def provider_options():
    """Dropdown options for the tag-provider picker. Browses the gateway root for providers;
    fails soft to [default] so Step 1 never hard-blocks (the provider list has no scripting API
    guarantee across versions, so we discover it by browsing root and degrade gracefully)."""
    out = []
    try:
        results = system.tag.browse("").getResults()
        for r in results:
            try:
                full = str(r['fullPath'])
            except Exception:
                continue
            if not full:
                continue
            val = full if full.startswith("[") else ("[%s]" % full)
            label = val.strip("[]") or "default"
            seen = False
            for o in out:
                if o["value"] == val:
                    seen = True
                    break
            if not seen:
                out.append({"value": val, "label": label})
    except Exception as e:
        _logger().warn("provider browse failed: %s" % str(e))
    if not out:
        out = [{"value": "[default]", "label": "default"}]
    return out


def browse_nodes(base):
    """Folder browser rows for Step 1: immediate children under `base` as
    [{label, path, kind}] where kind is 'folder' or 'tag'. Click a folder row to drill in;
    'Use this folder' commits `base` as the data source. Read-only browse."""
    out = []
    if not base:
        base = "[default]"
    try:
        results = system.tag.browse(base).getResults()
    except Exception as e:
        _logger().warn("browse_nodes %s failed: %s" % (base, str(e)))
        return out
    for r in results:
        try:
            full = str(r['fullPath'])
            children = r['hasChildren']
        except Exception:
            continue
        leaf = full.rsplit("/", 1)[-1]
        if leaf.startswith("["):
            leaf = leaf.strip("[]")
        if children:
            out.append({"label": "[+]  " + leaf, "path": full, "kind": "folder"})
        else:
            out.append({"label": "      " + leaf, "path": full, "kind": "tag"})
    return out


# --- Step 2: VERIFY ---

def verify_summary(folder):
    """Scan `folder` and report {count, good, bad}: total atomic tags + a live good/bad read
    (capped) so the operator can prove the source is alive BEFORE mapping. Reuses the cached
    _scan_all so Step 2 and Step 3 share one browse. Called from the 'Test data source' event."""
    items = _scan_all(folder or "[default]")
    count = len(items)
    paths = [t["path"] for t in items[:500]]   # cap the read; count is the true total
    good = 0
    bad = 0
    if paths:
        try:
            qvs = system.tag.readBlocking(paths)
            for q in qvs:
                try:
                    if q.quality.isGood():
                        good += 1
                    else:
                        bad += 1
                except Exception:
                    bad += 1
        except Exception as e:
            _logger().warn("verify read failed: %s" % str(e))
    return {"count": count, "good": good, "bad": bad}


def verify_ok(folder):
    """True iff the folder has at least one good-quality tag (the Step-2 advance gate)."""
    return verify_summary(folder)["good"] >= 1


def verify_breakdown_md(folder):
    """Datatype breakdown line for Step 2: how many Float/Int/Bool/String tags are under `folder`."""
    items = _scan_all(folder or "[default]")
    f = i = b = s = 0
    for t in items:
        dt = t["dt"].lower()
        if "float" in dt:
            f += 1
        elif "int" in dt:
            i += 1
        elif "bool" in dt:
            b += 1
        elif "string" in dt:
            s += 1
    return "**Types:**  Float %d  &middot;  Int %d  &middot;  Bool %d  &middot;  String %d" % (f, i, b, s)


def verify_sample(folder):
    """A small live sample (<=15 rows) of the folder for Step 2: [{path, type, value, quality}].
    Reuses scan_tags so the operator watches real values move and spots bad-quality links."""
    return scan_tags(folder or "[default]", "", "All")[:15]


# --- Step 3: MAP (auto-suggest seam) ---
# Lightweight LOCAL fuzzy match of tag NAMES to a signal role -- no cloud, no AI service. Pre-fills
# the best guess for the user to confirm; unknowns stay empty (never guessed). Conservative: a
# candidate must both fit the role's datatype AND contain a role keyword.
_SUGGEST_KEYWORDS = {
    "vfd/vfd101/freq": ["freq", "hz", "output_freq", "speed_hz"],
    "vfd/vfd101/current_a": ["current", "amp", "amps", "iout", "motor_current"],
    "vfd/vfd101/fault_code": ["fault", "trip", "faultcode", "fault_code"],
    "vfd/vfd101/freq_setpoint": ["setpoint", "freq_cmd", "cmd_freq", "freq_ref", "freq_sp"],
    "vfd/vfd101/dc_bus_v": ["dc_bus", "dcbus", "bus_v", "vdc", "dc_link", "busvolt"],
    "vfd/vfd101/comm_ok": ["comm", "online", "connected", "heartbeat", "link_ok"],
    "vfd/vfd101/cmd_word": ["cmd_word", "control_word", "ctrl_word", "command_word", "cmdword"],
    "vfd/vfd101/warn_code": ["warn", "warning", "alarm_code"],
    "motor/m101/running": ["running", "run_status", "motor_run", "is_running"],
    "safety/estop": ["estop", "e_stop", "emergency"],
}
# Negative tokens: a tag whose name contains one of these is probably a DIFFERENT signal, so we
# penalize it. This stops greedy keywords from mis-matching -- e.g. "freq" alone would tie
# vfd_frequency (the OUTPUT) with vfd_freq_cmd (the SETPOINT) and the shorter name would win.
_SUGGEST_NEG = {
    "vfd/vfd101/freq": ["cmd", "setpoint", "set_", "_set", "ref", "_sp", "sp_", "command", "target"],
    "vfd/vfd101/current_a": ["cmd", "setpoint", "limit", "ref"],
    "vfd/vfd101/dc_bus_v": ["cmd", "setpoint", "ref"],
}


def suggest_for_role(folder, role_key):
    """Best fuzzy name-match tag path for `role_key` under `folder`, or '' if none is confident
    enough. Requires datatype fit + a net-positive keyword score; negative tokens (e.g. 'cmd',
    'setpoint') penalize a candidate so an OUTPUT role won't grab a SETPOINT tag. Ties break to
    the shorter tag name."""
    kws = _SUGGEST_KEYWORDS.get(role_key)
    if not kws:
        return ""
    neg = _SUGGEST_NEG.get(role_key, [])
    r = _roles.role(role_key)
    kind = r["kind"] if r else "analog"
    allowed = _DT_FOR_KIND.get(kind)
    items = _scan_all(folder or "[default]")
    best = ""
    best_score = 0
    best_len = 99999
    for t in items:
        if allowed is not None:
            dtl = t["dt"].lower()
            ok = False
            for a in allowed:
                if a in dtl:
                    ok = True
                    break
            if not ok:
                continue
        name = t["path"].rsplit("/", 1)[-1].lower()
        score = 0
        for kw in kws:
            if kw in name:
                score += 1
        for nk in neg:
            if nk in name:
                score -= 2   # a negative token outweighs a single positive -> disqualifies it
        if score > 0 and (score > best_score or (score == best_score and len(name) < best_len)):
            best = t["path"]
            best_score = score
            best_len = len(name)
    return best


def accept_all_suggestions(asset, folder):
    """Auto-fill every UNMAPPED required/recommended role with its fuzzy suggestion (source
    'suggested', confidence 'proposed' -- distinct from a manual 'verified' pick). Never
    overwrites an existing mapping; unknowns stay unmapped. The user still reviews + can change
    each slot. One batched write."""
    asset = _coerce_asset(asset)
    if not asset:
        return "ERROR: no asset"
    cfg = _load(asset)
    if cfg is None:
        cfg = {"schemaVersion": 1, "assetId": asset, "driveFamily": "GS10",
               "unsPath": "", "roles": {}}
    cfg = _scaffold(cfg, asset)
    n = 0
    for r in _roles.ROLES:
        if r["requirement"] == _roles.OPTIONAL:
            continue
        key = r["key"]
        if key in cfg["roles"]:
            continue
        tag = suggest_for_role(folder, key)
        if tag:
            div = _norm_divisor(key, _roles.default_divisor(key, _family(asset)))
            cfg["roles"][key] = {"tag": tag, "divisor": div, "source": "suggested",
                                 "confidence": "proposed", "evidence": "name_match"}
            n += 1
    if n == 0:
        return "no new suggestions found under that folder"
    try:
        _cfg.load_config(cfg, valid_keys=_roles.valid_keys())
    except Exception as e:
        return "ERROR: %s" % str(e)
    _ensure_tag(asset)
    js = system.util.jsonEncode(cfg)
    try:
        q = system.tag.writeBlocking([CONFIG_TAG % asset], [js])[0]
        if q.isGood():
            return "Applied %d suggestion(s) -- review the slots, then confirm" % n
        return "WRITE FAILED (quality not good)"
    except Exception as e:
        return "ERROR writing: %s" % str(e)


def progress_text(asset):
    """Step-3 required-field progress meter, e.g. 'Mapped 2 of 3 required'."""
    cfg = _load(asset)
    req = _roles.required_keys()
    if cfg is None:
        return "Mapped 0 of %d required" % len(req)
    mapped = len(req) - len(_cfg.required_unmapped(cfg, req))
    return "Mapped %d of %d required" % (mapped, len(req))


def is_ready(asset):
    """True iff all REQUIRED roles are mapped (the Step-3 -> Step-4 advance gate)."""
    asset = _coerce_asset(asset)
    if not asset:
        return False
    cfg = _load(asset)
    if cfg is None:
        return False
    return len(_cfg.required_unmapped(cfg, _roles.required_keys())) == 0


# --- Step 4: SAVE ---

def finalize(asset, approved, approved_by):
    """Commit the config with its train-before-deploy approval state. approved=True records
    approvedBy; approved=False clears it. Validates before writing; never writes an invalid config.
    Returns a human status string."""
    asset = _coerce_asset(asset)
    if not asset:
        return "ERROR: no asset"
    cfg = _load(asset)
    if cfg is None:
        cfg = {"schemaVersion": 1, "assetId": asset, "driveFamily": "GS10",
               "unsPath": "", "roles": {}}
    cfg = _scaffold(cfg, asset)
    cfg["approved"] = bool(approved)
    cfg["approvedBy"] = approved_by if (approved and approved_by) else None
    try:
        _cfg.load_config(cfg, valid_keys=_roles.valid_keys())
    except Exception as e:
        return "ERROR: %s" % str(e)
    _ensure_tag(asset)
    js = system.util.jsonEncode(cfg)
    try:
        q = system.tag.writeBlocking([CONFIG_TAG % asset], [js])[0]
        if q.isGood():
            n = len(cfg.get("roles", {}))
            tail = "  (approved)" if approved else ""
            return "Saved %d role(s)%s" % (n, tail)
        return "WRITE FAILED (quality not good)"
    except Exception as e:
        return "ERROR writing: %s" % str(e)
