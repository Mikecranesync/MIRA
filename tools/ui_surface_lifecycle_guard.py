#!/usr/bin/env python3
"""FactoryLM Unified UI Cutover — legacy presentation lifecycle guard.

FACTORYLM-UNIFIED-UI-CUTOVER-001. Charter:
docs/architecture/convergence/UNIFIED_UI_CUTOVER.md §3 "Legacy exception
policy" + §3.1 "Trusted enforcement boundary". Governance plan:
docs/superpowers/plans/2026-09-06-factorylm-unified-ui-cutover-governance.md
Task 2.

Fails closed by default on ANY addition, modification, deletion, rename-in,
or rename-out of a guarded legacy presentation path (from
docs/architecture/convergence/REGISTRY.yaml) or a hardcoded CONTROL_PATTERNS
control-plane file — unless the PR carries the `legacy-ui-exception` label, a
single substantive `## Legacy UI exception` PR-body section (Reason /
Canonical replacement impact / Rollback), and a fresh user label event bound
to the current PR head/body snapshot.

This module does no network access and reads no GitHub token — it is pure
policy + text analysis, designed to run from the TRUSTED BASE revision of the
repository (see `.github/workflows/ui-lifecycle-guard.yml`), fed only
metadata (changed files plus one current PR snapshot containing labels, body,
and head) fetched by a separate token-bearing step. See CLI `main()` at the
bottom.

    python3 tools/ui_surface_lifecycle_guard.py --base <sha> --head <sha>
    python3 tools/ui_surface_lifecycle_guard.py \\
        --changes-json-file changed-files.jsonl \\
        --expected-change-count-file expected-change-count.txt \\
        --labels-file labels.txt \\
        --pr-body-file pr-body.md \\
        --event-json-file "$GITHUB_EVENT_PATH" \\
        --current-pull-json-file current-pull.json \\
        --approver-permission-json-file approver-permission.json
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

import yaml
from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REGISTRY_REL = "docs/architecture/convergence/REGISTRY.yaml"

# ---------------------------------------------------------------------------
# CONTROL_PATTERNS — code-owned trusted-base policy.
#
# These paths are guarded UNCONDITIONALLY, regardless of what the registry
# file (loaded from the base revision) says. A PR that edits its own guard
# implementation, its tests and transitive pytest/import inputs, the registry,
# the charter, the focused Claude rule, the three UI workflow files, or any
# GitHub workflow is a self-protection case — it must go through the same audited
# exception as any guarded legacy path, so the enforcement layer can never be
# quietly loosened in the same PR that would benefit from the loosening.
# ---------------------------------------------------------------------------
CONTROL_PATTERNS: tuple[str, ...] = (
    "conftest.py",
    "docs/architecture/convergence/REGISTRY.yaml",
    "docs/architecture/convergence/UNIFIED_UI_CUTOVER.md",
    "pyproject.toml",
    "pytest.ini",
    "pip.py",
    "pip/**",
    "setup.cfg",
    "sitecustomize.py",
    "tests/conftest.py",
    "tools/ui_surface_lifecycle_guard.py",
    "tools/markdown_it.py",
    "tools/yaml.py",
    "tox.ini",
    "usercustomize.py",
    "tests/test_ui_surface_lifecycle_guard.py",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".claude/rules/factorylm-unified-ui-cutover.md",
    ".claude/workflows/flm-ui-map.js",
    ".claude/workflows/flm-ui-slice.js",
    ".claude/workflows/flm-ui-verify.js",
    ".github/workflows/**",
    ".github/scripts/resolve_release_tag.sh",
    ".github/pull_request_template.md",
    "requirements/ui-lifecycle-guard.txt",
    "tools/hooks/prod-guard.sh",
    "tools/ota_handset_evidence.py",
)

# ---------------------------------------------------------------------------
# Code-owned presentation classifiers (charter §2.2 addendum).
#
# Registry globs document the broad legacy roots. These classifiers apply
# first and carry the executable exclusions for preserved capability seams.
# That order is essential: a broad `src/**` registry glob closes sibling-UI
# bypasses, while this trusted-base code keeps API/transport/domain paths
# available for the canonical adapters to reuse.
#
# Public trees are blanket guarded. Images, fonts, PDFs, and manifests all
# change the shipped legacy experience; "non-executable" never meant
# "non-presentational". New canonical assets belong in the shared packages or
# a bounded `src/factorylm-ui/**` adapter, not in an old public tree.
# ---------------------------------------------------------------------------
PUBLIC_STATIC_GUARDED_ROOTS: tuple[str, ...] = (
    "mira-web/public/",
    "mira-hub/public/",
)

# Production build, mount, native-wrapper, and release controls sit outside
# `src/**` but can still select or replace the customer-visible entry point.
# Direct files at each historical module root therefore fail closed unless they
# are known documentation, review evidence, or test-only configuration. The
# rule is intentionally future-safe: an arbitrary new `alternate-entry.ts` at
# a module root is guarded without first extending an allowlist.
LEGACY_SURFACE_CONTROL_ROOTS: tuple[str, ...] = (
    "docs/preview/",
    "deployment/ota-download/",
    "mira-web/emails/",
    "mira-mobile/android/",
    "mira-mobile/ios/",
    "mira-mobile/public/",
    "preview/",
    "well-known/",
)

LEGACY_SURFACE_MODULE_ROOTS: tuple[str, ...] = (
    "mira-web/",
    "mira-hub/",
    "mira-mobile/",
)

LEGACY_SURFACE_EXACT_CONTROL_PATHS: frozenset[str] = frozenset(
    {
        # Selects, verifies, builds, and packages the signed web artifact
        # shipped over the air. Every script executed in the production OTA
        # workflow is trusted release control: even a verifier runs before
        # later secret-bearing build and deploy steps in the same workspace.
        "deployment/nginx-app-factorylm.conf",
        "deployment/nginx-factorylm-marketing.conf",
        "deployment/nginx-stg-factorylm.conf",
        "deployment/nginx-updates-factorylm.conf",
        "deployment/well-known/apple-app-site-association",
        "deployment/well-known/assetlinks.json",
        "agent-dashboard.html",
        "compose.yaml",
        "compose.yml",
        "compose.override.yaml",
        "compose.override.yml",
        "docker-compose.hub.yml",
        "docker-compose.yaml",
        "docker-compose.saas.yml",
        "docker-compose.staging-vps.yml",
        "docker-compose.yml",
        "docker-compose.override.yaml",
        "docker-compose.override.yml",
        "mira-mobile/scripts/ota-deploy.mjs",
        "mira-mobile/scripts/ota-guard.mjs",
        "mira-mobile/scripts/native-fingerprint.mjs",
        "mira-mobile/scripts/ota-package.mjs",
        "mira-mobile/scripts/ota-provenance.mjs",
        "mira-mobile/scripts/ota-publish.mjs",
        "mira-mobile/scripts/ota-rollback.mjs",
        # These otherwise capability-shaped wrappers can independently
        # re-enable the legacy chat flag or select a fleet OTA bundle.
        "mira-hub/src/app/api/me/route.ts",
        "mira-hub/src/app/api/mobile/live-update/manifest/route.ts",
        "mira-mobile/src/api/resources.ts",
        "nginx-oracle.conf",
        "nginx-oracle-v2.conf",
        "nginx-phase2-live.conf",
        "oracle-bootstrap.sh",
        "oracle-deploy.sh",
        "scripts/apply-apex-login-redirects.sh",
        # Existing trusted inputs executed with production credentials or on
        # the production host before UI containers are built.
        "scripts/host_perm_setup.sh",
        "scripts/install_crons.sh",
        "tools/migration_drift.py",
        "tools/migration-drift-requirements.txt",
        "tools/predeploy_log_capture.sh",
        "tools/agent-dashboard.html",
    }
)

_ROOT_COMPOSE_CONTROL_RE = re.compile(r"^(?:docker-)?compose[^/]*\.ya?ml$", re.IGNORECASE)

# A new root- or scripts-level shell helper must not be able to move the public
# mount merely by choosing a filename outside the current exact inventory.
# All redirect scripts are mount controls; the wider action+surface form catches
# future `future-ui-deploy.sh` / `switch-site-mount.sh` style selectors without
# freezing unrelated backend deployment helpers.
_UI_CONTROL_SCRIPT_RE = re.compile(
    r"^(?:scripts/)?(?:(?=[^/]*redirect)|(?=[^/]*(?:deploy|mount|switch|cutover|route))(?=[^/]*(?:ui|surface|frontend|site|web|app)))[^/]+\.sh$",
    re.IGNORECASE,
)

_NONRUNTIME_MODULE_SUBTREES: tuple[str, ...] = (
    "mira-web/scripts/",
    "mira-web/tools/",
    "mira-web/docs/",
    "mira-web/tests/",
    "mira-hub/benchmarks/",
    "mira-hub/db/",
    "mira-hub/docs/",
    "mira-hub/scripts/",
    "mira-hub/tests/",
    "mira-hub/tools/",
    "mira-mobile/docs/",
    "mira-mobile/scripts/__tests__/",
    "mira-mobile/tests/",
    "mira-mobile/tools/",
)

_ANDROID_TEST_SOURCESET_RE = re.compile(
    r"^mira-mobile/android/[^/]+/src/(?:test|androidTest|testFixtures)(?:[A-Z][^/]*)?/"
)

_NONRUNTIME_NATIVE_EXACT_PATHS: frozenset[str] = frozenset(
    {
        "mira-mobile/android/.gitignore",
        "mira-mobile/android/app/.gitignore",
        "mira-mobile/ios/App/CapApp-SPM/.gitignore",
        "mira-mobile/ios/App/CapApp-SPM/README.md",
        "mira-mobile/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist",
        "mira-mobile/ios/.gitignore",
    }
)

_NONRUNTIME_DEPLOYMENT_PATHS: frozenset[str] = frozenset(
    {
        "deployment/admin_guide.md",
        "deployment/customer_agreement.md",
        "deployment/deploy.sh",
        "deployment/network.yml",
        "deployment/onboarding_guide.md",
        "deployment/troubleshooting.md",
        "deployment/well-known/README.md",
    }
)

_ROOT_SERVER_CONFIG_CONTROL_RE = re.compile(r"^[^/]+\.conf$", re.IGNORECASE)

_NONRUNTIME_MODULE_ROOT_SUFFIXES: tuple[str, ...] = (
    ".md",
    ".jpeg",
    ".jpg",
    ".png",
    ".webp",
)

_NONRUNTIME_MODULE_ROOT_PATHS: frozenset[str] = frozenset(
    {
        "mira-web/.gitignore",
        "mira-hub/.gitignore",
        "mira-hub/components.json",
        "mira-hub/Dockerfile.sync-worker",
        "mira-hub/eslint.config.mjs",
        "mira-hub/playwright.command-center.config.ts",
        "mira-hub/playwright.config.ts",
        "mira-hub/playwright.e2e-laptop-to-cloud.config.ts",
        "mira-hub/playwright.onboarding-validate.config.ts",
        "mira-hub/playwright.onboarding-walkthrough.config.ts",
        "mira-hub/playwright.signup.config.ts",
        "mira-hub/playwright.smoke.config.ts",
        "mira-hub/vitest.config.ts",
        "mira-hub/vitest.integration.config.ts",
        "mira-mobile/.gitignore",
    }
)

CLASSIFIED_SOURCE_ROOTS: tuple[str, ...] = (
    "mira-web/src/",
    "mira-hub/src/",
    "mira-mobile/src/",
)

CANONICAL_ADAPTER_ROOTS: tuple[str, ...] = (
    "mira-web/src/factorylm-ui/",
    "mira-hub/src/factorylm-ui/",
    "mira-mobile/src/factorylm-ui/",
    # The connected mobile adapter predates the standardized factorylm-ui
    # directory name. Treat the complete live adapter root as canonical: its
    # CSS and any future React siblings are the new UI, not legacy presentation.
    "mira-mobile/src/unified/",
)

CANONICAL_ADAPTER_FILES: frozenset[str] = frozenset(
    {
        # Exact connected mobile shell hosts. The surrounding screens directory
        # remains legacy-by-default; only these already-merged new-UI wrappers
        # are exempt until a later mechanical move into factorylm-ui/.
        "mira-mobile/src/screens/UnifiedChat.tsx",
        "mira-mobile/src/screens/UnifiedRoot.tsx",
    }
)

_PRESENTATION_SUFFIXES: tuple[str, ...] = (
    ".tsx",
    ".jsx",
    ".css",
    ".scss",
    ".sass",
    ".less",
)

# Explicit capability roots are not blanket filename bypasses. Only source and
# machine-readable data shapes that cannot directly ship a presentation remain
# open; HTML, JavaScript, SVG, Vue, Markdown, styles, and unknown formats fail
# closed even when placed below a capability/seed/API directory.
_NONPRESENTATIONAL_CAPABILITY_SUFFIXES: tuple[str, ...] = (
    ".ts",
    ".mts",
    ".cts",
    ".json",
)

# Existing mira-web route modules that are data/API capability seams rather
# than HTML page mounts. Every other current or future production route file
# is guarded by default. New backend work has a durable unambiguous home under
# `mira-web/src/capabilities/**`.
_WEB_PRESERVED_ROUTE_PATHS: frozenset[str] = frozenset(
    {
        "mira-web/src/routes/inbox.ts",
        "mira-web/src/routes/mfa.ts",
        "mira-web/src/routes/probe-state.ts",
    }
)

_WEB_PRESENTATION_LIB_PATHS: frozenset[str] = frozenset(
    {
        "mira-web/src/lib/blog-renderer.ts",
        "mira-web/src/lib/components.ts",
        "mira-web/src/lib/drive-commander-renderer.ts",
        "mira-web/src/lib/feature-renderer.ts",
        "mira-web/src/lib/head.ts",
    }
)

# Existing public-web libraries audited as capability/server seams. Every
# other current or future production file under the mixed historical lib root
# is guarded by default. New backend modules have an unambiguous open home at
# `mira-web/src/capabilities/**` instead of growing this allowlist casually.
_WEB_PRESERVED_LIB_PATHS: frozenset[str] = frozenset(
    {
        "mira-web/src/lib/account-deletion.ts",
        "mira-web/src/lib/activation.ts",
        "mira-web/src/lib/atlas.ts",
        "mira-web/src/lib/audit.ts",
        "mira-web/src/lib/auth.ts",
        "mira-web/src/lib/connect.ts",
        "mira-web/src/lib/cookie-session.ts",
        "mira-web/src/lib/crypto.ts",
        "mira-web/src/lib/csv-import.ts",
        "mira-web/src/lib/dc-pro-activation.ts",
        "mira-web/src/lib/drip.ts",
        "mira-web/src/lib/hub-provisioning-queue.ts",
        "mira-web/src/lib/hub-user-activation.ts",
        "mira-web/src/lib/magic-link.ts",
        "mira-web/src/lib/mfa.ts",
        "mira-web/src/lib/mira-chat.ts",
        "mira-web/src/lib/posthog-server.ts",
        "mira-web/src/lib/qr-generate.ts",
        "mira-web/src/lib/qr-tracker.ts",
        "mira-web/src/lib/quota.ts",
        "mira-web/src/lib/stripe.ts",
    }
)

_HUB_PRESENTATION_LIB_SUFFIXES: tuple[str, ...] = (
    "-view.ts",
    "-data.ts",
    "-titles.ts",
    "-card.ts",
)

_HUB_PRESENTATION_LIB_PATHS: frozenset[str] = frozenset(
    {
        "mira-hub/src/lib/doc-chat-link.ts",
        "mira-hub/src/lib/knowledge-graph/canonical-relationship-type.ts",
        "mira-hub/src/lib/notebook-delete.ts",
        "mira-hub/src/lib/onboarding-flow.ts",
        "mira-hub/src/lib/visual/reducer.ts",
        "mira-hub/src/lib/visual/viewport.ts",
    }
)

# The historical Hub lib bucket mixes backend capabilities with old-page view
# behavior. This is the audited snapshot of reusable capability/domain files.
# Unknown additions fail closed; new backend modules belong in the explicit
# `mira-hub/src/capabilities/**` seam instead of expanding this list casually.
_HUB_PRESERVED_LIB_PATHS: frozenset[str] = frozenset(
    {
        "mira-hub/src/lib/abort-helpers.ts",
        "mira-hub/src/lib/agents/asset-intelligence.ts",
        "mira-hub/src/lib/agents/morning-brief.ts",
        "mira-hub/src/lib/agents/pm-escalation.ts",
        "mira-hub/src/lib/agents/safety-alert.ts",
        "mira-hub/src/lib/agents/wo-lifecycle.ts",
        "mira-hub/src/lib/approved-context.ts",
        "mira-hub/src/lib/asset-agent-transition.ts",
        "mira-hub/src/lib/asset-tag.ts",
        "mira-hub/src/lib/asset-uns-path.ts",
        "mira-hub/src/lib/atlas/client.ts",
        "mira-hub/src/lib/atlas/sync.ts",
        "mira-hub/src/lib/auth/route-helpers.ts",
        "mira-hub/src/lib/auth/session.ts",
        "mira-hub/src/lib/bindings.ts",
        "mira-hub/src/lib/cmms/atlas-provider.ts",
        "mira-hub/src/lib/cmms/deep-link.ts",
        "mira-hub/src/lib/cmms/provider.ts",
        "mira-hub/src/lib/cmms/registry.ts",
        "mira-hub/src/lib/cmms/tenant-config.ts",
        "mira-hub/src/lib/command-center-freshness.ts",
        "mira-hub/src/lib/config.ts",
        "mira-hub/src/lib/contextualization/approval.ts",
        "mira-hub/src/lib/contextualization/asset-matcher.ts",
        "mira-hub/src/lib/contextualization/bundle-import.ts",
        "mira-hub/src/lib/contextualization/intake-contract.schema.json",
        "mira-hub/src/lib/contextualization/intake-contract.ts",
        "mira-hub/src/lib/contextualization/parse-source.ts",
        "mira-hub/src/lib/contextualization/unzip.ts",
        "mira-hub/src/lib/csv-export.ts",
        "mira-hub/src/lib/data-schema.ts",
        "mira-hub/src/lib/db.ts",
        "mira-hub/src/lib/demo-auth.ts",
        "mira-hub/src/lib/display-registration.ts",
        "mira-hub/src/lib/drive-pack-suggestion.ts",
        "mira-hub/src/lib/drive-packs/gs10-pack.json",
        "mira-hub/src/lib/drive-packs/loader.ts",
        "mira-hub/src/lib/equipment-notebooks.ts",
        "mira-hub/src/lib/equipment-type.ts",
        "mira-hub/src/lib/fetch-adapters.ts",
        "mira-hub/src/lib/gateway-probe.ts",
        "mira-hub/src/lib/i3x/approval.ts",
        "mira-hub/src/lib/i3x/auth.ts",
        "mira-hub/src/lib/i3x/data-access.ts",
        "mira-hub/src/lib/i3x/index.ts",
        "mira-hub/src/lib/i3x/namespaces.ts",
        "mira-hub/src/lib/i3x/object-types.ts",
        "mira-hub/src/lib/i3x/objects.ts",
        "mira-hub/src/lib/i3x/quality.ts",
        "mira-hub/src/lib/i3x/relationships.ts",
        "mira-hub/src/lib/i3x/response.ts",
        "mira-hub/src/lib/i3x/server-info.ts",
        "mira-hub/src/lib/i3x/types.ts",
        "mira-hub/src/lib/i3x/value.ts",
        "mira-hub/src/lib/ics-export.ts",
        "mira-hub/src/lib/inbox-node.ts",
        "mira-hub/src/lib/inference/canonical-cascade.ts",
        "mira-hub/src/lib/inference/persist-usage.ts",
        "mira-hub/src/lib/ip-rate-limit.ts",
        "mira-hub/src/lib/kb-gap.ts",
        "mira-hub/src/lib/knowledge-graph/analysis.ts",
        "mira-hub/src/lib/knowledge-graph/asset-bridge.ts",
        "mira-hub/src/lib/knowledge-graph/cmms-sync.ts",
        "mira-hub/src/lib/knowledge-graph/context-builder.ts",
        "mira-hub/src/lib/knowledge-graph/extractor.ts",
        "mira-hub/src/lib/knowledge-graph/hierarchy-backfill.ts",
        "mira-hub/src/lib/knowledge-graph/inference.ts",
        "mira-hub/src/lib/knowledge-graph/plan-vs-actual.ts",
        "mira-hub/src/lib/knowledge-graph/proposals-writer.ts",
        "mira-hub/src/lib/knowledge-graph/queries.ts",
        "mira-hub/src/lib/knowledge-graph/relationship-extractor.ts",
        "mira-hub/src/lib/knowledge-graph/trace.ts",
        "mira-hub/src/lib/knowledge-graph/traversal.ts",
        "mira-hub/src/lib/knowledge-graph/types.ts",
        "mira-hub/src/lib/knowledge-graph/uns-backfill.ts",
        "mira-hub/src/lib/llm/cascade.ts",
        "mira-hub/src/lib/local-upload.ts",
        "mira-hub/src/lib/machine-context-intelligence.ts",
        "mira-hub/src/lib/machine-context-packet.ts",
        "mira-hub/src/lib/machine-current-state.ts",
        "mira-hub/src/lib/machine-history.ts",
        "mira-hub/src/lib/machine-memory-response.ts",
        "mira-hub/src/lib/machine-memory-sanitize.ts",
        "mira-hub/src/lib/machine-memory.ts",
        "mira-hub/src/lib/manual-applicability.ts",
        "mira-hub/src/lib/manual-discovery.ts",
        "mira-hub/src/lib/manual-rag.ts",
        "mira-hub/src/lib/manufacturer-aliases.json",
        "mira-hub/src/lib/manufacturerNormalize.ts",
        "mira-hub/src/lib/mira-ingest-client.ts",
        "mira-hub/src/lib/nameplate/capture-quality.ts",
        "mira-hub/src/lib/nameplate/detect.ts",
        "mira-hub/src/lib/nameplate/evidence.ts",
        "mira-hub/src/lib/nameplate/image-mime.ts",
        "mira-hub/src/lib/nameplate/index.ts",
        "mira-hub/src/lib/nameplate/oem-corroboration.ts",
        "mira-hub/src/lib/nameplate/passes.ts",
        "mira-hub/src/lib/nameplate/preprocess.ts",
        "mira-hub/src/lib/nango.ts",
        "mira-hub/src/lib/node-document-proposals.ts",
        "mira-hub/src/lib/node-knowledge-ingest.ts",
        "mira-hub/src/lib/normalize-tag-path.ts",
        "mira-hub/src/lib/notebook-chat-types.ts",
        "mira-hub/src/lib/notebook-query.ts",
        "mira-hub/src/lib/oauth-state.ts",
        "mira-hub/src/lib/pg-unique-retry.ts",
        "mira-hub/src/lib/photo-ocr.ts",
        "mira-hub/src/lib/plc-import.ts",
        "mira-hub/src/lib/plc-proposals.ts",
        "mira-hub/src/lib/pm-interval.ts",
        "mira-hub/src/lib/proposal-transition.ts",
        "mira-hub/src/lib/qr-origin.ts",
        "mira-hub/src/lib/quote-window.ts",
        "mira-hub/src/lib/review-queue.ts",
        "mira-hub/src/lib/role.ts",
        "mira-hub/src/lib/safe-download.ts",
        "mira-hub/src/lib/safety-classifier.ts",
        "mira-hub/src/lib/safety-phrases.ts",
        "mira-hub/src/lib/scan-target.ts",
        "mira-hub/src/lib/session.ts",
        "mira-hub/src/lib/signal-recorder.ts",
        "mira-hub/src/lib/sniff-mime.ts",
        "mira-hub/src/lib/ssrf-guard.ts",
        "mira-hub/src/lib/suggestion-accept.ts",
        "mira-hub/src/lib/tenant-context.ts",
        "mira-hub/src/lib/token-crypto.ts",
        "mira-hub/src/lib/token-refresh.ts",
        "mira-hub/src/lib/uns/skeleton.ts",
        "mira-hub/src/lib/uns.ts",
        "mira-hub/src/lib/upload-buffer.ts",
        "mira-hub/src/lib/upload-log.ts",
        "mira-hub/src/lib/upload-pipeline.ts",
        "mira-hub/src/lib/uploads.ts",
        "mira-hub/src/lib/users.ts",
        "mira-hub/src/lib/vendor-relevance.ts",
        "mira-hub/src/lib/visual/canonical.ts",
        "mira-hub/src/lib/visual/golden-vectors.json",
        "mira-hub/src/lib/visual/image-dims.ts",
        "mira-hub/src/lib/visual/index.ts",
        "mira-hub/src/lib/visual/schema.ts",
        "mira-hub/src/lib/visual/signed-url.ts",
        "mira-hub/src/lib/wo-completion-validation.ts",
        "mira-hub/src/lib/work-order-status.ts",
        "mira-hub/src/lib/workflow-versions.ts",
        "mira-hub/src/lib/workflow.ts",
        "mira-hub/src/lib/workspace-files.ts",
    }
)

# These are transport/native-call seams already consumed by the mobile
# application. OTA selection is deliberately excluded: choosing and staging a
# new web bundle is part of the customer-visible mount boundary. Everything
# else under the historical `src/lib/**` bucket fails closed: that bucket also
# contains visible copy, view models, composer behavior, citation rendering,
# and transient-layer behavior, so treating the directory itself as a
# capability boundary is unsafe. New reusable capability code belongs in the
# API/adapter roots or in the shared FactoryLM packages.
_MOBILE_PRESERVED_LIB_PATHS: frozenset[str] = frozenset(
    {
        "mira-mobile/src/lib/native-pick.ts",
        "mira-mobile/src/lib/offline-queue.ts",
        "mira-mobile/src/lib/open-with.ts",
        "mira-mobile/src/lib/resume-guard.ts",
        "mira-mobile/src/lib/tags.ts",
    }
)

_MOBILE_PRESERVED_CHAT_ADAPTER_PATHS: frozenset[str] = frozenset(
    {
        "mira-mobile/src/chat-adapter/contract.ts",
    }
)

MAX_EXPECTED_CHANGE_COUNT = 3000

_TERMINAL_GLOB = "/**"
_LEGACY_LABEL = "legacy-ui-exception"
_FIELD_LABELS: tuple[str, ...] = (
    "Reason:",
    "Canonical replacement impact:",
    "Rollback:",
)
# Values that are ONLY a placeholder if they match EXACTLY (whole value,
# case-insensitive) — these are common real English words/phrases that can
# legitimately open a substantive sentence ("none, this only touches the
# recovery route" is real content, not a placeholder), so they must not be
# treated as prefixes.
_PLACEHOLDER_EXACT_VALUES: frozenset[str] = frozenset({"none", "not applicable"})
# Placeholder-phrase prefixes. Matched against the START of a (lowercased,
# stripped) field value only — never as a substring — so a substantive value
# that merely mentions one of these words mid-sentence ("the TODO comment in
# home.ts was hiding a null deref") is never rejected. A prefix match only
# counts if the next character is not alphanumeric (word-boundary check), so
# "na" doesn't false-positive against "native app rewrite ...". These are
# phrases that are placeholder-shaped even WITH trailing text ("N/A because
# this is a rollback" is still a non-answer), unlike `_PLACEHOLDER_EXACT_VALUES`.
_PLACEHOLDER_PREFIXES: tuple[str, ...] = (
    "n/a",
    "na",
    "tbd",
    "todo",
    "tba",
    "placeholder",
    "fill later",
    "fill in later",
)
_ANGLE_PLACEHOLDER_RE = re.compile(r"^<.*>$", re.DOTALL)
_SUBSTANTIVE_TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)
_GITHUB_FOOTNOTE_RE = re.compile(r"\[\^[^\]\r\n]+\]")
_GITHUB_EMOJI_ALIAS_RE = re.compile(r":[A-Za-z0-9_+-]+:")
_MIN_SUBSTANTIVE_TOKENS = 3
_MIN_SUBSTANTIVE_ALNUM_CHARS = 12
_FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_GITHUB_MARKDOWN = MarkdownIt("commonmark").enable(["table", "strikethrough"])

# GitHub pull-files `status` values this guard understands, mapped to the
# same normalized vocabulary `changed_files_between()` produces from git.
_GITHUB_STATUS_MAP = {
    "added": "added",
    "modified": "modified",
    "removed": "removed",
    "renamed": "renamed",
}
# git --name-status single-letter codes (only A/M/D/R can appear without
# --find-copies, which this module deliberately never passes).
_GIT_STATUS_MAP = {"A": "added", "M": "modified", "D": "removed", "R": "renamed"}

# Canonical entry shapes emitted by both `git ls-tree` and GitHub's immutable
# Git Trees API. Anything else is malformed or a future object type this guard
# has not audited, so it must fail closed during evidence loading.
_GIT_TREE_ENTRY_KINDS: frozenset[tuple[str, str]] = frozenset(
    {
        ("040000", "tree"),
        ("100644", "blob"),
        ("100755", "blob"),
        ("120000", "blob"),
        ("160000", "commit"),
    }
)
_REGULAR_FILE_MODES: frozenset[str] = frozenset({"100644", "100755"})


class GuardPolicyError(Exception):
    """Registry, changed-files, or CLI input is malformed.

    Raised instead of silently ignoring or weakening protection — a broken
    `guarded_paths` entry, a duplicate YAML key, or an unparseable
    changed-files record must stop the guard, not quietly pass everything.
    """


@dataclass(frozen=True)
class ChangedFile:
    status: str
    path: str
    previous_path: Optional[str] = None
    old_mode: Optional[str] = None
    old_type: Optional[str] = None
    new_mode: Optional[str] = None
    new_type: Optional[str] = None
    tree_evidence_complete: bool = False


@dataclass(frozen=True)
class GitTreeEntry:
    mode: str
    type: str


@dataclass(frozen=True)
class GuardPolicy:
    """Normalized guarded-path patterns. Exact paths, or a path ending in the
    single terminal wildcard form `dir/sub/**` (matches anything under
    `dir/sub/`). `load_guard_policy()` is the only place CONTROL_PATTERNS is
    injected — a bare `GuardPolicy(...)` does not include them, which lets
    tests build minimal fixture policies without carrying the whole
    control-plane list."""

    guarded_paths: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class GuardResult:
    allowed: bool
    guarded_paths: tuple[str, ...]
    missing_fields: tuple[str, ...]
    message: str


@dataclass(frozen=True)
class ExceptionApproval:
    """Fresh GitHub label attestation bound to one PR head and body snapshot."""

    valid: bool
    approver: Optional[str]
    reason: str


# ---------------------------------------------------------------------------
# Strict YAML loading — duplicate top-level (or any) mapping keys are a
# policy error, not a silent last-wins shadow.
# ---------------------------------------------------------------------------
class _StrictUniqueKeyLoader(yaml.SafeLoader):
    pass


def _construct_mapping_no_dupes(loader: yaml.SafeLoader, node: yaml.Node, deep: bool = False):
    mapping: dict = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise GuardPolicyError(f"duplicate YAML key {key!r} in {node.start_mark}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_StrictUniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping_no_dupes
)


def _strict_yaml_load(text: str) -> dict:
    loader = _StrictUniqueKeyLoader(text)
    try:
        # Use the SafeLoader subclass directly instead of routing through
        # yaml.load. This preserves duplicate-key rejection while making the
        # safe construction boundary explicit to both readers and scanners.
        data = loader.get_single_data()
    except GuardPolicyError:
        raise
    except yaml.YAMLError as exc:
        raise GuardPolicyError(f"registry is not valid YAML: {exc}") from exc
    finally:
        loader.dispose()
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise GuardPolicyError("registry root must be a mapping of entry name -> entry body")
    return data


# ---------------------------------------------------------------------------
# guarded_paths validation — normalize or fail closed. Never weaken.
# ---------------------------------------------------------------------------
def _validate_guarded_path(raw: object, *, entry_name: str) -> str:
    if not isinstance(raw, str):
        raise GuardPolicyError(f"{entry_name}: guarded_paths entry is not a string: {raw!r}")
    path = raw.strip()
    if not path:
        raise GuardPolicyError(f"{entry_name}: guarded_paths entry is empty")
    if path.startswith("/"):
        raise GuardPolicyError(f"{entry_name}: guarded_paths entry is absolute: {raw!r}")
    if "\\" in path:
        raise GuardPolicyError(f"{entry_name}: guarded_paths entry contains a backslash: {raw!r}")
    if ".." in path.split("/"):
        raise GuardPolicyError(
            f"{entry_name}: guarded_paths entry contains a traversal segment: {raw!r}"
        )
    if "*" in path:
        if not path.endswith(_TERMINAL_GLOB):
            raise GuardPolicyError(
                f"{entry_name}: guarded_paths entry uses an unsupported wildcard form "
                f"(only a terminal /** is allowed): {raw!r}"
            )
        prefix = path[: -len(_TERMINAL_GLOB)]
        if not prefix or "*" in prefix:
            raise GuardPolicyError(
                f"{entry_name}: guarded_paths entry uses an unsupported wildcard form "
                f"(only a terminal /** is allowed): {raw!r}"
            )
    return path


def _entry_guarded_paths(name: str, entry: dict) -> tuple[str, ...]:
    """Extract validated guarded_paths from one registry entry, or () if the
    entry does not carry the full legacy-guard combination at all.

    An entry only "carries" guard policy when ALL of status/change_policy/
    deletion_safe/canonical_replacement match the guarded-legacy shape
    (charter §2.2, §3). An entry with none of that is simply not a guard
    entry — silently skipped, not an error. But an entry that DOES carry that
    combination and then has a malformed `guarded_paths` is a policy error:
    that shape is precisely how protection could be silently disabled.
    """
    if not isinstance(entry, dict):
        return ()
    is_guard_shaped = (
        entry.get("status") == "LEGACY"
        and entry.get("change_policy") == "exception_only"
        and entry.get("deletion_safe") is False
        and isinstance(entry.get("canonical_replacement"), str)
        and entry.get("canonical_replacement").strip() != ""
    )
    if not is_guard_shaped:
        return ()
    raw_paths = entry.get("guarded_paths")
    if not isinstance(raw_paths, list) or len(raw_paths) == 0:
        raise GuardPolicyError(
            f"{name}: status=LEGACY/change_policy=exception_only/deletion_safe=false "
            "entry must carry a non-empty list `guarded_paths` — found "
            f"{raw_paths!r}"
        )
    return tuple(_validate_guarded_path(p, entry_name=name) for p in raw_paths)


def load_guard_policy(registry_path: Path) -> GuardPolicy:
    """Load a `GuardPolicy` from a REGISTRY.yaml-shaped file.

    Always includes CONTROL_PATTERNS (hardcoded, never sourced from the file)
    in addition to whatever guarded legacy entries the registry declares.
    """
    registry_path = Path(registry_path)
    try:
        text = registry_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise GuardPolicyError(f"cannot read registry {registry_path}: {exc}") from exc

    data = _strict_yaml_load(text)
    guarded: list[str] = list(CONTROL_PATTERNS)
    for name, entry in data.items():
        for p in _entry_guarded_paths(str(name), entry):
            if p not in guarded:
                guarded.append(p)
    return GuardPolicy(guarded_paths=tuple(guarded))


# ---------------------------------------------------------------------------
# Path matching
# ---------------------------------------------------------------------------
def _matches_pattern(path: str, pattern: str) -> bool:
    if pattern.endswith(_TERMINAL_GLOB):
        prefix = pattern[: -len(_TERMINAL_GLOB)] + "/"
        return path == prefix.rstrip("/") or path.startswith(prefix)
    return path == pattern


def _is_nonpresentational_capability_path(path: str) -> bool:
    return path.lower().endswith(_NONPRESENTATIONAL_CAPABILITY_SUFFIXES)


def _classify_legacy_surface_control(path: str) -> Optional[bool]:
    """Classify build/mount controls outside `src/**`; True means guarded."""
    if path in LEGACY_SURFACE_EXACT_CONTROL_PATHS:
        return True
    # Compose accepts arbitrary root-level project/override filenames. Guard
    # the naming family so a newly introduced selector cannot evade an exact
    # list merely by choosing a fresh environment suffix.
    if "/" not in path and _ROOT_COMPOSE_CONTROL_RE.fullmatch(path):
        return True
    if _ROOT_SERVER_CONFIG_CONTROL_RE.fullmatch(path):
        return True
    if any(path.startswith(root) for root in _NONRUNTIME_MODULE_SUBTREES):
        return False
    if _ANDROID_TEST_SOURCESET_RE.match(path):
        return False
    if path in _NONRUNTIME_NATIVE_EXACT_PATHS:
        return False
    if path.startswith(("mira-mobile/android/", "mira-mobile/ios/")):
        native_parts = path.split("/")
        if path.startswith("mira-mobile/ios/") and any(
            part == "Tests" or part.endswith("Tests") for part in native_parts[3:-1]
        ):
            return False
    # Deployment is an integration/mount boundary, so unknown future entries
    # fail closed regardless of suffix. Only the current audited backend/docs
    # snapshot stays open; adding a new capability deployment file requires an
    # explicit classifier decision instead of becoming an accidental UI mount.
    if path.startswith("deployment/"):
        return path not in _NONRUNTIME_DEPLOYMENT_PATHS
    if _UI_CONTROL_SCRIPT_RE.fullmatch(path):
        return True
    if any(path.startswith(root) for root in LEGACY_SURFACE_CONTROL_ROOTS):
        return True
    for root in LEGACY_SURFACE_MODULE_ROOTS:
        if not path.startswith(root):
            continue
        relative = path[len(root) :]
        if not relative:
            return None
        if relative.startswith("src/"):
            return None
        # Anything else nested under a deployed UI module is an alternate
        # production tree unless it matched a known non-runtime subtree above.
        # This catches Next's root `app/` / `pages/` precedence as well as new
        # public or framework roots without enumerating future names.
        if "/" in relative:
            return True
        if path in _NONRUNTIME_MODULE_ROOT_PATHS:
            return False
        if path.lower().endswith(_NONRUNTIME_MODULE_ROOT_SUFFIXES):
            return False
        return True
    return None


def _is_hub_api_route(path: str) -> bool:
    """True only for Next route-handler files below an explicit `api` segment.

    This preserves both `app/api/**/route.ts` and the historical
    `app/(hub)/api/**/route.ts` capability seams. A `page.tsx` placed below an
    `api` directory is still presentation and therefore remains guarded.
    """
    prefix = "mira-hub/src/app/"
    if not path.startswith(prefix) or not path.endswith("/route.ts"):
        return False
    return "api" in path[len(prefix) :].split("/")[:-1]


def _classify_web_source(path: str) -> bool:
    """Classify `mira-web/src/**`; True means legacy presentation.

    mira-web mixes HTML templates and backend behavior in `.ts` files, so an
    extension-only rule is unsafe. Existing data/API seams are preserved by
    explicit roots/paths, while route mounts, renderers, content data,
    `server.ts`, and every unknown production sibling fail closed.
    """
    if path.startswith("mira-web/src/capabilities/"):
        return not _is_nonpresentational_capability_path(path)
    if path.startswith("mira-web/src/seed/"):
        return not _is_nonpresentational_capability_path(path)
    if path in _WEB_PRESERVED_ROUTE_PATHS:
        return False
    if path.startswith("mira-web/src/routes/"):
        return True
    if path in _WEB_PRESENTATION_LIB_PATHS:
        return True
    if path.startswith("mira-web/src/lib/"):
        # The historical lib root mixes capability code with renderers, route
        # behavior, visible output, and old chat state. Preserve only the
        # audited existing capability set; an arbitrary new filename is not an
        # escape hatch from the presentation freeze.
        return path not in _WEB_PRESERVED_LIB_PATHS
    if path.startswith("mira-web/src/views/") or path.startswith("mira-web/src/data/"):
        return True
    if path == "mira-web/src/server.ts":
        return True
    # Unknown production roots are not an escape hatch for a new old-site UI.
    return True


def _classify_hub_source(path: str) -> bool:
    """Classify `mira-hub/src/**`; True means legacy presentation."""
    if _is_hub_api_route(path):
        return False
    if path.startswith("mira-hub/src/capabilities/"):
        return not _is_nonpresentational_capability_path(path)
    if path.startswith("mira-hub/src/messages/"):
        # Locale catalogs are rendered product copy, not inert backend data.
        return True
    if path.startswith("mira-hub/src/app/"):
        return True
    if path.startswith("mira-hub/src/components/"):
        # Client-side helpers here own copy, chat/composer state, navigation,
        # and sign-out behavior even when their extension is plain `.ts`.
        return True
    if path.startswith("mira-hub/src/providers/"):
        # Providers include the legacy navigation catalog, redirects, identity
        # presentation, and mock view data. Keep the complete old UI boundary
        # frozen; reusable server authorization lives under lib/capabilities.
        return True
    if path.startswith("mira-hub/src/lib/"):
        # Framework-free does not imply capability-only. Guard all known
        # presentation shapes and exact mixed helpers, preserve only the
        # audited existing capability snapshot, and fail closed for every
        # arbitrary new filename in this historical mixed bucket.
        if path in _HUB_PRESENTATION_LIB_PATHS:
            return True
        name = path.rsplit("/", 1)[-1].lower()
        if name.endswith(_HUB_PRESENTATION_LIB_SUFFIXES) or name.endswith(_PRESENTATION_SUFFIXES):
            return True
        return path not in _HUB_PRESERVED_LIB_PATHS
    # Unknown production roots are not a new old-site presentation escape.
    # Root authentication and middleware both select customer entry routes and
    # therefore stay inside the legacy mount boundary.
    return True


def _classify_mobile_source(path: str) -> bool:
    """Classify `mira-mobile/src/**`; True means legacy presentation."""
    if path.startswith("mira-mobile/src/chat-adapter/"):
        return path not in _MOBILE_PRESERVED_CHAT_ADAPTER_PATHS
    if path.startswith("mira-mobile/src/api/"):
        return not _is_nonpresentational_capability_path(path)
    if path.startswith("mira-mobile/src/lib/"):
        return path not in _MOBILE_PRESERVED_LIB_PATHS
    if path == "mira-mobile/src/nav.ts":
        return True
    # Every unknown production sibling fails closed. New reusable behavior
    # belongs in the API seam or a canonical FactoryLM adapter/package.
    return True


def _classify_source_path(path: str) -> Optional[bool]:
    if path in CANONICAL_ADAPTER_FILES or any(
        path.startswith(root) for root in CANONICAL_ADAPTER_ROOTS
    ):
        return False
    if path.startswith("mira-web/src/"):
        return _classify_web_source(path)
    if path.startswith("mira-hub/src/"):
        return _classify_hub_source(path)
    if path.startswith("mira-mobile/src/"):
        return _classify_mobile_source(path)
    return None


def path_is_guarded(path: str, policy: GuardPolicy) -> bool:
    surface_control = _classify_legacy_surface_control(path)
    if surface_control is not None:
        return surface_control
    for root in PUBLIC_STATIC_GUARDED_ROOTS:
        if path.startswith(root):
            return True
    classified = _classify_source_path(path)
    if classified is not None:
        return classified
    return any(_matches_pattern(path, pattern) for pattern in policy.guarded_paths)


# ---------------------------------------------------------------------------
# Immutable Git tree evidence and git-derived changed files. Path-only diff
# metadata cannot reveal symlinks, executable-bit flips, gitlinks, or a file
# replaced by a directory. Every production CLI path therefore binds each
# changed-file record to base/head tree entries before policy evaluation.
# ---------------------------------------------------------------------------
def _validated_tree_entry(*, path: object, mode: object, entry_type: object) -> GitTreeEntry:
    if not isinstance(path, str) or not path:
        raise GuardPolicyError(f"Git tree entry has missing/invalid path: {path!r}")
    if path.startswith("/") or "\\" in path or ".." in path.split("/"):
        raise GuardPolicyError(f"Git tree entry has unsafe path: {path!r}")
    if not isinstance(mode, str) or not isinstance(entry_type, str):
        raise GuardPolicyError(
            f"Git tree entry {path!r} has invalid mode/type: {mode!r}/{entry_type!r}"
        )
    if (mode, entry_type) not in _GIT_TREE_ENTRY_KINDS:
        raise GuardPolicyError(
            f"Git tree entry {path!r} has unsupported mode/type: {mode!r}/{entry_type!r}"
        )
    return GitTreeEntry(mode=mode, type=entry_type)


def _load_git_tree_entries(path: Path, *, description: str) -> dict[str, GitTreeEntry]:
    """Load one complete recursive response from GitHub's Git Trees API."""
    document = _load_json_object(path, description=description)
    if document.get("truncated") is not False:
        raise GuardPolicyError(
            f"{description} is truncated or missing `truncated: false`; refusing incomplete "
            "Git tree evidence"
        )
    raw_entries = document.get("tree")
    if not isinstance(raw_entries, list):
        raise GuardPolicyError(f"{description} must contain a `tree` list")

    entries: dict[str, GitTreeEntry] = {}
    for index, raw_entry in enumerate(raw_entries):
        if not isinstance(raw_entry, dict):
            raise GuardPolicyError(f"{description} tree entry {index} is not an object")
        raw_path = raw_entry.get("path")
        entry = _validated_tree_entry(
            path=raw_path,
            mode=raw_entry.get("mode"),
            entry_type=raw_entry.get("type"),
        )
        assert isinstance(raw_path, str)  # established by _validated_tree_entry
        if raw_path in entries:
            raise GuardPolicyError(f"{description} has duplicate tree path {raw_path!r}")
        entries[raw_path] = entry
    return entries


def _git_tree_entries(root: Path, revision: str) -> dict[str, GitTreeEntry]:
    """Read a complete local tree, including directory and gitlink entries."""
    try:
        proc = subprocess.run(
            ["git", "ls-tree", "-rz", "-t", "--full-tree", revision],
            cwd=str(root),
            capture_output=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise GuardPolicyError(f"git ls-tree {revision} failed: {exc}") from exc

    entries: dict[str, GitTreeEntry] = {}
    for raw_record in proc.stdout.split(b"\0"):
        if not raw_record:
            continue
        try:
            raw_metadata, raw_path = raw_record.split(b"\t", 1)
            mode_bytes, type_bytes, _sha_bytes = raw_metadata.split(b" ", 2)
            path = raw_path.decode("utf-8")
            mode = mode_bytes.decode("ascii")
            entry_type = type_bytes.decode("ascii")
        except (UnicodeDecodeError, ValueError) as exc:
            raise GuardPolicyError(
                f"malformed git ls-tree record for {revision!r}: {raw_record!r}"
            ) from exc
        if path in entries:
            raise GuardPolicyError(f"git ls-tree {revision!r} has duplicate path {path!r}")
        entries[path] = _validated_tree_entry(path=path, mode=mode, entry_type=entry_type)
    return entries


def _git_merge_base(root: Path, base: str, head: str) -> str:
    try:
        proc = subprocess.run(
            ["git", "merge-base", base, head],
            cwd=str(root),
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise GuardPolicyError(f"git merge-base {base} {head} failed: {exc}") from exc
    merge_base = proc.stdout.strip()
    if not _FULL_SHA_RE.fullmatch(merge_base):
        raise GuardPolicyError(f"git merge-base returned an invalid SHA: {merge_base!r}")
    return merge_base


def _attach_tree_evidence(
    changes: Iterable[ChangedFile],
    base_entries: dict[str, GitTreeEntry],
    head_entries: dict[str, GitTreeEntry],
) -> tuple[ChangedFile, ...]:
    enriched: list[ChangedFile] = []
    for change in changes:
        old_path = change.previous_path if change.status == "renamed" else change.path
        old_entry = base_entries.get(old_path) if old_path else None
        new_entry = head_entries.get(change.path)

        if change.status in {"modified", "renamed"} and (old_entry is None or new_entry is None):
            raise GuardPolicyError(
                f"{change.status} path {change.path!r} is missing immutable base/head tree evidence"
            )
        if change.status == "added" and new_entry is None:
            raise GuardPolicyError(
                f"added path {change.path!r} is missing immutable head tree evidence"
            )
        if change.status == "removed" and old_entry is None:
            raise GuardPolicyError(
                f"removed path {change.path!r} is missing immutable base tree evidence"
            )

        enriched.append(
            ChangedFile(
                status=change.status,
                path=change.path,
                previous_path=change.previous_path,
                old_mode=old_entry.mode if old_entry else None,
                old_type=old_entry.type if old_entry else None,
                new_mode=new_entry.mode if new_entry else None,
                new_type=new_entry.type if new_entry else None,
                tree_evidence_complete=True,
            )
        )
    return tuple(enriched)


def changed_files_between(root: Path, base: str, head: str) -> tuple[ChangedFile, ...]:
    try:
        proc = subprocess.run(
            ["git", "diff", "--name-status", "-z", "--find-renames", f"{base}...{head}"],
            cwd=str(root),
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise GuardPolicyError(f"git diff {base}...{head} failed: {exc}") from exc

    tokens = proc.stdout.split("\0")
    if tokens and tokens[-1] == "":
        tokens.pop()

    out: list[ChangedFile] = []
    i = 0
    while i < len(tokens):
        status_raw = tokens[i]
        i += 1
        if not status_raw:
            continue
        code = status_raw[0]
        if code in ("R", "C"):
            if i + 1 >= len(tokens):
                raise GuardPolicyError(f"malformed rename/copy record in git diff output: {tokens}")
            old_path = tokens[i]
            new_path = tokens[i + 1]
            i += 2
            out.append(ChangedFile(status="renamed", path=new_path, previous_path=old_path))
        else:
            normalized = _GIT_STATUS_MAP.get(code)
            if normalized is None:
                raise GuardPolicyError(f"unexpected git status code {status_raw!r}")
            if i >= len(tokens):
                raise GuardPolicyError(f"malformed record in git diff output: {tokens}")
            path = tokens[i]
            i += 1
            out.append(ChangedFile(status=normalized, path=path))
    merge_base = _git_merge_base(root, base, head)
    base_entries = _git_tree_entries(root, merge_base)
    head_entries = _git_tree_entries(root, head)
    return _attach_tree_evidence(out, base_entries, head_entries)


def validate_expected_change_count(count: int) -> None:
    """Fail closed on a count that cannot be trusted.

    Negative counts are malformed. A count over MAX_EXPECTED_CHANGE_COUNT
    means the PR's diff cannot be safely enumerated at all: GitHub's
    `pulls/{n}/files` endpoint silently stops paginating around 3000 entries
    (the truncation this whole check exists to catch), so a PR that big is
    refused rather than evaluated against a possibly-incomplete file list.
    """
    if count < 0:
        raise GuardPolicyError(f"expected change count is negative: {count}")
    if count > MAX_EXPECTED_CHANGE_COUNT:
        raise GuardPolicyError(
            f"expected change count {count} exceeds {MAX_EXPECTED_CHANGE_COUNT} — the "
            "GitHub pull-files endpoint cannot be safely enumerated past this size "
            "(pagination truncates silently); refusing to evaluate an unverifiable diff"
        )


def read_expected_change_count(path: Path) -> int:
    """Read and validate the PR's own authoritative `changed_files` count."""
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise GuardPolicyError(f"cannot read expected-change-count file {path}: {exc}") from exc
    try:
        count = int(text)
    except ValueError as exc:
        raise GuardPolicyError(
            f"expected-change-count file {path} is not an integer: {text!r}"
        ) from exc
    validate_expected_change_count(count)
    return count


def load_changed_files(
    path: Path,
    *,
    expected_count: Optional[int] = None,
    base_tree_json_file: Optional[Path] = None,
    head_tree_json_file: Optional[Path] = None,
) -> tuple[ChangedFile, ...]:
    """Parse normalized GitHub pull-files JSON-lines (one `{filename, status,
    previous_filename}` object per line) from a data-only file. Rejects
    unknown or missing fields, duplicate filename records, and — when
    `expected_count` is given (the PR's own authoritative `changed_files`
    field) — a record count that doesn't match it, which is exactly the
    signature of silent pull-files pagination truncation. When tree files are
    supplied, both are required and every record is bound to immutable
    base/head Git Trees API evidence before it is returned.
    """
    if (base_tree_json_file is None) != (head_tree_json_file is None):
        raise GuardPolicyError(
            "base and head tree JSON files must be provided together for immutable evidence"
        )
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise GuardPolicyError(f"cannot read changed-files file {path}: {exc}") from exc

    out: list[ChangedFile] = []
    seen_filenames: set[str] = set()
    for lineno, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise GuardPolicyError(f"changed-files line {lineno}: invalid JSON: {exc}") from exc
        if not isinstance(record, dict):
            raise GuardPolicyError(f"changed-files line {lineno}: expected a JSON object")

        status = record.get("status")
        normalized = _GITHUB_STATUS_MAP.get(status)
        if normalized is None:
            raise GuardPolicyError(
                f"changed-files line {lineno}: unknown or missing status {status!r}"
            )

        filename = record.get("filename")
        if not isinstance(filename, str) or not filename:
            raise GuardPolicyError(f"changed-files line {lineno}: missing/invalid filename")
        if filename in seen_filenames:
            raise GuardPolicyError(
                f"changed-files line {lineno}: duplicate filename record {filename!r}"
            )
        seen_filenames.add(filename)

        if normalized == "renamed":
            previous = record.get("previous_filename")
            if not isinstance(previous, str) or not previous:
                raise GuardPolicyError(
                    f"changed-files line {lineno}: renamed record missing previous_filename"
                )
            out.append(ChangedFile(status="renamed", path=filename, previous_path=previous))
        else:
            out.append(ChangedFile(status=normalized, path=filename))

    if expected_count is not None and len(out) != expected_count:
        raise GuardPolicyError(
            f"changed-files record count {len(out)} does not match the PR's "
            f"authoritative changed_files count {expected_count} — possible pull-files "
            "pagination truncation; refusing to evaluate an incomplete diff"
        )
    changes = tuple(out)
    if base_tree_json_file is None:
        return changes
    base_entries = _load_git_tree_entries(base_tree_json_file, description="base Git tree")
    head_entries = _load_git_tree_entries(head_tree_json_file, description="head Git tree")
    return _attach_tree_evidence(changes, base_entries, head_entries)


def _load_json_object(path: Path, *, description: str) -> dict:
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise GuardPolicyError(f"cannot read {description} file {path}: {exc}") from exc
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise GuardPolicyError(f"{description} file {path} is not valid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise GuardPolicyError(f"{description} file {path} must contain a JSON object")
    return value


def load_exception_approval(
    event_path: Path,
    current_pull_path: Path,
    approver_permission_path: Path,
) -> ExceptionApproval:
    """Validate a fresh label act against the current PR snapshot.

    The persistent label is not approval by itself. The only accepted
    attestation is the `pull_request_target:labeled` event that applied
    `legacy-ui-exception`, performed by a GitHub User, whose event-time head
    SHA and PR body still match a separately fetched current pull request, and
    whose separately fetched repository role is `maintain` or whose legacy
    base permission is `admin`. GitHub maps Maintain to legacy `write`, so both
    `permission` and `role_name` are checked.
    Any later push or body edit causes the next workflow run to fail until an
    authorized user removes/reapplies the label after reviewing the new state.
    """
    event = _load_json_object(event_path, description="GitHub event")
    current = _load_json_object(current_pull_path, description="current pull request")
    permission_record = _load_json_object(
        approver_permission_path, description="approver repository permission"
    )

    event_pr = event.get("pull_request")
    event_label = event.get("label")
    sender = event.get("sender")
    current_head = current.get("head")
    current_base = current.get("base")
    current_labels = current.get("labels")
    permission_user = permission_record.get("user")
    if (
        not all(
            isinstance(value, dict)
            for value in (event_pr, event_label, sender, current_head, current_base)
        )
        or not isinstance(current_labels, list)
        or not isinstance(permission_user, dict)
    ):
        raise GuardPolicyError("exception approval metadata is missing required GitHub objects")

    event_head = event_pr.get("head")
    current_base_repo = current_base.get("repo")
    event_repo = event.get("repository")
    if not all(isinstance(value, dict) for value in (event_head, current_base_repo, event_repo)):
        raise GuardPolicyError("exception approval metadata is missing head/repository objects")

    event_sha = event_head.get("sha")
    current_sha = current_head.get("sha")
    if not isinstance(event_sha, str) or not _FULL_SHA_RE.fullmatch(event_sha):
        raise GuardPolicyError("exception approval event head SHA is missing or malformed")
    if not isinstance(current_sha, str) or not _FULL_SHA_RE.fullmatch(current_sha):
        raise GuardPolicyError("current pull request head SHA is missing or malformed")

    event_body = event_pr.get("body")
    current_body = current.get("body")
    if event_body is not None and not isinstance(event_body, str):
        raise GuardPolicyError("exception approval event PR body is not text or null")
    if current_body is not None and not isinstance(current_body, str):
        raise GuardPolicyError("current pull request body is not text or null")

    label_names: set[str] = set()
    for item in current_labels:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            raise GuardPolicyError("current pull request labels contain a malformed item")
        label_names.add(item["name"])

    approver = sender.get("login") if isinstance(sender.get("login"), str) else None
    permission_login = (
        permission_user.get("login") if isinstance(permission_user.get("login"), str) else None
    )
    permission = permission_record.get("permission")
    role_name = permission_record.get("role_name")
    has_maintainer_authority = permission == "admin" or (
        permission == "write" and role_name == "maintain"
    )
    checks = (
        (event.get("action") == "labeled", "workflow event is not a label application"),
        (event_label.get("name") == _LEGACY_LABEL, "workflow event applied a different label"),
        (_LEGACY_LABEL in label_names, "exception label is no longer present"),
        (sender.get("type") == "User" and bool(approver), "label actor is not a GitHub User"),
        (permission_login == approver, "permission record actor mismatches label actor"),
        (
            has_maintainer_authority,
            "label actor does not have repository maintain or admin permission",
        ),
        (event.get("number") == current.get("number"), "pull request number changed"),
        (event_pr.get("number") == current.get("number"), "event pull request number mismatches"),
        (
            event_repo.get("full_name") == current_base_repo.get("full_name"),
            "repository identity mismatches",
        ),
        (event_sha == current_sha, "pull request head changed after approval"),
        ((event_body or "") == (current_body or ""), "pull request body changed after approval"),
    )
    failures = [reason for passed, reason in checks if not passed]
    if failures:
        return ExceptionApproval(valid=False, approver=approver, reason="; ".join(failures))
    return ExceptionApproval(
        valid=True,
        approver=approver,
        reason=(
            "fresh label event matches the current pull request head/body and "
            "the actor has repository maintainer authority"
        ),
    )


# ---------------------------------------------------------------------------
# Exception PR-body parsing — consume rendered CommonMark token structure plus
# GitHub's table/strikethrough rules, not source-looking regex approximations.
# Only a real top-level H2 can open the section; fenced/indented code, unsafe
# HTML, lists, blockquotes, tables, and struck text cannot smuggle a heading or
# field into the attestation.
# ---------------------------------------------------------------------------
def _visible_inline_text(token) -> str:
    """Return visible plain text from one CommonMark inline token.

    HTML tags/comments are structure, not attestation text. Text nested in
    emphasis or links remains represented by child `text` tokens; inline code
    is visible and therefore may form part of a substantive field value.
    """
    visible: list[str] = []
    struck_depth = 0
    for child in token.children or ():
        if child.type == "s_open":
            struck_depth += 1
            continue
        if child.type == "s_close":
            struck_depth = max(0, struck_depth - 1)
            continue
        if struck_depth:
            continue
        if child.type == "text":
            # Entity references such as ``&#10;`` decode inside a text token,
            # but GitHub renders that control as collapsed paragraph space. Do
            # not promote a decoded character into a structural line boundary;
            # only the explicit break tokens below may contribute LF.
            visible.append(child.content.replace("\n", " "))
        elif child.type == "code_inline":
            visible.append(child.content)
        elif child.type in {"softbreak", "hardbreak"}:
            visible.append("\n")
    return "".join(visible)


def _is_safe_standalone_html_comment(content: str) -> bool:
    """Accept one HTML-spec-safe comment token and nothing else.

    These restrictions mirror the comment syntax constraints that prevent
    HTML5's bogus/abrupt comment recovery from escaping into live DOM content.
    Conservative rejection is intentional for ambiguous or combined tokens.
    """
    text = content.strip()
    if len(text) < len("<!---->") or not text.startswith("<!--") or not text.endswith("-->"):
        return False
    inner = text[4:-3]
    return not (
        inner.startswith((">", "->")) or "<!--" in inner or "--" in inner or inner.endswith("<!-")
    )


def _has_unsafe_html(tokens) -> bool:
    """Reject HTML structure that can hide or visually nest an attestation.

    CommonMark deliberately does not model the DOM nesting created by raw HTML
    containers: with blank lines, a Markdown H2 inside `<details>` can still be
    emitted as a level-zero heading token. HTML comment recovery also differs
    between Markdown renderers and HTML5 browsers. Permit only one strictly
    valid standalone comment per HTML token; reject tags, unclosed/malformed
    comments, or combined comment/tag tokens anywhere in the PR body.
    """
    for token in tokens:
        for candidate in (token, *(token.children or ())):
            if candidate.type in {"html_block", "html_inline"} and not (
                _is_safe_standalone_html_comment(candidate.content)
            ):
                return True
    return False


def _has_renderer_specific_markup(source: str) -> bool:
    """Reject GitHub extensions that can relocate or hide attestation text.

    ``markdown-it-py`` intentionally implements CommonMark plus the explicitly
    enabled table/strikethrough rules. GitHub additionally moves footnote
    definitions away from their source position and renders paired dollar
    delimiters through a math component whose visible text can differ from the
    source (for example, ``\\phantom``). Exception PR bodies deliberately use a
    narrow source subset: reject any footnote marker, any two dollar signs, or
    any tilde, including inside code or comments, so parser token loss and
    future renderer ordering cannot make this check fail open.
    """
    # CommonMark can consume a ``[^name]: value`` line as an ordinary reference
    # definition and omit it from the token stream entirely. Inspect the raw
    # source for GitHub's unambiguous footnote marker before walking tokens.
    return _GITHUB_FOOTNOTE_RE.search(source) is not None or source.count("$") >= 2 or "~" in source


def _find_exception_sections(pr_body: str) -> tuple[list[str], Optional[str]]:
    source = pr_body or ""
    tokens = _GITHUB_MARKDOWN.parse(source)
    if _has_unsafe_html(tokens):
        return [], "body:unsafe or non-comment HTML invalidates Legacy UI exception"
    if _has_renderer_specific_markup(source):
        return [], "body:renderer-specific markup invalidates Legacy UI exception"
    sections: list[str] = []
    current: Optional[list[str]] = None
    top_level_paragraph = False

    for index, token in enumerate(tokens):
        if token.type == "heading_open" and token.level == 0 and token.tag in {"h1", "h2"}:
            if current is not None:
                sections.append("\n".join(current))
                current = None

            # Use the parser-owned heading markup and inline content directly;
            # indexing token source maps into Python `splitlines()` is unsafe
            # because Python treats more Unicode characters as line breaks than
            # CommonMark does. Setext H2s carry `-` markup and therefore remain
            # boundaries without becoming an exception opener.
            inline = tokens[index + 1] if index + 1 < len(tokens) else None
            if (
                token.tag == "h2"
                and token.markup == "##"
                and inline is not None
                and inline.type == "inline"
                and inline.content == "Legacy UI exception"
            ):
                current = []
            top_level_paragraph = False
            continue

        if current is None:
            continue

        if token.type == "paragraph_open":
            top_level_paragraph = token.level == 0
            continue
        if token.type == "paragraph_close":
            top_level_paragraph = False
            continue
        if token.type != "inline" or not top_level_paragraph:
            continue

        visible = _visible_inline_text(token)
        # CommonMark line endings are LF/CRLF/CR only. The parser has already
        # normalized them to LF in inline content; Python ``splitlines()`` also
        # treats Unicode separators, VT, and FF as boundaries and could thereby
        # manufacture field anchors or a fake [WORK-CLAIM] boundary that GitHub
        # renders inside one paragraph.
        visible_lines = visible.split("\n")
        work_claim_at = next(
            (index for index, line in enumerate(visible_lines) if line.strip() == "[WORK-CLAIM]"),
            None,
        )
        if work_claim_at is None:
            current.append(visible)
            continue

        before_work_claim = "\n".join(visible_lines[:work_claim_at])
        if before_work_claim:
            current.append(before_work_claim)
        sections.append("\n".join(current))
        current = None
        top_level_paragraph = False

    if current is not None:
        sections.append("\n".join(current))
    return sections, None


def _extract_field(body: str, label: str) -> tuple[Optional[str], bool]:
    """Return `(value, ambiguous)`. A field label appearing more than once in
    the section body is ambiguous — fail closed rather than silently take the
    first match (a duplicated `Reason:` line could otherwise hide a
    contradicting or placeholder second value behind a substantive first
    one)."""
    pattern = re.compile(r"^" + re.escape(label) + r"[ \t]*(.*)$", re.MULTILINE)
    matches = list(pattern.finditer(body))
    if not matches:
        return None, False
    if len(matches) > 1:
        return None, True
    return matches[0].group(1).strip(), False


def _starts_with_placeholder_phrase(value_lower: str) -> bool:
    """True if `value_lower` (already `.strip().lower()`d) starts with a
    placeholder-vocabulary phrase at a word boundary — anchored at the START
    of the value only, never a substring match, so a substantive value that
    merely mentions "todo" or "n/a" mid-sentence is never rejected."""
    for prefix in _PLACEHOLDER_PREFIXES:
        if value_lower == prefix:
            return True
        if value_lower.startswith(prefix):
            next_char = value_lower[len(prefix)]
            if not next_char.isalnum():
                return True
    return False


def _is_punctuation_only(value: str) -> bool:
    return bool(value) and not any(c.isalnum() for c in value)


def _is_substantive(value: Optional[str]) -> bool:
    if value is None:
        return False
    if any(
        unicodedata.category(char).startswith("C")
        or "FILLER" in unicodedata.name(char, "")
        or "ZERO WIDTH" in unicodedata.name(char, "")
        or "OVERLAY" in unicodedata.name(char, "")
        for char in value
    ):
        return False
    v = unicodedata.normalize("NFKC", value).strip()
    if not v:
        return False
    # GitHub turns emoji aliases into one glyph and single tildes into deleted
    # text. Neither source form may satisfy the human-readable evidence floor.
    if _GITHUB_EMOJI_ALIAS_RE.search(v) or "~" in v:
        return False
    if _ANGLE_PLACEHOLDER_RE.match(v):
        return False
    if _is_punctuation_only(v):
        return False
    if v.lower() in _PLACEHOLDER_EXACT_VALUES:
        return False
    if _starts_with_placeholder_phrase(v.lower()):
        return False
    tokens = _SUBSTANTIVE_TOKEN_RE.findall(v)
    if len(tokens) < _MIN_SUBSTANTIVE_TOKENS:
        return False
    if sum(len(token) for token in tokens) < _MIN_SUBSTANTIVE_ALNUM_CHARS:
        return False
    return True


def _exception_missing_fields(pr_body: str) -> list[str]:
    """Return the list of problems with the PR body's exception section —
    empty means exactly one live section with all three fields substantive."""
    sections, invalid_reason = _find_exception_sections(pr_body)
    if invalid_reason is not None:
        return [invalid_reason]
    if len(sections) == 0:
        return ["body:## Legacy UI exception section"]
    if len(sections) > 1:
        return ["body:duplicate ## Legacy UI exception sections"]
    body = sections[0]
    missing = []
    for label in _FIELD_LABELS:
        value, ambiguous = _extract_field(body, label)
        if ambiguous:
            missing.append(f"body:{label} (duplicate field — ambiguous)")
        elif not _is_substantive(value):
            missing.append(f"body:{label}")
    return missing


# ---------------------------------------------------------------------------
# evaluate() — the guard decision
# ---------------------------------------------------------------------------
def _tree_evidence_requires_exception(change: ChangedFile) -> bool:
    if not change.tree_evidence_complete:
        return False

    old_entry = (
        GitTreeEntry(change.old_mode, change.old_type)
        if change.old_mode is not None and change.old_type is not None
        else None
    )
    new_entry = (
        GitTreeEntry(change.new_mode, change.new_type)
        if change.new_mode is not None and change.new_type is not None
        else None
    )

    # Missing halves or status-inconsistent presence indicate incomplete or
    # forged evidence. Treat it as guarded here even though the production
    # loaders reject it earlier.
    if (change.old_mode is None) != (change.old_type is None):
        return True
    if (change.new_mode is None) != (change.new_type is None):
        return True
    if change.status in {"modified", "renamed"} and (old_entry is None or new_entry is None):
        return True
    if change.status == "added" and new_entry is None:
        return True
    if change.status == "removed" and old_entry is None:
        return True
    if change.status not in {"added", "modified", "removed", "renamed"}:
        return True

    # A symlink is encoded as mode 120000/type blob. Trees and gitlinks are
    # likewise non-regular objects. Any changed non-regular entry is guarded,
    # and any mode/type transition (including 100644 <-> 100755) is guarded.
    for entry in (old_entry, new_entry):
        if entry is not None and (entry.type != "blob" or entry.mode not in _REGULAR_FILE_MODES):
            return True
    if old_entry is not None and new_entry is not None and old_entry != new_entry:
        return True
    if change.status == "added" and old_entry is not None:
        return True
    if change.status == "removed" and new_entry is not None:
        return True
    return False


def evaluate(
    changes: Iterable[ChangedFile],
    labels: "set[str] | frozenset[str]",
    pr_body: str,
    policy: GuardPolicy,
    *,
    exception_approval_valid: bool = False,
) -> GuardResult:
    """Require an audited exception for any guarded or control-plane touch.

    For a rename, both `previous_path` and `path` are checked — a rename-out
    of a guarded tree and a rename-in to a guarded tree are both violations.
    """
    touched: list[str] = []
    seen: set[str] = set()
    for change in changes:
        if _tree_evidence_requires_exception(change):
            for candidate in (change.path, change.previous_path):
                if candidate and candidate not in seen:
                    touched.append(candidate)
                    seen.add(candidate)
        for candidate in (change.path, change.previous_path):
            if not candidate or candidate in seen:
                continue
            if path_is_guarded(candidate, policy):
                touched.append(candidate)
                seen.add(candidate)

    if not touched:
        return GuardResult(
            allowed=True,
            guarded_paths=(),
            missing_fields=(),
            message="No guarded legacy or control-plane paths touched.",
        )

    missing: list[str] = []
    if _LEGACY_LABEL not in set(labels):
        missing.append(f"label:{_LEGACY_LABEL}")
    missing.extend(_exception_missing_fields(pr_body))
    if not missing and not exception_approval_valid:
        missing.append("approval:fresh legacy-ui-exception label bound to current head/body")

    if missing:
        return GuardResult(
            allowed=False,
            guarded_paths=tuple(touched),
            missing_fields=tuple(missing),
            message=(
                "Guarded legacy presentation or control-plane path(s) touched without "
                f"an audited `{_LEGACY_LABEL}` exception. Touched: "
                + ", ".join(touched)
                + ". Missing: "
                + ", ".join(missing)
            ),
        )
    return GuardResult(
        allowed=True,
        guarded_paths=tuple(touched),
        missing_fields=(),
        message="Audited legacy-ui-exception approved for: " + ", ".join(touched),
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _read_labels(path: Optional[Path]) -> set[str]:
    if path is None:
        return set()
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise GuardPolicyError(f"cannot read labels file {path}: {exc}") from exc
    return {line.strip() for line in text.splitlines() if line.strip()}


def _read_pr_body(path: Optional[Path]) -> str:
    if path is None:
        return ""
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise GuardPolicyError(f"cannot read PR body file {path}: {exc}") from exc


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--registry",
        type=Path,
        default=ROOT / DEFAULT_REGISTRY_REL,
        help="Path to REGISTRY.yaml (defaults to the repo's canonical location).",
    )
    p.add_argument("--labels-file", type=Path, default=None, help="Newline-delimited label names.")
    p.add_argument("--pr-body-file", type=Path, default=None, help="Raw PR body text.")
    p.add_argument(
        "--event-json-file",
        type=Path,
        default=None,
        help="Raw pull_request_target event JSON used to bind a fresh exception label.",
    )
    p.add_argument(
        "--current-pull-json-file",
        type=Path,
        default=None,
        help="Current GitHub pull-request JSON compared with the label event snapshot.",
    )
    p.add_argument(
        "--approver-permission-json-file",
        type=Path,
        default=None,
        help="Current GitHub repository-permission JSON for the label-event actor.",
    )
    p.add_argument(
        "--changes-json-file",
        type=Path,
        default=None,
        help="GitHub pull-files JSON-lines ({filename, status, previous_filename}).",
    )
    p.add_argument(
        "--expected-change-count-file",
        type=Path,
        default=None,
        help=(
            "Required with --changes-json-file: a file containing the PR's own "
            "authoritative `changed_files` integer, so a pull-files pagination "
            "truncation (silent past ~3000 files) is caught rather than silently "
            "evaluated against an incomplete diff."
        ),
    )
    p.add_argument(
        "--base-tree-json-file",
        type=Path,
        default=None,
        help="Complete recursive Git Trees API response for the immutable PR base SHA.",
    )
    p.add_argument(
        "--head-tree-json-file",
        type=Path,
        default=None,
        help="Complete recursive Git Trees API response for the immutable PR head SHA.",
    )
    p.add_argument("--base", default=None, help="Base git ref/SHA (paired with --head).")
    p.add_argument("--head", default=None, help="Head git ref/SHA (paired with --base).")
    return p


def main(argv: Optional[list] = None) -> int:
    args = _build_arg_parser().parse_args(argv)

    has_json = args.changes_json_file is not None
    has_basehead = args.base is not None or args.head is not None
    if has_json == has_basehead:
        print(
            "error: specify exactly one of --changes-json-file or --base/--head",
            file=sys.stderr,
        )
        return 2
    if has_basehead and not (args.base and args.head):
        print("error: --base and --head must both be provided", file=sys.stderr)
        return 2
    if has_json and args.expected_change_count_file is None:
        print(
            "error: --changes-json-file requires --expected-change-count-file "
            "(pull-files pagination truncation defense)",
            file=sys.stderr,
        )
        return 2
    tree_files = (args.base_tree_json_file, args.head_tree_json_file)
    if has_json and not all(path is not None for path in tree_files):
        print(
            "error: --changes-json-file requires --base-tree-json-file and "
            "--head-tree-json-file (immutable mode/type evidence)",
            file=sys.stderr,
        )
        return 2
    if not has_json and any(path is not None for path in tree_files):
        print(
            "error: --base-tree-json-file/--head-tree-json-file are only valid with "
            "--changes-json-file",
            file=sys.stderr,
        )
        return 2
    approval_files = (
        args.event_json_file,
        args.current_pull_json_file,
        args.approver_permission_json_file,
    )
    if any(path is not None for path in approval_files) and not all(
        path is not None for path in approval_files
    ):
        print(
            "error: --event-json-file, --current-pull-json-file, and "
            "--approver-permission-json-file must be provided together",
            file=sys.stderr,
        )
        return 2

    try:
        policy = load_guard_policy(args.registry)
        if has_json:
            expected_count = read_expected_change_count(args.expected_change_count_file)
            changes = load_changed_files(
                args.changes_json_file,
                expected_count=expected_count,
                base_tree_json_file=args.base_tree_json_file,
                head_tree_json_file=args.head_tree_json_file,
            )
        else:
            changes = changed_files_between(Path.cwd(), args.base, args.head)
        labels = _read_labels(args.labels_file)
        pr_body = _read_pr_body(args.pr_body_file)
        approval = (
            load_exception_approval(
                args.event_json_file,
                args.current_pull_json_file,
                args.approver_permission_json_file,
            )
            if args.event_json_file is not None
            else ExceptionApproval(
                valid=False,
                approver=None,
                reason="no GitHub label-event attestation was supplied",
            )
        )
    except GuardPolicyError as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1

    result = evaluate(
        changes,
        labels,
        pr_body,
        policy,
        exception_approval_valid=approval.valid,
    )
    if not result.allowed:
        for touched_path in result.guarded_paths:
            print(f"::error file={touched_path}::{result.message}")
        return 1

    print(result.message)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
