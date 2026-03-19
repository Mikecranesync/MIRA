# Bravonode Ollama Optimization Report v1

**Date:** 2026-03-13  
**Hardware:** Apple Mac Mini M4 16GB (bravonode)  
**Ollama version:** 0.17.7  
**Model:** mira (qwen2.5:7b-instruct-q4_K_M)

## Baseline (before changes)

| Run | Load | TTFT | Gen | TPS |
|-----|------|------|-----|-----|
| 1 (cold) | 4.45s | 0.43s | 0.05s | 40.3 |
| 2 (warm) | 0.08s | 0.05s | 0.05s | 43.4 |
| 3 (warm) | 0.05s | 0.05s | 0.05s | 43.3 |

Pre-existing plist vars: OLLAMA_FLASH_ATTENTION=1, OLLAMA_KV_CACHE_TYPE=q8_0

## Changes Applied

### pmset (sleep prevention)
```bash
sudo pmset -a sleep 0 disksleep 0 displaysleep 0
sudo pmset -a tcpkeepalive 1 womp 1 autorestart 1 powernap 0 hibernatemode 0
```

### Ollama plist additions (~/.Library/LaunchAgents/homebrew.mxcl.ollama.plist)
- `OLLAMA_KEEP_ALIVE=-1` — model stays loaded indefinitely (no eviction)
- `OLLAMA_NUM_PARALLEL=1` — single request queue optimal for 16GB unified memory
- `OLLAMA_MAX_LOADED_MODELS=2` — mira + vision model (qwen2.5vl:7b) both hot
- `OLLAMA_HOST=0.0.0.0` — cluster-wide access via LAN/Tailscale

## Post-Optimization

| Run | Load | TTFT | Gen | TPS |
|-----|------|------|-----|-----|
| 1 (cold) | 13.80s | 0.49s | 0.06s | 35.2 |
| 2 (warm) | 0.10s | 0.05s | 0.05s | 43.6 |
| 3 (warm) | 0.06s | 0.05s | 0.05s | 43.4 |

## Analysis

- **Warm TPS:** 43.3 → 43.5 (+0.5% — within noise)
- **Cold load:** 4.45s → 13.80s — longer first load due to MAX_LOADED_MODELS=2 
  keeping vision model also resident (more memory to initialize)
- **Key win:** KEEP_ALIVE=-1 means zero eviction after first load; subsequent 
  Telegram bot calls will always hit the warm path (0.05-0.10s load)
- **Cluster access:** OLLAMA_HOST=0.0.0.0 enables direct Ollama calls from 
  charlie (192.168.1.12) and travel laptop without port-forwarding

## Rollback
```bash
# Remove the 4 added keys from plist, then:
launchctl unload ~/Library/LaunchAgents/homebrew.mxcl.ollama.plist
launchctl load ~/Library/LaunchAgents/homebrew.mxcl.ollama.plist
```
