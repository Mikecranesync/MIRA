---
source: https://docs.openwebui.com / https://github.com/open-webui/open-webui
version: v0.8.6 (latest as of 2026-04-19; v0.8.x series active)
fetched_date: 2026-04-19
summary: >
  Shelf reference for Open WebUI mobile/PWA behavior, theming & branding options,
  voice I/O, input affordances, and interactive UI features. Covers every env var
  and admin-panel path relevant to customizing OW for plant-floor mobile use.
---

# Open WebUI — Mobile, PWA & Theming Reference

## Quick Reference

| Concern | Mechanism | Key env var / path |
|---|---|---|
| App name in UI | Env var | `WEBUI_NAME=MIRA` |
| PWA manifest override | Env var | `EXTERNAL_PWA_MANIFEST_URL=https://…/manifest.webmanifest` |
| Disable new signups | Env var (PersistentConfig) | `ENABLE_SIGNUP=False` |
| Auto-create admin | Env var | `WEBUI_ADMIN_EMAIL` + `WEBUI_ADMIN_PASSWORD` |
| Disable login form (SSO-only) | Env var (PersistentConfig) | `ENABLE_LOGIN_FORM=False` |
| Disable auth entirely | Env var | `WEBUI_AUTH=False` |
| Notification banners | Env var (PersistentConfig) | `WEBUI_BANNERS=[{…}]` |
| Default prompt suggestions | Env var | `DEFAULT_PROMPT_SUGGESTIONS=[…]` |
| Follow-up generation | Env var (PersistentConfig) | `ENABLE_FOLLOW_UP_GENERATION=True` (default on) |
| Whisper model size | Env var | `WHISPER_MODEL=base` |
| Cloud STT engine | Env var | `AUDIO_STT_ENGINE=openai` + `AUDIO_STT_OPENAI_API_KEY` |
| TTS engine | Env var | `AUDIO_TTS_ENGINE=openai|elevenlabs|azure|transformers` |
| Favicon/logo override | Docker layer or nginx sub_filter | (see Theming section) |
| White-label (logo/colors) | Enterprise license | `LICENSE_KEY` |
| HTTPS required for STT/TTS | Infra constraint | Serve over TLS |
| Streaming batch size | Env var | `CHAT_RESPONSE_STREAM_DELTA_CHUNK_SIZE=1` |

---

## 1. PWA / Installability

Open WebUI ships a `manifest.json` and qualifies as an installable PWA on HTTPS deployments. The maintainers explicitly treat PWA as the preferred mobile delivery path over native apps ([discussion #3031](https://github.com/open-webui/open-webui/discussions/3031)).

**What ships by default:**
- `manifest.json` is present and served at `/manifest.json`
- Add-to-home-screen prompt fires in Chrome/Safari when served over HTTPS
- Standalone display mode removes the browser chrome (address bar)

**Configuring the manifest:**
- `EXTERNAL_PWA_MANIFEST_URL` — set to a fully-qualified URL (e.g., `https://app.factorylm.com/mira.webmanifest`) and OW proxies that file for all `/manifest.json` requests. Use this to set a custom `name`, `short_name`, `theme_color`, `background_color`, and `icons` without rebuilding the image. Default: empty (uses built-in manifest).

**Known issues:**
- Android: Multiple users report Chrome on Android no longer installs as a full PWA — it falls back to "add to home screen" only (opens in browser tab, not standalone). Confirmed broken on Pixel 7 / Android 16 as of February 2025. No upstream fix yet. ([discussion #8964](https://github.com/open-webui/open-webui/discussions/8964))
- Local domain / reverse proxy: PWA install can silently fail if `WEBUI_URL` is not set to the public HTTPS URL. Set `WEBUI_URL=https://app.factorylm.com`.
- Service worker scope: not separately documented; assumed to cover `/` origin.

---

## 2. Mobile Responsive Layout

OW is built with Tailwind CSS and is responsive by default. There is no separate "mobile mode" env var or admin toggle.

**Breakpoints (Tailwind defaults, not officially documented separately):**
- `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px

**Sidebar behavior:** collapses to a hamburger/overlay on narrow viewports. The sidebar open/close state is local to the browser session.

**No dedicated mobile layout mode** — OW adapts the same component tree responsively. There is no `MOBILE_MODE` env var.

**Admin path:** none for layout; it is purely CSS-driven.

---

## 3. Viewport, Touch & Keyboard Behavior

**Viewport meta tag:** present in the OW HTML template (`content="width=device-width, initial-scale=1"`). No env var to override.

**iOS Safari known issues:**
- **Voice/Call feature regression (v0.5.11–v0.5.16):** tapping the Call icon caused a full page refresh instead of opening the mic. Root cause: kokoro.js in-browser TTS engine introduced after v0.5.10 caused excessive memory use and crashed the tab. **Fixed in v0.5.17.** As of iOS 18.4 the fix may be incomplete on some configs. ([discussion #10103](https://github.com/open-webui/open-webui/discussions/10103))
- **iPadOS 26:** left sidebar blocked by traffic-light button in landscape — touch area overlap. No upstream fix confirmed.
- **Keyboard push (iOS):** the virtual keyboard can push the viewport up; no OW-specific workaround is documented. Standard `height: 100dvh` approach applies.

**Android Chrome known issues:**
- Camera Capture button unresponsive on Android 14 / One UI 6.1, Chrome Mobile v123. Desktop works fine. No fix as of v0.6.34. ([discussion #13339](https://github.com/open-webui/open-webui/discussions/13339))
- PWA install degrades to "add to home screen" (see §1).

**HTTPS requirement:** microphone access (STT, voice mode) is blocked by all modern mobile browsers unless the app is served over HTTPS. `localhost` is the only allowed exception. ([troubleshooting/audio](https://docs.openwebui.com/troubleshooting/audio/))

---

## 4. Theming & Branding

### Env vars / free tier

| Var | Default | Effect |
|---|---|---|
| `WEBUI_NAME` | `Open WebUI` | Sets the display name in the UI header. Note: appends "(Open WebUI)" when overridden unless enterprise license is active. |
| `WEBUI_BANNERS` | `[]` | PersistentConfig. JSON array of dismissible banners: `[{"id":"b1","type":"info","title":"…","content":"…","dismissible":true}]`. Type values: `info`, `success`, `warning`, `error`. |
| `ENABLE_EASTER_EGGS` | `True` | Set `False` to hide the "Her" theme and other novelty UI options. |
| `STATIC_DIR` | `./static` | Base path for static assets. **Overwritten on every container start** by files from `FRONTEND_BUILD_DIR`. |

### Logo / favicon override (free, but fiddly)

Direct file replacement in `STATIC_DIR` does not survive container restarts because OW copies from the frontend build directory at startup. Two working approaches:

1. **Custom Docker layer (recommended):**
   ```dockerfile
   FROM ghcr.io/open-webui/open-webui:0.8.6
   COPY ./branding/static /app/build/static
   ```
   Files in `/app/build/static` are what OW copies from, so they propagate correctly. Place `favicon.png`, `logo.png`, etc. here.

2. **Nginx `sub_filter`:** inject `<link rel="icon">` tags via proxy to override the browser's favicon resolution without touching the container. ([issue #5417](https://github.com/open-webui/open-webui/issues/5417))

### Custom CSS (free, community approach)

There is no official admin-panel CSS injection field in the free tier as of v0.8.6. Community approach:

- Add a `<style>` or `<link>` tag via nginx `sub_filter` (same proxy method as favicon).
- Override Tailwind CSS selectors. OW uses Tailwind utility classes, so specificity requires careful targeting. Selectors can break on minor OW updates.
- Dark/light mode classes: OW adds `dark` class to `<html>` when dark mode is active.

**Admin panel → Settings → Interface** has a "Theme" toggle (System / Dark / Light) per-user. There is no instance-wide force-dark env var; dark mode is user-controlled.

### Enterprise white-labeling

Full white-label (custom logo, colors, remove "Open WebUI" branding, custom CSS field in admin panel) requires an enterprise license via `LICENSE_KEY`. Contact sales@openwebui.com. ([enterprise/customization](https://docs.openwebui.com/enterprise/customization/))

### Tab title / browser title

`WEBUI_NAME` affects the in-app title. The `<title>` HTML tag is set from the same value. Custom tab titles beyond `WEBUI_NAME` require a Docker layer or nginx `sub_filter`. ([discussion #8640](https://github.com/open-webui/open-webui/discussions/8640))

### Dark mode

- Default: follows OS/system preference ("System" mode).
- User toggle: Settings → Interface → Theme (System / Dark / Light). Per-user, persisted in the browser.
- Instance-wide force: not available in free tier via env var. Enterprise CSS injection is the only path to enforce it for all users.

---

## 5. Voice I/O

STT and TTS both require HTTPS (see §3).

### Speech-to-Text (STT)

**Admin panel path:** Admin Panel → Settings → Audio → Speech-to-Text

| Var | Default | Notes |
|---|---|---|
| `WHISPER_MODEL` | `base` | Local model size: `tiny`, `base`, `small`, `medium`, `large-v3`. |
| `WHISPER_MODEL_DIR` | `{CACHE_DIR}/whisper/models` | Cache location. |
| `WHISPER_COMPUTE_TYPE` | `int8` | GPU: `float16`. CPU: `int8`. |
| `WHISPER_LANGUAGE` | `` (auto) | ISO 639-1 code, e.g. `en`. |
| `WHISPER_MULTILINGUAL` | `false` | Enable multilingual model. |
| `WHISPER_VAD_FILTER` | `false` | Voice activity detection pre-filter. |
| `AUDIO_STT_ENGINE` | `` (local Whisper) | `openai`, `azure`, `deepgram`, `mistral`, or empty for local. |
| `AUDIO_STT_OPENAI_API_BASE_URL` | `https://api.openai.com/v1` | Override for any OpenAI-compatible endpoint. |
| `AUDIO_STT_OPENAI_API_KEY` | `` | API key for cloud STT. |
| `AUDIO_STT_MODEL` | `` | Model ID, e.g. `whisper-1`. |

Users can also select "Web API" engine in their personal settings, which uses the browser's built-in SpeechRecognition (no server roundtrip, works offline; quality varies by device).

**UI affordances:** microphone icon in chat input → live waveform → checkmark to submit / X to cancel. This is always visible; no config to hide it per-user except via custom CSS.

### Text-to-Speech (TTS)

**Admin panel path:** Admin Panel → Settings → Audio → Text-to-Speech

| Var | Default | Notes |
|---|---|---|
| `AUDIO_TTS_ENGINE` | `` (browser) | `openai`, `elevenlabs`, `azure`, `transformers`. Empty = browser Web Speech API. |
| `AUDIO_TTS_MODEL` | `tts-1` | OpenAI model. |
| `AUDIO_TTS_VOICE` | `alloy` | Voice name for OpenAI/ElevenLabs. |
| `AUDIO_TTS_OPENAI_API_BASE_URL` | `https://api.openai.com/v1` | Override for self-hosted TTS. |
| `AUDIO_TTS_OPENAI_API_KEY` | `` | API key. |
| `AUDIO_TTS_SPLIT_ON` | `punctuation` | `punctuation` or `none` — affects streaming start latency. |
| `AUDIO_TTS_AZURE_SPEECH_REGION` | `eastus` | Azure TTS region. |

**Voice mode / hands-free:** enabled via Settings → Interface → Conversation Mode. Activates a full-screen voice UI (push-to-talk + auto-TTS). The Call icon in the chat header opens it. iOS Safari issue in v0.5.11–0.5.16 (see §3).

---

## 6. Input Affordances

All of the following work on desktop. Mobile support is noted:

| Feature | Desktop | Mobile | Config |
|---|---|---|---|
| Text input | Yes | Yes | — |
| File upload (PDF, images, docs) | Yes | Yes | `ENABLE_FILE_UPLOAD` (admin toggle) |
| Drag-and-drop files | Yes | Limited (OS-dependent) | — |
| Paste image from clipboard | Yes | Partial (Android Chrome) | — |
| Camera capture (live photo) | Yes | Broken on Android 14 / One UI 6.1 | No env var; hardware-dependent |
| Image generation prompt | Yes | Yes | Requires image gen backend |

Permissions for file upload and screen capture can be restricted per-user or per-role in Admin Panel → Admin Settings → User Permissions. The upload/capture button remains visible in the UI even when disabled (tracked in [issue #8881](https://github.com/open-webui/open-webui/issues/8881)).

---

## 7. Interactive UI Features

| Feature | Status | Config |
|---|---|---|
| Suggested prompts (empty state) | Built-in; configurable | `DEFAULT_PROMPT_SUGGESTIONS=[…]` (env var, JSON array) or Admin Panel → Settings → Interface |
| Follow-up question chips (after response) | On by default | `ENABLE_FOLLOW_UP_GENERATION=True`; user toggle in Settings → Interface → Chat |
| Follow-up template | Customizable | `FOLLOW_UP_GENERATION_PROMPT_TEMPLATE` |
| Feedback thumbs up/down | On by default | `ENABLE_MESSAGE_RATING=True` (PersistentConfig) |
| Copy message button | Always present | No config to remove (enterprise CSS only) |
| Regenerate response button | Always present | — |
| Message editing (user turn) | Yes | — |
| Branching / conversation forks | Yes | — |
| Emoji reactions | Channels feature only | `ENABLE_CHANNELS=False` (default off) |
| Share chat (public link) | `ENABLE_COMMUNITY_SHARING=True` | PersistentConfig; set `False` to disable |
| Response watermark on copy | `RESPONSE_WATERMARK=` | PersistentConfig; set to custom text appended when copying messages |
| Auto-complete suggestions (mid-typing) | `ENABLE_AUTOCOMPLETE_GENERATION=True` | PersistentConfig |

---

## 8. Streaming UX

- **Streaming is on by default.** Individual users can disable it in chat's Advanced Settings → "Stream Chat Response: Off".
- `CHAT_RESPONSE_STREAM_DELTA_CHUNK_SIZE=1` — minimum token count batched before sending to client. Increase for slower-network clients (reduces repaints). Default: `1`.
- `CHAT_STREAM_RESPONSE_CHUNK_MAX_BUFFER_SIZE` — max buffer bytes (e.g., `16777216`). Default: disabled.
- The typing cursor is a built-in CSS animation on the streaming text. It is not configurable via env var; override via custom CSS (`.cursor` or similar selector — may change between versions).
- `ENABLE_REALTIME_CHAT_SAVE=False` — avoid enabling; writes every streaming chunk to the DB and carries a significant performance cost.

---

## 9. Dark Mode

- Default behavior: follows OS system preference.
- User toggle: Settings → Interface → Theme: System / Light / Dark. Persisted per-user in browser localStorage.
- No env var to force a specific theme instance-wide.
- Enterprise license required to inject CSS that could lock the theme.
- Bug (dev builds only): theme selection fails to persist when running `npm run dev`. Works correctly in Docker builds. ([discussion #10837](https://github.com/open-webui/open-webui/discussions/10837))

---

## 10. Login & Onboarding

| Scenario | How to achieve | Var(s) |
|---|---|---|
| Auto-create admin on first start | Set both admin vars | `WEBUI_ADMIN_EMAIL`, `WEBUI_ADMIN_PASSWORD` |
| Disable self-registration | Prevent new signups | `ENABLE_SIGNUP=False` (PersistentConfig) |
| New users auto-approved | Change default role | `DEFAULT_USER_ROLE=user` (PersistentConfig; default is `pending`) |
| Force SSO-only (hide password form) | Remove login form | `ENABLE_LOGIN_FORM=False` + `ENABLE_PASSWORD_AUTH=False` |
| Disable auth entirely (trusted network) | | `WEBUI_AUTH=False` |
| Custom "pending approval" message | Overlay text | `PENDING_USER_OVERLAY_TITLE`, `PENDING_USER_OVERLAY_CONTENT` (PersistentConfig) |
| Persistent JWT across restarts | Required for Docker | `WEBUI_SECRET_KEY=<stable-secret>` — must be set; default is random per restart |
| Session cookie on HTTPS behind proxy | Secure cookies | `WEBUI_SESSION_COOKIE_SECURE=True`, `WEBUI_AUTH_COOKIE_SECURE=True` |

**PersistentConfig note:** variables marked PersistentConfig are only read from the environment on **first launch** (or when `RESET_CONFIG_ON_START=True`). After that, the database value wins. To force a re-read, set `ENABLE_PERSISTENT_CONFIG=False` (disables DB override entirely) or `RESET_CONFIG_ON_START=True` (resets on every boot — use with caution in prod).

---

## Known Mobile Gotchas

1. **STT/TTS require HTTPS** — will silently fail on `http://` in all modern mobile browsers. No workaround without serving TLS.
2. **Camera Capture broken on Android 14 / One UI 6.1** — `<input capture>` attribute not triggering on Chrome Mobile v123+. No upstream fix. ([discussion #13339](https://github.com/open-webui/open-webui/discussions/13339))
3. **iOS Voice/Call feature** — was broken in v0.5.11–0.5.16 (page refresh on tap). Fixed in v0.5.17 but "spotty" on iOS 18.4+. ([discussion #10103](https://github.com/open-webui/open-webui/discussions/10103))
4. **Android PWA degrades to bookmark** — Chrome on Android 16 / modern Android no longer installs OW as a standalone app; opens in browser tab instead. ([discussion #8964](https://github.com/open-webui/open-webui/discussions/8964))
5. **WEBUI_SECRET_KEY not set** — users get logged out on every container restart ("Error decrypting tokens"). Always set this in prod.
6. **`WEBUI_URL` not set** — PWA install and OAuth/SSO redirects break. Set to the public HTTPS URL.
7. **iPadOS 26 sidebar** — traffic-light buttons overlap the sidebar toggle in landscape. No workaround documented.

---

## Unsupported / Upstream Issues

| Feature | Status | Issue |
|---|---|---|
| Native iOS / Android app | Not planned by maintainers; community forks exist | [discussion #3031](https://github.com/open-webui/open-webui/discussions/3031) |
| Instance-wide theme lock (force dark) | Free tier: not available. Enterprise CSS only. | [issue #1065](https://github.com/open-webui/open-webui/issues/1065) |
| Admin-panel CSS injection (free) | Not available; enterprise feature | [issue #316](https://github.com/open-webui/open-webui/issues/316) |
| Persistent favicon via `STATIC_DIR` | Overwritten on every restart | [issue #5417](https://github.com/open-webui/open-webui/issues/5417), [discussion #6549](https://github.com/open-webui/open-webui/discussions/6549) |
| Disable Capture button via UI when permission denied | Button stays visible even when disabled | [issue #8881](https://github.com/open-webui/open-webui/issues/8881) |
| Android PWA standalone install | Broken on modern Android Chrome (degrades to add-to-home-screen) | [discussion #8964](https://github.com/open-webui/open-webui/discussions/8964) |
| Allow disabling prompt suggestions via env var | Feature-requested, not yet merged | [discussion #15710](https://github.com/open-webui/open-webui/discussions/15710) |
| Custom follow-up suggestions | Feature-requested | [issue #15635](https://github.com/open-webui/open-webui/issues/15635) |
| `WEBUI_NAME` without "(Open WebUI)" suffix in free tier | Appends brand suffix unless enterprise license active | [discussion #8301](https://github.com/open-webui/open-webui/discussions/8301) |
