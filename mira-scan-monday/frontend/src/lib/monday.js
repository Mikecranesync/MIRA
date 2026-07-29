import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();

const CONTEXT_TIMEOUT_MS = 3000;

function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("context_timeout")), ms)
  );
  return Promise.race([promise, timeout]);
}

export async function getMondayContext() {
  try {
    const ctx = await withTimeout(monday.get("context"), CONTEXT_TIMEOUT_MS);
    const session = await monday.get("sessionToken").catch(() => ({ data: null }));
    return {
      ...ctx,
      sessionToken: session?.data || null,
    };
  } catch (err) {
    if (err?.message !== "context_timeout") {
      console.warn("Board context unavailable (outside embedded view?)", err);
    }
    return { data: null, sessionToken: null };
  }
}

/**
 * Send the user through the OAuth install flow. Call this when the
 * backend returns `reinstall_required:` in an error message — the
 * stored access_token has been revoked and we need fresh consent.
 *
 * Inside an iframe we redirect the top window so Monday's consent
 * screen renders full-page instead of inside the embed.
 */
export function redirectToInstall(apiBaseUrl) {
  const installUrl = `${apiBaseUrl || ""}/oauth/monday/install`;
  if (window.top && window.top !== window) {
    window.top.location.href = installUrl;
  } else {
    window.location.href = installUrl;
  }
}

export default monday;
