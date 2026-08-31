"""Process entry: HTTP gateway on loopback by default. Optional FastMCP if installed.

Never binds CAO. Never listens on a CAO/LAN port. Public TLS termination is a
later Mike-approved tunnel/VPS step — this process defaults to 127.0.0.1.
"""

from __future__ import annotations

import os
import sys

from fleet_gateway.factory import load_local_env, service_from_env
from fleet_gateway.http_app import create_http_app, default_bind_host, default_bind_port


def main() -> None:
    load_local_env()
    if not (os.environ.get("FLEET_GATEWAY_BEARER") or "").strip():
        sys.stderr.write("ERROR: FLEET_GATEWAY_BEARER is not set — all tool calls will 401\n")
        sys.stderr.flush()
    service = service_from_env()
    app = create_http_app(service)
    host = default_bind_host()
    port = default_bind_port()
    # Refuse obviously-public accidental CAO confusion: this is the gateway, not CAO.
    sys.stderr.write(f"INFO: fleet-gateway HTTP {host}:{port} (CAO stays loopback/stub)\n")
    import uvicorn

    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
