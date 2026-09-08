// Five-tab FactoryLM technician shell (ADR-0034 Phase 3) — renders the frozen
// mobile contract from the ONE canonical nav model (src/nav.ts), capability-
// filtered fail-closed. Per-tab navigation stacks; Android back pops the
// active stack before backgrounding; active tab persists across launches.
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
import { TABS, can, visibleTabs, type TabId } from "./nav";
import { extractAssetTag } from "./lib/tags";
import { openNotebookTransition } from "./lib/scan-landing";
import { Login } from "./screens/Login";
import { WorkordersTab } from "./screens/Workorders";
import { ScheduleTab } from "./screens/Schedule";
import { NotebooksTab, type NotebookRoute } from "./screens/NotebooksTab";
import { UnifiedRoot } from "./screens/UnifiedRoot";
import { readChatUiChoice, writeChatUiChoice, type ChatUiChoice } from "./lib/chat-ui-pref";
import { closeTopTransientLayer } from "./lib/transient-layer";
import { signOutSyncInProgressCopy, signOutWarningCopy } from "./lib/sign-out-copy";
import { AssetsTab, type AssetsRoute } from "./screens/AssetsTab";
import { MoreTab } from "./screens/More";

const TAB_KEY = "flm.activeTab.v1";
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
  const [tab, setTab] = useState<TabId>("workorders");
  const [assetsRoute, setAssetsRoute] = useState<AssetsRoute>({ name: "list" });
  // Lifted for the same reason AssetsRoute is: a scan has to switch the tab AND
  // set the route in one go. Doing only the first drops the technician on the
  // notebook list, one tap away from the machine they are standing next to.
  const [notebookRoute, setNotebookRoute] = useState<NotebookRoute>({ name: "home" });
  // FLM-UI-4000 unified root: when the device prefers the unified shell, it
  // owns the whole app (navigation, header, conversation) instead of the tabs.
  const [chatUi, setChatUi] = useState<ChatUiChoice | null>(null);
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
      const [{ value: savedTab }, m, choice] = await Promise.all([
        Preferences.get({ key: TAB_KEY }).catch((error) => {
          console.warn("[boot] saved tab unavailable; using default", error);
          return { value: null };
        }),
        getMe(),
        readChatUiChoice(),
      ]);
      if (savedTab && TABS.some((t) => t.id === savedTab)) setTab(savedTab as TabId);
      setChatUi(choice);
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

  // Deep links: land on the Assets tab's tag-resolution route.
  useEffect(() => {
    deepLinkSink = (tag, raw) => {
      setTab("assets");
      setAssetsRoute(
        tag ? { name: "tag", tag } : { name: "tag", tag: "", error: `Unrecognized link: ${raw}` },
      );
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

  const selectTab = (id: TabId) => {
    setTab(id);
    void Preferences.set({ key: TAB_KEY, value: id });
  };

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

  const tabs = visibleTabs(me.capabilities);

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

  if (chatUi === "unified") {
    return (
      <UnifiedRoot
        me={me}
        backRef={backHandler}
        onSignOut={signOutFlow}
        onSwitchClassic={() => {
          void writeChatUiChoice("legacy");
          setChatUi("legacy");
        }}
      />
    );
  }

  return (
    <div className="shell">
      <div className="topbar">
        <span>
          FactoryLM <small>{me.email}</small>
        </span>
      </div>

      <div className="tabhost">
        {tab === "workorders" && <WorkordersTab me={me} backRef={backHandler} />}
        {tab === "schedule" && <ScheduleTab me={me} backRef={backHandler} />}
        {tab === "chat" && (
          <NotebooksTab
            backRef={backHandler}
            route={notebookRoute}
            setRoute={setNotebookRoute}
            capabilities={me.capabilities}
          />
        )}
        {tab === "assets" && (
          <AssetsTab
            route={assetsRoute}
            setRoute={setAssetsRoute}
            backRef={backHandler}
            openNotebook={(id) => {
              // All three, together. See the note on notebookRoute above, and
              // openNotebookTransition for why the assets route must be
              // consumed rather than left armed.
              const next = openNotebookTransition(id);
              setNotebookRoute(next.notebookRoute);
              setTab(next.tab);
              setAssetsRoute(next.assetsRoute);
            }}
          />
        )}
        {tab === "more" && (
          <MoreTab
            me={me}
            chatV2Available={can(me.capabilities, "chat_v2")}
            onChatUiChange={setChatUi}
            backRef={backHandler}
            onSignOut={signOutFlow}
          />
        )}
      </div>

      <nav className="tabbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab ${t.id === tab ? "tab-active" : ""}`}
            onClick={() => selectTab(t.id)}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-title">{t.title}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
