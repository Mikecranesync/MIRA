import type { Attachment, PlatformAdapter } from "@factorylm/interaction";

/**
 * What the lab adapter may read from the shell to stay deterministic. It is a
 * function so the adapter always sees the current state without owning it.
 */
export interface LabAdapterContext {
  readonly activeMachineId?: string;
  readonly machineIds: readonly string[];
}

export interface LabAdapter extends PlatformAdapter {
  /** Every adapter call in order — the lab shows it so mock actions are inspectable. */
  log(): readonly string[];
}

const PHOTO = { name: "drive-a-nameplate.jpg", mediaType: "image/jpeg", kind: "photo" } as const;
const FILE = { name: "g120-manual.pdf", mediaType: "application/pdf", kind: "pdf" } as const;

/**
 * Deterministic, in-memory platform capabilities for the disconnected lab.
 * Photo and file pickers return the fixture attachments; machine scan returns
 * the next in-scope machine after the active one; share always succeeds; the
 * host handles Back. Nothing here touches a network, storage, or a device.
 */
export function createLabAdapter(context: () => LabAdapterContext, onCall: () => void = () => {}): LabAdapter {
  const log: string[] = [];
  const record = (entry: string) => {
    log.push(entry);
    onCall();
  };
  let photos = 0;
  let files = 0;

  const attachment = (base: typeof PHOTO | typeof FILE, id: string): Attachment => ({
    id,
    name: base.name,
    mediaType: base.mediaType,
    kind: base.kind,
    status: "ready",
  });

  return {
    log: () => log,
    attachPhoto: async () => {
      record("attachPhoto");
      photos += 1;
      return attachment(PHOTO, `lab-photo-${photos}`);
    },
    attachFile: async () => {
      record("attachFile");
      files += 1;
      return attachment(FILE, `lab-file-${files}`);
    },
    scanMachine: async () => {
      record("scanMachine");
      const { activeMachineId, machineIds } = context();
      if (machineIds.length === 0) return null;
      const index = activeMachineId ? machineIds.indexOf(activeMachineId) : -1;
      return machineIds[(index + 1) % machineIds.length];
    },
    shareArtifact: async (artifactId) => {
      record(`shareArtifact:${artifactId}`);
      return "shared";
    },
    onBack: () => {
      record("onBack");
      return "handled";
    },
  };
}
