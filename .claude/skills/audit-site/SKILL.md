# Audit Site
Run a Playwright crawl across all routes (desktop + mobile viewports), consolidate findings, then:
1. File issues to GitHub with `gh issue create`
2. Mirror to Linear with cross-links in both directions
3. Commit the audit report to docs/audits/YYYY-MM-DD.md
Use chrome-headless-shell if default Playwright times out (Windows).
