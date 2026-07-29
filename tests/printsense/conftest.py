"""Ensure the repo root is importable so ``import printsense`` resolves under any pytest sys.path mode."""

import pathlib
import sys

_REPO_ROOT = str(pathlib.Path(__file__).resolve().parents[2])
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
