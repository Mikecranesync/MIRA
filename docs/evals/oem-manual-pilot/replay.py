#!/usr/bin/env python3
"""Explicit local replay: public download preparation, then offline MIRA evidence.

Requires Python 3.12+, Node, existing pinned node_modules and PostgreSQL tools.
Never reads provider keys or existing application databases; never installs deps.
"""

import argparse
import getpass
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = "2cd7cb3aa55bdea0343087652bbe695471eb8cd5"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def command(args, *, cwd=None, env=None, log=None):
    return subprocess.run(
        args, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT if log else None, check=True
    )


def prepare(args):
    repo, output, modules = args.repo.resolve(), args.output.resolve(), args.node_modules.resolve()
    if output.is_relative_to(repo):
        raise ValueError(
            "Output must be outside the repository: keep OEM PDFs/private traces out of git"
        )
    if output.exists():
        raise ValueError("Output already exists; use a fresh path, never overwrite evidence")
    dependencies = json.loads((HERE / "dependencies.json").read_text())
    for name, version in dependencies.items():
        actual = json.loads((modules / name / "package.json").read_text())["version"]
        if actual != version:
            raise ValueError(f"Dependency mismatch: {name} expected {version}, got {actual}")
    # Verify all pinned production bytes BEFORE creating output or downloading.
    sources = {}
    for name, sha in json.loads((HERE / "source-lock.json").read_text()).items():
        data = subprocess.check_output(
            ["git", "-C", str(repo), "show", f"{BASE}:mira-hub/src/{name}"]
        )
        if digest(data) != sha:
            raise ValueError(f"Pinned source hash mismatch: {name}")
        sources[name] = data
    output.mkdir(parents=True, mode=0o700)
    for name, data in sources.items():
        path = output / "src" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    for name, text in json.loads((HERE / "adapters.json").read_text()).items():
        path = output / "src" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    for name in [
        "manifest.json",
        "cases.json",
        "acceptance-cases.json",
        "schema.sql",
        "proof.test.ts",
        "verify-pages.mjs",
        "vitest.config.ts",
        "oem_manual_acceptance.py",
    ]:
        shutil.copyfile(HERE / name, output / name)
    (output / "node_modules").symlink_to(modules, target_is_directory=True)
    (output / "source-sha.txt").write_text(BASE + "\n")
    (output / "private-pdfs").mkdir(mode=0o700)
    for corpus in json.loads((output / "manifest.json").read_text())["corpora"]:
        filename = corpus["corpus_id"] + ".pdf"
        if args.pdf_dir:
            data = (args.pdf_dir / filename).read_bytes()
        else:
            with urllib.request.urlopen(corpus["url"], timeout=90) as response:
                if not response.url.startswith("https://"):
                    raise ValueError("Refuse non-HTTPS redirect")
                data = response.read(50 * 1024 * 1024 + 1)
            if len(data) > 50 * 1024 * 1024:
                raise ValueError("PDF exceeds bounded download size")
        if not data.startswith(b"%PDF-") or digest(data) != corpus["sha256"]:
            raise ValueError(
                f"PDF changed or invalid: {filename}; inspect new edition, do not update lock blindly"
            )
        (output / "private-pdfs" / filename).write_bytes(data)
    (output / "prepared.json").write_text(
        json.dumps(
            {"source_sha": BASE, "dependencies": dependencies, "pdfs_hash_verified": True}, indent=2
        )
    )
    print(f"Prepared private replay at {output}; no MIRA/provider calls yet")


def run(args):
    output = args.output.resolve()
    if not (output / "prepared.json").is_file():
        raise ValueError("Run prepare successfully first")
    # Preparation and execution are separate: refuse stale/tampered source,
    # adapters or harness rather than label it as the pinned baseline.
    for name, expected in json.loads((HERE / "source-lock.json").read_text()).items():
        if digest((output / "src" / name).read_bytes()) != expected:
            raise ValueError(f"Prepared source changed: {name}")
    for name, expected in json.loads((HERE / "adapters.json").read_text()).items():
        if (output / "src" / name).read_text() != expected:
            raise ValueError(f"Prepared adapter changed: {name}")
    for name in [
        "manifest.json",
        "cases.json",
        "acceptance-cases.json",
        "schema.sql",
        "proof.test.ts",
        "verify-pages.mjs",
        "vitest.config.ts",
        "oem_manual_acceptance.py",
    ]:
        if (output / name).read_bytes() != (HERE / name).read_bytes():
            raise ValueError(f"Prepared recipe changed: {name}; prepare a fresh output")
    if (output / "source-sha.txt").read_text().strip() != BASE:
        raise ValueError("Prepared source identity changed")
    for name, version in json.loads((HERE / "dependencies.json").read_text()).items():
        actual = json.loads((output / "node_modules" / name / "package.json").read_text())[
            "version"
        ]
        if actual != version:
            raise ValueError(f"Prepared dependency changed: {name}")
    pgdata = output / "pgdata"
    if pgdata.exists():
        raise ValueError("Preserved cluster already exists; prepare a fresh output for another run")
    for tool in ("initdb", "pg_ctl", "psql", "node"):
        if not shutil.which(tool):
            raise ValueError(f"Missing local prerequisite: {tool}")
    user = getpass.getuser()
    env = {"PATH": os.environ["PATH"], "HOME": str(Path.home()), "LANG": "C.UTF-8"}
    socket = Path(tempfile.mkdtemp(prefix="mira-oem-", dir="/tmp"))
    (output / "socket-path.txt").write_text(str(socket))
    env.update(
        {
            "PROOF_SOCKET": str(socket),
            "PROOF_DB_USER": user,
            "NODE_EMBED_ON_WRITE": "0",
            "NODE_DOC_PROPOSALS": "0",
            "NOTEBOOK_GARBLE_OCR_FALLBACK": "0",
            "NOTEBOOK_HYBRID_RETRIEVAL": "0",
            "NOTEBOOK_RERANK": "0",
            "MIRA_ENFORCE_APPROVED_RETRIEVAL": "true",
            "NOTEBOOK_LEXICAL_V2": "1",
        }
    )
    started = False
    with (output / "run.log").open("w") as log:
        try:
            command(
                [
                    "initdb",
                    "-D",
                    str(pgdata),
                    "-U",
                    user,
                    "--auth-local=peer",
                    "--auth-host=reject",
                    "--no-locale",
                    "-E",
                    "UTF8",
                ],
                env=env,
                log=log,
            )
            command(
                [
                    "pg_ctl",
                    "-D",
                    str(pgdata),
                    "-l",
                    str(output / "postgres.log"),
                    "-o",
                    f"-c listen_addresses='' -k {socket} -p 55439",
                    "start",
                ],
                env=env,
                log=log,
            )
            started = True
            command(
                [
                    "psql",
                    "-X",
                    "-h",
                    str(socket),
                    "-p",
                    "55439",
                    "-U",
                    user,
                    "-d",
                    "postgres",
                    "-v",
                    "ON_ERROR_STOP=1",
                    "-f",
                    str(output / "schema.sql"),
                ],
                env=env,
                log=log,
            )
            command(["node", "node_modules/vitest/vitest.mjs", "run"], cwd=output, env=env, log=log)
            command(["node", "verify-pages.mjs"], cwd=output, env=env, log=log)
        finally:
            if started:
                command(["pg_ctl", "-D", str(pgdata), "stop", "-m", "fast"], env=env, log=log)
    # Expected baseline is FAIL, not an execution error. Preserve the exit status.
    with (output / "acceptance.json").open("w") as result:
        scored = subprocess.run(
            [
                shutil.which("python3") or "python3",
                str(output / "oem_manual_acceptance.py"),
                "--cases",
                str(output / "acceptance-cases.json"),
                "--results",
                str(output / "results.json"),
            ],
            env=env,
            stdout=result,
            check=False,
        )
    print(
        f"Replay completed; database stopped. Evidence acceptance exit={scored.returncode}; inspect {output / 'acceptance.json'}"
    )
    return scored.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("--repo", type=Path, required=True)
    prep.add_argument("--output", type=Path, required=True)
    prep.add_argument("--node-modules", type=Path, required=True)
    source = prep.add_mutually_exclusive_group(required=True)
    source.add_argument("--download", action="store_true")
    source.add_argument("--pdf-dir", type=Path)
    execute = sub.add_parser("run")
    execute.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    return prepare(args) if args.action == "prepare" else run(args)


if __name__ == "__main__":
    raise SystemExit(main())
