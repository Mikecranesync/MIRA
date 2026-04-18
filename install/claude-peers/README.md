# claude-peers-mcp patches

Patches against [louislva/claude-peers-mcp](https://github.com/louislva/claude-peers-mcp)
to support LAN binding for the FactoryLM cluster.

## `broker-host-bind.patch`

Adds `CLAUDE_PEERS_HOST` and `CLAUDE_PEERS_BROKER_HOST` env vars so the
broker can bind on `0.0.0.0` instead of hardcoded `127.0.0.1`.

### Apply

```bash
cd ~/claude-peers-mcp
git apply ~/MIRA/install/claude-peers/broker-host-bind.patch
```

### What it changes

- **broker.ts**: Reads `CLAUDE_PEERS_HOST` (default `127.0.0.1`), uses it
  for `Bun.serve({ hostname })` and the startup log line.
- **server.ts**: Reads `CLAUDE_PEERS_BROKER_HOST` (default `127.0.0.1`),
  uses it to construct `BROKER_URL` for the MCP server client.

### Next steps

- Consider forking `louislva/claude-peers-mcp` and committing these changes
  directly, or opening an upstream PR.
- The launchd plist that runs the broker on ALPHA is tracked at
  `install/launchd/com.factorylm.claude-peers.plist`.
