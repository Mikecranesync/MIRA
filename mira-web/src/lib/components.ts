/* FactoryLM × MIRA render helpers — pure string → string, no side effects. */

// ─── #SO-302 Buttons ─────────────────────────────────────────────────────────

interface BtnOpts {
  onclick?: string;
  type?: "button" | "submit" | "reset";
  ariaLabel?: string;
  disabled?: boolean;
  href?: string;
}

export function btnPrimary(label: string, opts: BtnOpts = {}): string {
  const type = opts.type ?? "button";
  const aria = opts.ariaLabel ? ` aria-label="${opts.ariaLabel}"` : "";
  const disabled = opts.disabled ? " disabled" : "";
  const click = opts.onclick ? ` onclick="${opts.onclick}"` : "";
  if (opts.href) {
    return `<a href="${opts.href}" class="fl-btn fl-btn-primary"${aria}>${label}</a>`;
  }
  return `<button type="${type}" class="fl-btn fl-btn-primary"${aria}${disabled}${click}>${label}</button>`;
}

export function btnGhost(label: string, opts: BtnOpts = {}): string {
  const type = opts.type ?? "button";
  const aria = opts.ariaLabel ? ` aria-label="${opts.ariaLabel}"` : "";
  const disabled = opts.disabled ? " disabled" : "";
  const click = opts.onclick ? ` onclick="${opts.onclick}"` : "";
  if (opts.href) {
    return `<a href="${opts.href}" class="fl-btn fl-btn-ghost"${aria}>${label}</a>`;
  }
  return `<button type="${type}" class="fl-btn fl-btn-ghost"${aria}${disabled}${click}>${label}</button>`;
}

export function btnMic(opts: BtnOpts = {}): string {
  const type = opts.type ?? "button";
  const aria = opts.ariaLabel ?? "Voice input";
  const click = opts.onclick ? ` onclick="${opts.onclick}"` : "";
  return `<button type="${type}" class="fl-btn fl-btn-mic" aria-label="${aria}"${click}>🎙️</button>`;
}

// ─── #SO-303 State Pill ───────────────────────────────────────────────────────

type StateVariant = "indexed" | "partial" | "failed" | "superseded";

const STATE_DEFAULT_LABELS: Record<StateVariant, string> = {
  indexed: "Indexed",
  partial: "Partial · Tap to rescan",
  failed: "OCR failed · Tap to retry",
  superseded: "Superseded",
};

export function stateBadge(state: StateVariant, label?: string): string {
  const text = label ?? STATE_DEFAULT_LABELS[state];
  const role = state === "failed" || state === "partial" ? ' role="status"' : "";
  return `<span class="fl-state fl-state-${state}"${role}><span class="fl-state-glyph"></span>${text}</span>`;
}

// ─── #SO-304 Trust Band ───────────────────────────────────────────────────────

export function trustBand(eyebrow: string, items: string[]): string {
  if (items.length === 0) return "";
  const lis = items.map((i) => `<li>${i}</li>`).join("\n      ");
  return `<section class="fl-trust-band">
  <p class="fl-trust-eyebrow">${eyebrow}</p>
  <ul class="fl-trust-list">
    ${lis}
  </ul>
</section>`;
}

// ─── #SO-306 Stop Card ────────────────────────────────────────────────────────

interface StopCta {
  label: string;
  href?: string;
  onclick?: string;
}

export function stopCard(headline: string, body: string, ctas: StopCta[]): string {
  const safeHeadline = headline.startsWith("⚠ STOP — ") ? headline : `⚠ STOP — ${headline}`;
  const ctaHtml = ctas
    .map((c) => {
      if (c.href) {
        return `<a href="${c.href}" class="fl-stop-btn">${c.label}</a>`;
      }
      const click = c.onclick ? ` onclick="${c.onclick}"` : "";
      return `<button type="button" class="fl-stop-btn"${click}>${c.label}</button>`;
    })
    .join("\n    ");
  return `<div class="fl-stop-card" role="alert">
  <h4>${safeHeadline}</h4>
  <p>${body}</p>
  <div class="fl-stop-cta">
    ${ctaHtml}
  </div>
</div>`;
}

// ─── #SO-305 Compare Block ────────────────────────────────────────────────────

export function compareBlock(
  question: string,
  badLabel: string,
  badQuote: string,
  badNote: string,
  goodLabel: string,
  goodQuote: string,
  goodCitations: string[] = []
): string {
  const citationsHtml =
    goodCitations.length > 0
      ? `<div class="fl-col-citations">${goodCitations.map((c) => `<span class="fl-cite-chip">${c}</span>`).join("")}</div>`
      : "";
  return `<div class="fl-compare">
  <p class="fl-compare-q">"${question}"</p>
  <div class="fl-compare-grid">
    <div class="fl-col fl-col-bad">
      <h3 class="fl-col-h-bad">${badLabel}</h3>
      <blockquote>${badQuote}</blockquote>
      <p class="fl-col-note">${badNote}</p>
    </div>
    <div class="fl-col fl-col-good">
      <h3 class="fl-col-h-good">${goodLabel}</h3>
      <blockquote>${goodQuote}</blockquote>
      ${citationsHtml}
    </div>
  </div>
</div>`;
}

// ─── #SO-308 Limits List ──────────────────────────────────────────────────────

interface LimitItem {
  headline: string;
  body: string;
}

export function limitsList(intro: string, items: LimitItem[]): string {
  if (items.length === 0) {
    return `<section class="fl-limits">
  <p class="fl-limits-intro">${intro}</p>
  <p class="fl-muted">Nothing to disclose. Yet.</p>
</section>`;
  }
  const lis = items
    .map((i) => `<li><strong>${i.headline}</strong> ${i.body}</li>`)
    .join("\n    ");
  return `<section class="fl-limits">
  <p class="fl-limits-intro">${intro}</p>
  <ul class="fl-limits-list">
    ${lis}
  </ul>
</section>`;
}

// ─── #SO-307 Price Card ───────────────────────────────────────────────────────

type PriceVariant = "free" | "recommended" | "premium";

interface PriceCardOpts {
  name: string;
  pitch: string;
  amount: string | "Free";
  period?: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  fineprint?: string;
  variant: PriceVariant;
}

export function priceCard(opts: PriceCardOpts): string {
  const ribbon =
    opts.variant === "recommended"
      ? `<div class="fl-price-ribbon">Most popular</div>`
      : "";
  const amountHtml =
    opts.amount === "Free"
      ? `<div class="fl-price-amount"><span class="fl-price-num">Free</span></div>`
      : `<div class="fl-price-amount" aria-label="${opts.name}, ${opts.amount} dollars${opts.period ? ` ${opts.period}` : ""}">
      <span class="fl-price-currency">$</span>
      <span class="fl-price-num">${opts.amount}</span>
      ${opts.period ? `<span class="fl-price-period">${opts.period}</span>` : ""}
    </div>`;
  const cta =
    opts.variant === "free"
      ? btnGhost(opts.ctaLabel, { href: opts.ctaHref })
      : btnPrimary(opts.ctaLabel, { href: opts.ctaHref });
  const fineprint = opts.fineprint
    ? `<p class="fl-price-fineprint">${opts.fineprint}</p>`
    : "";
  const features = opts.features
    .map((f) => `<li>${f}</li>`)
    .join("\n      ");
  return `<article class="fl-price-card fl-price-card-${opts.variant}" aria-label="${opts.name}">
  ${ribbon}
  <header>
    <h3 class="fl-price-name">${opts.name}</h3>
    <p class="fl-price-pitch">${opts.pitch}</p>
  </header>
  ${amountHtml}
  <ul class="fl-price-features">
    ${features}
  </ul>
  ${cta}
  ${fineprint}
</article>`;
}

export function priceRow(cards: string[]): string {
  return `<div class="fl-price-row">${cards.join("")}</div>`;
}
