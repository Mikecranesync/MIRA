#!/usr/bin/env python3
"""Read-only field-device discovery for industrial networks + RS-485.

Scans a subnet (and optionally a serial bus) for industrial field devices,
identifies them against device-profiles/*.yaml, and writes a resume-shaped
inventory.json. Sibling to deploy_modbus_map.py / live_monitor.py.

    # auto-detect subnet from local interfaces, deep + shallow probes
    python plc/discover.py

    # explicit subnet + RS-485 sweep for the GS10
    python plc/discover.py --subnet 192.168.1.0/24 --serial /dev/tty.usbserial-XXXX

    # one host, Modbus/TCP + EtherNet/IP only
    python plc/discover.py --host 192.168.1.100 --deep-only

    # see the plan, probe nothing
    python plc/discover.py --subnet 192.168.1.0/24 --dry-run

SAFETY — this tool is STRICTLY READ-ONLY (see .claude/rules/fieldbus-readonly.md):
it only ever does TCP connects, CIP List Identity, and Modbus READ function codes.
It NEVER writes a register, sets an IP/baud, or sends a control command. A motor
must never move because someone ran a scan. Config-writes live in separate tools
(deploy_modbus_map.py).

Spec: docs/specs/fieldbus-discovery-spec.md
Deps: pymodbus (repo dep), rich (repo dep), PyYAML. Zero GPL, no nmap binary.
"""
from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import logging
import socket
import struct
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import yaml
from rich.console import Console
from rich.table import Table

try:  # pymodbus 3.x
    from pymodbus.client import ModbusSerialClient, ModbusTcpClient
except ImportError:  # pragma: no cover - very old pymodbus
    from pymodbus.client.sync import ModbusSerialClient, ModbusTcpClient  # type: ignore

logging.basicConfig(level=logging.WARNING, format="%(message)s")
logger = logging.getLogger("fieldbus-discover")
# pymodbus logs exception responses (e.g. ILLEGAL_FUNCTION when a map isn't deployed)
# at its own level — that's expected, classified output for us, not console noise.
logging.getLogger("pymodbus").setLevel(logging.CRITICAL)
console = Console()

SCHEMA = "fieldbus-inventory/1"

# port -> (protocol key, depth). Deep = we fully identify; shallow = port-open + banner.
DEFAULT_PORTS: dict[int, tuple[str, str]] = {
    502: ("modbus_tcp", "deep"),
    44818: ("ethernet_ip", "deep"),
    102: ("s7", "shallow"),
    4840: ("opcua", "shallow"),
    47808: ("bacnet", "shallow"),
}

# RS-485 sweep defaults (GS10-known values tried first via profile serial_defaults).
DEFAULT_BAUDS = [9600, 19200, 38400]
DEFAULT_FRAMES = ["8N2", "8N1", "8E1"]

TIER_PORT_OPEN = "port_open"
TIER_PROTO = "protocol_confirmed"
TIER_DEVICE = "device_identified"


# --------------------------------------------------------------------------- #
# Profiles
# --------------------------------------------------------------------------- #
@dataclass
class Profile:
    id: str
    data: dict[str, Any]

    @property
    def display_name(self) -> str:
        return self.data.get("display_name", self.id)


def load_profiles(profiles_dir: Path) -> list[Profile]:
    """Load every device-profiles/*.yaml except the _schema doc."""
    profiles: list[Profile] = []
    if not profiles_dir.is_dir():
        logger.warning("profiles dir not found: %s (identification disabled)", profiles_dir)
        return profiles
    for path in sorted(profiles_dir.glob("*.yaml")):
        if path.stem.startswith("_"):
            continue
        try:
            data = yaml.safe_load(path.read_text()) or {}
        except yaml.YAMLError as exc:
            logger.warning("skipping malformed profile %s: %s", path.name, exc)
            continue
        if isinstance(data, dict) and data.get("id"):
            profiles.append(Profile(id=data["id"], data=data))
    return profiles


def _expect_ok(expect: dict[str, Any], value: int) -> bool:
    """Evaluate a profile fingerprint `expect` clause against a read value."""
    if not expect:
        return True
    if expect.get("nonzero"):
        return value != 0
    if "equals" in expect:
        return value == expect["equals"]
    if "in" in expect:
        return value in expect["in"]
    if "mask" in expect and "eq" in expect:
        return (value & expect["mask"]) == expect["eq"]
    return True


# --------------------------------------------------------------------------- #
# Network: async TCP port sweep (read-only: connect then close)
# --------------------------------------------------------------------------- #
async def _check_port(host: str, port: int, timeout: float, sem: asyncio.Semaphore) -> bool:
    async with sem:
        try:
            fut = asyncio.open_connection(host, port)
            _reader, writer = await asyncio.wait_for(fut, timeout=timeout)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:  # noqa: BLE001 - close best-effort
                pass
            return True
        except (asyncio.TimeoutError, OSError):
            return False


async def scan_subnet(
    hosts: list[str], ports: list[int], timeout: float, concurrency: int
) -> dict[str, list[int]]:
    """Return {host: [open_ports]} for hosts with >=1 open port."""
    sem = asyncio.Semaphore(concurrency)
    tasks = {(h, p): asyncio.create_task(_check_port(h, p, timeout, sem)) for h in hosts for p in ports}
    open_map: dict[str, list[int]] = {}
    for (host, port), task in tasks.items():
        if await task:
            open_map.setdefault(host, []).append(port)
    for ports_open in open_map.values():
        ports_open.sort()
    return open_map


def expand_targets(subnets: list[str], single_hosts: list[str]) -> list[str]:
    hosts: list[str] = []
    seen: set[str] = set()
    for cidr in subnets:
        try:
            net = ipaddress.ip_network(cidr, strict=False)
        except ValueError as exc:
            logger.warning("bad subnet %s: %s", cidr, exc)
            continue
        for ip in net.hosts():
            s = str(ip)
            if s not in seen:
                seen.add(s)
                hosts.append(s)
    for h in single_hosts:
        if h not in seen:
            seen.add(h)
            hosts.append(h)
    return hosts


def autodetect_subnets() -> list[str]:
    """Best-effort /24s from local non-loopback IPv4 addresses."""
    nets: list[str] = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, family=socket.AF_INET):
            ip = str(info[4][0])
            if ip.startswith("127."):
                continue
            net = str(ipaddress.ip_network(ip + "/24", strict=False))
            if net not in nets:
                nets.append(net)
    except socket.gaierror:
        pass
    return nets


# --------------------------------------------------------------------------- #
# Deep probe: EtherNet/IP CIP List Identity (UDP 44818, hand-rolled, read-only)
# --------------------------------------------------------------------------- #
def enip_list_identity(host: str, timeout: float = 1.0) -> Optional[dict[str, Any]]:
    """Send a CIP List Identity (cmd 0x63) and parse the identity reply.

    Encapsulation header is 24 bytes; List Identity request carries no data.
    No connection/session needed — this is the canonical 'who are you' probe.
    """
    request = struct.pack(
        "<HHIIQI",  # command, length, session, status, sender_context(8), options
        0x0063, 0, 0, 0, 0, 0,
    )
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(request, (host, 44818))
        data, _ = sock.recvfrom(1024)
    except OSError:
        return None
    finally:
        sock.close()
    return _parse_list_identity(data)


def _parse_list_identity(data: bytes) -> Optional[dict[str, Any]]:
    if len(data) < 24 + 2:
        return None
    # Skip 24-byte encapsulation header; then item count (2), item type (2), item len (2).
    off = 24
    (item_count,) = struct.unpack_from("<H", data, off)
    off += 2
    if item_count < 1:
        return None
    off += 4  # item type (2) + item length (2)
    try:
        # CIP Identity item body
        off += 2  # encap protocol version
        off += 16  # socket address (sin_family/port/addr/zero)
        vendor_id, device_type, product_code = struct.unpack_from("<HHH", data, off)
        off += 6
        off += 2  # revision (major/minor)
        (status,) = struct.unpack_from("<H", data, off)
        off += 2
        (serial,) = struct.unpack_from("<I", data, off)
        off += 4
        (name_len,) = struct.unpack_from("<B", data, off)
        off += 1
        product_name = data[off : off + name_len].decode("ascii", errors="replace").strip()
    except struct.error:
        return None
    return {
        "vendor_id": vendor_id,
        "device_type": device_type,
        "product_code": product_code,
        "status": status,
        "serial": f"{serial:08X}",
        "product": product_name,
    }


# --------------------------------------------------------------------------- #
# Deep probe: Modbus/TCP (pymodbus, read-only)
# --------------------------------------------------------------------------- #
def probe_modbus_tcp(host: str, profiles: list[Profile], timeout: float) -> Optional[dict[str, Any]]:
    """Confirm Modbus on :502 and try to fingerprint against profiles. Read-only."""
    client = ModbusTcpClient(host, port=502, timeout=timeout)
    if not client.connect():
        return None
    evidence: list[str] = []
    matched: Optional[Profile] = None
    identity: dict[str, Any] = {}
    try:
        # Confirm the protocol: any successful read on unit 1.
        confirmed = False
        try:
            rr = client.read_holding_registers(address=0, count=1, slave=1)
            if not rr.isError():
                confirmed = True
                evidence.append("modbus/tcp unit 1 FC3 read ok")
        except Exception:  # noqa: BLE001 - some maps reject addr 0; still Modbus
            pass
        # Try each profile's modbus_tcp fingerprint.
        for prof in profiles:
            fp = (prof.data.get("fingerprint") or {}).get("modbus_tcp")
            if not fp:
                continue
            read = fp.get("read", {})
            reg, count = read.get("reg", 0), read.get("count", 1)
            try:
                rr = client.read_holding_registers(address=reg, count=count, slave=1)
            except Exception:  # noqa: BLE001
                continue
            if rr.isError() or not getattr(rr, "registers", None):
                continue
            confirmed = True
            if _expect_ok(fp.get("expect", {}), rr.registers[0]):
                matched = prof
                evidence.append(f"modbus/tcp fingerprint reg {reg}={rr.registers[0]} -> {prof.id}")
                break
        if not confirmed:
            return None
    finally:
        client.close()
    return {"protocol": "modbus_tcp", "profile": matched, "identity": identity, "evidence": evidence}


# --------------------------------------------------------------------------- #
# Deep probe: Modbus RTU / RS-485 sweep (pymodbus serial, read-only)
# --------------------------------------------------------------------------- #
def _frame_parts(frame: str) -> tuple[int, str, int]:
    """'8N2' -> (bytesize, parity, stopbits)."""
    return int(frame[0]), frame[1].upper(), int(frame[2])


def _ordered_combos(
    profiles: list[Profile], bauds: list[int], frames: list[str]
) -> list[tuple[int, str]]:
    """Try known-good profile serial_defaults FIRST, then the full matrix."""
    preferred: list[tuple[int, str]] = []
    for prof in profiles:
        sd = prof.data.get("serial_defaults") or {}
        if sd.get("baud") and sd.get("frame"):
            combo = (int(sd["baud"]), str(sd["frame"]))
            if combo not in preferred:
                preferred.append(combo)
    rest = [(b, f) for b in bauds for f in frames if (b, f) not in preferred]
    return preferred + rest


def sweep_serial(
    port: str, addrs: range, bauds: list[int], frames: list[str],
    profiles: list[Profile], timeout: float,
) -> list[dict[str, Any]]:
    """Sweep addr x baud x frame on an RS-485 port. Read-only (FC3). Returns hits."""
    hits: list[dict[str, Any]] = []
    found_addrs: set[int] = set()
    # Build a probe-register list from profiles (so a found device fingerprints itself).
    probe_regs = []
    for prof in profiles:
        fp = (prof.data.get("fingerprint") or {}).get("modbus_rtu")
        if fp and "read" in fp:
            probe_regs.append((prof, fp["read"].get("reg", 0), fp.get("expect", {})))
    if not probe_regs:
        probe_regs = [(None, 0, {})]

    for baud, frame in _ordered_combos(profiles, bauds, frames):
        bytesize, parity, stopbits = _frame_parts(frame)
        client = ModbusSerialClient(
            port=port, baudrate=baud, bytesize=bytesize, parity=parity,
            stopbits=stopbits, timeout=timeout,
        )
        if not client.connect():
            logger.warning("could not open serial port %s", port)
            return hits
        try:
            for addr in addrs:
                if addr in found_addrs:
                    continue
                for prof, reg, expect in probe_regs:
                    try:
                        rr = client.read_holding_registers(address=reg, count=1, slave=addr)
                    except Exception:  # noqa: BLE001
                        continue
                    if rr.isError() or not getattr(rr, "registers", None):
                        continue
                    found_addrs.add(addr)
                    matched = prof if _expect_ok(expect, rr.registers[0]) else None
                    hits.append({
                        "protocol": "modbus_rtu",
                        "address": f"{port}@{baud},{frame},addr{addr}",
                        "profile": matched,
                        "evidence": [
                            f"rtu addr {addr} @ {baud} {frame}: reg {reg}={rr.registers[0]}"
                            + (f" -> {matched.id}" if matched else " (no profile match)")
                        ],
                    })
                    break
        finally:
            client.close()
    return hits


# --------------------------------------------------------------------------- #
# Identify + assemble device records
# --------------------------------------------------------------------------- #
def _enip_match(identity: dict[str, Any], profiles: list[Profile]) -> Optional[Profile]:
    name = (identity.get("product") or "").lower()
    for prof in profiles:
        fp = (prof.data.get("fingerprint") or {}).get("ethernet_ip")
        if not fp:
            continue
        vid = fp.get("vendor_id")
        if vid is not None and identity.get("vendor_id") != vid:
            continue
        needles = fp.get("identity_contains", [])
        if needles and any(n.lower() in name for n in needles):
            return prof
        if not needles and vid is not None:
            return prof
    return None


def _uns_hint(prof: Optional[Profile]) -> Optional[str]:
    """Best-effort UNS path stub from a profile (real builder wiring is v1.5)."""
    if not prof:
        return None
    uns = prof.data.get("uns") or {}
    mfr, model = uns.get("manufacturer"), uns.get("model")
    if not (mfr and model):
        return None

    def slug(s: str) -> str:
        return "_".join("".join(c if c.isalnum() else " " for c in s.lower()).split())

    return f"enterprise.knowledge_base.{slug(mfr)}.{slug(model)}"


def build_device(
    transport: str, address: str, protocol: str, tier: str,
    profile: Optional[Profile], identity: dict[str, Any], evidence: list[str],
) -> dict[str, Any]:
    next_actions = list((profile.data.get("gotchas") or [])[:3]) if profile else []
    return {
        "transport": transport,
        "address": address,
        "tier": tier,
        "protocol": protocol,
        "profile": profile.id if profile else None,
        "identity": identity,
        "evidence": evidence,
        "uns_hint": _uns_hint(profile),
        "next_actions": next_actions,
    }


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
@dataclass
class ScanResult:
    devices: list[dict[str, Any]] = field(default_factory=list)
    unknowns: list[dict[str, Any]] = field(default_factory=list)


def run_network(
    open_map: dict[str, list[int]], profiles: list[Profile], timeout: float, deep_only: bool
) -> ScanResult:
    res = ScanResult()
    for host, open_ports in open_map.items():
        host_identified = False
        for port in open_ports:
            proto, depth = DEFAULT_PORTS.get(port, ("unknown", "shallow"))
            if deep_only and depth != "deep":
                continue
            if proto == "ethernet_ip":
                ident = enip_list_identity(host, timeout)
                if ident:
                    prof = _enip_match(ident, profiles)
                    res.devices.append(build_device(
                        "ethernet", host, "ethernet_ip",
                        TIER_DEVICE if prof else TIER_PROTO, prof, ident,
                        [f"enip list-identity: {ident.get('product', '?')} (vendor {ident.get('vendor_id')})"],
                    ))
                    host_identified = True
                else:
                    res.devices.append(build_device(
                        "ethernet", host, "ethernet_ip", TIER_PORT_OPEN, None, {},
                        ["tcp 44818 open, no list-identity reply"],
                    ))
            elif proto == "modbus_tcp":
                probe = probe_modbus_tcp(host, profiles, timeout)
                if probe:
                    prof = probe["profile"]
                    res.devices.append(build_device(
                        "ethernet", host, "modbus_tcp",
                        TIER_DEVICE if prof else TIER_PROTO, prof, {}, probe["evidence"],
                    ))
                    host_identified = True
                else:
                    res.devices.append(build_device(
                        "ethernet", host, "modbus_tcp", TIER_PORT_OPEN, None, {},
                        ["tcp 502 open, no Modbus read (map may be undeployed)"],
                    ))
            else:  # shallow
                res.devices.append(build_device(
                    "ethernet", host, proto, TIER_PORT_OPEN, None, {},
                    [f"tcp {port} open ({proto}, shallow probe)"],
                ))
        if not host_identified and all(
            DEFAULT_PORTS.get(p, ("", "shallow"))[1] != "deep" for p in open_ports
        ):
            res.unknowns.append({"address": host, "open_ports": open_ports, "note": "open ports, no deep identify"})
    return res


# --------------------------------------------------------------------------- #
# Output
# --------------------------------------------------------------------------- #
def print_table(res: ScanResult) -> None:
    table = Table(title="Field devices discovered", show_lines=False)
    table.add_column("Transport", style="cyan")
    table.add_column("Address")
    table.add_column("Protocol", style="magenta")
    table.add_column("Tier")
    table.add_column("Profile / Identity", style="green")
    tier_color = {TIER_DEVICE: "green", TIER_PROTO: "yellow", TIER_PORT_OPEN: "dim"}
    for d in res.devices:
        ident = d["profile"] or d["identity"].get("product") or "—"
        table.add_row(
            d["transport"], d["address"], d["protocol"],
            f"[{tier_color.get(d['tier'], 'white')}]{d['tier']}[/]", str(ident),
        )
    console.print(table)
    if res.unknowns:
        console.print(f"[dim]{len(res.unknowns)} host(s) with open ports but no deep identify.[/dim]")
    if not res.devices:
        console.print("[dim]No field devices found.[/dim]")


def write_inventory(path: Path, res: ScanResult, scan_meta: dict[str, Any]) -> None:
    payload = {
        "schema": SCHEMA,
        "scanned_at": None,  # caller/cron stamps this; Date is non-deterministic here
        "scan": scan_meta,
        "devices": res.devices,
        "unknowns": res.unknowns,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n")
    console.print(f"[bold]wrote[/bold] {path}  ({len(res.devices)} device(s), {len(res.unknowns)} unknown(s))")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description="Read-only industrial field-device discovery")
    ap.add_argument("--subnet", action="append", default=[], help="CIDR to scan (repeatable)")
    ap.add_argument("--host", action="append", default=[], help="single host (repeatable)")
    ap.add_argument("--ports", help="comma-separated port override")
    ap.add_argument("--deep-only", action="store_true", help="skip shallow probes")
    ap.add_argument("--serial", help="RS-485 serial port to sweep (e.g. /dev/tty… or COM3)")
    ap.add_argument(
        "--serial-bus-idle", action="store_true",
        help="REQUIRED to sweep --serial: confirm no other Modbus master is on the bus. "
             "RS-485 is single-master; contending with a live PLC master CRC-fails its "
             "polls and can trip a VFD comm-timeout fault (motor stop). See "
             ".claude/rules/fieldbus-readonly.md.",
    )
    ap.add_argument("--addr", default="1-32", help="serial slave-addr range (default 1-32)")
    ap.add_argument("--baud", help="comma-separated baud set")
    ap.add_argument("--frame", help="comma-separated framing set (e.g. 8N2,8N1)")
    ap.add_argument("--thorough", action="store_true", help="widen serial addr range to 1-247")
    ap.add_argument("--gentle", action="store_true", help="fragile-network mode (slower, gentler)")
    ap.add_argument("--json", default="inventory.json", help="inventory output path")
    ap.add_argument("--profiles", default="device-profiles", help="device-profiles dir")
    ap.add_argument("--dry-run", action="store_true", help="print plan, probe nothing")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    if args.verbose:
        logger.setLevel(logging.INFO)

    timeout = 2.0 if args.gentle else 1.0
    concurrency = 32 if args.gentle else 64
    ports = (
        [int(p) for p in args.ports.split(",")] if args.ports else list(DEFAULT_PORTS)
    )
    bauds = [int(b) for b in args.baud.split(",")] if args.baud else DEFAULT_BAUDS
    frames = args.frame.split(",") if args.frame else DEFAULT_FRAMES
    lo, _, hi = args.addr.partition("-")
    addr_range = range(int(lo), (int(hi) if hi else int(lo)) + 1)
    if args.thorough:
        addr_range = range(1, 248)

    subnets = args.subnet or ([] if args.host else autodetect_subnets())
    profiles = load_profiles(Path(args.profiles))
    console.print(f"[dim]loaded {len(profiles)} device profile(s): "
                  f"{', '.join(p.id for p in profiles) or 'none'}[/dim]")

    scan_meta = {
        "subnets": subnets, "hosts": args.host, "ports": ports,
        "serial": {"port": args.serial, "addr": args.addr, "bauds": bauds, "frames": frames}
        if args.serial else None,
        "gentle": args.gentle, "deep_only": args.deep_only,
    }

    if args.dry_run:
        targets = expand_targets(subnets, args.host)
        console.print("[bold]DRY RUN — scan plan (nothing probed)[/bold]")
        console.print(f"  network hosts: {len(targets)}  ports: {ports}")
        if args.serial:
            console.print(f"  serial: {args.serial}  addr {addr_range.start}-{addr_range.stop - 1}  "
                          f"baud {bauds}  frame {frames}")
        console.print_json(json.dumps(scan_meta))
        return 0

    res = ScanResult()

    targets = expand_targets(subnets, args.host)
    if targets:
        console.print(f"[dim]scanning {len(targets)} host(s) x {len(ports)} port(s)…[/dim]")
        open_map = asyncio.run(scan_subnet(targets, ports, timeout, concurrency))
        net_res = run_network(open_map, profiles, timeout, args.deep_only)
        res.devices.extend(net_res.devices)
        res.unknowns.extend(net_res.unknowns)

    if args.serial and not args.serial_bus_idle:
        console.print(
            "[bold red]REFUSING serial sweep:[/bold red] RS-485 is single-master. "
            "Sweeping a bus a PLC is actively mastering CRC-fails its polls and can trip "
            "a VFD comm-timeout fault (motor stop) — a 'read' that has real-world effect.\n"
            "Confirm the bus master is OFFLINE (or this adapter is the sole master), then "
            "re-run with [bold]--serial-bus-idle[/bold]. (Ethernet results above are unaffected.)"
        )
    elif args.serial:
        n_combos = len(_ordered_combos(profiles, bauds, frames))
        est_s = int(n_combos * len(addr_range) * timeout)
        console.print(f"[dim]sweeping {args.serial} (RS-485, ~{est_s}s worst case)…[/dim]")
        for hit in sweep_serial(args.serial, addr_range, bauds, frames, profiles, timeout):
            prof = hit["profile"]
            res.devices.append(build_device(
                "serial", hit["address"], "modbus_rtu",
                TIER_DEVICE if prof else TIER_PROTO, prof, {}, hit["evidence"],
            ))

    print_table(res)
    write_inventory(Path(args.json), res, scan_meta)
    return 0


if __name__ == "__main__":
    sys.exit(main())
