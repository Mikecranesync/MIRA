const BASE = import.meta.env.VITE_API_BASE_URL || "";

export class ApiError extends Error {
  constructor(status, body, message) {
    super(message || `${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function jsonFetch(path, opts = {}, sessionToken) {
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  if (sessionToken) headers["X-Monday-Session-Token"] = sessionToken;

  const resp = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!resp.ok) {
    const text = await resp.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { detail: text };
    }
    throw new ApiError(resp.status, body, `${resp.status}: ${text}`);
  }
  return resp.json();
}

export async function scanExtract(imageBase64, mimeType, sessionToken) {
  return jsonFetch(
    "/scan/extract",
    {
      method: "POST",
      body: JSON.stringify({ image_base64: imageBase64, mime_type: mimeType }),
    },
    sessionToken
  );
}

export async function kbLookup(make, model, sessionToken) {
  const params = new URLSearchParams({ make: make || "", model: model || "" });
  return jsonFetch(`/kb/lookup?${params.toString()}`, { method: "GET" }, sessionToken);
}

export async function chatMessage(
  message,
  assetId,
  history,
  sessionToken,
  assetLabel,
) {
  return jsonFetch(
    "/chat/message",
    {
      method: "POST",
      body: JSON.stringify({
        message,
        asset_id: assetId,
        asset_label: assetLabel,
        history,
      }),
    },
    sessionToken
  );
}

export async function queueManualRequest(make, model, serial, sessionToken) {
  return jsonFetch(
    "/queue/manual-request",
    {
      method: "POST",
      body: JSON.stringify({ make, model, serial, source: "mira-scan" }),
    },
    sessionToken
  );
}

export async function queueStatus(sessionToken, make, model) {
  const params = new URLSearchParams();
  if (make) params.set("make", make);
  if (model) params.set("model", model);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return jsonFetch(`/queue/status${qs}`, { method: "GET" }, sessionToken);
}

export async function mondayUpdateItem(boardId, itemId, columns, sessionToken) {
  return jsonFetch(
    "/monday/update-item",
    {
      method: "POST",
      body: JSON.stringify({ board_id: String(boardId), item_id: String(itemId), columns }),
    },
    sessionToken
  );
}
