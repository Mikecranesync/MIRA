import type { WorkPacket } from "@/capabilities/work-packet/types";
import type { JobRecord } from "@/capabilities/work-packet/job-record";
import type { KvStore } from "./living-sheet-client";

/** Explicit intake reads only the existing packet/record keys. Nothing is saved. */
export async function localInstructionInput(store: Pick<KvStore, "get">, notebookId: string): Promise<{ packet: WorkPacket; record: JobRecord | null }> {
  const raw = await store.get(`work-packet-draft:${notebookId}`);
  if (!raw) throw new Error("No local packet was found for this notebook. Build a packet first.");
  if (raw.length > 8 * 1024 * 1024) throw new Error("The local packet exceeds the intake limit.");
  const packet = JSON.parse(raw) as WorkPacket;
  if (!packet || typeof packet.packetId !== "string") throw new Error("The local packet is unreadable.");
  const saved = await store.get(`work-packet-record:${packet.packetId}`);
  if (saved && saved.length > 8 * 1024 * 1024) throw new Error("The local work record exceeds the intake limit.");
  return { packet, record: saved ? JSON.parse(saved) as JobRecord : null };
}

/** Content-derived request ID survives reload without another persistence store.
 * Server still checks actor/content; this ID never grants authority. */
export async function instructionRequestId(scope: string, value: unknown): Promise<string> {
  const canonical = JSON.stringify([scope, value], (_key, v) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)))].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
