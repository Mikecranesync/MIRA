// Codex round 2 on #6082, F5: "the route closed its stream" is not "the answer was handed
// off". These tests pin the tracker on its own; the route tests in
// semantic-redraft.route.test.ts pin where it is installed and what it gates.
import { describe, expect, it, vi } from "vitest";

import { createResponseHandoff } from "../response-handoff";

const enc = new TextEncoder();
const dec = new TextDecoder();
const WAIT = 2000;
const QUICK = 300;

/** A source stream that hands out `chunks`, then ends; it records what its consumer did to it. */
function source(chunks: string[]) {
  const seen = { pulls: 0, cancelled: undefined as unknown, cancelCalls: 0 };
  let i = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seen.pulls += 1;
        if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
        else controller.close();
      },
      cancel(reason) {
        seen.cancelCalls += 1;
        seen.cancelled = reason;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, seen };
}
const sse = (stream: ReadableStream<Uint8Array>) =>
  new Response(stream, { status: 207, statusText: "Multi", headers: { "Content-Type": "text/event-stream", "X-Safety-Test": "kept" } });

/** The simplest shape: one response is both the handler's own and the one that leaves the route. */
const both = (handoff: ReturnType<typeof createResponseHandoff>, stream: ReadableStream<Uint8Array>) => handoff.final(handoff.own(sse(stream)));

/** Resolves with the handoff's answer, or "pending" when it has not answered within `ms`. */
const within = (p: Promise<boolean>, ms: number) =>
  Promise.race([p, new Promise<"pending">((r) => setTimeout(() => r("pending"), ms))]);

async function readAll(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return text;
    text += dec.decode(value, { stream: true });
  }
}

describe("response handoff: confirmed only when the tracked body was read to its end", () => {
  it("read to the end: confirmed, and the reader got the same chunks, status and headers", async () => {
    const { stream } = source(["data: a\n\n", "data: b\n\n", "data: [DONE]\n\n"]);
    const handoff = createResponseHandoff(new AbortController().signal);
    const res = both(handoff, stream);
    expect(res.status).toBe(207);
    expect(res.statusText).toBe("Multi");
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("x-safety-test")).toBe("kept");
    const reader = res.body!.getReader();
    const chunks: string[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(dec.decode(value));
    }
    expect(chunks).toEqual(["data: a\n\n", "data: b\n\n", "data: [DONE]\n\n"]);
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(true);
  });

  it("works with no request signal at all", async () => {
    const handoff = createResponseHandoff();
    await readAll(both(handoff, source(["x"]).stream).body!.getReader());
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(true);
  });

  it("every chunk read but not the end: not confirmed, and false once the wait has passed", async () => {
    const handoff = createResponseHandoff();
    const reader = both(handoff, source(["one", "two"]).stream).body!.getReader();
    expect(dec.decode((await reader.read()).value)).toBe("one");
    expect(dec.decode((await reader.read()).value)).toBe("two");
    const answer = handoff.confirmed(150);
    expect(await within(answer, 60)).toBe("pending");
    expect(await answer).toBe(false);
  });

  it("nobody reads: the source is not read either, and an empty body is not confirmed", async () => {
    const { stream, seen } = source([]);
    const handoff = createResponseHandoff();
    both(handoff, stream);
    await new Promise((r) => setTimeout(r, 30));
    expect(seen.pulls).toBe(0);
    expect(await handoff.confirmed(100)).toBe(false);
  });

  it("the wait passing is final: a body read to its end afterwards does not turn the answer into a yes", async () => {
    const handoff = createResponseHandoff();
    const res = both(handoff, source(["late"]).stream);
    expect(await handoff.confirmed(40)).toBe(false);
    expect(await readAll(res.body!.getReader())).toBe("late");
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(false);
  });

  it("confirmed before the wait: the answer arrives at once, not when the wait ends", async () => {
    const handoff = createResponseHandoff();
    await readAll(both(handoff, source(["x"]).stream).body!.getReader());
    const started = Date.now();
    expect(await handoff.confirmed(WAIT)).toBe(true);
    expect(Date.now() - started).toBeLessThan(WAIT / 2);
  });
});

describe("response handoff: the handler's own response AND the final response must both be read to their end", () => {
  /** A wrapper between the two: it reads `res` and hands every chunk on, like the sheet receipt does. */
  const wrapped = (res: Response) => new Response(res.body!.pipeThrough(new TransformStream<Uint8Array, Uint8Array>()), { status: res.status });

  it("a wrapper sits between them and the final response is read to its end: confirmed", async () => {
    const handoff = createResponseHandoff();
    const final = handoff.final(wrapped(handoff.own(sse(source(["a", "b"]).stream))));
    expect(await readAll(final.body!.getReader())).toBe("ab");
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(true);
  });

  it("a wrapper failed: the final response ends cleanly with other content and the handler's response is never read -> not confirmed", async () => {
    const handoff = createResponseHandoff();
    const { seen } = (() => {
      const src = source(["the answer"]);
      handoff.own(sse(src.stream)); // returned by the handler; the wrapper threw before reading it
      return src;
    })();
    const final = handoff.final(sse(source(["data: error\n\n", "data: [DONE]\n\n"]).stream));
    expect(await readAll(final.body!.getReader())).toContain("[DONE]");
    expect(seen.pulls).toBe(0);
    const answer = handoff.confirmed(150);
    expect(await within(answer, 60)).toBe("pending");
    expect(await answer).toBe(false);
  });

  it("the handler's response was never tracked at all (it threw): a final response read to its end is not confirmed", async () => {
    const handoff = createResponseHandoff();
    await readAll(handoff.final(sse(source(["data: error\n\n"]).stream)).body!.getReader());
    const answer = handoff.confirmed(150);
    expect(await within(answer, 60)).toBe("pending");
    expect(await answer).toBe(false);
  });

  it("the handler's response is read to its end and nothing leaves the route: not confirmed", async () => {
    const handoff = createResponseHandoff();
    await readAll(handoff.own(sse(source(["a"]).stream)).body!.getReader());
    const answer = handoff.confirmed(150);
    expect(await within(answer, 60)).toBe("pending");
    expect(await answer).toBe(false);
  });

  it("a wrapper read the handler's response to its end, then the final response is cancelled: denied at once", async () => {
    const handoff = createResponseHandoff();
    const own = handoff.own(sse(source(["a", "b"]).stream));
    // The wrapper drains the handler's response into its own queue, as the progress stream does.
    const drained = await readAll(own.body!.getReader());
    const final = handoff.final(sse(source([drained]).stream));
    const reader = final.body!.getReader();
    expect(dec.decode((await reader.read()).value)).toBe("ab");
    await reader.cancel();
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(false);
  });
});

describe("response handoff: a cancel, an abort or a source error is a no", () => {
  it("cancel: denied at once, and the cancel reaches the wrapped body with its reason", async () => {
    const { stream, seen } = source(["a", "b", "c"]);
    const handoff = createResponseHandoff();
    const reader = both(handoff, stream).body!.getReader();
    await reader.read();
    await reader.cancel("client stop");
    expect(seen.cancelCalls).toBe(1);
    expect(seen.cancelled).toBe("client stop");
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(false);
  });

  it("cancel after the last chunk, before the end was read: denied", async () => {
    const handoff = createResponseHandoff();
    const reader = both(handoff, source(["only"]).stream).body!.getReader();
    expect(dec.decode((await reader.read()).value)).toBe("only");
    await reader.cancel();
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(false);
  });

  it("request aborted while the body is being read: denied even when the body is then read to its end", async () => {
    const ac = new AbortController();
    const handoff = createResponseHandoff(ac.signal);
    const reader = both(handoff, source(["a", "b"]).stream).body!.getReader();
    await reader.read();
    ac.abort();
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(false);
    expect(await readAll(reader)).toBe("b");
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(false);
  });

  it("request aborted before any response is tracked: denied", async () => {
    const ac = new AbortController();
    const handoff = createResponseHandoff(ac.signal);
    ac.abort();
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(false);
    await readAll(both(handoff, source(["x"]).stream).body!.getReader());
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(false);
  });

  it("request already aborted when the tracker is created: denied (the abort event never fires again)", async () => {
    const ac = new AbortController();
    ac.abort();
    const handoff = createResponseHandoff(ac.signal);
    await readAll(both(handoff, source(["x"]).stream).body!.getReader());
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(false);
  });

  it("the wrapped body errors: the reader gets that error and the handoff is denied at once", async () => {
    const boom = new Error("source failed (test)");
    let n = 0;
    const failing = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (n++ === 0) controller.enqueue(enc.encode("first"));
          else controller.error(boom);
        },
      },
      { highWaterMark: 0 },
    );
    const handoff = createResponseHandoff();
    const reader = both(handoff, failing).body!.getReader();
    expect(dec.decode((await reader.read()).value)).toBe("first");
    await expect(reader.read()).rejects.toBe(boom);
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(false);
  });

  it("a response with no body: returned as it is, and denied at once", async () => {
    const handoff = createResponseHandoff();
    const bare = new Response(null, { status: 204 });
    expect(handoff.final(bare)).toBe(bare);
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(false);
  });

  it("the handler's response has no body: returned as it is, and denied at once", async () => {
    const handoff = createResponseHandoff();
    const bare = new Response(null, { status: 204 });
    expect(handoff.own(bare)).toBe(bare);
    await readAll(handoff.final(sse(source(["x"]).stream)).body!.getReader());
    expect(await within(handoff.confirmed(WAIT), QUICK)).toBe(false);
  });

  it("a confirmed handoff leaves no timer running", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const handoff = createResponseHandoff();
      await readAll(both(handoff, source(["x"]).stream).body!.getReader());
      expect(await handoff.confirmed(60_000)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
