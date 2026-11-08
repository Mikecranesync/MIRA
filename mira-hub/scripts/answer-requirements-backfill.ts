/**
 * Backfill: grade stored Turn Evidence Packets with the SAME evaluateAnswerRequirements the
 * route uses (one implementation, no twin). Reads NDJSON {trace_id, ts, evidence_packet} on
 * stdin, writes NDJSON {trace_id, ts, ...verdict} on stdout. Scores/ids only — no text.
 *   npx vite-node scripts/answer-requirements-backfill.ts < packets.ndjson > verdicts.ndjson
 */
import { createInterface } from "node:readline";
import { evaluateAnswerRequirements } from "../src/capabilities/observability/answer-requirements";
import type { TurnEvidencePacket } from "../src/capabilities/observability/turn-evidence-packet";

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const row = JSON.parse(line) as { trace_id: string; ts: string | null; evidence_packet: TurnEvidencePacket };
  const v = evaluateAnswerRequirements(row.evidence_packet);
  if (v) process.stdout.write(JSON.stringify({ trace_id: row.trace_id, ts: row.ts, ...v }) + "\n");
});
