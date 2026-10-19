"""Build-time model fetcher for mira-reranker.

Downloads the pinned revision of cross-encoder/ms-marco-MiniLM-L-6-v2 from
Hugging Face into MODEL_DIR, verifies each file's sha256 against
MODEL_SHA256, and exits non-zero on any mismatch or download failure.

Runs ONLY at Docker build time (see Dockerfile). The service never
downloads at runtime. Deliberately stdlib-only: this script is not part of
the runtime dependency set (onnxruntime / tokenizers / numpy / fastapi /
uvicorn) declared in pyproject.toml.
"""

from __future__ import annotations

import hashlib
import os
import sys
import urllib.request
from pathlib import Path

MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
MODEL_REVISION = "233902d25c440f23af6f7d6e94d2946bac0bee0a"
FILES = ("onnx/model.onnx", "onnx/model_quint8_avx2.onnx", "tokenizer.json", "config.json")
BASE_URL = f"https://huggingface.co/{MODEL_NAME}/resolve/{MODEL_REVISION}"

HERE = Path(__file__).resolve().parent


def load_expected_hashes(sha_file: Path) -> dict[str, str]:
    """Parse a sha256sum-style file: '<hex>  <relative-path>' per line."""
    expected: dict[str, str] = {}
    for raw_line in sha_file.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(None, 1)
        if len(parts) != 2:
            print(f"fetch_model: malformed MODEL_SHA256 line: {raw_line!r}", file=sys.stderr)
            sys.exit(1)
        digest, rel_path = parts
        expected[rel_path.strip()] = digest.strip().lower()
    return expected


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"fetch_model: downloading {url} -> {dest}")
    try:
        with urllib.request.urlopen(url, timeout=120) as resp:  # noqa: S310 - trusted HF domain
            if resp.status != 200:
                print(f"fetch_model: HTTP {resp.status} fetching {url}", file=sys.stderr)
                sys.exit(1)
            with dest.open("wb") as out:
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
    except OSError as exc:
        print(f"fetch_model: download failed for {url}: {exc}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    target_dir = Path(os.environ.get("MODEL_DIR", "/models/ms-marco-MiniLM-L-6-v2"))
    sha_file = Path(os.environ.get("MODEL_SHA256_FILE", HERE / "MODEL_SHA256"))

    expected = load_expected_hashes(sha_file)
    missing = [f for f in FILES if f not in expected]
    if missing:
        print(f"fetch_model: MODEL_SHA256 is missing entries for: {missing}", file=sys.stderr)
        sys.exit(1)

    target_dir.mkdir(parents=True, exist_ok=True)

    for rel_path in FILES:
        dest = target_dir / rel_path
        download(f"{BASE_URL}/{rel_path}", dest)

        actual = sha256_of(dest)
        want = expected[rel_path]
        if actual != want:
            print(
                f"fetch_model: SHA256 MISMATCH for {rel_path}: expected {want}, got {actual}",
                file=sys.stderr,
            )
            sys.exit(1)
        print(f"fetch_model: verified {rel_path} sha256={actual}")

    print(f"fetch_model: all {len(FILES)} files verified under {target_dir}")


if __name__ == "__main__":
    main()
