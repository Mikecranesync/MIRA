"""Build-context drift guard for the Hub-local GS10 pack copy.

The Hub's Docker build context is `./mira-hub` (`docker-compose.saas.yml`), so
`mira-hub/src/lib/drive-packs/loader.ts` cannot import the canonical
`mira-bots/shared/drive_packs/packs/durapulse_gs10/pack.json` from outside
that context — a `../../../../mira-bots/...` import resolves on a full-repo
checkout (CI) but is absent from the image build, so `next build` fails only
at deploy time (see ADR-0025 follow-up / final-review Critical finding).

The fix is a committed, byte-for-byte copy of the canonical pack inside
`mira-hub/src/lib/drive-packs/gs10-pack.json`, which `loader.ts` imports
instead. The canonical
`mira-bots/shared/drive_packs/packs/durapulse_gs10/pack.json` remains THE
source of truth — co-located package data next to the Python loader so it
also ships inside the mira-pipeline Docker image (which COPYs
`mira-bots/shared/`); this is what the Python loader/tests in
`test_drive_packs.py` read. This test is the guard that keeps the Hub copy
honest: it runs on a full-repo checkout (where both files exist, same as the
rest of `mira-bots/tests/` in CI — see `.github/workflows/ci.yml`) and fails
loudly if the copy drifts from the canonical file.
"""

from __future__ import annotations

import os

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_CANONICAL_PATH = os.path.join(
    _REPO_ROOT,
    "mira-bots",
    "shared",
    "drive_packs",
    "packs",
    "durapulse_gs10",
    "pack.json",
)
_HUB_COPY_PATH = os.path.join(_REPO_ROOT, "mira-hub", "src", "lib", "drive-packs", "gs10-pack.json")


def test_hub_copy_is_byte_identical_to_canonical_pack() -> None:
    """The Hub build-context copy must be byte-for-byte identical to the canonical pack.

    If this fails: someone edited one of
    `mira-bots/shared/drive_packs/packs/durapulse_gs10/pack.json` or
    `mira-hub/src/lib/drive-packs/gs10-pack.json` without re-syncing the
    other. Re-sync with:

        cp mira-bots/shared/drive_packs/packs/durapulse_gs10/pack.json \\
            mira-hub/src/lib/drive-packs/gs10-pack.json

    The canonical file
    (`mira-bots/shared/drive_packs/packs/durapulse_gs10/pack.json`) is the
    source of truth — always copy FROM it, never the reverse.
    """
    assert os.path.isfile(_CANONICAL_PATH), (
        f"canonical pack missing at {_CANONICAL_PATH} — this test expects a full-repo checkout"
    )
    assert os.path.isfile(_HUB_COPY_PATH), (
        f"Hub build-context copy missing at {_HUB_COPY_PATH} — "
        "mira-hub/src/lib/drive-packs/loader.ts imports this file directly "
        "so the Hub Docker build (context: ./mira-hub) can resolve it; it "
        "must be a real committed file, not generated at build time"
    )

    with open(_CANONICAL_PATH, "rb") as f:
        canonical_bytes = f.read()
    with open(_HUB_COPY_PATH, "rb") as f:
        hub_copy_bytes = f.read()

    assert canonical_bytes == hub_copy_bytes, (
        "Hub pack copy drifted from canonical — re-sync: "
        "mira-hub/src/lib/drive-packs/gs10-pack.json no longer matches "
        "mira-bots/shared/drive_packs/packs/durapulse_gs10/pack.json "
        "byte-for-byte. Run:\n"
        "  cp mira-bots/shared/drive_packs/packs/durapulse_gs10/pack.json "
        "mira-hub/src/lib/drive-packs/gs10-pack.json"
    )
