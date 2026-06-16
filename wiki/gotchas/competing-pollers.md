---
title: Competing Telegram Pollers
type: gotcha
updated: 2026-04-08
tags: [telegram, bots, bravo, charlie]
---

# Competing Telegram Pollers

## The Problem

Only one process can poll a Telegram bot token at a time. If a stale poller is running on [[nodes/charlie]] or [[nodes/bravo]], the bot appears dead on the other machine — no errors, just silent failure.

## Diagnosis

```bash
# On each machine, check for running bot processes
ssh bravo 'docker ps | grep telegram'
ssh charlie 'docker ps | grep telegram'
```

## Fix

Stop the stale poller before starting a new one:
```bash
ssh bravo 'docker stop mira-bot-telegram'
# Then start on the desired machine
```

## Prevention

Only run the Telegram bot container on ONE machine at a time. Currently designated: [[nodes/bravo]].
