---
title: macOS Keychain Blocks Docker + Doppler over SSH
type: gotcha
updated: 2026-04-08
tags: [bravo, charlie, docker, doppler, ssh, macos]
---

# macOS Keychain Blocks Docker + Doppler over SSH

## The Problem

When SSH'd into macOS machines ([[nodes/bravo]], [[nodes/charlie]]), both `docker build`/`docker pull` and `doppler run` fail because they try to access the macOS keychain, which isn't available in a non-GUI SSH session.

## Fix: Bravo (Completed 2026-03-21)

### Doppler
- Set service token (`DOPPLER_TOKEN`) in `~/.zshrc`
- Rewrote `~/.doppler/.doppler.yaml` to remove keychain token reference
- Alternative: `doppler configure set token-storage file`

### Docker
- Renamed `docker-credential-osxkeychain` and `docker-credential-desktop` to `.disabled` at `/usr/local/bin/`
- Set `"credsStore": ""` in `~/.docker/config.json`
- Docker Hub + ghcr.io pulls now work over SSH

### Quick workaround (for docker build only)
```bash
DOCKER_CONFIG=/tmp/docker-config docker build ...
```

## Fix: Charlie (NOT YET DONE)

Charlie has the same issue. Needs `doppler configure set token-storage file` — requires a local terminal session (can't fix over SSH, which is the irony).

## Workaround: docker cp

When Docker build is broken over SSH, use:
```bash
# Build locally, save, transfer, load
docker save image:tag | ssh bravo 'docker load'
# Or: docker cp files into running container + docker commit + docker restart
```
