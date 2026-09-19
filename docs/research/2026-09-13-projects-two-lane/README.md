# Projects and two-lane MIRA — research pack

Date: 2026-09-13. Publication: [draft PR #3791](https://github.com/Mikecranesync/MIRA/pull/3791).

**Start with [CLAUDE_IMPLEMENTATION_GUIDE.md](CLAUDE_IMPLEMENTATION_GUIDE.md).** It guides both implementations: completing Projects in V7 and making general/evidence-based answers useful, honest, and consistent across the same conversation.

| Artifact | Purpose |
| --- | --- |
| [Projects interaction research](FactoryLM-Projects-Next-Build-Brief.md) | Full UI inventory, desktop/phone behavior, 15-state signed-in capture checklist, source scope, and Projects acceptance tests. |
| [Two-lane research](TWO_LANE_RESEARCH.md) | Repository findings, corrections to the proposed gate, streaming/safety implications, reuse candidates, and an estimated work breakdown. |
| [Combined Claude guide](CLAUDE_IMPLEMENTATION_GUIDE.md) | Execution sequence, ownership checks, deliverables, acceptance evidence, and a copy/paste starting prompt. |
| [Expanded sidebar](chatgpt-sidebar-reference-20260913.jpg) | Genuine signed-out ChatGPT desktop capture. |
| [Collapsed sidebar](chatgpt-collapsed-reference-20260913.jpg) | Genuine signed-out ChatGPT desktop capture. |
| [Composer menu](chatgpt-attachment-menu-reference-20260913.jpg) | Genuine signed-out ChatGPT desktop capture. |

## Authority and limitations

This is an implementation research supplement. Mike's explicit direction and applicable current repository contracts remain authoritative. The documents do not silently replace the UI design policy, cutover charter, or issue #3787; proposed refinements must be reconciled into their existing canonical records during implementation.

ChatGPT evidence is **OBSERVED** only for the signed-out desktop shell. Its Projects organization is **DOCUMENTED** in linked official sources. Authenticated Projects drawers/dialogs and native Android reference behavior are **NOT CAPTURED**. Proposed FactoryLM behavior is labeled separately; do not fabricate missing reference screenshots.

MIRA code findings are from static inspection at `b5bcc102c3b46eb3cafa2afb44a74a74716a6e44`. Recorded benchmark outcomes are attributed to PR #3789 and its issues. This research ran no MIRA application tests, deployed no application changes, and performed no phone installation. The three screenshot files were preserved byte-for-byte and their Git blob hashes checked at publication.

The publication contains research and guidance. Both implementation tracks remain to be verified against current code and runtime state.
