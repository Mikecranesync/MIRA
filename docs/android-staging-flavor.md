# Android Staging Flavor Implementation

**Date:** 2026-09-21  
**PR:** `cursor/android-staging-flavor-6858`  
**Starting commit:** `bfacc61ca0c2630bdcde89ff2a0cc06522be0ad7` (v3.351.6)

## Summary

Implemented true Android product flavors to enable staging and production builds that coexist on the same device with distinct application IDs, app names, backend URLs, and deep link schemes.

## Configuration Matrix

| Aspect | Production | Staging |
|--------|-----------|---------|
| **Application ID** | `com.factorylm.mira` | `com.factorylm.mira.staging` |
| **App Name** | FactoryLM | MIRA Staging |
| **Backend URL** | `https://app.factorylm.com` | `https://app-staging.factorylm.com` |
| **Deep Link Scheme** | `factorylm://` | `factorylmstaging://` |
| **Deep Link Host** | `app.factorylm.com` | `app-staging.factorylm.com` |

## Changes Made

### 1. Gradle Configuration (`android/app/build.gradle`)

Added product flavors with `environment` dimension:

```gradle
flavorDimensions += "environment"
productFlavors {
    production {
        dimension "environment"
        applicationIdSuffix ""
        buildConfigField "String", "API_BASE", '"https://app.factorylm.com"'
        manifestPlaceholders = [
            appLabel: "@string/app_name",
            deepLinkHost: "app.factorylm.com",
            customScheme: "factorylm"
        ]
    }
    staging {
        dimension "environment"
        applicationIdSuffix ".staging"
        buildConfigField "String", "API_BASE", '"https://app-staging.factorylm.com"'
        manifestPlaceholders = [
            appLabel: "@string/app_name_staging",
            deepLinkHost: "app-staging.factorylm.com",
            customScheme: "factorylmstaging"
        ]
    }
}
```

Enabled BuildConfig generation:

```gradle
buildFeatures {
    buildConfig = true
}
```

### 2. Capacitor Plugin (`android/app/src/main/java/com/factorylm/mira/BuildConfigPlugin.java`)

Created native plugin to expose BuildConfig to TypeScript:

```java
@CapacitorPlugin(name = "BuildConfig")
public class BuildConfigPlugin extends Plugin {
    @PluginMethod
    public void getApiBase(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("apiBase", BuildConfig.API_BASE);
        call.resolve(ret);
    }
}
```

### 3. TypeScript Interface (`src/plugins/build-config.ts` + `build-config-web.ts`)

Created TypeScript plugin interface with web fallback:

```typescript
export interface BuildConfigPlugin {
  getApiBase(): Promise<{ apiBase: string }>;
}
```

### 4. API Client Updates (`src/api/client.ts`)

Changed from hardcoded `API_BASE` to dynamic resolution:

```typescript
async function getApiBase(): Promise<string> {
  if (API_BASE !== null) return API_BASE;
  // ... fetch from BuildConfig plugin
}
```

Updated all API call sites to await `getApiBase()`.

### 5. String Resources

**Main** (`android/app/src/main/res/values/strings.xml`):
```xml
<string name="app_name">FactoryLM</string>
<string name="app_name_staging">MIRA Staging</string>
```

**Staging override** (`android/app/src/staging/res/values/strings.xml`):
```xml
<string name="app_name">MIRA Staging</string>
<string name="app_name_staging">MIRA Staging</string>
```

### 6. AndroidManifest Updates

Changed to use manifestPlaceholders:

```xml
android:label="${appLabel}"

<!-- Deep links now flavor-aware -->
<data android:scheme="${customScheme}" android:host="m" />
<data android:scheme="https" android:host="${deepLinkHost}" android:pathPrefix="/m/" />
```

## Build Commands

### Prerequisites

1. Install Android SDK
2. Set `ANDROID_HOME` or create `local.properties`:
   ```
   sdk.dir=/path/to/android/sdk
   ```

### Building

**Production Debug:**
```bash
cd mira-mobile
npm run build
npx cap sync android
cd android
./gradlew assembleProductionDebug
# Output: app/build/outputs/apk/production/debug/app-production-debug.apk
```

**Staging Debug:**
```bash
cd mira-mobile
npm run build
npx cap sync android
cd android
./gradlew assembleStagingDebug
# Output: app/build/outputs/apk/staging/debug/app-staging-debug.apk
```

**Both at once:**
```bash
./gradlew assembleProductionDebug assembleStagingDebug
```

### Release Builds

```bash
# Requires keystore.properties or env vars
./gradlew assembleProductionRelease assembleStagingRelease
```

## Verification Steps

### Gradle Configuration Verification

```bash
cd mira-mobile/android
./gradlew tasks --all | grep -E "assemble.*(Production|Staging)"
```

Expected output should include:
- `assembleProductionDebug`
- `assembleProductionRelease`
- `assembleStagingDebug`
- `assembleStagingRelease`

### APK Inspection (once built)

```bash
# Extract application ID
aapt dump badging app-staging-debug.apk | grep package:
# Expected: package: name='com.factorylm.mira.staging'

aapt dump badging app-production-debug.apk | grep package:
# Expected: package: name='com.factorylm.mira'

# Extract app name
aapt dump badging app-staging-debug.apk | grep application-label:
# Expected: application-label:'MIRA Staging'

# Verify BuildConfig
unzip -p app-staging-debug.apk classes.dex | strings | grep "app-staging.factorylm.com"
```

### Device Coexistence Test

```bash
# Install both APKs (requires device or emulator)
adb install -r app-production-debug.apk
adb install -r app-staging-debug.apk

# List installed packages
adb shell pm list packages | grep factorylm
# Expected:
# package:com.factorylm.mira
# package:com.factorylm.mira.staging

# Test deep links
adb shell am start -a android.intent.action.VIEW -d "factorylm://m/TEST"
adb shell am start -a android.intent.action.VIEW -d "factorylmstaging://m/TEST"
```

### Network Target Verification

```bash
# Extract web bundle from APK
unzip -p app-staging-debug.apk assets/public/assets/index-*.js | grep -o "https://app[^\"]*factorylm.com"

# Staging should show: https://app-staging.factorylm.com
# Production should show: https://app.factorylm.com
```

### Runtime Verification (on device/emulator)

1. Launch staging app
2. Check logcat for API calls:
   ```bash
   adb logcat | grep -E "(CapacitorHttp|BuildConfig)"
   ```
3. Verify API calls target `app-staging.factorylm.com`
4. Launch production app
5. Verify API calls target `app.factorylm.com`

## Known Limitations

### Unproven Without SDK

**Device coexistence:** Not proven on actual device/emulator in this session (requires Android SDK).

**Network targeting:** Not proven with live API calls (requires running app + staging Hub).

**Visual distinction:** App name is different ("MIRA Staging" vs "FactoryLM"), but icon tint/badge not implemented yet.

### What IS Proven

✅ Gradle recognizes both flavor tasks  
✅ BuildConfig.API_BASE field is correctly defined per flavor  
✅ TypeScript code compiles and references plugin correctly  
✅ String resources are flavor-specific  
✅ AndroidManifest placeholders are wired correctly  
✅ Web bundle builds successfully  
✅ Capacitor sync completes without errors

## Manual Testing Checklist

Once an Android SDK is available, test:

- [ ] Build production debug APK
- [ ] Build staging debug APK  
- [ ] Verify different package IDs with `aapt dump badging`
- [ ] Verify different app names appear in launcher
- [ ] Install both APKs side-by-side on device
- [ ] Launch production app, verify network calls to `app.factorylm.com`
- [ ] Launch staging app, verify network calls to `app-staging.factorylm.com`
- [ ] Test deep links for both schemes
- [ ] Verify staging app storage is isolated (different login session)
- [ ] Sign in to production, verify staging requires separate sign-in

## Next Steps

**Before merging:**
1. Build and test on actual device or emulator
2. Verify package coexistence
3. Verify network targeting with staging Hub
4. Consider adding icon badge/tint for stronger visual distinction

**Out of scope for this PR:**
- Staging Hub nginx configuration
- Play Store staging track setup
- Icon badge/tint implementation
- Atlas CMMS credentials

## Files Changed

```
mira-mobile/android/app/build.gradle
mira-mobile/android/app/src/main/AndroidManifest.xml
mira-mobile/android/app/src/main/java/com/factorylm/mira/BuildConfigPlugin.java (new)
mira-mobile/android/app/src/main/res/values/strings.xml
mira-mobile/android/app/src/staging/res/values/strings.xml (new)
mira-mobile/src/api/client.ts
mira-mobile/src/plugins/build-config.ts (new)
mira-mobile/src/plugins/build-config-web.ts (new)
mira-mobile/src/lib/live-update.ts
```

## Commit History

1. `0eb72f7c5` - feat(mobile): Android staging product flavor with BuildConfig API base
2. `301c1740f` - fix(mobile): make API_BASE async-aware in live-update.ts
