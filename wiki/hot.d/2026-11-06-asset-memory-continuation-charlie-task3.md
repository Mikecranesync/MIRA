# Asset Memory continuation — requested fixes and authenticated proof

Mike explicitly resumed draft #5241 from152f6d39a, asking to fix #5242/#5243/#5244,
review the new changes and execute an authenticated journey. The old reviewed
snapshot is preserved by rollback/asset-memory-5241-152f6d39; no old approval is
reused. Product fixes are3fd4d1b6ac628342e72ec25a6456d03c4353a9d8.

Imported reports now enter the bounded chat/Guide projection without inheriting
current execution. Closeout uses one clone and existing edit semantics; the
accepted6.3MB/420-target fixture measured2,081ms/420 serializations before and
6.2ms/1 afterward. `/hub` and root links match the existing API client.

Fresh locked-dependency full Hub run13,138 PASS/53 existing SKIP, focused37 PASS,
unchanged159-line typecheck baseline, scoped lint/sitemap/build pass. Only this
task's dependency symlink was replaced with npm ci; peer files unchanged.

[Actual proof](../../docs/proofs/asset-memory-5241-continuation/verification.md):
normal synthetic QA password authentication, real staging DB, candidate on
loopback, actual desktop/mobile UI and clicked source link,401 anonymous/404
other-tenant controls, stable session and exact record across process restart.
Manual job reopen passes; automatic selected-job resume is false.

End-to-end acceptance remains BLOCKED: PUMP-01 has0 components/manuals, this
viewer has0 saved chat turns, the legacy job has no imported guide, and no Hub
work-order row maps to Atlas1652. No missing source or provider URL was invented.
The user was asked for a suitable existing approved non-production case while
independent verification continued. No paid-provider call, schema migration,
source-data write, merge, shared deployment or production change.
