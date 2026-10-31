"""Outside-in UX acceptance detectors.

Pure functions over a serialized screen snapshot. No DOM, no browser, no
framework — so the same detector decides a Playwright lab run and a CDP run
against the Android WebView, and neither surface can drift into its own
definition of a defect.

See docs/prd/2026-09-07-factorylm-ui-ux-v1.md and docs/specs/chatgpt-class-ux-acceptance.md.
"""
