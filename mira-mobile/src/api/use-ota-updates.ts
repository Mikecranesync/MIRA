import { useEffect, useRef, useState } from "react";
import { App as CapApp, type AppInfo } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  NATIVE_FINGERPRINT,
  checkAndStage,
  readBundleRestartState,
  readOtaChannel,
  recoverToPackaged,
  writeOtaChannel,
  type OtaChannel,
} from "../lib/live-update";

export type OtaUpdateController = {
  /** undefined while loading, null when native metadata does not apply or is unavailable. */
  appInfo: AppInfo | null | undefined;
  /** undefined while loading, null when native state is unavailable. */
  bundleId: string | null | undefined;
  /** undefined while loading, null when persisted enrollment is unavailable. */
  channel: OtaChannel | null | undefined;
  platform: string;
  nativeFingerprint: string;
  statusCode: string | null;
  stagedBundleId: string | null;
  pendingBundleKnown: boolean;
  /** False after replay-floor persistence becomes ambiguous; only remount/restart may retry. */
  replayStateKnown: boolean;
  lastCheckedAt: Date | null;
  busy: boolean;
  checkNow: () => Promise<void>;
  changeChannel: (
    channel: OtaChannel,
  ) => Promise<
    | "changed"
    | "unchanged"
    | "staged_bundle_pending"
    | "pending_bundle_state_unavailable"
    | "channel_state_unavailable"
    | "pointer_state_unavailable"
    | "busy"
  >;
  recoverPackagedBundle: () => Promise<void>;
  restartToApply: () => Promise<void>;
};

/**
 * Non-presentational adapter for the native/version and OTA lifecycle.
 *
 * Both mobile renderers may consume these facts and actions, but the adapter
 * deliberately owns no labels, layout, or human-facing result copy. That
 * keeps the canonical FactoryLM surface independent from the frozen classic
 * screen while retaining one implementation of the update behavior.
 */
export function useOtaUpdates(
  pendingOfflineWork: () => Promise<boolean>,
): OtaUpdateController {
  const nativePlatform = Capacitor.isNativePlatform();
  const [appInfo, setAppInfo] = useState<AppInfo | null | undefined>(undefined);
  const [bundleId, setBundleId] = useState<string | null | undefined>(undefined);
  const [channel, setChannel] = useState<OtaChannel | null | undefined>(undefined);
  const [statusCode, setStatusCode] = useState<string | null>(null);
  const [stagedBundleId, setStagedBundleId] = useState<string | null>(null);
  const [pendingBundleKnown, setPendingBundleKnown] = useState(false);
  const [replayStateKnown, setReplayStateKnown] = useState(true);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const operationInFlight = useRef(false);

  const beginOperation = () => {
    if (operationInFlight.current) return false;
    operationInFlight.current = true;
    setBusy(true);
    return true;
  };

  const finishOperation = () => {
    operationInFlight.current = false;
    setBusy(false);
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      let nextAppInfo: AppInfo | null = null;
      try {
        nextAppInfo = await CapApp.getInfo();
      } catch {
        // Browser previews have no native application metadata.
      }
      let nextBundleId: string | null = nativePlatform ? null : "web";
      let nextChannel: OtaChannel | null = null;
      try {
        nextChannel = await readOtaChannel();
      } catch {
        // A missing preference legitimately defaults to production inside
        // readOtaChannel. A rejected storage read is different: the persisted
        // truth may be canary, so guessing production could stage a bundle for
        // the wrong channel.
      }
      let nextPendingBundleId: string | null = null;
      let nextPendingBundleKnown = !nativePlatform;
      if (nativePlatform) {
        try {
          // Current and next are one safety decision. Reading them through the
          // strict helper prevents a failed current read from being silently
          // converted to `packaged` while a real OTA bundle is executing.
          const restartState = await readBundleRestartState();
          nextBundleId = restartState.currentBundleId;
          nextPendingBundleId = restartState.pendingBundleId;
          nextPendingBundleKnown = true;
        } catch {
          // Do not turn an unreadable native bundle into a positive claim that
          // the packaged bundle is active. Controls remain locked and About
          // reports the exact state as unavailable.
        }
      }
      if (!active) return;
      setAppInfo(nextAppInfo);
      setBundleId(nextBundleId);
      setChannel(nextChannel);
      setPendingBundleKnown(nextPendingBundleKnown);
      if (nativePlatform && nextPendingBundleKnown) {
        const current = nextBundleId || "packaged";
        const pending = nextPendingBundleId || "packaged";
        setStagedBundleId(pending === current ? null : pending);
      } else if (!nativePlatform) {
        setStagedBundleId(null);
      }
      if (!nextChannel) {
        setStatusCode("channel_state_unavailable");
      } else if (!nextPendingBundleKnown) {
        setStatusCode("pending_bundle_state_unavailable");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const reconcilePendingState = async (
    reason: string,
    reportedStagedBundleId: string | null,
  ) => {
    if (nativePlatform && reason === "pointer_state_unavailable") {
      // The signed pointer may have been accepted without a durable per-channel
      // floor. Do not permit another check or a channel relabel in this mount.
      setReplayStateKnown(false);
    }
    if (!nativePlatform) {
      setStagedBundleId(null);
      setPendingBundleKnown(true);
      setStatusCode(reason);
      return;
    }
    let nativeState: Awaited<ReturnType<typeof readBundleRestartState>>;
    try {
      nativeState = await readBundleRestartState();
    } catch (error) {
      console.warn("[ota] pending bundle reconciliation failed", error);
      setPendingBundleKnown(false);
      if (reportedStagedBundleId) setStagedBundleId(reportedStagedBundleId);
      setStatusCode("pending_bundle_state_unavailable");
      return;
    }

    const nativePending = nativeState.pendingBundleId || "packaged";
    const nativeCurrent = nativeState.currentBundleId || "packaged";
    setBundleId(nativeCurrent);
    const reconciledStaged = nativePending === nativeCurrent
      ? null
      : nativePending;
    setStagedBundleId(reconciledStaged);

    // reset() is a successful no-op when packaged is already both the current
    // and next target. Do not turn that truthful state into a false ambiguity.
    if (
      reason === "recovered_to_packaged" &&
      reportedStagedBundleId === "packaged" &&
      nativeCurrent === "packaged" &&
      nativePending === "packaged"
    ) {
      setPendingBundleKnown(true);
      setStatusCode("already_packaged");
      return;
    }

    // A full native-inventory read failed inside checkAndStage. Even when the
    // narrower current/next reread happens to work, do not enable channel
    // relabelling until a clean check or restart establishes the whole state.
    if (reason === "bundle_state_unavailable") {
      setPendingBundleKnown(false);
      setStatusCode(reason);
      return;
    }

    // A successful core result that disagrees with native's restart target is
    // an ambiguous bridge outcome. Preserve the native truth but keep every
    // channel-changing control locked.
    if (reportedStagedBundleId && reconciledStaged !== reportedStagedBundleId) {
      setPendingBundleKnown(false);
      setStatusCode("pending_bundle_state_unavailable");
      return;
    }

    setPendingBundleKnown(true);
    const committedAfterAmbiguousResponse =
      Boolean(reconciledStaged) &&
      !reportedStagedBundleId &&
      (reason === "verify_failed" || reason === "check_failed");
    const packagedRecoveryCommitted =
      reconciledStaged === "packaged" && reason === "recovery_failed";
    setStatusCode(
      committedAfterAmbiguousResponse
        ? "staged"
        : packagedRecoveryCommitted
          ? "recovered_to_packaged"
          : reason,
    );
  };

  const checkNow = async () => {
    if (
      !channel ||
      !pendingBundleKnown ||
      !replayStateKnown ||
      stagedBundleId ||
      !beginOperation()
    ) return;
    setStatusCode(null);
    try {
      const result = await checkAndStage({ channel, isBusy: pendingOfflineWork });
      await reconcilePendingState(result.reason, result.staged);
      setLastCheckedAt(new Date());
    } catch (error) {
      console.warn("[ota] update check failed", error);
      await reconcilePendingState("check_failed", null);
      setLastCheckedAt(new Date());
    } finally {
      finishOperation();
    }
  };

  const changeChannel = async (next: OtaChannel) => {
    // setNextBundle survives until restart. Relabelling the device after that
    // point would make the UI claim one channel while Android still applies a
    // bundle authorized for the other. Restart or recover first.
    if (!channel) return "channel_state_unavailable" as const;
    if (!pendingBundleKnown) return "pending_bundle_state_unavailable" as const;
    if (!replayStateKnown) return "pointer_state_unavailable" as const;
    if (stagedBundleId) return "staged_bundle_pending" as const;
    if (!beginOperation()) return "busy" as const;
    try {
      try {
        await writeOtaChannel(next);
      } catch (writeError) {
        // Preferences is a native bridge: the write can commit before its
        // response is lost. Re-read the persisted truth before deciding which
        // channel may be checked next.
        try {
          const persisted = await readOtaChannel();
          setChannel(persisted);
          if (persisted !== next) {
            setStatusCode(null);
            return "unchanged" as const;
          }
        } catch (readError) {
          console.warn("[ota] channel write outcome unavailable", writeError, readError);
          setChannel(null);
          setPendingBundleKnown(false);
          setStatusCode("channel_state_unavailable");
          return "channel_state_unavailable" as const;
        }
      }
      setChannel(next);
      setStatusCode(null);
      setLastCheckedAt(null);
      return "changed" as const;
    } finally {
      finishOperation();
    }
  };

  const recoverPackagedBundle = async () => {
    if (!beginOperation()) return;
    try {
      await recoverToPackaged();
      // reset() is itself the authoritative native mutation: packaged is now
      // the known restart target even if the confirming reread is unavailable.
      await reconcilePendingState("recovered_to_packaged", "packaged");
    } catch (error) {
      console.warn("[ota] packaged recovery failed", error);
      await reconcilePendingState("recovery_failed", null);
    } finally {
      finishOperation();
    }
  };

  const restartToApply = async () => {
    // A known staged target may survive an inconclusive post-stage reread.
    // Restart owns a fresh strict reread, so it remains the safe recovery path
    // even while all channel-changing controls stay locked.
    if (!stagedBundleId || !beginOperation()) return;
    try {
      let nativeState: Awaited<ReturnType<typeof readBundleRestartState>>;
      try {
        nativeState = await readBundleRestartState();
      } catch (error) {
        console.warn("[ota] restart target unavailable", error);
        setPendingBundleKnown(false);
        setStatusCode("pending_bundle_state_unavailable");
        return;
      }

      const nativeCurrent = nativeState.currentBundleId || "packaged";
      const nativePending = nativeState.pendingBundleId || "packaged";
      const nativeStaged = nativePending === nativeCurrent ? null : nativePending;
      setBundleId(nativeCurrent);
      setStagedBundleId(nativeStaged);

      if (nativeStaged !== stagedBundleId) {
        setPendingBundleKnown(false);
        setStatusCode("pending_bundle_state_unavailable");
        return;
      }
      setPendingBundleKnown(true);

      // Probe again at the point of no return. A chat stream, upload, server
      // mutation, queue producer, or unsynced work order that began after the
      // update was staged must keep the running app alive.
      if (await pendingOfflineWork()) {
        setStatusCode("busy");
        return;
      }
      await CapApp.exitApp();
    } catch (error) {
      console.warn("[ota] restart failed", error);
      setStatusCode("restart_failed");
    } finally {
      finishOperation();
    }
  };

  return {
    appInfo,
    bundleId,
    channel,
    platform: Capacitor.getPlatform(),
    nativeFingerprint: NATIVE_FINGERPRINT,
    statusCode,
    stagedBundleId,
    pendingBundleKnown,
    replayStateKnown,
    lastCheckedAt,
    busy,
    checkNow,
    changeChannel,
    recoverPackagedBundle,
    restartToApply,
  };
}
