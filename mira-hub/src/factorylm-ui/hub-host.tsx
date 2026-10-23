"use client";
/**
 * Hub host for the shared FactoryLM shell (Hub mount PR 1, #3839).
 *
 * The shell (`packages/factorylm-ui`) renders; this host owns everything the
 * charter says a host owns: auth, the notebook/thread tree, hydration, the send
 * path through the ONE canonical conversation backend
 * (`POST /api/equipment-notebooks/[id]/chat`), stop/retry, and the citation
 * lookup. No new chat store, stream parser, evidence system or backend — the
 * stream reader, chat body, and persisted-turn rules are the classic notebook's
 * (`notebook-chat-utils.ts`), mapped onto `InteractionPart` by
 * `to-interaction.ts`.
 *
 * Scope (owner, 2026-09-19 — supersedes the 2017 note): the host lands on
 * HOME with the composer enabled.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import {
  shellReducer,
  type Attachment,
  IdentityAlreadyConfirmedError,
  type ConfirmIdentityResult,
  type IdentityProposal,
  type InteractionPart,
  type InteractionTurn,
  type ManualSearchFollowState,
  type ManualSearchStatus,
  type ProjectItem,
  type ShellState,
} from "@factorylm/interaction";
import {
  FactoryLMShell,
  createFixRequestIds,
  createReadAloud,
  fixRefusalMessage,
  fixSymptomFor,
  serverTurnIdFor,
  spokenAnswerText,
  type HostHooks,
} from "@factorylm/ui";
import { API_BASE, MAX_UPLOAD_MB } from "@/lib/config";
import type { EquipmentNotebook, NotebookSource } from "@/lib/equipment-notebooks";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import {
  isAbortError,
  readNotebookStream,
  type PersistedTurn,
} from "@/components/equipment/notebook-chat-utils";
import { AnswerMarkdown } from "@/components/equipment/notebook-markdown";
import { browserAdapterDeps, createWebAdapter } from "./web-adapter";
import { HOME_THREAD, createOutgoingOwner, withOutgoing, type Outgoing } from "./outgoing-turn";
import { composeHubSend, pairAttachments, resolveUploadNode, runAttachedSend, type HeldFile } from "./hub-attachments";
import { createManualSearchDriver, type ManualSearchDriver } from "./manual-search-driver";
import { GuidedProcedure } from "./GuidedProcedure";
import { LEGACY_THREAD_ID, notebookMachines, notebookProjects, threadRefFromItem, notebookIdFromProject, type HubNotebook } from "./notebook-tree";
import { answerTurnId, citationIndex, contextFor, lifecycleFromStream, partsFromStream, sourceIdFor, threadFromPersisted, withManualSearchStatus, withSettledFollowups, type SettledFollowups } from "./to-interaction";
import {
  EMPTY_FIXTURE,
  NO_PROJECT_ERROR,
  applyConfirmIdentityResult,
  chatBodyFor,
  guidedDeadEndBody,
  createLatestLoadTracker,
  detailQueryFor,
  draftAfterSendSucceeded,
  enabledDocIds,
  errorMessageFor,
  fixtureFor,
  groundingLineFor,
  historyRows,
  homeSendPlan,
  initialHubShellState,
  landingSelection,
  latestRequestGate,
  metaFor,
  newThreadId,
  openNotebookSelection,
  retainedStreamInterruption,
  searchForSelection,
  selectionFromSearch,
  sendFailureMessage,
  shellThreadId,
  type CompatibleStreamResult,
  type HubSelection,
} from "./hub-host-logic";
import { keepPhotoWithReview } from "./keep-photo-review";
