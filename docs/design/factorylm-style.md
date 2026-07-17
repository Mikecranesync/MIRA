# FactoryLM Style Guide & Runbook

**One look across every product.** This is the source of truth for the FactoryLM / MIRA UI style.
Tokens: `docs/design/factorylm-tokens.css`. Rule: `.claude/rules/ui-style.md`. Skill:
`.claude/skills/factorylm-ui-style/`.

## 1. Decision (why this style)

All our front ends are plain HTML/CSS (offline tools) or React/Tailwind (mira-hub, mira-web) — both
featherweight and cross-platform. We standardize on a **flat, modern** look (not the old Win95 Tag
Mapper chrome) because it matches the Command Center, follows the industrial-HMI doctrine (muted
normal, color = state), and factors cleanly into shared **design tokens**. Tokens are the lightest
possible enforcement: one stylesheet, no framework, works in any browser/WebView.

## 2. Principles (industrial-HMI aligned)

1. **Muted by default; color means something.** Backgrounds/text are grays. Green = ok/running/
   accepted, amber = warning/medium, red = fault/stop/rejected, gray = off/unknown/low. Never use a
   state color for decoration. (See `industrial-hmi-scada-design` + `.claude/rules/ui-style.md`.)
2. **One accent.** Indigo (`--fl-accent`) for primary actions and selection. Not for status.
3. **No new colors.** If you need one, add a token here — don't hardcode a hex in a component.
4. **Flat.** Thin 1px `--fl-line` borders, `--fl-radius`, subtle `--fl-shadow`. No bevels/gradients.
5. **Type.** `--fl-font` (Segoe UI / system), monospace `--fl-mono` for tags/paths/codes.
6. **3-second test.** A screen's state must read at a glance — lead with state, keep chrome quiet.

## 3. Tokens (the contract)

See `factorylm-tokens.css` for values. Groups: surfaces (`--fl-bg/-surface/-header`), text
(`--fl-ink/-muted/-faint`), lines, accent (`--fl-accent/-hover/-tint/-ink`), **state**
(`--fl-ok/-warn/-fault/-off` + `*-bg` tints), type (`--fl-font/-mono/-fs*`), shape
(`--fl-radius*/-gap/-pad/-shadow*`).

## 4. Component patterns (copy these)

```html
<!-- button -->            <button class="btn">Refresh</button>
<!-- primary button -->    <button class="btn primary">Promote</button>
<!-- status pill -->       <span class="pill accepted">accepted</span>
<!-- confidence -->        high=--fl-ok · med=--fl-warn · low=--fl-off
<!-- toast -->             dark --fl-header bubble, --fl-shadow-pop, auto-dismiss ~2.6s
```
Buttons: `border:1px solid --fl-line; border-radius:--fl-radius-sm`. Primary: `bg:--fl-accent;
color:#fff`. Tables: header `#f9fafb` + uppercase `--fl-muted`; rows accepted→`--fl-ok-bg`,
rejected→`--fl-fault-bg`. Chips: `--fl-accent-tint` bg, `--fl-accent-ink` text.

## 5. How to apply per product

- **Plain-HTML offline tools** (mira-contextualizer, mira-plc-parser Tag Mapper): keep a COPY of
  `factorylm-tokens.css` in the tool's `gui/` dir (so it bundles offline) and
  `<link rel="stylesheet" href="factorylm-tokens.css">`. Use `var(--fl-*)`. **Bundle it in the
  PyInstaller spec** (`datas` must include the css). Re-skinning legacy CSS: remap its existing
  variables to `--fl-*` tokens rather than rewriting every rule (see the Tag Mapper).
- **React / Tailwind** (mira-hub, mira-web): map the same token values into the Tailwind theme; don't
  invent parallel colors.
- **Ignition Perspective**: use the same hex values from the tokens for view styles.

## 5b. Dark datasheet theme (public marketing/datasheet surfaces)

Public technical pages (Drive Commander family/fault/parameter pages, the PrintSense landing)
use the `--fl-dark-*` block in the canonical token file — the ONE sanctioned dark look. Same
doctrine as the light workspace: muted normal, brand-orange `--fl-dark-accent` for actions only,
green/amber/red strictly for state (cited/grounded=ok, held=warn, stop/fault=fault). Hard rules
for these surfaces: no emoji as icons (inline SVG only), no glows/gradients/bevels, no duplicated
content blocks, honest counts ("N faults in this pack", never "All N fault codes"). mira-web pages
`<link>` `/_tokens.css` (which mirrors the block) and may alias tokens into short local vars in a
`:root` remap — but never introduce a raw hex. Reference implementation:
`mira-web/src/lib/drive-commander-renderer.ts`.

## 6. Sync rule (avoid drift)

`docs/design/factorylm-tokens.css` is canonical. The per-tool copies must match it byte-for-byte.
When you change a token: edit the canonical file, copy it into every `gui/` dir, and rebuild. (A CI
check can later diff the copies against canonical.)

## 7. Verify

- Run the app; the picker/table/toolbar must look flat + on-brand; states show the right color.
- For mira-* web UI changes, follow the repo **Screenshot Rule** (`docs/promo-screenshots/`).
- Frozen offline tools: confirm `factorylm-tokens.css` is present under `_internal/gui/` after build.
