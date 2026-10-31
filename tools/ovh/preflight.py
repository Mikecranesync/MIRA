#!/usr/bin/env python3
"""Read-only OVH preflight for the #3800 recovery: auth check + VPS inventory.

Runs ONLY `GET` calls through the official `ovh` SDK. It never orders, reboots,
reinstalls, or modifies anything, and it never prints credential values.

Credentials come from the environment (inject with Doppler, do not export by
hand):

    doppler run -p factorylm -c prd -- python3 tools/ovh/preflight.py

Name mapping (in-process only). The SDK's canonical names win when present;
the legacy Doppler names are accepted as fallbacks so nothing has to be
renamed or copied to run this:

    OVH_ENDPOINT            (default: ovh-us)
    OVH_APPLICATION_KEY     <- OVH_KEY
    OVH_APPLICATION_SECRET  <- OVH_SECRET_KEY
    OVH_CONSUMER_KEY        <- OVH_CONSUMER_KEY

Outcomes are reported distinctly so "no VPS" is never confused with "not
allowed to see the VPS" or "wrong endpoint":

    AUTH_OK / AUTH_INVALID / AUTH_EXPIRED / ENDPOINT_UNREACHABLE
    VPS_LISTED (n) / VPS_NONE / VPS_FORBIDDEN
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from typing import Any

try:
    import ovh
    from ovh import exceptions as ovh_exc
except ImportError:  # pragma: no cover - environment problem, not a logic path
    sys.stderr.write("the official OVH SDK is not installed: `uv pip install ovh` (or pip)\n")
    sys.exit(2)


DEFAULT_ENDPOINT = "ovh-us"

# Keys whose *values* must never reach stdout/stderr, even on error.
_SECRET_ENV = (
    "OVH_APPLICATION_KEY",
    "OVH_APPLICATION_SECRET",
    "OVH_CONSUMER_KEY",
    "OVH_KEY",
    "OVH_SECRET_KEY",
)


def _redact(text: str) -> str:
    """Strip any secret value that might be echoed back inside an SDK error."""
    for key in _SECRET_ENV:
        value = os.environ.get(key)
        if value and len(value) >= 8:
            text = text.replace(value, f"<{key}>")
    return text


@dataclass
class VpsRecord:
    service_name: str
    display_name: str | None = None
    state: str | None = None
    model: str | None = None
    vcore: int | None = None
    memory_mb: int | None = None
    disk_gb: int | None = None
    datacenter: str | None = None
    zone: str | None = None
    offer: str | None = None
    distribution: str | None = None
    ips: list[str] = field(default_factory=list)
    renewal_period: str | None = None
    renewal_type: str | None = None
    expiration: str | None = None
    creation: str | None = None
    status: str | None = None
    billing_price: str | None = None
    billing_plan: str | None = None
    errors: list[str] = field(default_factory=list)


@dataclass
class Report:
    endpoint: str
    credential_source: str
    auth: str
    auth_detail: str = ""
    credential_rules: list[dict[str, Any]] = field(default_factory=list)
    credential_expiration: str | None = None
    account_state: str | None = None
    vps_outcome: str = "NOT_RUN"
    vps: list[VpsRecord] = field(default_factory=list)
    other_compute: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def _resolve_credentials() -> tuple[dict[str, str], str]:
    """Map Doppler's legacy names onto the SDK's names, in-process only."""
    endpoint = os.environ.get("OVH_ENDPOINT") or DEFAULT_ENDPOINT
    app_key = os.environ.get("OVH_APPLICATION_KEY") or os.environ.get("OVH_KEY")
    app_secret = os.environ.get("OVH_APPLICATION_SECRET") or os.environ.get("OVH_SECRET_KEY")
    consumer = os.environ.get("OVH_CONSUMER_KEY")

    used = []
    used.append("OVH_APPLICATION_KEY" if os.environ.get("OVH_APPLICATION_KEY") else "OVH_KEY")
    used.append(
        "OVH_APPLICATION_SECRET" if os.environ.get("OVH_APPLICATION_SECRET") else "OVH_SECRET_KEY"
    )
    used.append("OVH_CONSUMER_KEY")
    source = ",".join(used)

    missing = [
        name
        for name, val in (
            ("application key", app_key),
            ("application secret", app_secret),
            ("consumer key", consumer),
        )
        if not val
    ]
    if missing:
        raise SystemExit(
            "missing OVH credential(s) in the environment: "
            + ", ".join(missing)
            + " — run under `doppler run -p factorylm -c <cfg> --`"
        )
    return (
        {
            "endpoint": endpoint,
            "application_key": app_key or "",
            "application_secret": app_secret or "",
            "consumer_key": consumer or "",
        },
        source,
    )


def _get(client: ovh.Client, path: str, errors: list[str]) -> Any:
    """GET with the failure folded into `errors` instead of raising."""
    try:
        return client.get(path)
    except ovh_exc.NotGrantedCall as exc:
        errors.append(f"{path}: FORBIDDEN ({_redact(str(exc))})")
    except ovh_exc.ResourceNotFoundError:
        errors.append(f"{path}: NOT_FOUND")
    except ovh_exc.APIError as exc:
        errors.append(f"{path}: API_ERROR ({_redact(str(exc))})")
    return None


def check_auth(client: ovh.Client, report: Report) -> bool:
    try:
        cred = client.get("/auth/currentCredential")
    except ovh_exc.InvalidCredential as exc:
        report.auth = "AUTH_INVALID"
        report.auth_detail = _redact(str(exc))
        return False
    except ovh_exc.NotGrantedCall as exc:
        # Keys are valid but the consumer key was never granted /auth/* — still
        # a working credential for other paths; record it and continue.
        report.auth = "AUTH_OK_UNINTROSPECTABLE"
        report.auth_detail = _redact(str(exc))
        return True
    except ovh_exc.APIError as exc:
        report.auth = "AUTH_ERROR"
        report.auth_detail = _redact(str(exc))
        return False
    except Exception as exc:  # network / DNS / TLS to the wrong endpoint
        report.auth = "ENDPOINT_UNREACHABLE"
        report.auth_detail = _redact(f"{type(exc).__name__}: {exc}")
        return False

    status = str(cred.get("status", "")).lower()
    report.credential_expiration = cred.get("expiration")
    report.credential_rules = list(cred.get("rules") or [])
    if status and status != "validated":
        report.auth = "AUTH_EXPIRED" if status == "expired" else f"AUTH_{status.upper()}"
        report.auth_detail = f"credential status={status}"
        return False
    report.auth = "AUTH_OK"
    write_rules = [r for r in report.credential_rules if r.get("method") != "GET"]
    if write_rules:
        report.notes.append(
            f"credential carries {len(write_rules)} non-GET rule(s); this script "
            "still issues GET only"
        )
    return True


def collect_account(client: ovh.Client, report: Report) -> None:
    errs: list[str] = []
    me = _get(client, "/me", errs)
    if isinstance(me, dict):
        # Only the account *state* is useful here; nothing identifying is echoed.
        report.account_state = me.get("state")
    report.notes.extend(errs)


def collect_vps(client: ovh.Client, report: Report) -> None:
    try:
        names = client.get("/vps")
    except ovh_exc.NotGrantedCall as exc:
        report.vps_outcome = "VPS_FORBIDDEN"
        report.notes.append(_redact(f"/vps: {exc}"))
        return
    except ovh_exc.APIError as exc:
        report.vps_outcome = "VPS_ERROR"
        report.notes.append(_redact(f"/vps: {exc}"))
        return

    if not names:
        report.vps_outcome = "VPS_NONE"
        return
    report.vps_outcome = f"VPS_LISTED ({len(names)})"

    for name in names:
        rec = VpsRecord(service_name=name)
        detail = _get(client, f"/vps/{name}", rec.errors)
        if isinstance(detail, dict):
            rec.display_name = detail.get("displayName")
            rec.state = detail.get("state")
            rec.zone = detail.get("zone")
            rec.offer = detail.get("offerType")
            model = detail.get("model") or {}
            rec.model = model.get("name") or model.get("offer")
            rec.vcore = model.get("vcore") or detail.get("vcore")
            rec.memory_mb = model.get("memory") or detail.get("memoryLimit")
            rec.disk_gb = model.get("disk")
        ips = _get(client, f"/vps/{name}/ips", rec.errors)
        if isinstance(ips, list):
            rec.ips = [str(ip) for ip in ips]
        dc = _get(client, f"/vps/{name}/datacenter", rec.errors)
        if isinstance(dc, dict):
            rec.datacenter = dc.get("longName") or dc.get("name")
        dist = _get(client, f"/vps/{name}/distribution", rec.errors)
        if isinstance(dist, dict):
            rec.distribution = dist.get("name")
        info = _get(client, f"/vps/{name}/serviceInfos", rec.errors)
        if isinstance(info, dict):
            rec.renewal_period = str((info.get("renew") or {}).get("period"))
            rec.renewal_type = info.get("renewalType")
            rec.expiration = info.get("expiration")
            rec.creation = info.get("creation")
            rec.status = info.get("status")
            service_id = info.get("serviceId")
            if service_id:
                svc = _get(client, f"/services/{service_id}", rec.errors)
                if isinstance(svc, dict):
                    billing = svc.get("billing") or {}
                    plan = billing.get("plan") or {}
                    pricing = billing.get("pricing") or {}
                    rec.billing_plan = plan.get("code") or plan.get("invoiceName")
                    price = pricing.get("price") or {}
                    if price:
                        rec.billing_price = (
                            f"{price.get('text') or price.get('value')} per "
                            f"{pricing.get('interval') or 'period'}"
                        )
        report.vps.append(rec)


def collect_other_compute(client: ovh.Client, report: Report) -> None:
    """Detect a Public Cloud project or dedicated server if 'the VPS' is one."""
    errs: list[str] = []
    for label, path in (
        ("cloud_projects", "/cloud/project"),
        ("dedicated_servers", "/dedicated/server"),
    ):
        val = _get(client, path, errs)
        if isinstance(val, list):
            report.other_compute[label] = len(val)
    if errs:
        report.other_compute["errors"] = errs


def render(report: Report) -> str:
    lines = [
        f"endpoint            : {report.endpoint}",
        f"credential source   : {report.credential_source} (values not shown)",
        f"auth                : {report.auth}"
        + (f" — {report.auth_detail}" if report.auth_detail else ""),
    ]
    if report.credential_expiration:
        lines.append(f"credential expires  : {report.credential_expiration}")
    if report.credential_rules:
        rules = ", ".join(f"{r.get('method')} {r.get('path')}" for r in report.credential_rules)
        lines.append(f"credential rules    : {rules}")
    if report.account_state:
        lines.append(f"account state       : {report.account_state}")
    lines.append(f"vps outcome         : {report.vps_outcome}")
    for v in report.vps:
        lines.append(f"  - {v.service_name} ({v.display_name or '-'})")
        lines.append(
            f"      state={v.state} model={v.model} vcore={v.vcore} "
            f"ram_mb={v.memory_mb} disk_gb={v.disk_gb} os={v.distribution}"
        )
        lines.append(f"      dc={v.datacenter} zone={v.zone} offer={v.offer} ips={v.ips}")
        lines.append(
            f"      created={v.creation} expires={v.expiration} status={v.status} "
            f"renew={v.renewal_type}/{v.renewal_period}"
        )
        lines.append(f"      billing: plan={v.billing_plan} price={v.billing_price}")
        for e in v.errors:
            lines.append(f"      ! {e}")
    if report.other_compute:
        lines.append(f"other compute       : {report.other_compute}")
    for n in report.notes:
        lines.append(f"note                : {n}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--json", action="store_true", help="emit the report as JSON")
    args = parser.parse_args(argv)

    creds, source = _resolve_credentials()
    report = Report(endpoint=creds["endpoint"], credential_source=source, auth="NOT_RUN")

    try:
        client = ovh.Client(**creds)
    except ovh_exc.InvalidRegion as exc:
        report.auth = "ENDPOINT_INVALID"
        report.auth_detail = _redact(str(exc))
        print(json.dumps(asdict(report), indent=2) if args.json else render(report))
        return 1

    if check_auth(client, report):
        collect_account(client, report)
        collect_vps(client, report)
        collect_other_compute(client, report)

    print(json.dumps(asdict(report), indent=2) if args.json else render(report))
    return 0 if report.auth.startswith("AUTH_OK") else 1


if __name__ == "__main__":
    sys.exit(main())
