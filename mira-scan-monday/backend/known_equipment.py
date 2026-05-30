"""Curated allowlist of equipment families known to have manuals in the
MIRA knowledge base. Used by /kb/lookup as a fast deterministic match
without round-tripping NeonDB on every scan.

Match rule: case-insensitive substring. An entry matches when ANY of its
make tokens appears in the scanned `make` AND ANY of its model tokens
appears in the scanned `model`. Empty scanner output (no make / no
model) never matches.

Add new equipment here as the KB grows — keep tokens specific enough to
avoid collisions (e.g. don't put bare "525" without "powerflex").
"""

from __future__ import annotations

KNOWN_EQUIPMENT: list[dict] = [
    # --- AC Drives (VFDs) ---
    {
        "asset_id": "ab-powerflex-525",
        "label": "Allen-Bradley PowerFlex 525",
        "category": "AC drive",
        "make": ["allen-bradley", "allen bradley", "rockwell", "ab"],
        "model": ["powerflex 525", "powerflex525", "pf525", "25b"],
    },
    {
        "asset_id": "ab-powerflex-523",
        "label": "Allen-Bradley PowerFlex 523",
        "category": "AC drive",
        "make": ["allen-bradley", "allen bradley", "rockwell"],
        "model": ["powerflex 523", "pf523", "25a"],
    },
    {
        "asset_id": "ab-powerflex-520-series",
        "label": "Allen-Bradley PowerFlex 520-series",
        "category": "AC drive",
        "make": ["allen-bradley", "allen bradley", "rockwell"],
        "model": ["powerflex 520", "520-series"],
    },
    {
        "asset_id": "ab-powerflex-4",
        "label": "Allen-Bradley PowerFlex 4",
        "category": "AC drive",
        "make": ["allen-bradley", "rockwell"],
        "model": ["powerflex 4", "22f", "22a"],
    },
    {
        "asset_id": "ab-powerflex-755",
        "label": "Allen-Bradley PowerFlex 755",
        "category": "AC drive",
        "make": ["allen-bradley", "rockwell"],
        "model": ["powerflex 755", "20g"],
    },
    {
        "asset_id": "yaskawa-ga500",
        "label": "Yaskawa GA500",
        "category": "AC drive",
        "make": ["yaskawa"],
        "model": ["ga500", "cipr-ga50"],
    },
    {
        "asset_id": "yaskawa-v1000",
        "label": "Yaskawa V1000",
        "category": "AC drive",
        "make": ["yaskawa"],
        "model": ["v1000", "cimr-vu"],
    },
    {
        "asset_id": "abb-acs880",
        "label": "ABB ACS880",
        "category": "AC drive",
        "make": ["abb"],
        "model": ["acs880"],
    },
    {
        "asset_id": "abb-acs580",
        "label": "ABB ACS580",
        "category": "AC drive",
        "make": ["abb"],
        "model": ["acs580"],
    },
    {
        "asset_id": "siemens-sinamics-g120",
        "label": "Siemens SINAMICS G120",
        "category": "AC drive",
        "make": ["siemens"],
        "model": ["g120", "sinamics g120", "6sl3"],
    },
    {
        "asset_id": "automationdirect-gs10",
        "label": "AutomationDirect GS10",
        "category": "AC drive",
        "make": ["automationdirect", "automation direct", "ad"],
        "model": ["gs10", "gs11", "gs1-", "gs1 "],
    },
    {
        "asset_id": "automationdirect-gs20",
        "label": "AutomationDirect GS20",
        "category": "AC drive",
        "make": ["automationdirect", "automation direct"],
        "model": ["gs20", "gs21", "gs2-", "gs2 "],
    },
    {
        "asset_id": "automationdirect-gs4",
        "label": "AutomationDirect GS4",
        "category": "AC drive",
        "make": ["automationdirect", "automation direct"],
        "model": ["gs4", "gs-4"],
    },
    # --- PLCs ---
    {
        "asset_id": "ab-compactlogix",
        "label": "Allen-Bradley CompactLogix",
        "category": "PLC",
        "make": ["allen-bradley", "rockwell"],
        "model": ["compactlogix", "1769", "5069", "5370"],
    },
    {
        "asset_id": "ab-controllogix",
        "label": "Allen-Bradley ControlLogix",
        "category": "PLC",
        "make": ["allen-bradley", "rockwell"],
        "model": ["controllogix", "1756", "5570", "5580"],
    },
    {
        "asset_id": "ab-micrologix",
        "label": "Allen-Bradley MicroLogix",
        "category": "PLC",
        "make": ["allen-bradley", "rockwell"],
        "model": ["micrologix", "1762", "1763", "1766"],
    },
    {
        "asset_id": "ab-micro820",
        "label": "Allen-Bradley Micro820",
        "category": "PLC",
        "make": ["allen-bradley", "rockwell"],
        "model": ["micro820", "2080-lc20"],
    },
    {
        "asset_id": "siemens-s7-1200",
        "label": "Siemens S7-1200",
        "category": "PLC",
        "make": ["siemens"],
        "model": ["s7-1200", "s71200", "1211c", "1212c", "1214c", "1215c", "1217c"],
    },
    {
        "asset_id": "siemens-s7-1500",
        "label": "Siemens S7-1500",
        "category": "PLC",
        "make": ["siemens"],
        "model": ["s7-1500", "s71500", "1511", "1513", "1515", "1516", "1517", "1518"],
    },
    # --- Motors ---
    {
        "asset_id": "baldor-motor",
        "label": "Baldor / ABB-Baldor industrial motor",
        "category": "AC motor",
        "make": ["baldor", "baldor-reliance", "abb"],
        "model": ["l1408t", "l3504", "vm", "em", "rpm"],
    },
]


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def match_equipment(make: str, model: str) -> dict | None:
    """Return the first KNOWN_EQUIPMENT entry that matches (make AND model).

    Either field may be blank if the OCR didn't read it; the match still
    succeeds when the other field is unambiguous (e.g. "PowerFlex 525"
    alone is enough even without an explicit make).
    """
    nm_make = _norm(make)
    nm_model = _norm(model)

    if not nm_make and not nm_model:
        return None

    def make_hits(entry: dict) -> bool:
        if not nm_make:
            return True
        return any(tok in nm_make for tok in entry["make"])

    def model_hits(entry: dict) -> bool:
        if not nm_model:
            return False
        return any(tok in nm_model for tok in entry["model"])

    for entry in KNOWN_EQUIPMENT:
        if make_hits(entry) and model_hits(entry):
            return entry
    return None


def get_equipment(asset_id: str) -> dict | None:
    for entry in KNOWN_EQUIPMENT:
        if entry["asset_id"] == asset_id:
            return entry
    return None
