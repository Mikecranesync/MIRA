const BRIDGE_URL = process.env.TASK_BRIDGE_URL ?? "http://100.86.236.11:8003";
const BRIDGE_KEY = process.env.TASK_BRIDGE_API_KEY ?? "";

interface BridgeResponse {
  task_id: string;
  task_name: string;
  status: string;
}

export async function triggerBridgeTask(
  taskName: string,
  payload?: Record<string, unknown>,
): Promise<BridgeResponse> {
  const resp = await fetch(`${BRIDGE_URL}/tasks/${taskName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BRIDGE_KEY}`,
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Bridge ${taskName} failed: ${resp.status} ${text}`);
  }

  return resp.json() as Promise<BridgeResponse>;
}
