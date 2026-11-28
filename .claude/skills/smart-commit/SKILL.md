---
name: smart-commit
description: Stage all changes and write a conventional commit message
---

1. Run `git diff` and `git status` to understand exactly what changed
2. Write a conventional commit message following CLAUDE.md commit convention:
   - `feat:` new feature
   - `fix:` bug fix
   - `security:` security hardening
   - `docs:` documentation only
   - `refactor:` code restructuring, no behavior change
   - `test:` tests only
   - `chore:` build system, deps, tooling
   - `BREAKING:` breaking change (use with another type)
3. Run: `git add -A && git commit -m "<message>"`
4. Run: `git push origin main`
5. Update `.planning/STATE.md` — mark completed task, set next task
