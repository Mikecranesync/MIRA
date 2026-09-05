---
name: smart-commit
description: Review and stage only the exact intended paths, write a conventional commit, and push the current scoped branch without merging
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
3. Stage only the exact reviewed paths: `git add -- <path>...`, inspect `git diff --cached`, then run `git commit -m "<message>"`. Never use `git add -A`, `git add .`, or an equivalent broad stage.
4. Push only the current scoped branch: `git push -u origin HEAD`. Never push directly to `main`, merge, or enable auto-merge from this skill.
5. Do not edit `.planning/STATE.md` automatically. Update planning state only when the user's scoped mission explicitly owns that file.

These steps are subordinate to `AGENTS.md` and `docs/ENGINEERING_GUARDRAILS.md`. A commit or push is
not authorization to merge or deploy.
