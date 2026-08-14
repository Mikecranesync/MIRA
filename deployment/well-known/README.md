# App/Universal Link well-known files (ADR-0034 Phase 4 — server gate)

Static files Android and iOS fetch from the **prod origin** to verify that the
FactoryLM app may claim `https://app.factorylm.com/m/<TAG>` links.

| File | Consumer | Status |
|---|---|---|
| `assetlinks.json` | Android App Links (`autoVerify` in the mobile manifest) | fingerprint = **debug keystore** on the dev laptop (works for dev/emulator installs). **Replace with the release-signing cert SHA-256 before store distribution** (`keytool -list -v -keystore <release.keystore>` → SHA256 line; multiple fingerprints may coexist in the array — keep debug + add release). |
| `apple-app-site-association` | iOS Universal Links | `REPLACE_TEAM_ID` placeholder — needs the Apple Developer Team ID (Phase 5, macOS/signing step). Must be served **without a file extension** and with `Content-Type: application/json`. |

## Deploy (prod nginx — via the normal gated path, never hand-edited)

1. Copy both files to the VPS: `/opt/mira/well-known/`.
2. Add to the `app.factorylm.com` server block in
   `deployment/nginx-app-factorylm.conf` (already contains the snippet below),
   then `nginx -t && nginx -s reload` through the sanctioned deploy path:

```nginx
    # App/Universal Links verification (ADR-0034 Phase 4)
    location = /.well-known/assetlinks.json {
        alias /opt/mira/well-known/assetlinks.json;
        default_type application/json;
        add_header Cache-Control "max-age=3600" always;
    }
    location = /.well-known/apple-app-site-association {
        alias /opt/mira/well-known/apple-app-site-association;
        default_type application/json;
        add_header Cache-Control "max-age=3600" always;
    }
```

(Exact-match locations only — `/.well-known/acme-challenge/` for certbot is
untouched.)

## Verify after deploy

```bash
curl -s https://app.factorylm.com/.well-known/assetlinks.json | jq .
curl -sI https://app.factorylm.com/.well-known/apple-app-site-association | grep -i content-type
# Android end-to-end (device/emulator with the app installed):
adb shell pm verify-app-links --re-verify com.factorylm.mira
adb shell pm get-app-links com.factorylm.mira   # expect "verified"
```
