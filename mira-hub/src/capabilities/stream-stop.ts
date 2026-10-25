/**
 * When may the provider read loop stop after a streamed chunk?
 *
 * With `stream_options.include_usage` (the canonical seam), OpenAI delivers the
 * usage block on a chunk AFTER the one carrying `finish_reason: "stop"`, then
 * `[DONE]`. The route used to stop reading at the stop marker, so whether the
 * turn's token usage was captured depended on whether both chunks happened to
 * land in the same network read — a race. On 2026-10-11 the staging acceptance
 * audit (run 38154158721) failed scenario 3 with `token usage recorded
 * None/None` on an OpenAI-served turn while scenarios 4 and 5 recorded usage
 * fine, and the receipt it wrote could not authorize production.
 *
 * Rules (pure, one chunk at a time; the caller still terminates on `[DONE]`
 * and on the stream closing, which bounds the drain):
 *   - legacy inline cascade (seam off): stop at `finish_reason: "stop"` —
 *     byte-identical to the behaviour before this helper existed.
 *   - canonical seam: after `stop`, keep reading until the usage block has been
 *     seen (on this chunk or a later one); `[DONE]` still ends the loop even if
 *     a provider never sends usage.
 */
export type StreamStopState = {
  /** Canonical seam on (`stream_options.include_usage` requested). */
  seam: boolean;
  /** `choices[0].finish_reason` of the chunk just parsed, if any. */
  finishReason: string | null | undefined;
  /** A `stop` was seen on an earlier chunk of this stream. */
  sawStop: boolean;
  /** A usage block has been captured (this chunk or earlier). */
  usageSeen: boolean;
};

export function finishedAfterChunk(s: StreamStopState): { finished: boolean; sawStop: boolean } {
  const sawStop = s.sawStop || s.finishReason === "stop";
  if (!s.seam) return { finished: s.finishReason === "stop", sawStop };
  return { finished: sawStop && s.usageSeen, sawStop };
}
