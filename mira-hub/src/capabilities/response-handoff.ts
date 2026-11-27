/**
 * Was a response body handed off in full? (Codex round 2 on #6082, F5.)
 *
 * A route that builds its answer inside a `ReadableStream` knows when it has WRITTEN the
 * last frame and closed its own stream. It does not know that anyone read them: the frames
 * sit in a queue, and the response that actually leaves the route may be another stream
 * wrapped around this one (the progress stream, the sheet receipt), which can be cancelled
 * while it is still waiting to start reading. "I closed my stream" is therefore not "the
 * answer was delivered".
 *
 * Two responses are tracked, and BOTH must be read to their end:
 *  - `own`: the response the turn handler itself returned, the one that carries the answer
 *    frames. Whoever consumes it (a wrapper, or the server) must have read every chunk and
 *    then its end.
 *  - `final`: the response the route returns, after the last wrapper. Its consumer is the
 *    server runtime.
 * One without the other proves nothing. A final response can end cleanly without the answer
 * having passed through it: when a wrapper fails, the progress stream writes an error frame
 * and closes normally. And the handler's response can be read to its end by a wrapper whose
 * own output nobody reads.
 *
 * `confirmed` is true only when both were read to their end with no cancel, no source error
 * and no request abort before that point. The claim is "the server handed every byte on and
 * knows of no cancellation", never "the phone showed the answer". Anything else (a cancel,
 * an abort, an error, a response never tracked, a body nobody finished reading within the
 * wait) is false.
 *
 * Two things withdraw a yes that was already latched (Codex round 4 on #6082), because both
 * can become known only after the last byte was read:
 *  - F11: the request's abort. Both ends can be read and the client still go away before
 *    the caller acts. The signal is read again each time `confirmed` answers.
 *  - F9: `rewritten()`. Reading both ends proves bytes were taken, not that a wrapper in
 *    between passed on the bytes it read. A wrapper that decodes and re-encodes the stream
 *    (the sheet receipt) can corrupt a frame on the way. The route reports such a wrapper
 *    here whenever it wrapped the body, damaged or not, and nothing is confirmed for that
 *    turn, whenever it is reported.
 * So `confirmed` is the answer as of the moment it resolves, and the caller acts on it at
 * once: a later call can say no where an earlier one said yes, never the other way round.
 *
 * It changes nothing a reader can see: the same chunks in the same order, the same status
 * and headers, and a cancel is passed on to the wrapped body.
 */
export type ResponseHandoff = {
  /** Wrap the response the turn handler returned, before any wrapper reads it. Call it once. */
  own(res: Response): Response;
  /** Wrap the response that leaves the route, after the last wrapper. Call it once. */
  final(res: Response): Response;
  /** A wrapper between `own` and `final` re-encodes the bytes (damaged or not): nothing can be confirmed for this turn. */
  rewritten(): void;
  /** True only on a confirmed full handoff; false on anything else, including `waitMs` passing first. */
  confirmed(waitMs: number): Promise<boolean>;
};

export function createResponseHandoff(signal?: AbortSignal | null): ResponseHandoff {
  let decide!: (handed: boolean) => void;
  // A promise keeps its first resolution: the first of "both read to the end", "cancelled",
  // "aborted", "errored" and "waited too long" is the answer, and a later one changes nothing.
  const outcome = new Promise<boolean>((resolve) => {
    decide = resolve;
  });
  const deny = () => decide(false);
  // The route detaches its own abort listeners before it commits the turn, so this one is
  // separate. A request that is already aborted never fires the event: read the flag too.
  if (signal?.aborted) deny();
  else signal?.addEventListener("abort", deny, { once: true });

  let rewritten = false;
  const ended = { own: false, final: false };
  const track = (which: "own" | "final") => (res: Response): Response => {
    if (!res.body) {
      // Nothing to hand off, so nothing can be confirmed.
      deny();
      return res;
    }
    const reader = res.body.getReader();
    const body = new ReadableStream<Uint8Array>(
      {
        // Called only when the consumer asks for more (the queue holds nothing: see the
        // strategy below), so reaching `done` means every chunk before it was taken.
        async pull(controller) {
          try {
            const { value, done } = await reader.read();
            if (done) {
              controller.close();
              ended[which] = true;
              if (ended.own && ended.final) decide(true);
              return;
            }
            controller.enqueue(value);
          } catch (err) {
            deny();
            controller.error(err);
          }
        },
        cancel(reason) {
          deny();
          return reader.cancel(reason);
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };

  return {
    own: track("own"),
    final: track("final"),
    rewritten() {
      rewritten = true;
      deny();
    },
    async confirmed(waitMs) {
      const timer = setTimeout(deny, waitMs);
      (timer as { unref?: () => void }).unref?.();
      const handed = await outcome.finally(() => clearTimeout(timer));
      // Read at the moment of answering, not when the last byte was read (F9, F11 above).
      return handed && !rewritten && !signal?.aborted;
    },
  };
}
