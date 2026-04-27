# Changelog

All notable changes to mira-hub. Format follows the project's Versioning Discipline rule: one line per release, namespaced semver tag at merge.

## [1.4.0] - 2026-04-26
- Upload-pipeline hardening sweep — tenant_id filter on updateUploadStatus (#707), structured JSON logs + X-Request-Id propagation (#709), path-traversal sanitization on asset_tag (#726), magic-byte file sniffing on PDF/image uploads (#729), AbortSignal/timeout on every outbound fetch (#730), SSRF guard + manual-redirect re-validation on streamFromSignedUrl (#731), cloud-source upload idempotency (#733), manual retry endpoint POST /api/uploads/:id/retry (#734).

> **Note on prior v1.4.0 attempt:** A `mira-hub/v1.4.0` tag briefly existed pointing at orphan commit `a2ceac7` (an attempted release of the UX audit + Playwright suite work that was prepared on a branch never merged to `main`). The underlying UX-audit and mobile-upload feature work itself did land via PR #715 and others, but the release-prep commit and its tag were stranded. The orphan tag was deleted on 2026-04-26 and v1.4.0 reused for today's upload-pipeline hardening sweep.

## [1.3.0] - 2026-04-25
- Photos upload — JPEG/PNG/WebP/HEIC + multi-select + asset linking (#546)

## [1.2.0] - 2026-04-25
- Knowledge upload picker — Google Picker + Dropbox Chooser + local file picker (#540)

## [1.1.0] - 2026-04-24
- First tagged release. NeonDB-backed API (6 routes), Playwright e2e suite (76/76), i18n (EN/ES/HI/ZH), design system + login/feed pages.
