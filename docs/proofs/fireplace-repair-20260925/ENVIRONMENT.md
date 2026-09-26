# Local candidate test environment

## Start here — plain-language summary

This describes the separate test setup. It ran on the Mac and a test phone or emulator; it did not update the customer-facing app.

[Read the complete plain-language report on GitHub](https://github.com/Mikecranesync/MIRA/pull/3999#issuecomment-5841521419). It separates what works, what still fails, and what has actually been published.

<details>
<summary>Technical test record for developers</summary>

Fresh isolated branch from main f41e57054dda30600246c5f835c46c48df4fa069. Integrated existing #3845 b00d1696cfe2f04a6f6763e755927869aa7acfb9 and #3807 4ad969ddbb45a0e613c6b781c6499e60072a297f, original worktrees untouched.

Physical Pixel9a55081JEBF07026 connected; baseline staging1.2.1/build12 retained until candidate install. Production package untouched. Node dependencies installed from lockfiles (Hub npm ci, root bun frozen lock); mobile lock/package-identical dependencies reused from prior proof worktree. JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home; ANDROID_HOME=/opt/homebrew/share/android-commandlinetools.

Local Next HTTPS at127.0.0.1:4443; USB adb reverse443→4443, native test BuildConfig https://127.0.0.1 (distinct from the Capacitor asset origin https://localhost). Temporary Gradle init overrides stagingDebug only via isolated build: version13/1.2.1-fireplace-local and local-only TLS trust anchor. System trust unchanged, cleartext forbidden, production flavor untouched, no device-global CA installed. Temporary cert/key/config outside repo /tmp/mira-fireplace-localqa; not a release artifact. No trust weakening committed.

Backend environment is Doppler factorylm/stg; staging DB hostname independently verified ep-polished-hall-ahcqtcxe-pooler.c-3.us-east-1.aws.neon.tech. Auth and vision secrets injected without printing. Normal designated staging QA login establishes a cookie for the local native origin. Existing production login is untouched. TOGETHERAI_VISION_MODEL configured MiniMaxAI/MiniMax-M3; unchanged provider/model. MIRA_TURN_RECONCILER=0 for this local instance; basePath empty; no production or shared staging deployment. LOOK originals live in scoped staging DB BYTEA, existing implementation. No fixture-mode answers.

Local developer run is candidate QA, not deployed-stage or release acceptance. Final source and APK hashes, prompt/output evidence and remaining limitations will be appended after code freeze.

</details>
