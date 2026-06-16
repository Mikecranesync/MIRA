---
title: Agent Coding Principles
type: reference
updated: 2026-04-17
tags: [coding, principles, karpathy]
---

# Agent Coding Principles

*Adapted from [Karpathy's CLAUDE.md](https://github.com/forrestchang/andrej-karpathy-skills). Bias toward caution over speed.*

## Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

## Simplicity First
- No features beyond what was asked. No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- If you write 200 lines and it could be 50, rewrite it.

## Surgical Changes
- Don't "improve" adjacent code, comments, or formatting.
- Match existing style. Every changed line traces to the user's request.
- Remove orphans YOUR changes created. Don't remove pre-existing dead code.

## Goal-Driven Execution
- Transform tasks into verifiable goals with explicit success criteria.
- For multi-step tasks, state a brief plan: `[Step] → verify: [check]`
- Loop until verified. "Verify Before Declaring Done" rules apply.
