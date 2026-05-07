# Help Documentation Spec — In-App Help + GitHub Repo Docs

**Owner:** Mike (FactoryLM)
**Author:** Claude (CHARLIE)
**Created:** 2026-05-07
**Status:** Draft — awaiting Mike's review before merge
**Branch:** claude/beautiful-burnell-6946d9

---

## 1. Why this exists

Today MIRA has good developer-facing docs (`docs/developer/*`) and a small set of product docs (`docs/product/*.md`) — but neither surface is reachable inside the running product, and the GitHub repo is missing the public-facing files (`CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`) that signal "this is a real project you can rely on."

Two distinct audiences need help:

| Audience | Where they look | What they need |
|----------|-----------------|----------------|
| Plant technician / supervisor / admin using `app.factorylm.com` | Inside the app (sidebar) | "How do I do X right now?" — short, task-shaped, mobile-first |
| Developer / open-source visitor on GitHub | The repo's front door | "What is this, can I run it, and how do I contribute?" |

This spec defines **both surfaces**, ties them together, and locks the content tone to Mike's Voice Guide so future help pages stay consistent.

---

## 2. Research — what good help looks like

Reviewed the help/docs surfaces of:

- **Stripe** — `stripe.com/docs`. Three-pane layout (sections → topic list → article + ToC). Consumer-grade prose, code samples in every other paragraph, "Was this helpful?" feedback.
- **Linear** — `linear.app/docs`. One-column, dense, image-light. Heavy use of inline icons that mirror the in-product icons. Keyboard-shortcut cheat sheet is a first-class doc.
- **Notion** — `notion.so/help`. Card grid index, one card per feature surface. Each card opens a 5-min walkthrough with screenshots. "Getting started" is its own product.
- **Vercel** — `vercel.com/docs`. Strong `Frameworks → Deployments → Domains → CLI` taxonomy. Every page has a "Was this page helpful?" + a GitHub-edit-this-page link.
- **Supabase** — `supabase.com/docs`. Open-source friendly: every doc lives in the public repo, every page has "Edit this page on GitHub." Heavy on copy-paste-friendly code blocks.

GitHub OSS conventions reviewed (and adopted):
- `README.md` opens with one-line value prop, then "What it does in 60 seconds," then quick-start, then deeper links.
- `CONTRIBUTING.md` covers: fork → branch → commit format → tests → PR.
- `SECURITY.md` is GitHub's standard responsible-disclosure file — surfaces a "Report a vulnerability" button in the repo UI.
- `SUPPORT.md` triages help requests away from GitHub Issues (which should stay reserved for bugs/features).
- `docs/README.md` as a hand-curated index of the `docs/` tree.

CMMS competitors reviewed (MaintainX, UpKeep, Limble): all have help centers with a Getting-Started + Features + FAQ + Contact pattern. None feel especially mobile-first; MIRA can win on that.

**Patterns we adopt:**
1. Card-grid index page → topic page → linear scroll content (no nested accordions on mobile).
2. "Was this helpful?" feedback on every help article (defer wiring; render the UI now, log to console for v1).
3. GitHub repo: one-line description → demo → quick start → architecture link → contributing → license — in that order.
4. Keyboard shortcuts is its own page, surfaced from a `?` global key (deferred — render the page now, wire `?` later).

**Patterns we skip:**
- Multi-pane TOC + sidebar TOC. Overkill for an MVP help center; one-column scroll is plenty.
- Search across help articles. Defer until we have >25 articles. Add a Cmd-K search later.
- Translations of help content. Help strings stay English-only in v1 (UI chrome respects existing i18n via `nav.help`).

---

## 3. Surfaces, in scope

### Surface 1 — In-app help (`app.factorylm.com/help`)

A help section reachable from the hub sidebar, the mobile More drawer, and the mobile More page.

**Routes:**

```
/help                          Index (card grid)
/help/getting-started          5-min walkthrough
/help/features                 Feature guides hub (card grid)
/help/features/[slug]          One feature guide — slug ∈ feed | assets | workorders | schedule | knowledge | cmms | scan | reports | settings
/help/faq                      Top-10 FAQ
/help/shortcuts                Keyboard shortcuts + tips
/help/contact                  Contact + support response times
```

**Implementation:**
- Content lives in `mira-hub/src/app/(hub)/help/_content/*.ts` as typed data (NOT MDX, NOT a CMS). One file per help article. Self-contained, hot-reloadable, no build pipeline.
- Pages are React Server Components (Next.js App Router) for fast first-paint and zero client-side JS for read-only content. Interactivity (the "Was this helpful?" widget, copy-link button) is a small client island.
- Every page uses the existing `(hub)/layout.tsx` — sidebar, mobile top bar, bottom tabs all included for free.
- Mobile-responsive: same layout pattern as `more/page.tsx` (single column on mobile, max-width centered on desktop).
- Dark-mode-aware via existing `var(--*)` design tokens; no new CSS.

**Navigation wiring:**
- Add `{ key: "help", label: "Help", icon: "HelpCircle", href: "/help", roles: [all], group: "secondary" }` to `mira-hub/src/providers/access-control.ts` so it appears below the divider.
- Add `nav.help` to all four locale files (`en.json`, `es.json`, `hi.json`, `zh.json`).
- Add to `MobileDrawer` and `more/page.tsx` ITEMS arrays so it surfaces on mobile.
- The existing "Tour" button in the sidebar footer stays — tour ≠ help, they complement each other.

### Surface 2 — GitHub repo public docs

Files at the repo root + `docs/README.md`. All markdown, no tooling.

| File | Purpose | New / edit |
|------|---------|------------|
| `README.md` | Front door | **Edit** — already strong; add CONTRIBUTING/SECURITY/SUPPORT links |
| `CONTRIBUTING.md` | How to contribute | **New** |
| `SECURITY.md` | Responsible disclosure | **New** |
| `SUPPORT.md` | Where to get help | **New** |
| `docs/README.md` | Index of `docs/` | **New** |

---

## 4. Content (what each page says)

All help content follows Mike's Voice Guide:
- Grade 6–8 reading level
- "What it does," not "what it is"
- No jargon ("API," "tenant," "OAuth scope" → "your account," "log in with Google")
- Active voice, second person
- Short sentences. Short paragraphs. Bullets when there are >2 things.

### 4.1 `/help` — index

Hero: *"Welcome to FactoryLM Help. Find what you need."*
6 cards, 2×3 grid on desktop, single column on mobile:
1. Getting started — 5 minutes from sign-up to your first diagnosis
2. Feature guides — how every screen works
3. FAQ — top 10 questions, answered
4. Keyboard shortcuts — work faster with the keyboard
5. Contact support — email, Telegram, response times
6. What's new — link to `docs/CHANGELOG.md` (open in new tab)

Footer: "Can't find what you need? [Email mike@cranesync.com]"

### 4.2 `/help/getting-started` — 5-minute walkthrough

Stepped, numbered, action-shaped:

1. **Log in** — Magic link (paste the link from your email) or Google. No password to remember.
2. **Add your first asset** — Two ways: scan a QR sticker with your phone camera, or tap **+ New Asset** and type the vendor and model. MIRA pulls the manual in the background.
3. **Create a work order** — From any asset page, tap **Create work order**. Type what's wrong. Assign it to yourself or a teammate.
4. **Ask MIRA a question** — Type into the chat box on the home screen, or message @MiraFactoryBot on Telegram. Examples: *"My Yaskawa GS20 is faulting on F030"* or *"What lubrication does motor 12 take?"*
5. **See your PM schedule** — Tap **Schedule** in the sidebar. PMs are sorted by due date. Tap any to see the checklist and start it.

End: "Congrats — you're set. Next: [Feature guides] · [FAQ] · [Contact]"

### 4.3 `/help/features` — feature guides hub

Card grid, one per primary feature. Each card: icon, title, one-line description, link.

- **Activity Feed** (`feed`) — "What changed in your plant today, in one stream."
- **Assets** (`assets`) — "Every machine, every QR sticker, every manual."
- **Work Orders** (`workorders`) — "Track repairs from request to closeout."
- **PM Schedule** (`schedule`) — "Never miss a planned maintenance again."
- **Knowledge Base** (`knowledge`) — "Upload manuals. MIRA reads them so you don't have to."
- **CMMS Integration** (`cmms`) — "Connect MaintainX, Limble, Fiix, or Atlas."
- **MIRA Scan** (`scan`) — "Point your phone at a machine. Get answers."
- **Reports** (`reports`) — "Wrench time, downtime, MTTR — at a glance."
- **Settings** (`settings`) — "Team, billing, integrations, your profile."

Each `/help/features/[slug]` page has the same structure: H1, one-paragraph "What this does," a numbered "How to use it" list (3–6 steps), a "Common questions" mini-FAQ (2–4 Q&A), and a "Related" links section.

### 4.4 `/help/faq` — Top 10

The 10 questions from Mike's brief, answered in 2–4 sentences each. (Full answers drafted in the implementation, summarized here:)

1. **How does MIRA learn about my equipment?** — Scan or upload manuals. MIRA reads, indexes, and cites them in answers.
2. **Can I use MIRA from my phone?** — Yes. Open `app.factorylm.com` in Safari/Chrome. Tap Share → Add to Home Screen.
3. **How does the Knowledge Cooperative work?** — Anonymized fixes from one plant teach MIRA's shared brain. You opt in. Your raw data stays yours.
4. **What CMMS systems does FactoryLM integrate with?** — Atlas (built-in), MaintainX, Limble, Fiix.
5. **How do I export my data?** — Settings → Export. ZIP of all your assets, work orders, and chat history.
6. **Is my data secure?** — TLS in transit, encrypted at rest, SSO supported. We never train shared models on your raw text.
7. **What happens if MIRA doesn't know the answer?** — MIRA says so. It won't make things up. You can mark the answer as wrong, and we improve.
8. **How do I add team members?** — Team → Invite. They get an email link.
9. **What's included in each pricing tier?** — Pricing summary + link to `factorylm.com/pricing`.
10. **How do I contact support?** — Email `mike@cranesync.com` or Telegram `@MiraFactorySupport`. We reply within 1 business day.

### 4.5 `/help/shortcuts` — Keyboard shortcuts

Table: shortcut → action. Initial set:
- `g` then `f` → Go to Feed
- `g` then `a` → Go to Assets
- `g` then `w` → Go to Work Orders
- `g` then `s` → Go to Schedule
- `?` → Open this page
- `Esc` → Close any modal

(All listed. Wiring the global `?` handler is a follow-up — the page documents the intent now.)

### 4.6 `/help/contact` — Contact + response times

- **Email:** `mike@cranesync.com` — replies within 1 business day
- **Telegram:** `@MiraFactorySupport` — replies same day during US business hours
- **Status page:** `status.factorylm.com` (placeholder until built)
- **Bug report:** GitHub issue link
- **Sales / pricing:** `mike@cranesync.com`

### 4.7 GitHub repo files

- **`README.md`** — already strong (audit shows it has the value prop, customer/dev split, quick-start, license). Add `CONTRIBUTING`, `SECURITY`, `SUPPORT` to the navigation block. Add a one-line "Help / docs" pointer to `docs/README.md`.
- **`CONTRIBUTING.md`** — fork → branch (`feat/`, `fix/`, `chore/`) → conventional commit format (`feat(scope):`) → spec-first rule (write spec under `docs/specs/` before code) → run tests (`pytest`, `bun test`) → open PR → review checklist. Link to `.claude/rules/python-standards.md` and `.claude/rules/security-boundaries.md`.
- **`SECURITY.md`** — supported versions (latest only), how to report (`mike@cranesync.com`), what to expect (acknowledgment within 48 hours, fix or status update within 7 days), public disclosure policy (after fix shipped).
- **`SUPPORT.md`** — three-tier: in-app help → GitHub Discussions → email. GitHub Issues are for **bugs and feature requests only**, not "how do I…" questions.
- **`docs/README.md`** — hand-curated index. Specs · ADRs · Runbooks · Product docs · Developer docs · Reference. One line per pointer.

---

## 5. Acceptance criteria

A. **Spec exists at this path** — yes (this file).
B. **In-app help reachable** — `bun run dev` in `mira-hub/`, log in, click "Help" in sidebar → `/help` renders the index. Mobile drawer also has a Help link.
C. **All 7 in-app routes return 200** — verified via curl or Playwright on a running dev server.
D. **Mobile responsive** — at 412×915 viewport, no horizontal scroll, touch targets ≥44px.
E. **Dark mode** — every page renders with both `data-theme="light"` and `data-theme="dark"`.
F. **GitHub files exist** — `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, `docs/README.md` all present at repo root.
G. **README cross-links land** — every link in the README resolves to an existing file.
H. **i18n key added** — `nav.help` in all four locales (`en`, `es`, `hi`, `zh`).
I. **Type check passes** — `cd mira-hub && bun run typecheck` (or whatever the project uses) returns 0.
J. **Voice tone passes a sniff test** — random sample of 3 help paragraphs reads at Grade 6–8 (manual check; no automated tool).
K. **No external content host** — all help content lives in the repo. No CMS, no Notion embed, no `process.env.HELP_*` vars.

---

## 6. Out of scope (explicitly)

- Search across help articles (defer to v2 with Cmd-K palette)
- "Was this helpful?" → backend logging (UI shipped, click logs to console)
- Cmd-K global command palette (separate spec)
- Help-content i18n (English only in v1 — UI chrome stays i18n'd)
- Auto-generated screenshots / video tours (Loom links can be added later)
- Status page (`status.factorylm.com`) — referenced but not built
- Wiring the global `?` keyboard shortcut (page documents the intent; wiring is a follow-up)

---

## 7. File-level changes

**New files:**
```
mira-hub/src/app/(hub)/help/page.tsx                         # index
mira-hub/src/app/(hub)/help/getting-started/page.tsx
mira-hub/src/app/(hub)/help/features/page.tsx
mira-hub/src/app/(hub)/help/features/[slug]/page.tsx
mira-hub/src/app/(hub)/help/faq/page.tsx
mira-hub/src/app/(hub)/help/shortcuts/page.tsx
mira-hub/src/app/(hub)/help/contact/page.tsx
mira-hub/src/app/(hub)/help/_components/HelpCard.tsx
mira-hub/src/app/(hub)/help/_components/HelpHeader.tsx
mira-hub/src/app/(hub)/help/_components/Feedback.tsx         # client island
mira-hub/src/app/(hub)/help/_content/getting-started.ts
mira-hub/src/app/(hub)/help/_content/features.ts
mira-hub/src/app/(hub)/help/_content/faq.ts
mira-hub/src/app/(hub)/help/_content/shortcuts.ts
mira-hub/src/app/(hub)/help/_content/contact.ts
CONTRIBUTING.md
SECURITY.md
SUPPORT.md
docs/README.md
```

**Edited files:**
```
mira-hub/src/providers/access-control.ts                     # +1 NAV_ITEMS entry
mira-hub/src/messages/en.json                                # +nav.help
mira-hub/src/messages/es.json                                # +nav.help
mira-hub/src/messages/hi.json                                # +nav.help
mira-hub/src/messages/zh.json                                # +nav.help
mira-hub/src/components/layout/sidebar.tsx                   # +HelpCircle in ICON_MAP if missing
mira-hub/src/components/layout/mobile-drawer.tsx             # +help item
mira-hub/src/app/(hub)/more/page.tsx                         # +help item
README.md                                                    # +CONTRIBUTING / SECURITY / SUPPORT pointers
```

**No changes to:**
- Backend (no API additions)
- Database schema
- Docker/infra
- Existing `docs/product/` and `docs/developer/` content (in-app pages link out to them where appropriate)

---

## 8. Rollout

1. **Spec review** — Mike reads this file, signs off or requests changes.
2. **Branch** — currently on `claude/beautiful-burnell-6946d9`.
3. **Build** — implement per Section 7 in one commit per logical group:
   - `docs(spec): help documentation spec`
   - `feat(mira-hub): in-app help section`
   - `feat(mira-hub): wire Help into sidebar/drawer/more/i18n`
   - `docs(repo): CONTRIBUTING, SECURITY, SUPPORT, docs index`
   - `docs(readme): link to new community docs`
4. **Verify acceptance criteria** Section 5 A–K.
5. **Push branch + open PR**.
6. **After merge** — manual smoke test on `app.factorylm.com/help` after deploy.

---

## 9. Open questions for Mike

1. **Telegram support handle** — is `@MiraFactorySupport` correct, or should I use a different one?
2. **Support email** — `mike@cranesync.com` (from README) — confirm or swap.
3. **Voice on the FAQ "Is my data secure?" answer** — happy with the brief version above, or want it punchier / more legalese-free?
4. **GitHub Discussions** — is that on for the repo? `SUPPORT.md` will route how-to questions there if so; otherwise it'll route to email.

These don't block implementation — I'll use the answers I have, and the file-level changes leave easy edit points.
