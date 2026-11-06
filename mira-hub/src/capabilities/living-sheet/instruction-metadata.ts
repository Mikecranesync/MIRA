import type { WorkPacket, PacketEdit } from "@/capabilities/work-packet/types";
import type { JobRecord } from "@/capabilities/work-packet/job-record";

/** Server-written JSONB only. Generic public body validators reject this key. */
export type InstructionMetadata = {
  schemaVersion: 1;
  kind: "packet_intake";
  imported: { userId: string; at: string; notebookId: string; asset: { entityId: string; name: string; unsPath: string };
    identity: { manufacturer: string | null; model: string | null; catalogNumber: string | null; serialNumber: string | null; status: string } };
  originalPacket: WorkPacket;
  originalRecord: JobRecord | null;
  stepMap: { stepId: string; packetIndex: number }[];
  /** Corrected draft, separate from original evidence. */
  packet: WorkPacket;
  closeout?: { userId: string; at: string; notebookId: string; jobId: string; seq: number; snapshotId: string;
    decisions: PacketEdit[]; requestFingerprint: string };
};
