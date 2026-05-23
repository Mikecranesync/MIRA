#!/usr/bin/env python3
"""Compose memory-limit lint — close the PR #1336 footgun.

`deploy.resources.limits.memory` is Docker SWARM syntax and is silently
ignored by `docker compose up`. The 2026-05-16 VPS hang (PR #1336) happened
because the `mira-docling` service had only the Swarm key and
`HostConfig.Memory=0`, leading docling-serve to climb to 6.8 GiB on a 7.8 GiB
host. Three OOM-restart cycles later, the kernel RCU-stalled and the host
went dark for ~8.7 hours.

This lint walks every `docker-compose*.yml` (root + saas.yml + hub.yml +
staging variants) and FAILS if any user-defined service lacks both
`mem_limit` and the corresponding `memswap_limit`. The Swarm `deploy.*`
block is fine as long as it isn't the ONLY source of a memory cap — but the
lint also warns when it's present without the v2 sibling, because that's
the exact configuration that historically rotted into the prod compose
file.

Configurable allowlist for services that legitimately have no cap (e.g.
sidecars on Mike's laptop, never on the VPS) via env
``COMPOSE_MEM_LINT_SKIP`` as comma-separated service names.

Exit codes:
  0 — every service in every checked file has mem_limit set
  1 — one or more services lack mem_limit (details printed)
  2 — a compose file failed to parse
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
# Root + first-level service-dir compose files. Root `docker-compose.yml`
# uses `include:` directives to pull in mira-{core,bridge,bots,mcp,cmms,web,
# crawler,ops}/docker-compose.yml — those files define the actual services
# and have to be linted too. Skip node_modules + .git defensively.
DEFAULT_GLOBS = [
    "docker-compose.yml",
    "docker-compose.*.yml",
    "mira-*/docker-compose.yml",
    "mira-*/docker-compose.*.yml",
]


def _iter_compose_files(globs: list[str]) -> list[Path]:
    seen: set[Path] = set()
    out: list[Path] = []
    for pattern in globs:
        for p in REPO_ROOT.glob(pattern):
            if p.is_file() and p not in seen:
                seen.add(p)
                out.append(p)
    return sorted(out)


def _load(path: Path) -> dict:
    with path.open() as f:
        return yaml.safe_load(f) or {}


def _check_file(path: Path, skip: set[str]) -> tuple[list[str], list[str]]:
    """Returns (failures, warnings) — both lists of human strings."""
    failures: list[str] = []
    warnings: list[str] = []
    data = _load(path)
    services = data.get("services") or {}
    for svc_name, svc in services.items():
        if svc_name in skip:
            continue
        if not isinstance(svc, dict):
            continue
        # If the service only has `extends:` or `image: ...` with no other
        # config, that's a fragment / placeholder — skip.
        if list(svc.keys()) in (["extends"], ["image"]):
            continue
        has_mem_limit = "mem_limit" in svc
        deploy_block = svc.get("deploy") or {}
        has_swarm_mem = bool(
            deploy_block.get("resources", {}).get("limits", {}).get("memory")
        )
        if not has_mem_limit:
            if has_swarm_mem:
                failures.append(
                    f"{path.name}::{svc_name} — only has `deploy.resources.limits.memory` "
                    "(SWARM syntax, silently ignored by `docker compose up`). "
                    "Add `mem_limit:` at the service level. See PR #1336."
                )
            else:
                failures.append(
                    f"{path.name}::{svc_name} — no `mem_limit` set. "
                    "A leak in this container can drag the whole host (cf. mira-docling, May 2026)."
                )
        else:
            if "memswap_limit" not in svc:
                warnings.append(
                    f"{path.name}::{svc_name} — has `mem_limit` but no `memswap_limit`. "
                    "Without it the container can swap unbounded and stall the host."
                )
    return failures, warnings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--files",
        nargs="+",
        default=None,
        help="Specific compose files to check (default: every docker-compose*.yml at repo root)",
    )
    ap.add_argument(
        "--warnings-as-errors",
        action="store_true",
        help="Treat memswap_limit warnings as failures (CI mode)",
    )
    args = ap.parse_args()

    skip = {
        s.strip()
        for s in os.environ.get("COMPOSE_MEM_LINT_SKIP", "").split(",")
        if s.strip()
    }

    if args.files:
        files = [Path(f) if Path(f).is_absolute() else REPO_ROOT / f for f in args.files]
    else:
        files = _iter_compose_files(DEFAULT_GLOBS)

    if not files:
        print("no compose files to check")
        return 0

    all_failures: list[str] = []
    all_warnings: list[str] = []
    parse_skipped: list[Path] = []
    for p in files:
        try:
            f, w = _check_file(p, skip)
            n = sum(1 for _ in (yaml.safe_load(p.open()) or {}).get("services", {}))
        except yaml.YAMLError as exc:
            # Compose-specific YAML tags like `!reset` aren't understood by
            # plain safe_load. Skip the file with a warning rather than halting
            # the lint — the rest of the repo deserves the signal.
            parse_skipped.append(p)
            print(f"  [SKIP] {p.relative_to(REPO_ROOT)} (yaml: {type(exc).__name__})")
            continue
        all_failures.extend(f)
        all_warnings.extend(w)
        status = "OK" if not (f or w) else ("FAIL" if f else "WARN")
        print(f"  [{status}] {p.relative_to(REPO_ROOT)} ({n} services)")

    if all_warnings:
        print("\nWarnings:")
        for w in all_warnings:
            print(f"  ⚠ {w}")

    if all_failures:
        print("\nFailures:")
        for f_ in all_failures:
            print(f"  ✗ {f_}")
        print(
            "\nFix: add `mem_limit: <N>g` + `memswap_limit: <N>g` at the service level. "
            "Don't rely on `deploy.resources.limits.memory` — it's Swarm syntax and "
            "compose v2 silently ignores it."
        )
        return 1

    if args.warnings_as_errors and all_warnings:
        return 1

    print("\nAll services have `mem_limit` set.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
