#!/usr/bin/env python3
"""Read-only Vision ZTA fleet inventory probe."""

from __future__ import annotations

import argparse
import json
import socket
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ORDER = ("alpha", "bravo", "charlie", "vps")
VPS_FALLBACK = {
    "hostname": "factorylm-prod",
    "role": "production-ingress",
    "user": "root",
    "addresses": {"tailscale": "100.68.120.99", "public": "165.245.138.91"},
    "notes": "DigitalOcean VPS; public ingress and job/status host only, not heavy vision inference.",
}


def load_targets(network_path: str | Path) -> dict[str, dict]:
    """Load Alpha/Bravo/Charlie from deployment/network.yml and add VPS if absent."""
    import yaml

    raw = yaml.safe_load(Path(network_path).read_text(encoding="utf-8")) or {}
    nodes = raw.get("nodes") or {}
    merged = {node_id: dict(nodes[node_id]) for node_id in ORDER if node_id in nodes}
    if "vps" not in merged:
        merged["vps"] = dict(VPS_FALLBACK)
    return {node_id: merged[node_id] for node_id in ORDER if node_id in merged}


def build_remote_probe_body() -> str:
    """Return the shell payload run locally or over SSH. It reads only."""
    return r"""export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
python3 - <<'PY'
import json
import importlib.util
import platform
import socket
import subprocess

def run(cmd, timeout=8):
    try:
        cp = subprocess.run(
            cmd,
            shell=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
        )
    except Exception as exc:
        return f"missing: {exc.__class__.__name__}: {exc}"
    out = (cp.stdout or "").strip()
    if cp.returncode != 0:
        return out or f"missing: rc={cp.returncode}"
    return out or "ok"

def py_import(name):
    return "present" if importlib.util.find_spec(name) else "missing"

facts = {
    "hostname": socket.gethostname(),
    "os": run("if command -v sw_vers >/dev/null 2>&1; then sw_vers -productName && sw_vers -productVersion; else lsb_release -ds 2>/dev/null || uname -a; fi"),
    "kernel": platform.platform(),
    "architecture": platform.machine(),
    "cpu": run("sysctl -n machdep.cpu.brand_string 2>/dev/null || lscpu | sed -n 's/^Model name:[[:space:]]*//p' | head -1"),
    "memory_total_bytes": run("sysctl -n hw.memsize 2>/dev/null || awk '/MemTotal/ {print $2 * 1024}' /proc/meminfo"),
    "memory_free": run("if command -v vm_stat >/dev/null 2>&1; then vm_stat | head -8; else awk '/MemAvailable/ {print $2 \" kB\"}' /proc/meminfo; fi"),
    "disk_root": run("df -h / | tail -1"),
    "external_volumes": run("ls /Volumes 2>/dev/null || findmnt -rn -o TARGET,SIZE,AVAIL | head -20"),
    "docker": run("docker --version"),
    "docker_info": run("docker info --format '{{json .ServerVersion}} {{json .NCPU}} {{json .MemTotal}}'"),
    "colima": run("colima status"),
    "ollama_version": run("ollama --version"),
    "ollama_models": run("ollama list"),
    "python": run("python3 --version"),
    "tesseract": run("tesseract --version | head -1"),
    "paddleocr": py_import("paddleocr"),
    "mlx": py_import("mlx"),
    "mlx_vlm": py_import("mlx_vlm"),
    "gpu": run("if command -v system_profiler >/dev/null 2>&1; then system_profiler SPDisplaysDataType | sed -n '1,30p'; elif command -v nvidia-smi >/dev/null 2>&1; then nvidia-smi --query-gpu=name,memory.total --format=csv,noheader; else echo missing; fi"),
    "listening_tcp": run("lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | head -40 || ss -ltnp | head -40"),
    "load": run("uptime"),
}
print(json.dumps(facts, sort_keys=True))
PY
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _auto_local_node() -> str | None:
    host = socket.gethostname().lower()
    for node_id in ("alpha", "bravo", "charlie"):
        if node_id in host:
            return node_id
    return None


def ssh_destination(node_id: str, target: dict) -> str:
    addresses = target.get("addresses") or {}
    if node_id == "vps" and addresses.get("tailscale"):
        return f"{target.get('user', 'root')}@{addresses['tailscale']}"
    return node_id


def summarize_ollama_tags(url: str, payload: dict) -> str:
    names = []
    for model in payload.get("models", []):
        name = model.get("name") or model.get("model")
        if name:
            names.append(str(name))
    return f"{url} => {', '.join(names) if names else 'no models'}"


def probe_configured_ollama(target: dict, *, timeout: int = 4) -> str:
    errors = []
    addresses = target.get("addresses") or {}
    for key in ("tailscale", "lan", "public"):
        address = addresses.get(key)
        if not address:
            continue
        url = f"http://{address}:11434/api/tags"
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
            return summarize_ollama_tags(url, payload)
        except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
            errors.append(f"{url}: {exc.__class__.__name__}")
    return "unreachable" if not errors else "unreachable; " + "; ".join(errors)


def _aux_probe_timeout(timeout: int | float) -> float:
    try:
        value = float(timeout)
    except (TypeError, ValueError):
        value = 8.0
    return max(0.25, min(1.0, value / 8.0))


def probe_target(node_id: str, target: dict, *, local_node: str | None, timeout: int) -> dict:
    payload = build_remote_probe_body()
    base = {
        "node_id": node_id,
        "role": target.get("role", "unknown"),
        "configured": target,
        "collected_at": _now_iso(),
    }
    if node_id == local_node:
        cmd, kwargs = ["sh", "-s"], {"input": payload}
    else:
        cmd = [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=5",
            ssh_destination(node_id, target),
            "sh",
            "-s",
        ]
        kwargs = {"input": payload}
    try:
        cp = subprocess.run(
            cmd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            **kwargs,
        )
    except Exception as exc:
        return {**base, "status": "unreachable", "error": str(exc), "facts": {}}
    if cp.returncode != 0:
        return {
            **base,
            "status": "unreachable",
            "error": (cp.stderr or cp.stdout).strip(),
            "facts": {},
        }
    try:
        facts = json.loads(cp.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as exc:
        return {**base, "status": "error", "error": f"unparseable probe output: {exc}", "facts": {}}
    facts["ollama_api_configured_address"] = probe_configured_ollama(
        target,
        timeout=_aux_probe_timeout(timeout),
    )
    return {**base, "status": "ok", "facts": facts}


def _short(value: object, default: str = "UNKNOWN") -> str:
    text = str(value or "").strip()
    if not text or text.startswith("missing:"):
        return default
    return text.splitlines()[0].replace("|", "/")


def _gib(value: object) -> str:
    text = _short(value)
    if text.isdigit():
        return f"{int(text) / (1024**3):.1f} GiB"
    return text


def _detail(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return "UNKNOWN"
    if "\n" in text:
        text = "\n".join(line.rstrip() for line in text.splitlines())
        return "\n\n```text\n" + text.replace("```", "'''") + "\n```"
    return _short(text)


def _lane(node_id: str) -> str:
    lanes = {
        "alpha": "orchestration, page splitting, hashing, deterministic preprocessing",
        "bravo": "interactive local VLM/OCR lane and independent verification",
        "charlie": "document OCR/layout, embeddings/retrieval, batch corpus work",
        "vps": "authenticated ingress, job state, cache metadata; no heavy VLM",
    }
    return lanes.get(node_id, "UNKNOWN")


def render_markdown(results: list[dict], *, title_date: str) -> str:
    lines = [
        f"# Vision ZTA fleet inventory - {title_date}",
        "",
        "Read-only inventory for the Vision Zero-Token Architecture. UNKNOWN means the probe did not produce local evidence; do not treat stale docs as live proof.",
        "",
        "| Node | Role | Status | Hostname | OS | RAM | Disk | Vision ZTA lane |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for result in results:
        facts = result.get("facts") or {}
        lines.append(
            "| {node} | {role} | {status} | {host} | {os} | {ram} | {disk} | {lane} |".format(
                node=result.get("node_id", "UNKNOWN"),
                role=result.get("role", "unknown"),
                status=result.get("status", "UNKNOWN"),
                host=_short(facts.get("hostname")),
                os=_short(facts.get("os")),
                ram=_gib(facts.get("memory_total_bytes")),
                disk=_short(facts.get("disk_root")),
                lane=_lane(result.get("node_id", "")),
            )
        )
    lines += ["", "## Details"]
    for result in results:
        lines.append("")
        lines.append(f"### {result.get('node_id', 'UNKNOWN')}")
        if result.get("status") != "ok":
            lines.append(f"- Probe status: {result.get('status')} - {_short(result.get('error'))}")
            continue
        facts = result.get("facts") or {}
        for key in (
            "cpu",
            "memory_free",
            "external_volumes",
            "docker",
            "docker_info",
            "colima",
            "ollama_version",
            "ollama_models",
            "ollama_api_configured_address",
            "python",
            "tesseract",
            "paddleocr",
            "mlx",
            "mlx_vlm",
            "gpu",
            "listening_tcp",
            "load",
        ):
            detail = _detail(facts.get(key))
            lines.append(f"- {key}:{detail}" if detail.startswith("\n") else f"- {key}: {detail}")
    lines += [
        "",
        "## Resource-gated next actions",
        "",
        "- Treat Bravo as the primary interactive local VLM/OCR lane when its configured-address Ollama API reports the required models.",
        "- Treat Charlie as the document OCR/layout, embeddings/retrieval, batch corpus, and benchmark lane; keep work asynchronous and resource-limited.",
        "- Install or enable Tesseract, PaddleOCR, and MLX-VLM only in pinned, license-checked follow-up PRs with before/after benchmarks.",
        "- Keep the VPS on ingress, job state, manifests, and cache metadata; do not route routine heavy VLM work there.",
        "",
        "## Charlie-owned implementation lane",
        "",
        "Charlie should own document OCR/layout, embeddings/retrieval, batch corpus work, benchmark and dataset curation, and a second 4B-class local VLM lane only when live memory/load evidence says it will not degrade MIRA services.",
    ]
    return "\n".join(lines) + "\n"


def dumps_json(results: list[dict]) -> str:
    return json.dumps(results, indent=2, sort_keys=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", default="deployment/network.yml")
    parser.add_argument("--targets", default="all", help="comma list, or all")
    parser.add_argument("--local-node", default=_auto_local_node() or "")
    parser.add_argument("--timeout", type=int, default=25)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)

    targets = load_targets(args.network)
    wanted = (
        list(targets) if args.targets == "all" else [x.strip() for x in args.targets.split(",")]
    )
    results = [
        probe_target(node_id, targets[node_id], local_node=args.local_node, timeout=args.timeout)
        for node_id in wanted
    ]
    text = (
        dumps_json(results)
        if args.json
        else render_markdown(results, title_date=datetime.now(timezone.utc).date().isoformat())
    )
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
