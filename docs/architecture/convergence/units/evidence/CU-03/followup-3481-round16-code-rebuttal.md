# #3481 round P (code group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round16-gate7-code.md` — head `dbd377e987c8cd914dd4172b27f35aaa6fc0f070`,
scope `mira-crawler/ tests/ .github/ tools/` (rounds C and E settled), **97,829/97,829** chars,
sha256 `f5061cee9d1df0848caef4dee228acbd7818968e345dca7cb4f9268ab42565e5` (valid shape on attempt 2;
attempt 1 preserved as malformed). Every quotation below is a line of that diff.

## F1 — "Private URLs are logged in clear text" (high)

The finding's own quotation shows this is a **reformat of a pre-existing line**, not new logging:

```diff
-            "Refusing knowledge_entries write for %s — %s", (source_url or "<no url>")[:100], prov_reason
+            "Refusing knowledge_entries write for %s — %s",
+            (source_url or "<no url>")[:100],
+            prov_reason,
```

The message existed at `fc00074c6` (the merged #3268 head) with identical content; this PR changed
its line-wrapping only. Operator logs are not a tenant-visible surface, so "leak to other tenants"
does not describe any path in the system; and a refused write logs the URL precisely so the
operator can see *what* was refused and why. Out of this PR's scope, and not a defect it introduced.

## F2 — "Conflict handling never upgrades a row to a more-private state" (high)

Correct description; wrong conclusion. The conflict key **includes `tenant_id`** —

```diff
+        assert _canon(cols).split(",")[0] == "tenant_id"
```

— so a collision is one tenant colliding with its own row. The shared OEM corpus is owned by the
system tenant as public rows (`.claude/rules/knowledge-entries-tenant-scoping.md`). "Upgrade to
private on conflict" would therefore let any private re-ingest of a shared manual, under the system
tenant, **hide that manual from every tenant** — a shared-corpus outage, not a privacy gain. The lock
in this PR states the contract and both leak shapes it forbids:

```diff
+    def test_conflict_action_never_writes_the_colliding_row(self, captured):
```
```diff
+        assert action == "NOTHING"
```

A misclassified public row is corrected at the provenance policy and by re-ingest through the
boundary, never by conflict semantics — which must neither widen nor silently narrow visibility.

## F3 — "`ingested_source_urls` aborts on empty or malformed tenant IDs" (medium)

That is the fix, and the consequence the finding fears cannot occur. Items reported "not ingested"
stay **pending** in the ledger (the retryable direction); a re-attempted insert of an existing chunk
hits the exact-key `ON CONFLICT … DO NOTHING` guard (F2 above), so no duplicate row is possible:

```diff
+        logger.warning("ingested_source_urls called without a tenant_id — refusing the probe")
```
```diff
+    def test_ledger_probe_refuses_to_run_without_a_tenant(self, captured):
```

"Callers that relied on an empty tenant to probe cross-tenant" describes the defect this PR closed
(round M, real): a probe across every tenant's rows.

## F4 — "Missing-dependency handling for PyYAML is not truly lazy" (medium)

The premise — `provenance.py` imports `yaml` at module level — is false: the import is inside
`load_policy` (that file is unchanged by this PR, which is why it is not in the diff). The test
forces exactly that path by clearing the cached policy before patching the import, and asserts the
refusal that the finding says would not happen:

```diff
+        monkeypatch.setattr(provenance, "_POLICY", None)
+        monkeypatch.setitem(sys.modules, "yaml", None)  # `import yaml` → ImportError
```
```diff
+        assert ok is False and "fail closed" in reason, (ok, reason)
```

*Outside the diff, for the human reader:* measured on Python 3.12.3 and 3.14.2, the patched
`import yaml` raises `ModuleNotFoundError: import of yaml halted; None in sys.modules`.

## F5 — "Default exclusion of evidence artifacts may hide crucial context" (low)

By design and documented in both contracts: the excluded files are the raw outputs of *earlier
reviewers*, whose text was being reported back as the PR's claims; every excluded path is named in
the receipts and `--include-evidence` restores them when their contents are the subject:

```diff
+        "--include-evidence",
```
