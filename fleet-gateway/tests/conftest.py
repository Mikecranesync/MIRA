from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parent
sys.path.insert(0, str(TESTS_DIR))
sys.path.insert(0, str(ROOT))

from fleet_gateway.cao import FakeCAO
from fleet_gateway.node_config import make_bravo_config, make_charlie_config
from fleet_gateway.service import build_service
from fleet_gateway.worktree import WorktreeProvisioner
from helpers import AUTH_HEADER, LAUNCH_OK, TEST_BEARER

assert AUTH_HEADER and LAUNCH_OK and TEST_BEARER


def _init_git_repo(repo: Path) -> str:
    repo.mkdir(parents=True, exist_ok=True)
    env = {
        "GIT_AUTHOR_NAME": "Fleet Gateway Test",
        "GIT_AUTHOR_EMAIL": "fleet-gateway-test@localhost",
        "GIT_COMMITTER_NAME": "Fleet Gateway Test",
        "GIT_COMMITTER_EMAIL": "fleet-gateway-test@localhost",
        "GIT_TERMINAL_PROMPT": "0",
    }
    subprocess.run(["git", "init", "-b", "main"], cwd=repo, check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "fleet-gateway-test@localhost"],
        cwd=repo,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Fleet Gateway Test"],
        cwd=repo,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "commit.gpgsign", "false"], cwd=repo, check=True, capture_output=True
    )
    (repo / "README.md").write_text("fleet-gateway test origin\n", encoding="utf-8")
    subprocess.run(["git", "add", "README.md"], cwd=repo, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "init"],
        cwd=repo,
        check=True,
        capture_output=True,
        env={**{k: v for k, v in __import__("os").environ.items()}, **env},
    )
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    return sha


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    return tmp_path / "gw-data"


@pytest.fixture
def origin_repo(tmp_path: Path) -> tuple[Path, str]:
    repo = tmp_path / "origin"
    sha = _init_git_repo(repo)
    LAUNCH_OK["base_commit"] = sha
    return repo, sha


@pytest.fixture
def worktree_parent(tmp_path: Path) -> Path:
    path = tmp_path / "worktrees"
    path.mkdir()
    return path


@pytest.fixture
def charlie_repo(tmp_path: Path, origin_repo: tuple[Path, str]) -> Path:
    origin, _sha = origin_repo
    repo = tmp_path / "charlie-origin"
    subprocess.run(["git", "clone", str(origin), str(repo)], check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "commit.gpgsign", "false"], cwd=repo, check=True, capture_output=True
    )
    return repo


@pytest.fixture
def charlie_worktree_parent(tmp_path: Path) -> Path:
    path = tmp_path / "charlie-worktrees"
    path.mkdir()
    return path


@pytest.fixture
def cao() -> FakeCAO:
    return FakeCAO()


@pytest.fixture
def charlie_cao() -> FakeCAO:
    client = FakeCAO()
    client.cao_health = "ok"
    return client


@pytest.fixture
def service(
    data_dir: Path,
    cao: FakeCAO,
    charlie_cao: FakeCAO,
    origin_repo: tuple[Path, str],
    charlie_repo: Path,
    worktree_parent: Path,
    charlie_worktree_parent: Path,
    tmp_path: Path,
):
    repo, _sha = origin_repo
    return build_service(
        bearer_token=TEST_BEARER,
        cao=cao,
        data_dir=data_dir,
        requester="foreman-test",
        worktrees=WorktreeProvisioner(repo=repo, parent=worktree_parent),
        node_configs={
            "bravo": make_bravo_config(cao=cao, repo=repo, worktree_parent=worktree_parent),
            "charlie": make_charlie_config(
                cao=charlie_cao,
                repo=charlie_repo,
                worktree_parent=charlie_worktree_parent,
                expected_path_prefix=tmp_path,
                require_cao_health=True,
            ),
        },
        hostname_provider=lambda: "CharlieNodes-Mac-mini.local",
    )


@pytest.fixture
def auth() -> str:
    return AUTH_HEADER


@pytest.fixture
def launch_ok() -> dict:
    return dict(LAUNCH_OK)
