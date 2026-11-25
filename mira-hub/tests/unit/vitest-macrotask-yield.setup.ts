/**
 * Yield one real macrotask after every unit test.
 *
 * Why: the vitest runner awaits each test, but an `await` on an already-settled
 * promise is a microtask, so a file made only of mocked-DB tests never returns
 * to the worker's event loop. The runner still sends `onTaskUpdate` to the main
 * process every 100 ms, and the worker reads each reply as an IPC message, a
 * macrotask. When a file runs more than 60 s without yielding, the event loop's
 * timers phase runs before its poll phase, so the 60 s RPC timeout fires before
 * the waiting reply is read: `[vitest-worker]: Timeout calling "onTaskUpdate"`.
 * Every test passes and the run still exits 1.
 *
 * On CI's 2-core runner, micro820-section-scope.test.ts (1,349 tests) takes about
 * 67 s, just over that limit, so Hub Unit Tests failed intermittently on main
 * from 874d4595d onward.
 *
 * `setImmediate` is captured when this file loads, before any test can install
 * fake timers, so `vi.useFakeTimers()` cannot turn this hook into a hang.
 */
import { afterEach } from "vitest";

const realSetImmediate = globalThis.setImmediate;

afterEach(() => new Promise<void>((resolve) => realSetImmediate(() => resolve())));
