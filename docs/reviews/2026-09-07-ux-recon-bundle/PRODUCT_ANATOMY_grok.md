# PRODUCT ANATOMY — Grok (web)

**Recon date:** 2026-09-07 · **Surface:** grok.com desktop web
**Pass type:** DELTA against ChatGPT baseline
**Session state:** **LOGGED OUT.** Signing in was out of bounds for this study (no credential entry). Everything below is the logged-out experience, which is genuinely useful — it is the one product in this study where the cold, unauthenticated entry could be observed — but the authenticated shell, history, projects and chat lifecycle were **not** tested.

---

## Product thesis

**Grok is optimized for conversion first and conversation second.** On a screen containing one text box there are four separate monetization surfaces: `Suscríbete` in the header, an upsell row docked inside the model menu, a placeholder that advertises a feature, and a signup wall that replaces the answer itself. ChatGPT's home sells nothing. Grok's sells constantly.

Where it agrees with the baseline it agrees completely: centred greeting, one composer, one `+`, one model control, legal text at the foot. The convergence is the story.

---

## Screen map (logged out)

```
[logo]                    Imagine  [⚙]  [Iniciar sesión]  [Suscríbete]
                     ¿Qué debemos explorar?
                              ‿‿‿‿
        ┌──────────────────────────────────────────┐
        │ Cambia al modo Build para crear apps     │
        │                                          │
        │ [+]                      Fast ⌄    (↑)   │
        └──────────────────────────────────────────┘

              Al enviar un mensaje… Términos y Política
```

**No sidebar exists when logged out.** The entire app shell — history, projects, account — is withheld, not disabled. The logged-out product is a single stateless page.

---

## What Grok does the same as ChatGPT

Recorded to establish convergence, not novelty.

- Centred greeting + one composer as the entire home screen
- One `+` as the only attachment/tools entry point
- One model/mode control inline in the composer, showing its **current value** as the collapsed label
- Circular filled send button in the composer's right slot
- Escape closes popovers; popovers float without a dimmed backdrop
- Legal disclaimer pinned below the composer
- Dark ground, no shadows, hairline-free surfaces, one accent colour (blue)
- Rounded-rect composer with controls on an internal bottom row (identical geometry to ChatGPT's *Work* surface composer)

---

## NEW rules Grok introduces

**GROK-1 — Effort levels are named by outcome, not magnitude.**
`⚡ Fast · 🚀 Auto · 💡 Expert · ▦ Heavy · 🔧 Build`, checkmark on the active row.
Where ChatGPT gives a 5-notch slider labelled `Thinking effort`, Grok gives five words a non-expert already understands. **No user has to reason about a magnitude to pick correctly.** This is the single most transferable idea from Grok, and it is better than the baseline for a non-technical audience.

**GROK-2 — The logged-out gate is rendered in the answer's position, with the question preserved above it.**
Sending a message produces no answer at all — not a truncated one. The user's message stays in place and a card takes the answer's slot: heading, one line of value copy, a filled `Suscríbete gratis` button, and a 4-item benefit list (images/video, skills & connectors, file generation, chat history). The sunk cost is visible and the reward is one click away. Ruthless and effective; also means an unauthenticated visitor receives zero product value.

**GROK-3 — Theme is a three-icon segmented row inside a small popover.**
`☀ / ☾ / ◐` (light / dark / system) sits as an icon triplet at the top of the settings menu, above `Idioma` and `Comentarios`. No settings page, no navigation, no labels. A very compact solution for a control users toggle and then forget.

**GROK-4 — An upsell docks *inside* a functional menu.**
The model menu's last row is a pinned `SuperGrok — Desbloquear capacidades extendidas` block with its own button, visually separated from the options above it. Structurally clean; strategically noisy.

**GROK-5 — The placeholder is an advertisement.**
`Cambia al modo Build para crear apps` — the highest-value line of text in the product, the one that should invite input, is spent promoting a mode.

---

## Interaction / navigation grammar

Consistent with baseline where testable. `Escape` closes menus; the `+` is a plain attach control (tooltip `Adjuntar`) rather than a capability menu when logged out; the send button renders in its **enabled blue state even with an empty input** — the only product in this study that does not use the send control to communicate readiness.

Navigation could not be assessed: with no history, no sidebar and no persisted conversation, there is nothing to navigate between.

---

## Presentation notes

- Ground is near-black; the composer is a lifted surface with no border, matching baseline.
- One accent (blue), used only for the send button.
- **Decorative flourish:** a hand-drawn underline swash beneath the last word of the greeting. The only ornamental mark observed in any product in this study. It carries brand personality at zero functional cost — a legitimate way to have a voice without adding chrome.
- **Localization is partial and inconsistent.** UI localized to Spanish by locale detection, but `Fast`, `Imagine`, and `Build` remain English. Mode names and feature names went untranslated while chrome was translated — the exact reverse of what a non-English technician needs.

---

## Excellent decisions — FactoryLM should learn from these

1. **Name the effort levels by outcome.** `Fast / Expert / Heavy` beats a slider labelled with a parameter name for anyone who isn't an AI enthusiast. A technician on a ladder should not have to interpret "Extra High".
2. **A single decorative mark can carry brand voice** without adding a single functional element.
3. **Theme as a 3-icon inline triplet** — the cheapest possible implementation of a control users set once.
4. **When you must gate, preserve the user's input above the gate.** Losing the typed question would be the real failure.

---

## Weak decisions — FactoryLM should avoid these

1. **Two different axes fused into one list.** `Build` is a product mode that changes the entire surface; `Fast` and `Heavy` are effort levels. Presenting them as siblings is a category error — the user cannot predict that one of these five choices reshapes the app.
2. **Placeholder used as ad space.** The invitation to type is the most valuable line on the screen; spending it on promotion measurably raises the cost of starting.
3. **Send button always renders enabled.** Removes the product's cheapest readiness signal and invites dead clicks.
4. **Four monetization surfaces on a one-input screen.** The quiet that makes ChatGPT's home feel effortless is spent here.
5. **Partial localization.** Translating chrome while leaving mode names in English is worse than translating nothing — it implies the untranslated words are proper nouns when they are in fact the choices that matter.
6. **Total logged-out gate.** Zero value before signup. For FactoryLM the analogue would be gating a nameplate lookup behind account creation — fatal for a technician evaluating the tool on a plant floor with a supervisor watching.

---

## Delta verdict

**New interaction conventions contributed: 1 substantive** (outcome-named effort levels), plus three minor presentation ideas (theme triplet, brand flourish, gate-preserves-input).

Grok did not introduce a new app shell, a new navigation model, a new chat lifecycle, or a new organization model. **Convergence signal: STRONG.**

---

## Evidence index

| ID | Route | Action | Resulting state |
|---|---|---|---|
| GROK-A-01 | `/` | cold load, logged out | No sidebar; greeting + composer + header auth CTAs |
| GROK-A-02 | `/` | focus composer, `+` hover | tooltip `Adjuntar` — plain attach, not a menu |
| GROK-D-01 | `/` | type + Enter | user message preserved; **signup wall in the answer slot**; no answer produced |
| GROK-E-01 | composer | open model control | `Fast ✓ / Auto / Expert / Heavy / Build` + docked SuperGrok upsell row |
| GROK-G-01 | header `⚙` | open settings | `☀/☾/◐` triplet + Idioma + Comentarios |

**Gaps:** entire authenticated experience — shell, sidebar, history, projects, chat lifecycle, streaming, errors, multimodal, state restoration. Not tested because signing in was out of scope.
