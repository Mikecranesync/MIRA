// Unified FactoryLM technician shell: the shared FactoryLM shell (UnifiedRoot)
// owns the whole authenticated app — navigation drawer, conversation, evidence,
// About & updates, sign out. The classic five-tab presentation is retired from
// the runtime; rollback is by versioned release, not an in-app switch.
import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { Preferences } from "@capacitor/preferences";
import { invalidateLocalSessionRequests, onAuthExpired } from "./api/client";
import { createWorkOrder, getMe, signOut, type Me } from "./api/resources";
import {
  beginSessionLocalPurge,
  drainQueueForSessionPurge,
  pendingCount,
  preferencesStore,
  purgeAllQueues,
  resumeSessionLocalWrites,
  waitForSessionLocalProducers,
  waitForWorkOrderQueueProducers,
} from "./lib/offline-queue";
import { extractAssetTag } from "./lib/tags";
import { Login } from "./screens/Login";
import { UnifiedRoot, type UnifiedDeepLink } from "./screens/UnifiedRoot";
import { closeTopTransientLayer } from "./lib/transient-layer";
import { signOutSyncInProgressCopy, signOutWarningCopy } from "./lib/sign-out-copy";
const SECURE_CLEANUP_KEY = "flm.session.cleanup-required.v1";
// Native LiveUpdate rolls an unconfirmed bundle back after 10 seconds. Give a
// healthy local shell ample margin even when remote authentication is slow.
const BUNDLE_READY_FALLBACK_MS = 5_000;

let deepLinkSink: ((tag: string | null, raw: string) => void) | null = null;
export function handleDeepLink(url: string): void {
  const tag = extractAssetTag(url);
  deepLinkSink?.(tag, url);
}

type AppProps = {
  onBundleReady: () => void | Promise<void>;
};

export default function App({ onBundleReady }: AppProps) {
  const [me, setMe] = useState<Me | null>(null);
  const [booted, setBooted] = useState(false);
  // A deep link (QR sticker, app link) resolves inside the unified shell: the
  // tag opens the machine's notebook in the drawer, not a retired tab route.
  const [deepLink, setDeepLink] = useState<UnifiedDeepLink | null>(null);
  const [secureCleanupRequired, setSecureCleanupRequired] = useState(false);
  const [cleanupRetrying, setCleanupRetrying] = useState(false);
  const [cleanupRetryError, setCleanupRetryError] = useState<string | null>(null);
  // Each tab exposes a back-handler ref the shell calls on Android back.
  const backHandler = useRef<(() => boolean) | null>(null);
  const bundleAcknowledged = useRef(false);
  const bundleReadyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const acknowledgeBundle = useCallback(() => {
    if (bundleAcknowledged.current) return;
    bundleAcknowledged.current = true;
    void onBundleReady();
  }, [onBundleReady]);

  useEffect(() => {
    void (async () => {
      let cleanupMarker: { value: string | null };
      try {
        cleanupMarker = await Preferences.get({ key: SECURE_CLEANUP_KEY });
      } catch (error) {
        console.warn("[auth] cleanup marker could not be read", error);
        beginSessionLocalPurge();
        invalidateLocalSessionRequests();
        setSecureCleanupRequired(true);
        setBooted(true);
        return;
      }
      if (cleanupMarker.value === "required") {
        // Never reload a possibly stale persisted cookie before completing a
        // sign-out that a prior process could not durably verify.
        beginSessionLocalPurge();
        invalidateLocalSessionRequests();
        setSecureCleanupRequired(true);
        setBooted(true);
        return;
      }
      const m = await getMe();
      setMe(m);
      setBooted(true);
    })();
  }, []);

  // Prefer proving the selected Login/classic/unified root, but never make a
  // valid bundle's survival depend on a remote getMe() round trip. If auth is
  // slow or offline, the already-committed local boot shell is sufficient to
  // acknowledge before the native 10-second rollback deadline.
  useEffect(() => {
    bundleReadyTimer.current = setTimeout(acknowledgeBundle, BUNDLE_READY_FALLBACK_MS);
    return () => {
      if (bundleReadyTimer.current !== null) clearTimeout(bundleReadyTimer.current);
    };
  }, [acknowledgeBundle]);

  // In the normal fast path, acknowledge only after the selected root and all
  // of its children have rendered and committed successfully. A transition
  // render error is caught by the outer boot boundary before this effect runs.
  useEffect(() => {
    if (!booted) return;
    if (bundleReadyTimer.current !== null) clearTimeout(bundleReadyTimer.current);
    acknowledgeBundle();
  }, [acknowledgeBundle, booted]);

  // Session expiry anywhere → fail closed to login.
  useEffect(
    () =>
      onAuthExpired(() => {
        setMe(null);
      }),
    [],
  );

  // Deep links: hand the tag to the unified shell, which resolves it to the
  // machine's notebook (the same resolveScan flow the QR scanner uses).
  useEffect(() => {
    deepLinkSink = (tag, raw) => {
      setDeepLink({ tag, raw });
    };
    return () => {
      deepLinkSink = null;
    };
  }, []);

  // Android hardware back: give the active tab's stack first refusal.
  useEffect(() => {
    const sub = CapApp.addListener("backButton", ({ canGoBack: _ }) => {
      // An open transient layer (fullscreen viewer today; sheets to follow)
      // outranks every screen stack: BACK closes the most recently opened
      // layer first — viewer, then sheet, then navigation (#3427, PRD §11).
      if (closeTopTransientLayer()) return;
      const consumed = backHandler.current?.() ?? false;
      if (!consumed) void CapApp.minimizeApp();
    });
    return () => {
      void sub.then((s) => s.remove());
    };
  }, []);

  const completeSecureSignOut = async (): Promise<boolean> => {
    let cleanupFailed = false;
    try {
      await signOut();
    } catch (error) {
      cleanupFailed = true;
      console.warn("[auth] cookie cleanup could not be verified", error);
    }
    try {
      await purgeAllQueues(preferencesStore);
    } catch (error) {
      cleanupFailed = true;
      console.warn("[auth] tenant-local cleanup could not be verified", error);
    }

    if (!cleanupFailed) {
      try {
        await Preferences.remove({ key: SECURE_CLEANUP_KEY });
      } catch (error) {
        cleanupFailed = true;
        console.warn("[auth] cleanup marker could not be cleared", error);
      }
    }
    if (cleanupFailed) {
      try {
        await Preferences.set({ key: SECURE_CLEANUP_KEY, value: "required" });
      } catch (error) {
        console.warn("[auth] cleanup marker could not be refreshed", error);
      }
    }

    // Never leave an authenticated product surface visible after the user has
    // committed to sign out, even when durable cleanup must be retried.
    setMe(null);
    setSecureCleanupRequired(cleanupFailed);
    return !cleanupFailed;
  };

  const retrySecureCleanup = async () => {
    if (cleanupRetrying) return;
    setCleanupRetrying(true);
    setCleanupRetryError(null);
    beginSessionLocalPurge();
    invalidateLocalSessionRequests();
    try {
      try {
        await Preferences.set({ key: SECURE_CLEANUP_KEY, value: "required" });
      } catch (error) {
        console.warn("[auth] cleanup marker could not be armed for retry", error);
        setCleanupRetryError(
          "FactoryLM could not secure the cleanup retry. Your data remains locked. Try again.",
        );
        return;
      }
      await waitForWorkOrderQueueProducers();
      await waitForSessionLocalProducers();
      await completeSecureSignOut();
    } finally {
      setCleanupRetrying(false);
    }
  };

  if (!booted) return <div className="empty">FactoryLM…</div>;

  if (secureCleanupRequired) {
    return (
      <main className="empty" role="alert" aria-labelledby="secure-cleanup-heading">
        <h1 id="secure-cleanup-heading">Secure cleanup required</h1>
        <p>
          Access is locked because FactoryLM could not verify removal of this
          session&apos;s local data. Retry before signing in again.
        </p>
        {cleanupRetryError && <p role="status">{cleanupRetryError}</p>}
        <button type="button" disabled={cleanupRetrying} onClick={() => void retrySecureCleanup()}>
          {cleanupRetrying ? "Retrying secure cleanup…" : "Retry secure cleanup"}
        </button>
      </main>
    );
  }

  if (!me)
    return (
      <Login
        onSignedIn={async () => {
          const signedIn = await getMe();
          resumeSessionLocalWrites();
          setMe(signedIn);
        }}
      />
    );

  const signOutFlow = async () => {
    // Phase 4: local data never outlives the session — but try to sync
    // queued work orders first, and warn before destroying any.
    beginSessionLocalPurge();
    invalidateLocalSessionRequests();
    let canResumeCurrentSession = true;
    try {
      await waitForWorkOrderQueueProducers();
      if ((await pendingCount(preferencesStore, me.tenantId)) > 0) {
        const result = await drainQueueForSessionPurge(
          preferencesStore,
          me.tenantId,
          createWorkOrder,
          {
            retainRejected: true,
          },
        );
        if (result === null) {
          window.alert(signOutSyncInProgressCopy());
          resumeSessionLocalWrites();
          return;
        }
        const left = await pendingCount(preferencesStore, me.tenantId);
        const warning = signOutWarningCopy(left, result.rejected.length);
        if (warning && !window.confirm(warning)) {
          resumeSessionLocalWrites();
          return;
        }
      }
      await waitForSessionLocalProducers();
      try {
        await Preferences.set({ key: SECURE_CLEANUP_KEY, value: "required" });
      } catch (error) {
        console.warn("[auth] cleanup marker could not be armed", error);
        window.alert("Could not begin secure sign-out. Your session is still active; try again.");
        resumeSessionLocalWrites();
        return;
      }
      canResumeCurrentSession = false;
      await completeSecureSignOut();
    } catch (error) {
      if (canResumeCurrentSession) resumeSessionLocalWrites();
      throw error;
    }
  };

  return (
    <UnifiedRoot
      me={me}
      backRef={backHandler}
      onSignOut={signOutFlow}
      deepLink={deepLink}
      onDeepLinkConsumed={() => setDeepLink(null)}
    />
  );
}
