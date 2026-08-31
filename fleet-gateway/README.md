# Fleet Gateway MCP v1

Bounded HTTPS control plane: **Grok/Foreman → Fleet Gateway → private/loopback CAO**.

- Issue: [#3532](https://github.com/Mikecranesync/MIRA/issues/3532)
- Spec: [`docs/specs/fleet-gateway-mcp.md`](../docs/specs/fleet-gateway-mcp.md)
- This is **not** `mira-mcp` (product diagnostics) and **not** a Pi/PLC gateway.

## What this PR does not do

Does not merge, deploy, expose CAO, bind CAO to a public interface, touch PLC/Ignition/COM3, or change Tailscale/credentials. Public CAO exposure is a later **Mike-approved** tunnel/VPS step.

## Run (local / loopback)

```bash
export FLEET_GATEWAY_BEARER=...   # from env or a local .env — never git
python -m fleet_gateway
```

Defaults to `127.0.0.1:8765`. CAO is FakeCAO unless `FLEET_GATEWAY_CAO_URL=http://127.0.0.1:…`.

## Tests

```bash
pytest fleet-gateway/tests -q
```
