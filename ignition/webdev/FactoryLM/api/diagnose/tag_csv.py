# tag_csv.py -- vendor-agnostic PLC tag-export CSV parser (pure; no system.* imports).
#
# There is NO single universal "PLC CSV" format -- every vendor exports a different shape. This
# module auto-detects the delimiter + the header row + the vendor dialect and maps each dialect's
# columns onto ONE canonical record the VFD-Analyzer wizard's "CSV source" consumes. Supported
# dialects (detected, not assumed):
#   * rockwell_logix -- Studio 5000 / RSLogix 5000 tag CSV: remark preamble, then a
#       TYPE,SCOPE,NAME,DESCRIPTION,DATATYPE,SPECIFIER,ATTRIBUTES header; data rows keyed by TYPE
#       (TAG/COMMENT/ALIAS) -- we keep TAG rows.
#   * siemens_tia   -- TIA Portal PLC tag-table export: Name, Path, Data Type, Logical Address,
#       Comment (often ';'-delimited on European locales).
#   * kepware       -- KEPServerEX CSV: Tag Name, Address, Data Type, Scaling, Scan Rate, ...
#   * generic       -- any CSV with a name column + (datatype or a value to infer from).
#
# The canonical record is shaped to be compatible BOTH with the wizard's existing tag-scan
# machinery (via to_scan_rows -> [{path, dt}], so scan_for_role/suggest_for_role work unchanged)
# AND with the future Hub AI mapper's CanonicalTag / ai_suggestions model (name, datatype,
# engineering_unit, address, description -> proposed_uns_path/classification later).
#
# Dual Python 2.7 + 3.12-clean: no from __future__, no annotations, no f-strings, % formatting,
# plain dicts/lists, ASCII only. Stdlib only; hand-rolled CSV split (avoids Jython/CPython csv
# unicode differences). Read-only: parses text, never touches a tag or the network.

# ---- datatype normalization ----
# kind drives the wizard's role datatype-filter (analog->Float/Int, code->Int, bool->Bool);
# dt is an Ignition-style datatype string so the existing substring filter (_DT_FOR_KIND) matches.
ANALOG, INTEGER, BOOL, STRING, UNKNOWN = "analog", "integer", "bool", "string", "unknown"

# Raw vendor datatype tokens -> kind. Upper-cased, stripped of array/length suffixes before lookup.
_FLOAT_TYPES = set([
    "REAL", "LREAL", "FLOAT", "FLOAT32", "FLOAT64", "DOUBLE", "REAL32", "REAL64", "SINGLE",
])
_INT_TYPES = set([
    "INT", "DINT", "SINT", "LINT", "USINT", "UINT", "UDINT", "ULINT",
    "BYTE", "WORD", "DWORD", "LWORD", "SHORT", "LONG", "INT16", "INT32", "INT8", "INT64",
    "UINT16", "UINT32", "WORD16", "BCD", "NUMBER",
])
_BOOL_TYPES = set(["BOOL", "BOOLEAN", "BIT", "BOOLEAN8", "DISCRETE", "DIGITAL"])
_STRING_TYPES = set(["STRING", "STRING8", "STRING16", "CHAR", "WCHAR", "TEXT"])

_KIND_TO_DT = {ANALOG: "Float4", INTEGER: "Int4", BOOL: "Boolean", STRING: "String", UNKNOWN: ""}


def normalize_datatype(raw):
    """(kind, ignition_dt) for a raw vendor datatype string. Unknown -> (UNKNOWN, '')."""
    if raw is None:
        return (UNKNOWN, "")
    t = str(raw).strip().upper()
    if not t:
        return (UNKNOWN, "")
    # strip array/length decorations: REAL[10], STRING(82), DINT : Decimal, "Real (LReal)"
    for sep in ("[", "(", ":", " "):
        if sep in t:
            t = t.split(sep, 1)[0].strip()
    # strip a leading vendor namespace (e.g. Siemens "Bool" already plain; Logix UDTs pass through)
    if t in _FLOAT_TYPES:
        return (ANALOG, _KIND_TO_DT[ANALOG])
    if t in _BOOL_TYPES:
        return (BOOL, _KIND_TO_DT[BOOL])
    if t in _INT_TYPES:
        return (INTEGER, _KIND_TO_DT[INTEGER])
    if t in _STRING_TYPES:
        return (STRING, _KIND_TO_DT[STRING])
    return (UNKNOWN, "")


def _infer_kind_from_value(sample):
    """Best-effort kind from a sample value when no datatype column exists (generic CSVs)."""
    if sample is None:
        return (UNKNOWN, "")
    s = str(sample).strip()
    if s == "":
        return (UNKNOWN, "")
    low = s.lower()
    if low in ("true", "false", "on", "off", "1", "0"):
        # 1/0 are ambiguous; treat bare true/false/on/off as bool, leave 1/0 to numeric below
        if low in ("true", "false", "on", "off"):
            return (BOOL, _KIND_TO_DT[BOOL])
    try:
        if "." in s or "e" in low:
            float(s)
            return (ANALOG, _KIND_TO_DT[ANALOG])
        int(s)
        return (INTEGER, _KIND_TO_DT[INTEGER])
    except (TypeError, ValueError):
        return (STRING, _KIND_TO_DT[STRING])


# ---- column aliasing (case/space-insensitive) ----
def _norm_key(s):
    return "".join(ch for ch in str(s).strip().lower() if ch.isalnum())


# Alias lists are PRIORITY-ORDERED: the earlier alias wins when several columns could match. Notes:
#  * 'type' is deliberately NOT a datatype alias -- in Rockwell it is the row-marker (TAG/COMMENT);
#    a lone 'type' header is only used as datatype when no strong 'datatype' column exists.
#  * 'path' is LAST in address -- Siemens has both 'Path' (folder) and 'Logical Address' (the PLC
#    address we want), so the strong address aliases must win over 'path'.
_ALIASES = {
    "name": ["name", "tagname", "tag", "symbol", "identifier", "alias", "pointname", "point"],
    "datatype": ["datatype", "datatyp", "valuetype"],
    "address": ["logicaladdress", "address", "register", "modbusaddress", "plcaddress",
                "specifier", "offset", "item", "itemid", "path"],
    "description": ["description", "comment", "comments", "desc", "remark", "notes"],
    "unit": ["unit", "units", "engineeringunit", "engineeringunits", "eu", "uom"],
    "sample": ["value", "sample", "samplevalue", "currentvalue", "initialvalue",
               "defaultvalue", "lastvalue"],
}


def _build_colmap(header_cells):
    """Map canonical field -> column index, from a header row. 'name' is required by the caller.
    Resolution is alias-priority: for each field, the first alias (in list order) that matches any
    column wins, so strong aliases beat weak ones regardless of column order."""
    norm = [_norm_key(c) for c in header_cells]

    def find(aliases):
        for a in aliases:
            for i, key in enumerate(norm):
                if key == a:
                    return i
        return None

    colmap = {}
    for field in ("name", "address", "description", "unit", "sample"):
        idx = find(_ALIASES[field])
        if idx is not None:
            colmap[field] = idx

    # datatype + the Rockwell row-TYPE column, which collide on the word 'type':
    dt_idx = find(_ALIASES["datatype"])     # strong 'datatype' aliases only
    type_idx = None
    for i, key in enumerate(norm):
        if key == "type":
            type_idx = i
            break
    if dt_idx is not None:
        colmap["datatype"] = dt_idx
        if type_idx is not None and type_idx != dt_idx:
            colmap["typecol"] = type_idx     # Rockwell: real datatype col + a row-marker col
    elif type_idx is not None:
        colmap["datatype"] = type_idx        # a lone 'type' header IS the datatype (generic)
    return colmap


# ---- delimiter + line handling ----
def _split_lines(text):
    if text is None:
        return []
    # strip a BOM if present -- UTF-8 BOM as raw bytes (Jython 2.7 str), or U+FEFF as a decoded
    # char (CPython 3 str / Py2 unicode). ord() check keeps the source pure ASCII.
    if text[:3] == "\xef\xbb\xbf":
        text = text[3:]
    elif len(text) > 0 and ord(text[0]) == 0xFEFF:
        text = text[1:]
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return [ln for ln in text.split("\n")]


def sniff_delimiter(lines):
    """Pick the delimiter (',' ';' or tab) by majority count across the first non-blank lines."""
    cand = [",", ";", "\t", "|"]
    counts = {}
    seen = 0
    for ln in lines:
        if ln.strip() == "":
            continue
        for d in cand:
            counts[d] = counts.get(d, 0) + ln.count(d)
        seen += 1
        if seen >= 12:
            break
    best = ","
    best_n = -1
    for d in cand:
        if counts.get(d, 0) > best_n:
            best = d
            best_n = counts.get(d, 0)
    return best if best_n > 0 else ","


def _split_row(line, delim):
    """Split one CSV line on `delim`, honoring double-quoted fields ("" = escaped quote)."""
    out = []
    cur = []
    i = 0
    n = len(line)
    in_q = False
    while i < n:
        ch = line[i]
        if in_q:
            if ch == '"':
                if i + 1 < n and line[i + 1] == '"':
                    cur.append('"')
                    i += 2
                    continue
                in_q = False
                i += 1
                continue
            cur.append(ch)
            i += 1
            continue
        if ch == '"':
            in_q = True
            i += 1
            continue
        if ch == delim:
            out.append("".join(cur))
            cur = []
            i += 1
            continue
        cur.append(ch)
        i += 1
    out.append("".join(cur))
    return [c.strip() for c in out]


# ---- format detection ----
def detect_format(header_cells):
    keys = set(_norm_key(c) for c in header_cells)
    if "type" in keys and "scope" in keys and ("datatype" in keys or "specifier" in keys):
        return "rockwell_logix"
    if "tagname" in keys and ("scaling" in keys or "scanrate" in keys or "respectdatatype" in keys):
        return "kepware"
    if "name" in keys and ("logicaladdress" in keys or "path" in keys) and "datatype" in keys:
        return "siemens_tia"
    return "generic"


def _looks_like_header(cells):
    """A header row has a name-like column AND at least one meta column (datatype / address /
    value / the Rockwell 'type' marker)."""
    keys = [_norm_key(c) for c in cells]
    has_name = any(k in _ALIASES["name"] for k in keys)
    has_meta = any(k in _ALIASES["datatype"] or k in _ALIASES["address"]
                   or k in _ALIASES["sample"] or k == "type" for k in keys)
    return has_name and has_meta


# ---- main entry ----
def parse(text):
    """Parse PLC tag-export CSV text into the canonical record set.

    Returns a dict:
      {"format": <dialect>, "delimiter": <str>, "count": <int>,
       "tags": [ {name, datatype, kind, dt, address, description, unit, sample, source_format} ],
       "warnings": [ <str> ]}
    Rows before the detected header (vendor remark/metadata preamble) are skipped with a warning.
    A row with no usable name is skipped. Datatype is normalized to a kind + an Ignition-style dt;
    when absent, the kind is inferred from a sample value if present.
    """
    warnings = []
    lines = _split_lines(text)
    nonblank = [ln for ln in lines if ln.strip() != ""]
    if not nonblank:
        return {"format": "generic", "delimiter": ",", "count": 0, "tags": [], "warnings": ["empty input"]}

    delim = sniff_delimiter(nonblank)

    # find the header row (first row that looks like a header); preamble before it = skipped
    header_idx = -1
    header_cells = None
    for idx, ln in enumerate(lines):
        if ln.strip() == "":
            continue
        cells = _split_row(ln, delim)
        if _looks_like_header(cells):
            header_idx = idx
            header_cells = cells
            break
    if header_cells is None:
        # No recognizable header. Treat as a single-column name list (one tag per line).
        tags = []
        for ln in nonblank:
            name = _split_row(ln, delim)[0].strip()
            if name:
                kind, dt = (UNKNOWN, "")
                tags.append(_record(name, "", kind, dt, "", "", "", "", "generic"))
        warnings.append("no header row found; treated each line as a bare tag name")
        return {"format": "generic", "delimiter": delim, "count": len(tags),
                "tags": tags, "warnings": warnings}

    fmt = detect_format(header_cells)
    colmap = _build_colmap(header_cells)
    if "name" not in colmap:
        return {"format": fmt, "delimiter": delim, "count": 0, "tags": [],
                "warnings": ["header has no recognizable name column"]}
    if header_idx > 0:
        skipped = len([ln for ln in lines[:header_idx] if ln.strip() != ""])
        if skipped:
            warnings.append("skipped %d preamble line(s) before the header" % skipped)

    ncols_needed = max(colmap.values())
    tags = []
    for ln in lines[header_idx + 1:]:
        if ln.strip() == "":
            continue
        cells = _split_row(ln, delim)
        if len(cells) <= ncols_needed:
            cells = cells + [""] * (ncols_needed + 1 - len(cells))

        # Rockwell: only TAG rows are real tags (skip COMMENT/ALIAS/QUALIFIER/etc.)
        if "typecol" in colmap:
            rowtype = cells[colmap["typecol"]].strip().upper()
            if rowtype and rowtype != "TAG":
                continue

        name = cells[colmap["name"]].strip()
        if not name:
            continue
        raw_dt = cells[colmap["datatype"]].strip() if "datatype" in colmap else ""
        address = cells[colmap["address"]].strip() if "address" in colmap else ""
        desc = cells[colmap["description"]].strip() if "description" in colmap else ""
        unit = cells[colmap["unit"]].strip() if "unit" in colmap else ""
        sample = cells[colmap["sample"]].strip() if "sample" in colmap else ""

        kind, dt = normalize_datatype(raw_dt)
        if kind == UNKNOWN and sample:
            kind, dt = _infer_kind_from_value(sample)

        tags.append(_record(name, raw_dt, kind, dt, address, desc, unit, sample, fmt))

    return {"format": fmt, "delimiter": delim, "count": len(tags),
            "tags": tags, "warnings": warnings}


def _record(name, datatype, kind, dt, address, description, unit, sample, source_format):
    return {"name": name, "datatype": datatype, "kind": kind, "dt": dt,
            "address": address, "description": description, "unit": unit,
            "sample": sample, "source_format": source_format}


def to_scan_rows(parsed, prefix="csv:"):
    """Shape parsed tags like the wizard's live tag scan (_scan_all output): [{path, dt}].
    Lets scan_for_role / suggest_for_role run on CSV tags with no changes. `path` is a synthetic
    'csv:<name>' so it never collides with a real gateway tag path; dt is the Ignition-style type
    so the role datatype-filter matches. (The wizard adds live value/quality separately; CSV tags
    carry a file `sample` instead of a live read.)"""
    rows = []
    for t in parsed.get("tags", []):
        rows.append({"path": prefix + t["name"], "dt": t["dt"]})
    return rows
