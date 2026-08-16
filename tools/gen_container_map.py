#!/usr/bin/env python3
"""Container-map generator (convergence CU-02, drift finding D-2).

Regenerates the root CLAUDE.md "## Container Map" section from the compose
files, so the map is a machine-validated fact (convergence doctrine §11)
instead of hand-maintained prose that silently goes stale.

Sources of truth
----------------
Dev  : the root docker-compose.yml `include:` set + docker-compose.override.yml
Prod : docker-compose.saas.yml
Staging is deliberately a one-line pointer (docs/environments.md), not a table.

An include file that does not exist (e.g. mira-ops/docker-compose.yml, absent
on main as of 2026-08-15) is warned about on stderr and skipped — that is a
drift finding to record, not something this script silently repairs.

Modes
-----
    python3 tools/gen_container_map.py            # print the generated section
    python3 tools/gen_container_map.py --write    # rewrite CLAUDE.md in place
    python3 tools/gen_container_map.py --check    # exit 1 if CLAUDE.md differs

--check is the drift lock: it fails whenever the committed map disagrees with
the compose files. CU-06 wires it into tests/test_architecture.py as the
registry-vs-compose contract; until then it runs on demand.

Exit status
-----------
0 clean (or successful print/write) · 1 drift found by --check, or a source
compose file failed to parse.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent

CLAUDE_MD = "CLAUDE.md"
ROOT_COMPOSE = "docker-compose.yml"
DEV_OVERLAY = "docker-compose.override.yml"
PROD_COMPOSE = "docker-compose.saas.yml"

BEGIN_MARK = (
    "<!-- BEGIN GENERATED container-map — tools/gen_container_map.py; "
    "regenerate: `python3 tools/gen_container_map.py --write`; "
    "verify: `--check`. Do not hand-edit. -->"
)
END_MARK = "<!-- END GENERATED container-map -->"

# ${VAR:-default} / ${VAR-default} → default; ${VAR} (no default) is left as-is.
_ENV_DEFAULT_RE = re.compile(r"\$\{[A-Za-z_][A-Za-z0-9_]*:?-([^}]*)\}")


def _resolve_env_defaults(value: str) -> str:
    return _ENV_DEFAULT_RE.sub(lambda m: m.group(1), value)


def _render_port(entry: object) -> str:
    """'127.0.0.1:${P:-8009}:8000' → '127.0.0.1:8009→8000'; '9099:9099' → '9099'."""
    if isinstance(entry, dict):  # compose long syntax
        published = str(entry.get("published", ""))
        target = str(entry.get("target", ""))
        host_ip = entry.get("host_ip", "")
        raw = ":".join(p for p in (host_ip, published, target) if p)
    else:
        raw = str(entry)
    raw = _resolve_env_defaults(raw)
    parts = raw.rsplit(":", 2)
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        host, container = parts
        return host if host == container else f"{host}→{container}"
    ip, host, container = parts
    arrow = host if host == container else f"{host}→{container}"
    return f"{ip}:{arrow}"


def _load_services(compose_path: Path) -> list[dict]:
    """Return [{name, ports, networks, profiles}] for one compose file, in file order."""
    data = yaml.safe_load(compose_path.read_text(encoding="utf-8"))
    services = []
    for key, svc in (data.get("services") or {}).items():
        if not isinstance(svc, dict):
            continue
        networks = svc.get("networks") or []
        if isinstance(networks, dict):
            networks = list(networks)
        services.append(
            {
                "key": key,
                "name": svc.get("container_name", key),
                "ports": [_render_port(p) for p in (svc.get("ports") or [])],
                "networks": [str(n) for n in networks],
                "profiles": [str(p) for p in (svc.get("profiles") or [])],
            }
        )
    return services


def _dev_sources() -> list[Path]:
    """The root include set + the dev overlay, existing files only."""
    root = REPO_ROOT / ROOT_COMPOSE
    data = yaml.safe_load(root.read_text(encoding="utf-8"))
    paths = []
    for entry in data.get("include") or []:
        rel = entry.get("path", "") if isinstance(entry, dict) else str(entry)
        p = REPO_ROOT / rel
        if p.is_file():
            paths.append(p)
        else:
            print(f"WARN: {ROOT_COMPOSE} includes missing file {rel} — skipped", file=sys.stderr)
    overlay = REPO_ROOT / DEV_OVERLAY
    if overlay.is_file():
        paths.append(overlay)
    return paths


def _merge(sources: list[Path]) -> list[dict]:
    """Concatenate services across files; a later file overrides same-key entries."""
    by_key: dict[str, dict] = {}
    order: list[str] = []
    for path in sources:
        for svc in _load_services(path):
            if svc["key"] in by_key:
                existing = by_key[svc["key"]]
                for field in ("ports", "networks", "profiles"):
                    if svc[field]:
                        existing[field] = svc[field]
                existing["name"] = svc["name"]
            else:
                by_key[svc["key"]] = svc
                order.append(svc["key"])
    return [by_key[k] for k in order]


def _table(services: list[dict]) -> str:
    lines = ["| Container | Port(s) | Network(s) |", "|-----------|---------|------------|"]
    for svc in services:
        name = svc["name"]
        if svc["profiles"]:
            name += f" *(profile: {'/'.join(svc['profiles'])})*"
        ports = ", ".join(svc["ports"]) or "—"
        networks = ", ".join(svc["networks"]) or "—"
        lines.append(f"| {name} | {ports} | {networks} |")
    return "\n".join(lines)


def generate_section() -> str:
    dev = _merge(_dev_sources())
    prod = _load_services(REPO_ROOT / PROD_COMPOSE)
    return "\n".join(
        [
            BEGIN_MARK,
            "",
            f"**Dev** — `{ROOT_COMPOSE}` include set + `{DEV_OVERLAY}` "
            "(env-var ports shown at their defaults):",
            "",
            _table(dev),
            "",
            f"**Prod (VPS)** — `{PROD_COMPOSE}` (env-var ports shown at their defaults; "
            "container names differ from dev; Atlas CMMS runs as a separate compose project "
            "reached via external `cmms-ext`):",
            "",
            _table(prod),
            "",
            "Profile-gated rows start only with `docker compose --profile <name> up`. "
            "Staging: `docker-compose.staging-vps.yml` (`stg-*` names) — see `docs/environments.md`.",
            "",
            END_MARK,
        ]
    )


def _split_claude_md(text: str) -> tuple[str, str, str] | None:
    """Return (before, current_section, after) for the generated block, or the
    legacy '## Container Map' table if the markers are not yet present."""
    if BEGIN_MARK in text and END_MARK in text:
        start = text.index(BEGIN_MARK)
        end = text.index(END_MARK) + len(END_MARK)
        if end <= start:  # malformed marker order — refuse rather than corrupt on --write
            print(f"ERROR: container-map markers out of order in {CLAUDE_MD}", file=sys.stderr)
            return None
        return text[:start], text[start:end], text[end:]
    heading = "## Container Map"
    if heading not in text:
        return None
    start = text.index(heading) + len(heading)
    next_heading = text.find("\n## ", start)
    if next_heading == -1:
        next_heading = len(text)
    return text[: start + 1], text[start + 1 : next_heading].strip("\n") + "\n", text[next_heading:]


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):  # Windows consoles default to cp1252; '→' needs utf-8
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true", help="rewrite CLAUDE.md in place")
    mode.add_argument("--check", action="store_true", help="exit 1 if CLAUDE.md is stale")
    args = parser.parse_args()

    try:
        section = generate_section()
    except yaml.YAMLError as exc:
        print(f"ERROR: failed to parse a compose file: {exc}", file=sys.stderr)
        return 1
    if not (args.write or args.check):
        print(section)
        return 0

    claude_path = REPO_ROOT / CLAUDE_MD
    text = claude_path.read_text(encoding="utf-8")
    parts = _split_claude_md(text)
    if parts is None:
        print(f"ERROR: no '## Container Map' section or markers in {CLAUDE_MD}", file=sys.stderr)
        return 1
    before, current, after = parts

    if args.check:
        if current.strip("\n") == section.strip("\n"):
            print("container-map: CLAUDE.md matches compose files")
            return 0
        print(
            "container-map DRIFT: CLAUDE.md disagrees with the compose files — "
            "run `python3 tools/gen_container_map.py --write`",
            file=sys.stderr,
        )
        return 1

    if BEGIN_MARK in text:
        new_text = before + section + after
    else:  # first run: replace the legacy hand-written table with the marked block
        new_text = before + "\n" + section + "\n" + after
    claude_path.write_text(new_text, encoding="utf-8", newline="\n")
    print(f"container-map: wrote generated section to {CLAUDE_MD}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
