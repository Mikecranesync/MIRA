"""SimLab startup: ``python -m simlab``

Starts the FastAPI app with the Florida Natural Demo juice bottling line loaded,
underfill scenario armed (but not started).

Usage
-----
    python -m simlab
    python -m simlab --host 0.0.0.0 --port 8099

Sample curl commands are printed on startup.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s simlab: %(message)s",
)
logger = logging.getLogger("simlab.__main__")


def main() -> None:
    parser = argparse.ArgumentParser(description="MIRA SimLab — Juice Bottling Demo")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("SIMLAB_PORT", "8099")),
        help="Bind port (env SIMLAB_PORT)",
    )
    parser.add_argument("--reload", action="store_true", help="Auto-reload on code change")
    args = parser.parse_args()

    try:
        import uvicorn
    except ImportError:
        logger.error("uvicorn is not installed.  Run: pip install uvicorn")
        sys.exit(1)

    base = f"http://{args.host}:{args.port}"
    print()
    print("=" * 65)
    print("  MIRA SimLab — Florida Natural Demo Juice Bottling Line")
    print("=" * 65)
    print(f"  Server:  {base}")
    print(f"  Docs:    {base}/docs")
    print()
    print("  Sample curls:")
    print(f"    curl {base}/simlab/healthz")
    print(f"    curl {base}/simlab/lines")
    print(f"    curl {base}/simlab/assets/filler01/tags")
    print(f"    curl -X POST {base}/simlab/scenario/filler_underfill_low_bowl_pressure/start")
    print(f"    curl -X POST '{base}/simlab/scenario/tick?n=80'")
    print(f"    curl {base}/simlab/snapshot?asset=filler01")
    print(f"    curl {base}/simlab/alarms")
    print(f"    curl {base}/simlab/evidence/filler_underfill_low_bowl_pressure")
    print(f"    curl {base}/simlab/scenario/filler_underfill_low_bowl_pressure/rubric")
    print("=" * 65)
    print()

    uvicorn.run(
        "simlab.api:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
