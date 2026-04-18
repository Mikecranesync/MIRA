# LaunchAgent: claude-peers broker

Keeps the `claude-peers-mcp` broker running on ALPHA so all cluster
nodes can reach it via LAN.

## Install

```bash
cp com.factorylm.claude-peers.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.factorylm.claude-peers.plist
```

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLAUDE_PEERS_HOST` | `127.0.0.1` | Bind address. Set to `0.0.0.0` for LAN access. |
| `CLAUDE_PEERS_PORT` | `7899` | Broker listen port. |

## Paths

Edit `WorkingDirectory` and `ProgramArguments` in the plist if your
`bun` binary or `claude-peers-mcp` checkout lives elsewhere.

## Logs

- stdout: `/tmp/claude-peers-broker.out.log`
- stderr: `/tmp/claude-peers-broker.err.log`
