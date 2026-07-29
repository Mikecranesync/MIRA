---
name: factorylm-ui-style
description: Use when building or editing ANY FactoryLM/MIRA front end — the offline tools (mira-contextualizer, mira-plc-parser gui/), mira-hub, mira-web, or an Ignition Perspective view. Enforces one shared visual system via design tokens (flat/modern, muted-normal + color-for-state). Trigger on any HTML/CSS/Tailwind/Perspective change, a new tool window, or a request to "match the style / keep it consistent". Co-activates with industrial-hmi-scada-design for operator screens.
---

# FactoryLM UI Style

One look across every product, enforced by **design tokens** — the lightest, most portable way to
stay consistent (one CSS file, no framework, runs in any browser/WebView).

**Read first:** `docs/design/factorylm-style.md` (runbook) · `docs/design/factorylm-tokens.css`
(canonical tokens) · `.claude/rules/ui-style.md` (the law).

## Do this every time

1. **Link/import the tokens.** Plain-HTML tool → keep a copy of `factorylm-tokens.css` in the tool's
   `gui/` dir and `<link>` it; React/Tailwind → map the same token values into the theme; Ignition →
   use the same hex values.
2. **Use `var(--fl-*)` for every color/space/type value. Never hardcode a hex.** Missing value? Add
   a token to the canonical file (and the runbook), then sync copies — don't paste a hex.
3. **Flat, not Win95.** 1px `--fl-line` borders, `--fl-radius`, `--fl-shadow`. No bevels/gradients.
4. **Muted normal; color = state only.** ok=green, warn=amber, fault=red, off=gray; accent=indigo for
   actions/selection only. (Operator screens: also apply `industrial-hmi-scada-design`.)
5. **Bundle it.** Plain-HTML tool's PyInstaller spec `datas` MUST include `factorylm-tokens.css`.
6. **Re-skin legacy CSS by remapping its variables to `--fl-*`** (see mira-plc-parser Tag Mapper),
   not by rewriting every rule.

## Component cheatsheet
- Button `.btn` (1px line + radius); primary `.btn.primary` (accent bg, white text).
- Table: header `#f9fafb` + uppercase `--fl-muted`; accepted row `--fl-ok-bg`, rejected `--fl-fault-bg`.
- Confidence/state text: high=`--fl-ok`, med=`--fl-warn`, low=`--fl-off`.
- Chip `--fl-accent-tint`/`--fl-accent-ink`; pill uses state bg/ink; toast = dark `--fl-header`
  bubble + `--fl-shadow-pop`.

## Verify before done
- App renders flat + on-brand; states show the correct color; no stray hardcoded hex.
- Frozen build: `factorylm-tokens.css` present under `_internal/gui/`.
- Web UI: honor the repo Screenshot Rule (`docs/promo-screenshots/`).

## Anti-patterns
- ❌ Hardcoded hex in a component. ❌ New front end without the tokens. ❌ State color as decoration /
  accent as status. ❌ Spec missing the css. ❌ Reintroducing bevelled/Win95 chrome.
