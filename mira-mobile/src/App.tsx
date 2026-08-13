// Five-tab FactoryLM technician shell (ADR-0034 Phase 3) — renders the frozen
// mobile contract from the ONE canonical nav model (src/nav.ts), capability-
// filtered fail-closed. Per-tab navigation stacks; Android back pops the
// active stack before backgrounding; active tab persists across launches.
import { useEffect, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { Preferences } from "@capacitor/preferences";
import { onAuthExpired } from "./api/client";
import { createWorkOrder, getMe, signOut, type Me } from "./api/resources";
import {
  drainQueue,
  pendingCount,
  preferencesStore,
  purgeAllQueues,
} from "./lib/offline-queue";
import { TABS, visibleTabs, type TabId } from "./nav";
import { extractAssetTag } from "./lib/tags";
import { Login } from "./screens/Login";
import { WorkordersTab } from "./screens/Workorders";
import { ScheduleTab } from "./screens/Schedule";
import { ChatTab } from "./screens/ChatTab";
import { AssetsTab, type AssetsRoute } from "./screens/AssetsTab";
import { MoreTab } from "./screens/More";

const TAB_KEY = "flm.activeTab.v1";

let deepLinkSink: ((tag: string | null, raw: string) => void) | null = null;
export function handleDeepLink(url: string): void {
  const tag = extractAssetTag(url);
  deepLinkSink?.(tag, url);
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [booted, setBooted] = useState(false);
  const [tab, setTab] = useState<TabId>("workorders");
  const [assetsRoute, setAssetsRoute] = useState<AssetsRoute>({ name: "list" });
  // Each tab exposes a back-handler ref the shell calls on Android back.
  const backHandler = useRef<(() => boolean) | null>(null);

  useEffect(() => {
    void (async () => {
      const [{ value: savedTab }, m] = await Promise.all([
        Preferences.get({ key: TAB_KEY }),
        getMe(),
      ]);
      if (savedTab && TABS.some((t) => t.id === savedTab)) setTab(savedTab as TabId);
      setMe(m);
      setBooted(true);
    })();
  }, []);

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

  if (!booted) return <div className="empty">FactoryLM…</div>;
  if (!me)
    return (
      <Login
        onSignedIn={async () => {
          setMe(await getMe());
        }}
      />
    );

  const tabs = visibleTabs(me.capabilities);

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
        {tab === "chat" && <ChatTab backRef={backHandler} />}
        {tab === "assets" && (
          <AssetsTab route={assetsRoute} setRoute={setAssetsRoute} backRef={backHandler} />
        )}
        {tab === "more" && (
          <MoreTab
            me={me}
            backRef={backHandler}
            onSignOut={async () => {
              // Phase 4: local data never outlives the session — but try to
              // sync queued work orders first, and warn before destroying any.
              if ((await pendingCount(preferencesStore, me.tenantId)) > 0) {
                await drainQueue(preferencesStore, me.tenantId, createWorkOrder);
                const left = await pendingCount(preferencesStore, me.tenantId);
                if (
                  left > 0 &&
                  !window.confirm(
                    `${left} queued work order${left > 1 ? "s haven't" : " hasn't"} synced and will be deleted. Sign out anyway?`,
                  )
                )
                  return;
              }
              await signOut();
              await purgeAllQueues(preferencesStore);
              setMe(null);
            }}
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
