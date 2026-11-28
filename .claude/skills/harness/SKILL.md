---
name: harness
description: Run the adversarial-dev coding harness (Planner → Generator → Evaluator) to build an application from a prompt. Use when user says 'run harness', 'adversarial dev', 'harness build', or wants to generate a complete app using the three-agent GAN-inspired pipeline.
---

# Adversarial Dev Harness

Three-agent coding harness by Cole Medin: **Planner** (product spec) → **Generator** (builds code) → **Evaluator** (adversarial QA). Sprint-based with pass/fail gates.

**Repo:** `C:\Users\hharp\Documents\adversarial-dev`
**Harness entry:** `claude-harness/index.ts`
**Output dir:** `workspace/claude/app/`

## Configuration (shared/config.ts)

| Setting | Default |
|---------|---------|
| Model | claude-sonnet-4-6 |
| Max sprints | 10 |
| Max retries/sprint | 3 |
| Pass threshold | 7/10 |
| Max turns/agent | 50 |

## Run Steps

1. **Write the prompt** — create or update `prompt.md` in the adversarial-dev root:
   ```bash
   cat > /c/Users/hharp/Documents/adversarial-dev/prompt.md << 'EOF'
   <your prompt here>
   EOF
   ```

2. **Show the run command** to the user and **wait for approval** before executing:
   ```
   COMMAND: cd /c/Users/hharp/Documents/adversarial-dev && bun run claude-harness/index.ts --file prompt.md
   ```

3. **Run the harness** (only after user says "go ahead" / "run it"):
   ```bash
   cd /c/Users/hharp/Documents/adversarial-dev && bun run claude-harness/index.ts --file prompt.md
   ```

4. **Report milestones** as they happen:
   - Planner finishes writing spec
   - Generator/Evaluator lock sprint contract
   - Sprint scores (each criterion)
   - Retries if a sprint fails
   - Completion

5. **Test the output** — find generated app in `workspace/claude/app/`, start it, run verification tests, stop it.

6. **Summarize**: pass/fail, sprint count, retries, files generated, test results, duration.

## Important Rules

- **Never run the harness without explicit user approval**
- No API key needed — Claude subscription via CLI handles auth
- If rate limited, report and wait (don't restart)
- Port 3000 may conflict with Open WebUI on Bravo — check before testing
- The Codex harness (`codex-harness/`) requires a separate OpenAI Codex login and is not used by default

## Prompt Tips

- Keep prompts specific about endpoints, data models, and behavior
- Mention "single-file" or "no external packages" if you want constraints
- The Planner will expand a short prompt into a full spec — don't over-specify
