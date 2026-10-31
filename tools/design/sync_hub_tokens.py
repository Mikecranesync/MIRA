"""Emit the Hub's copy of the FactoryLM design tokens from the theme package (#3707).

Source of truth: packages/factorylm-theme/src/tokens.css (which the theme
package's own contract test keeps byte-identical to
docs/design/factorylm-tokens.css). The Hub is not a member of that Bun
workspace, so it carries a GENERATED copy in its canonical adapter root and
loads it from the root layout. mira-hub/src/factorylm-ui/tokens.test.ts fails
the Hub suite when the copy drifts from the source.

    python tools/design/sync_hub_tokens.py          # rewrite the copy
    python tools/design/sync_hub_tokens.py --check  # exit 1 on drift
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "packages/factorylm-theme/src/tokens.css"
TARGET = REPO / "mira-hub/src/factorylm-ui/tokens.css"
logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("sync-hub-tokens")

HEADER = (
    "/* GENERATED — do not edit. Source: packages/factorylm-theme/src/tokens.css\n"
    " * Regenerate: python tools/design/sync_hub_tokens.py\n"
    " * Drift guard: mira-hub/src/factorylm-ui/tokens.test.ts (#3707) */\n"
)


def render() -> str:
    return HEADER + SOURCE.read_text(encoding="utf-8")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--check", action="store_true", help="exit 1 if the copy is stale")
    args = p.parse_args()
    want = render()
    have = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
    if args.check:
        if have != want:
            log.error(
                "STALE: %s differs from %s", TARGET.relative_to(REPO), SOURCE.relative_to(REPO)
            )
            return 1
        log.info("OK: Hub token copy matches the theme source")
        return 0
    TARGET.write_text(want, encoding="utf-8")
    log.info("wrote %s (%d bytes)", TARGET.relative_to(REPO), len(want))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
