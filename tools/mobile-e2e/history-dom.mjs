// Exact thread/turn evidence for the debug-WebView cold-restart stage.
// Reuses cdp.mjs; release WebViews cannot provide this DOM evidence.
import { CDP, sleep } from "./cdp.mjs";
import { readHistoryState } from "./history-state.mjs";

const [action, question, projectId] = process.argv.slice(2);
let c;
let attachError;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    c = await CDP.attach();
    break;
  } catch (error) {
    attachError = error;
    await sleep(1000);
  }
}
if (!c) throw new Error(`debug WebView unavailable: ${attachError}`);

async function until(read, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${action}`);
}

async function touch(selector) {
  const point = await until(() => c.evaluate((s) => {
    const node = document.querySelector(s);
    if (!node) return null;
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, selector));
  await c.touch(point.x, point.y);
}

async function snapshot() {
  return c.evaluate(readHistoryState, question);
}

try {
  if (action === "sources") {
    const notebookId = await until(() => c.evaluate(() =>
      document.querySelector('[data-testid="unified-root"][data-notebook-id]')?.getAttribute("data-notebook-id") ?? null));
    await touch('button[aria-label="Open navigation"]');
    await touch(`[data-item-id="sources-${notebookId}"]`);
    process.stdout.write(JSON.stringify({ notebookId }));
  } else if (action === "restore") {
    await until(() => c.evaluate(() => Boolean(document.querySelector('[data-testid="unified-home"]'))));
    await touch('button[aria-label="Open navigation"]');
    await touch(`[data-project-id="${projectId}"]`);
  } else if (action !== "capture") {
    throw new Error("expected capture, restore, or sources");
  }
  if (action !== "sources") {
    let state = await until(snapshot);
    const end = Date.now() + 30000;
    while (Date.now() < end && (state.questionCount !== 1 || !state.threadItemId ||
      !state.answers[0]?.sources?.length)) {
      await sleep(500);
      state = await snapshot();
    }
    process.stdout.write(JSON.stringify(state));
  }
} finally {
  await c.close();
}
