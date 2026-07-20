"""The Drive Commander provable-read-only gate (Task 6, ADR-0025 amendment).

ADR-0025 §4 amends ``.claude/rules/fieldbus-readonly.md`` with a narrow
carve-out: a customer-run *local desktop* Drive Commander MAY open supported
**read-only** connections to supported drives on authorized plant networks,
under a **protocol-specific** discipline — **Modbus (TCP/RTU): read-only
function codes FC1–FC4 only, never FC5/6/15/16**; **EtherNet/IP: read /
status / identity-safe services only** (no parameter/config/output-assembly/
control-word writes, no state-changing service). "Read function codes only"
is a Modbus concept and does NOT transfer to EtherNet/IP. §6 item 6 calls out
a "Provable-read-only test" as the shipping gate.

**Scope boundary — read this before trusting the gate.** This gate proves the
**pack / loader / card surface** (``mira-bots/shared/drive_packs``) is *pure
data reshaping* — no write FC, no fieldbus client, no socket. It does **NOT**
prove that a future Drive Commander **desktop connector** is read-only: **no
connector exists yet.** When the connector is added, it MUST be added to this
gate (extend the scanned package set below) OR carry its own equivalent
protocol-specific gate (Modbus FC1–FC4; EtherNet/IP safe-services allowlist).
Do not read a green run here as "the desktop connector is safe."

This module IS that (pack-surface) gate. It statically scans ``mira-bots/shared/drive_packs``
(today: pure data-reshaping — a JSON loader, a nameplate-text matcher, and a
diagnostic-card builder; see ``.claude/rules/fieldbus-readonly.md``) plus the
pack JSON under the co-located ``mira-bots/shared/drive_packs/packs/`` (package
data, shipped in the Docker image) and asserts:

  1. No Modbus/EtherNet-IP write-call names appear (``write_register``,
     ``Write_Tag``, ``forward_open``, ...).
  2. No fieldbus-client / raw-socket imports appear (``pymodbus``,
     ``pycomm3``, ``snap7``, ``opcua``, ``asyncua``, ``socket``,
     ``pyModbusTCP``).
  3. No function/method is *named* like a device write
     (``write_*``/``set_param*``/``deploy_*``/``send_command*``).
  4. No explicit Modbus write-function-code literal (5/6/15/16) is passed to
     a function-code-shaped keyword/positional slot.
  5. Every ``pack.json`` parses as pure data with only the documented
     top-level keys (``packs/README.md``) — no executable/command content.

Detection approach (mirrors ``tests/test_architecture.py``'s
``scan_ingest_module`` pattern): the ``ast`` module is the primary tool for
imports, calls, and def names — far more robust than regex for those shapes,
and immune to the "the literal 5 is just an array index" false positive the
brief warns about. Only the narrow function-code-literal check (item 4) uses
a conservative regex, and it requires a function-code-shaped keyword name
adjacent to the literal — a bare ``arr[5]`` or ``x = 16`` never matches.

**This module ADDS a test only.** It does not modify ``drive_packs/``
source, ``live_snapshot.py``, or any pack JSON — per the task brief, if this
gate ever fails against real code, that is a real finding to STOP and report,
not something to "fix" by weakening the checker.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

# mira-bots/tests/test_drive_packs_readonly.py -> repo root is two parents up
# from mira-bots/, i.e. three parents up from this file.
_ROOT = Path(__file__).resolve().parents[2]
_DRIVE_PACKS_DIR = _ROOT / "mira-bots" / "shared" / "drive_packs"
# Co-located package data (ships inside the Docker image), not a repo-root dir.
_PACKS_DIR = _DRIVE_PACKS_DIR / "packs"

# ---------------------------------------------------------------------------
# The forbidden vocabulary (ADR-0025 §4 + .claude/rules/fieldbus-readonly.md)
# ---------------------------------------------------------------------------

# Modbus/EtherNet-IP write call names — pymodbus, pycomm3, and generic names
# a hand-rolled write helper would plausibly use. Matched by the *name* of a
# call's callee (a bare name or the trailing attribute of a dotted call), so
# `client.write_register(...)`, `pymodbus_client.write_register(...)`, and
# `write_register(...)` are all caught regardless of the receiver.
_FORBIDDEN_CALL_NAMES = {
    "write_coil",
    "write_coils",
    "write_register",
    "write_registers",
    "WriteSingleCoil",
    "WriteMultipleRegisters",
    "WriteSingleRegister",
    "WriteMultipleCoils",
    "Write_Tag",
    "write_tag",
    "forward_open",
    "set_attribute",
}

# Fieldbus-client / raw-socket import roots. Matched against the top-level
# dotted segment of an `import x.y` or `from x.y import z` — so
# `from pymodbus.client import ModbusTcpClient` is caught via root
# `pymodbus`, not the full dotted path.
_FORBIDDEN_IMPORT_ROOTS = {
    "pymodbus",
    "pycomm3",
    "snap7",  # the importable name for python-snap7
    "opcua",
    "asyncua",
    "socket",
    "pyModbusTCP",
}

# Def/method names implying a device write. Prefix match, not exact — a pure
# data module has no legitimate reason to define any of these.
_FORBIDDEN_DEF_PREFIXES = (
    "write_",
    "set_param",
    "deploy_",
    "send_command",
)

# Modbus write function codes (FC5 WriteSingleCoil, FC6 WriteSingleRegister,
# FC15 WriteMultipleCoils, FC16 WriteMultipleRegisters). Only flagged when the
# literal sits in a function-code-shaped slot — a keyword argument or dict/
# variable name containing "function_code"/"fc" (case-insensitive) — so a
# plain array index (`arr[5]`) or an unrelated integer (`retries = 16`) never
# matches. This keeps the check aligned with the brief's explicit warning not
# to naively fail on 5/6/15/16 appearing as array indices.
_FUNCTION_CODE_SLOT_RE = re.compile(
    r"\b(?:function_?code|fc)\s*[:=]\s*(5|6|15|16)\b",
    re.IGNORECASE,
)


def _line_of(source: str, idx: int) -> int:
    return source[:idx].count("\n") + 1


def _call_name(node: ast.Call) -> str | None:
    """The bare name being called: `f(...)` -> "f"; `a.b.f(...)` -> "f"."""
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _import_roots(node: ast.Import | ast.ImportFrom) -> list[str]:
    if isinstance(node, ast.Import):
        return [alias.name.split(".")[0] for alias in node.names]
    if isinstance(node, ast.ImportFrom) and node.module:
        return [node.module.split(".")[0]]
    return []


def scan_source_for_fieldbus_writes(rel_path: str, source: str) -> list[str]:
    """Return read-only-gate violations found in one Python module's source.

    Empty list = clean. Pure function — no I/O beyond the string it's given —
    so it is unit-tested directly against synthetic fixtures below (the
    self-test), proving the gate has teeth before it's trusted against real
    files.
    """
    violations: list[str] = []
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:  # pragma: no cover - shouldn't happen on repo code
        return [f"{rel_path}: unparseable ({exc})"]

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for root in _import_roots(node):
                if root in _FORBIDDEN_IMPORT_ROOTS:
                    violations.append(
                        f"{rel_path}:{node.lineno} imports forbidden fieldbus/socket "
                        f"module '{root}' (drive_packs must stay pure data-reshaping — "
                        "no fieldbus client, no raw socket)"
                    )
        elif isinstance(node, ast.Call):
            name = _call_name(node)
            if name in _FORBIDDEN_CALL_NAMES:
                violations.append(
                    f"{rel_path}:{node.lineno} calls '{name}' — a Modbus/EtherNet-IP "
                    "write primitive is forbidden in drive_packs (read-only, "
                    "ADR-0025 §4 / .claude/rules/fieldbus-readonly.md)"
                )
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name.startswith(_FORBIDDEN_DEF_PREFIXES):
                violations.append(
                    f"{rel_path}:{node.lineno} defines '{node.name}' — a name implying "
                    "a device write; drive_packs is reads + pure transforms only"
                )

    for match in _FUNCTION_CODE_SLOT_RE.finditer(source):
        violations.append(
            f"{rel_path}:{_line_of(source, match.start())} sets a Modbus write "
            f"function code ({match.group(1)}) — FC5/6/15/16 are write codes, "
            "forbidden in drive_packs"
        )

    return violations


# ---------------------------------------------------------------------------
# The real gate: today's drive_packs package + pack JSON must be clean
# ---------------------------------------------------------------------------


def _drive_packs_py_files() -> list[Path]:
    return sorted(p for p in _DRIVE_PACKS_DIR.rglob("*.py") if "__pycache__" not in p.parts)


def test_drive_packs_source_is_read_only():
    """The real gate: current drive_packs/*.py carries no write primitive.

    This is the ADR-0025 §4/§6 "Provable-read-only test" — the Drive
    Commander shipping gate. A failure here is a real finding, not something
    to silence by loosening the checker.
    """
    assert _drive_packs_py_files(), (
        f"no .py files found under {_DRIVE_PACKS_DIR} — the gate has nothing to scan; "
        "check the path"
    )

    offenders: list[str] = []
    for path in _drive_packs_py_files():
        rel = path.relative_to(_ROOT).as_posix()
        offenders.extend(scan_source_for_fieldbus_writes(rel, path.read_text(encoding="utf-8")))

    assert not offenders, (
        "Read-only violation in mira-bots/shared/drive_packs — this package must never "
        "emit a fieldbus write or open a fieldbus socket. See ADR-0025 §4 + "
        ".claude/rules/fieldbus-readonly.md.\n\n" + "\n".join(offenders)
    )


# ---------------------------------------------------------------------------
# Pack JSON is pure data — parses, and carries no keys beyond the documented
# schema (packs/README.md § "Top level").
# ---------------------------------------------------------------------------

_ALLOWED_TOP_LEVEL_PACK_KEYS = {
    "pack_id",
    "schema_version",
    "family",
    "nameplate",
    "live_decode",
    "envelope",
    "knowledge",
    "provenance",
    "parameters",
    "keypad_navigation",
    "fault_entries",
}


def _pack_json_files() -> list[Path]:
    return sorted(_PACKS_DIR.glob("*/pack.json"))


def test_pack_json_is_pure_data():
    """Every pack.json parses as JSON data with only the documented top-level
    keys — no unexpected key that could smuggle in executable/command
    content."""
    files = _pack_json_files()
    assert files, f"no pack.json files found under {_PACKS_DIR} — check the path"

    for path in files:
        rel = path.relative_to(_ROOT).as_posix()
        raw = json.loads(path.read_text(encoding="utf-8"))
        assert isinstance(raw, dict), f"{rel}: top-level JSON must be an object"
        unexpected = set(raw.keys()) - _ALLOWED_TOP_LEVEL_PACK_KEYS
        assert not unexpected, (
            f"{rel}: unexpected top-level key(s) {sorted(unexpected)} beyond the "
            f"documented schema (packs/README.md) — {sorted(_ALLOWED_TOP_LEVEL_PACK_KEYS)}"
        )


# ---------------------------------------------------------------------------
# Self-test: prove the checker has teeth (mirrors
# tests/test_architecture.py::test_one_pipeline_checker_catches_violations)
# ---------------------------------------------------------------------------


def test_checker_catches_synthetic_write_violations():
    """The checker must FAIL on obvious fieldbus-write fixtures — so a green
    run against real code actually means something."""
    bad_cases = {
        "pymodbus write_register": (
            "from pymodbus.client import ModbusTcpClient\n"
            "client = ModbusTcpClient('10.0.0.5')\n"
            "client.write_register(40001, 100)\n"
        ),
        "pymodbus write_coil": ("import pymodbus\nclient.write_coil(1, True)\n"),
        "pycomm3 Write_Tag": ("import pycomm3\nplc.Write_Tag('Program:MainProgram.Tag1', 5)\n"),
        "raw socket import": (
            "import socket\ns = socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n"
        ),
        "snap7 import": ("import snap7\n"),
        "opcua write-shaped module": ("from opcua import Client\n"),
        "forward_open call": ("cip.forward_open(session, path)\n"),
        "write-named def": ("def write_setpoint(value):\n    return None\n"),
        "set_param-named def": ("def set_param(name, value):\n    return None\n"),
        "deploy-named def": ("def deploy_modbus_map(path):\n    return None\n"),
        "send_command-named def": ("def send_command_word(word):\n    return None\n"),
        "explicit write function code kwarg": ("send(function_code=6, address=1, value=100)\n"),
        "explicit write function code short kwarg": ("send(fc=16, address=1, values=[1])\n"),
    }
    for label, src in bad_cases.items():
        assert scan_source_for_fieldbus_writes("synthetic.py", src), (
            f"checker missed a violation it must catch: {label}"
        )

    # A conforming, drive_packs-shaped module (JSON read + dataclass build +
    # array indexing that happens to use 5/6/15/16) must stay clean. This is
    # the false-positive guard the brief calls out explicitly: the literals
    # 5/6/15/16 as plain indices/values must NOT trip the gate.
    good = (
        "import json\n"
        "from pathlib import Path\n"
        "from dataclasses import dataclass\n"
        "\n"
        "@dataclass(frozen=True)\n"
        "class RegisterEntry:\n"
        "    addr: int | None\n"
        "    unit: str | None\n"
        "\n"
        "def load_pack(pack_id: str):\n"
        "    raw = json.loads(Path('pack.json').read_text())\n"
        "    return raw\n"
        "\n"
        "def _band(raw):\n"
        "    return raw.get('min')\n"
        "\n"
        "registers = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170]\n"
        "fifth = registers[5]\n"
        "sixteenth = registers[16]\n"
        "retries = 16\n"
        "fault_code = 15\n"
    )
    assert scan_source_for_fieldbus_writes("synthetic_good.py", good) == []
