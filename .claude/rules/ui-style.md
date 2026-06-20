# FactoryLM UI Style (the law for any front end)

One look across every product. Source of truth: `docs/design/factorylm-tokens.css` (tokens) +
`docs/design/factorylm-style.md` (runbook). Skill: `.claude/skills/factorylm-ui-style/`. This rule
complements `industrial-hmi-scada-design` (operator/HMI doctrine) — that governs *operator decision
support*; this governs *the visual system* every FactoryLM surface shares.

## Hard rules

1. **Use the tokens. Never hardcode colors.** Every color/spacing/type value comes from a
   `--fl-*` token. If a value is missing, ADD a token to `factorylm-tokens.css` (and the runbook) —
   do not paste a hex into a component.
2. **Flat, modern look — not the legacy Win95 chrome.** Thin `--fl-line` borders, `--fl-radius`,
   subtle `--fl-shadow`. No bevels, no gradients.
3. **Muted normal; color = state only.** green=ok/running/accepted, amber=warning/medium,
   red=fault/stop/rejected, gray=off/unknown/low. Indigo `--fl-accent` is for actions/selection,
   NEVER for status. (Same doctrine as `industrial-hmi-scada-design`.)
4. **Plain-HTML tools bundle a copy of the tokens.** Keep `factorylm-tokens.css` in the tool's
   `gui/` dir, `<link>` it, and add it to the PyInstaller spec `datas`. Re-skin legacy CSS by
   remapping its variables to `--fl-*`, not by rewriting rules.
5. **React/Tailwind + Ignition** map the SAME token values — no parallel palettes.
6. **Canonical token file is `docs/design/factorylm-tokens.css`.** Per-tool copies must match it;
   change the canonical file first, then sync copies, then rebuild.

## When this applies
- Any new or edited front end: mira-contextualizer, mira-plc-parser `gui/`, mira-hub, mira-web,
  Ignition Perspective views, any new operator/tool UI.

## When it does NOT apply
- Non-visual code; generated reports that aren't a UI; third-party embedded UIs we don't control.

## What a reviewer must catch
- ❌ A hardcoded hex/color in a component instead of a `--fl-*` token.
- ❌ A new front end that doesn't link/import the tokens.
- ❌ A state color used for decoration, or the accent used for status.
- ❌ A plain-HTML tool whose PyInstaller spec doesn't bundle `factorylm-tokens.css`.
- ❌ Reintroducing bevelled/Win95 chrome on a FactoryLM surface.

## Cross-references
- `docs/design/factorylm-style.md` — runbook (principles, patterns, per-product application)
- `docs/design/factorylm-tokens.css` — canonical tokens
- `.claude/skills/factorylm-ui-style/SKILL.md` — the build skill
- `industrial-hmi-scada-design` (global) — operator/HMI decision-support doctrine
