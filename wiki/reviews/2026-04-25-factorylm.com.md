# Web Review — factorylm.com — 2026-04-25

## Summary

- Total findings: **12**
- 🔴 P0: 1
- 🟠 P1: 1
- 🟡 P2: 7
- 🟢 P3: 3
- Sources: headers=6, lighthouse=5, edges=1

## Findings (most obvious first)

| # | Sev | Route | Title | Source | Evidence |
|---|---|---|---|---|---|
| 1 | 🔴 P0 | `/` | Missing HSTS over HTTPS | headers | curl -I https://factorylm.com returned headers without `strict-transport-security` |
| 2 | 🟠 P1 | `/` | Missing Content-Security-Policy | headers | curl -I https://factorylm.com returned headers without `content-security-policy` |
| 3 | 🟡 P2 | `/` | Missing X-Content-Type-Options: nosniff | headers | curl -I https://factorylm.com returned headers without `x-content-type-options` |
| 4 | 🟡 P2 | `/` | Missing X-Frame-Options (or frame-ancestors in CSP) | headers | curl -I https://factorylm.com returned headers without `x-frame-options` |
| 5 | 🟡 P2 | `/` | Lighthouse audit failed: Background and foreground colors do not have a sufficient contrast ratio. | lighthouse | Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](ht |
| 6 | 🟡 P2 | `/blog` | Lighthouse audit failed: Background and foreground colors do not have a sufficient contrast ratio. | lighthouse | Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](ht |
| 7 | 🟡 P2 | `/cmms` | Lighthouse audit failed: Background and foreground colors do not have a sufficient contrast ratio. | lighthouse | Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](ht |
| 8 | 🟡 P2 | `/blog/how-to-read-vfd-fault-codes` | Lighthouse audit failed: Background and foreground colors do not have a sufficient contrast ratio. | lighthouse | Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](ht |
| 9 | 🟡 P2 | `/blog/fault-codes` | Lighthouse audit failed: Background and foreground colors do not have a sufficient contrast ratio. | lighthouse | Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](ht |
| 10 | 🟢 P3 | `/` | Missing Referrer-Policy | headers | curl -I https://factorylm.com returned headers without `referrer-policy` |
| 11 | 🟢 P3 | `/` | Missing Permissions-Policy | headers | curl -I https://factorylm.com returned headers without `permissions-policy` |
| 12 | 🟢 P3 | `/__webreview_404_1777139121` | 404 page has no home link | edges | No href='/'-shaped link in body |

## Detail

### 1. [P0] / — Missing HSTS over HTTPS

- **Fingerprint:** `P0:/:missing-header-strict-transport-security`
- **Source:** `headers`
- **Occurrences this run:** 1

**Evidence:**

```
curl -I https://factorylm.com returned headers without `strict-transport-security`
```

**Suggested fix:** Add `strict-transport-security` header at the edge (nginx/CDN/Vercel config)

### 2. [P1] / — Missing Content-Security-Policy

- **Fingerprint:** `P1:/:missing-header-content-security-policy`
- **Source:** `headers`
- **Occurrences this run:** 1

**Evidence:**

```
curl -I https://factorylm.com returned headers without `content-security-policy`
```

**Suggested fix:** Add `content-security-policy` header at the edge (nginx/CDN/Vercel config)

### 3. [P2] / — Missing X-Content-Type-Options: nosniff

- **Fingerprint:** `P2:/:missing-header-x-content-type-options`
- **Source:** `headers`
- **Occurrences this run:** 1

**Evidence:**

```
curl -I https://factorylm.com returned headers without `x-content-type-options`
```

**Suggested fix:** Add `x-content-type-options` header at the edge (nginx/CDN/Vercel config)

### 4. [P2] / — Missing X-Frame-Options (or frame-ancestors in CSP)

- **Fingerprint:** `P2:/:missing-header-x-frame-options`
- **Source:** `headers`
- **Occurrences this run:** 1

**Evidence:**

```
curl -I https://factorylm.com returned headers without `x-frame-options`
```

**Suggested fix:** Add `x-frame-options` header at the edge (nginx/CDN/Vercel config)

### 5. [P2] / — Lighthouse audit failed: Background and foreground colors do not have a sufficient contrast ratio.

- **Fingerprint:** `P2:/:lighthouse-audit-color-contrast`
- **Source:** `lighthouse`
- **Occurrences this run:** 1

**Evidence:**

```
Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](https://dequeuniversity.com/rules/axe/4.10/color-contrast).
```

### 6. [P2] /blog — Lighthouse audit failed: Background and foreground colors do not have a sufficient contrast ratio.

- **Fingerprint:** `P2:/blog:lighthouse-audit-color-contrast`
- **Source:** `lighthouse`
- **Occurrences this run:** 1

**Evidence:**

```
Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](https://dequeuniversity.com/rules/axe/4.10/color-contrast).
```

### 7. [P2] /cmms — Lighthouse audit failed: Background and foreground colors do not have a sufficient contrast ratio.

- **Fingerprint:** `P2:/cmms:lighthouse-audit-color-contrast`
- **Source:** `lighthouse`
- **Occurrences this run:** 1

**Evidence:**

```
Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](https://dequeuniversity.com/rules/axe/4.10/color-contrast).
```

### 8. [P2] /blog/how-to-read-vfd-fault-codes — Lighthouse audit failed: Background and foreground colors do not have a sufficient contrast ratio.

- **Fingerprint:** `P2:/blog/how-to-read-vfd-fault-codes:lighthouse-audit-color-contrast`
- **Source:** `lighthouse`
- **Occurrences this run:** 1

**Evidence:**

```
Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](https://dequeuniversity.com/rules/axe/4.10/color-contrast).
```

### 9. [P2] /blog/fault-codes — Lighthouse audit failed: Background and foreground colors do not have a sufficient contrast ratio.

- **Fingerprint:** `P2:/blog/fault-codes:lighthouse-audit-color-contrast`
- **Source:** `lighthouse`
- **Occurrences this run:** 1

**Evidence:**

```
Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](https://dequeuniversity.com/rules/axe/4.10/color-contrast).
```

### 10. [P3] / — Missing Referrer-Policy

- **Fingerprint:** `P3:/:missing-header-referrer-policy`
- **Source:** `headers`
- **Occurrences this run:** 1

**Evidence:**

```
curl -I https://factorylm.com returned headers without `referrer-policy`
```

**Suggested fix:** Add `referrer-policy` header at the edge (nginx/CDN/Vercel config)

### 11. [P3] / — Missing Permissions-Policy

- **Fingerprint:** `P3:/:missing-header-permissions-policy`
- **Source:** `headers`
- **Occurrences this run:** 1

**Evidence:**

```
curl -I https://factorylm.com returned headers without `permissions-policy`
```

**Suggested fix:** Add `permissions-policy` header at the edge (nginx/CDN/Vercel config)

### 12. [P3] /__webreview_404_1777139121 — 404 page has no home link

- **Fingerprint:** `P3:/__webreview_404_1777139121:404-no-home-link`
- **Source:** `edges`
- **Occurrences this run:** 1

**Evidence:**

```
No href='/'-shaped link in body
```

**Suggested fix:** Add 'Back to home' link

---

_Generated by the `web-review` skill._
