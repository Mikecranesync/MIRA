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
 * This tracks the LAST response, the one the route returns. `confirmed` is true only when
 * the consumer of that response read every chunk and then read its end, with no cancel and
 * no request abort before that point. That consumer is the server runtime: the claim is
 * "the server handed every byte on and knows of no cancellation", never "the phone showed
 * the answer". Anything else (a cancel, an abort, a source error, a body nobody finished
 * reading within the wait) is false, and the answer is final once given.
 *
 * It changes nothing a reader can see: the same chunks in the same order, the same status
 * and headers, and a cancel is passed on to the wrapped body.
 */
export type ResponseHandoff = {
  /** Wrap the response that leaves the route. Call it once, on the outermost response. */
  track(res: Response): Response;
  /** True only on a confirmed full handoff; false on anything else, including `waitMs` passing first. */
  confirmed(waitMs: number): Promise<boolean>;
};

export function createResponseHandoff(signal?: AbortSignal | null): ResponseHandoff {
  let decide!: (handed: boolean) => void;
  // A promise keeps its first resolution: the first of "read to the end", "cancelled",
  // "aborted" and "waited too long" is the answer, and a later one changes nothing.
  const outcome = new Promise<boolean>((resolve) => {
    decide = resolve;
  });
  const deny = () => decide(false);
  // The route detaches its own abort listeners before it commits the turn, so this one is
  // separate. A request that is already aborted never fires the event: read the flag too.
  if (signal?.aborted) deny();
  else signal?.addEventListener("abort", deny, { once: true });

  return {
    track(res) {
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
                decide(true);
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
    },
    confirmed(waitMs) {
      const timer = setTimeout(deny, waitMs);
      (timer as { unref?: () => void }).unref?.();
      return outcome.finally(() => clearTimeout(timer));
    },
  };
}
