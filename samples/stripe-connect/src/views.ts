// =============================================================================
// src/views.ts — server-rendered HTML. No frontend framework, just template
// strings, so the focus stays on the Stripe API flow. Styling mirrors
// mira-web's warm-dark / amber theme.
// =============================================================================

/** Tiny HTML-escape so user-supplied strings can't break the markup / inject. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format an integer amount of the smallest currency unit (cents) as e.g. $12.34. */
export function formatMoney(amountMinor: number | null | undefined, currency = 'usd'): string {
  if (amountMinor == null) return '—';
  const major = amountMinor / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(major);
}

/** Shared page shell: dark theme, basic responsive layout. */
export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} · Stripe Connect Sample</title>
  <style>
    :root {
      --bg: #0a0a08; --panel: #141410; --panel-2: #1e1e1b; --border: #2a2a24;
      --text: #e4e0d8; --muted: #b0aca2; --accent: #f5a623; --accent-2: #f0a000;
      --ok: #2d7d2d; --warn: #f5c542; --err: #ff5d5d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--bg); color: var(--text);
      font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    a { color: var(--accent); }
    .wrap { max-width: 880px; margin: 0 auto; padding: 28px 20px 80px; }
    header.top { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    header.top .brand { font-weight: 700; letter-spacing: .3px; }
    header.top .brand span { color: var(--accent); }
    header.top nav { margin-left: auto; display: flex; gap: 16px; font-size: 14px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 17px; margin: 28px 0 10px; }
    p.sub { color: var(--muted); margin-top: 0; }
    .card {
      background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
      padding: 18px 18px; margin: 14px 0;
    }
    .row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .grow { flex: 1; min-width: 0; }
    label { display: block; font-size: 13px; color: var(--muted); margin: 10px 0 4px; }
    input, textarea, select {
      width: 100%; background: var(--panel-2); border: 1px solid var(--border);
      color: var(--text); border-radius: 8px; padding: 10px 12px; font-size: 14px;
    }
    button, .btn {
      display: inline-block; cursor: pointer; border: none; border-radius: 8px;
      padding: 10px 16px; font-size: 14px; font-weight: 600; text-decoration: none;
      background: var(--accent); color: #1a1a14;
    }
    button:hover, .btn:hover { background: var(--accent-2); }
    .btn.secondary { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); }
    .btn.secondary:hover { background: var(--border); }
    .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .pill.ok { background: rgba(45,125,45,.2); color: #7ed47e; }
    .pill.warn { background: rgba(245,197,66,.18); color: var(--warn); }
    .pill.err { background: rgba(255,93,93,.18); color: var(--err); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: var(--muted); }
    .muted { color: var(--muted); }
    .empty { color: var(--muted); font-style: italic; padding: 10px 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); font-size: 14px; }
    th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; }
    .banner { border-radius: 10px; padding: 12px 14px; margin: 14px 0; font-size: 14px; }
    .banner.ok { background: rgba(45,125,45,.16); border: 1px solid rgba(45,125,45,.4); }
    .banner.warn { background: rgba(245,197,66,.12); border: 1px solid rgba(245,197,66,.4); }
    .banner.err { background: rgba(255,93,93,.12); border: 1px solid rgba(255,93,93,.4); }
    @media (max-width: 560px) { .wrap { padding: 18px 14px 60px; } }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <div class="brand">Stripe <span>Connect</span> Sample</div>
      <nav>
        <a href="/">Dashboard</a>
      </nav>
    </header>
    ${body}
  </div>
</body>
</html>`;
}
