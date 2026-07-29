# MIRA Sight — verified SDK inventory

Last verified: **2026-07-29** (all facts below were re-checked against official sources on this
date, per PRD §3 "re-verify before implementation"). Anything not listed here is `unknown` —
never assume.

## Brilliant Labs Halo (initial hardware target)

| Fact | Value | Source / method |
|---|---|---|
| SDK monorepo | `brilliantlabsAR/brilliant_sdk`, default branch `main` | GitHub API |
| Repo license | **BSD-3-Clause** | GitHub API license field |
| Last push | 2026-07-18 | GitHub API |
| Releases/tags | **NONE** as of 2026-07-29 — versioning happens via package registries + commits | GitHub tags API (empty) |
| PyPI `brilliant-sdk` | **1.0.0** (single release; **no license metadata declared** — flag for review) | PyPI JSON API |
| npm `brilliant-sdk` | **1.0.1**, BSD-3-Clause | npm registry API |
| pub.dev `brilliant_sdk` | **2.0.0** | pub.dev API |
| Host SDK paths | Python / Flutter / Web Bluetooth (per official docs; not yet exercised here) | docs.brilliant.xyz (unverified-in-code) |
| On-device runtime | Lua 5.3 VM (per official docs; not yet exercised here) | docs.brilliant.xyz (unverified-in-code) |
| Camera video/streaming | **unknown** — do not assume; PRD §2.4 excludes continuous video regardless | — |
| NPU programmability | **unknown** (PRD explicitly forbids assuming it) | — |
| Industrial/hazloc certification | **not_verified** — treat as none | — |

**Version-lock discipline:** the registry versions above are recorded in
`config/mira-sight-sdk-baselines.lock.json`. The Halo adapter (Phase 3) discovers and pins
its own compatible versions at implementation time; this matrix is inventory, not a pin.

## Android XR (priority watch target — no hardware)

Official docs describe Jetpack Projected, Compose Glimmer, glasses emulation, ARCore for
Jetpack XR, capability/lifecycle APIs, active Developer Preview line. **Status: watch-only**
(PRD §3.2) — fingerprinted by the watcher; no adapter until Phase 7 and real evidence.

## RealWear / Vuzix / OpenXR / DigiLens / others

Watch-only per PRD §3.3. RealWear = Android + WearHF voice layer; Vuzix = Android glasses +
Speech/Connectivity SDKs; Magic Leap 2 = OpenXR. An adapter requires: official SDK,
acceptable terms, testable hardware or emulator, and a concrete MIRA capability gain
(PRD §12 scoring). None currently qualifies past "watch".
