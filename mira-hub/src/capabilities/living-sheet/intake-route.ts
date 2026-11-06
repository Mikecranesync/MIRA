import { NextRequest, NextResponse } from "next/server";
import { INTAKE_BYTES_MAX } from "./packet-intake";

/** Stream-bound bytes before JSON.parse, including absent/false content-length. */
export async function intakeJson(req: NextRequest): Promise<{ value: unknown } | { response: NextResponse }> {
  const reader = req.body?.getReader();
  if (!reader) return { response: NextResponse.json({ error: "invalid_json" }, { status: 400 }) };
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > INTAKE_BYTES_MAX) {
        await reader.cancel();
        return { response: NextResponse.json({ error: "intake_payload_too_large" }, { status: 413 }) };
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch { return { response: NextResponse.json({ error: "invalid_json" }, { status: 400 }) }; }
}

export function intakeFailure(status: string): NextResponse {
  const http = status === "unauthenticated" ? 401 : status === "wrong_technician" ? 403 : status === "job_not_found" ? 404 :
    ["invalid_input", "invalid_decisions"].includes(status) ? 400 : 409;
  return NextResponse.json({ error: status }, { status: http });
}
