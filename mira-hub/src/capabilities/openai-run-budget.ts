/**
 * Per-run OpenAI spend hard stop for the Hub (owner directive 2026-10-11:
 * "add a per run hard stop to catch runaways").
 *
 * OpenAI is the only METERED provider the Hub talks to (notebook chat via the
 * canonical seam, the nameplate recognizer, the LOOK vision call). A runaway —
 * a client re-sending a turn in a loop, a photo burst, a harness re-driving
 * questions — spends real dollars at a rate the free-tier providers never
 * could. This is the floor under that: every OpenAI call pre-checks a
 * worst-case estimate against a dollar cap for the current window and records
 * the actual usage after. At the cap, the caller skips OpenAI (the cascade
 * falls through; a vision call fails honestly) until the window rolls.
 *
 * Same contract as the Python runtime guard
 * (`mira-bots/shared/inference/run_budget.py`): precheck BEFORE, record AFTER,
 * one budget per process, a rolling window that starts on first use. Env names
 * are identical so one Doppler setting governs both runtimes; the `||` form is
 * load-bearing because compose maps `${VAR:-}` to an EMPTY STRING in-container.
 *
 *   OPENAI_RUN_BUDGET_USD        cap per window, default 10
 *   OPENAI_RUN_BUDGET_WINDOW_S   window length, default 86400 (one day)
 *   OPENAI_PRICE_PER_MTOK_IN     USD per million input tokens, default 0.75
 *   OPENAI_PRICE_PER_MTOK_OUT    USD per million output tokens, default 4.5
 *
 * Default prices are gpt-5.4-mini's list rate as declared in
 * `tools/review_router/prices.json`; the test pins them equal to that file.
 */

export const DEFAULT_CAP_USD = 10;
export const DEFAULT_WINDOW_S = 86_400;
export const DEFAULT_PRICE_PER_MTOK_IN = 0.75;
export const DEFAULT_PRICE_PER_MTOK_OUT = 4.5;

/** Chars-per-token proxy for the PRE-call estimate; the post-call record uses real usage. */
const CHARS_PER_TOKEN = 4;
/** Conservative fixed block an image part costs on input, for the pre-check only. */
export const IMAGE_PART_TOKENS = 1500;

/** `exclusive` makes the floor strict: a price of exactly 0 has no real-world
 *  meaning and would silently turn the cap into a no-op (Gate 7 on #4355), so
 *  it falls back to the default like junk does. The cap itself keeps 0 as a
 *  legal value: "spend nothing on OpenAI" is a real instruction. */
function envNumber(name: string, fallback: number, minimum = 0, exclusive = false): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return (exclusive ? n > minimum : n >= minimum) ? n : fallback;
}

export type BudgetVerdict =
  | { ok: true }
  | { ok: false; reason: string; spentUsd: number; worstCaseUsd: number; capUsd: number };

export class OpenAiRunBudget {
  private readonly cap: number;
  private readonly window: number;
  private readonly priceIn: number;
  private readonly priceOut: number;
  private readonly now: () => number;
  private windowStarted: number;
  private spent = 0;
  /** Worst-case cost of requests reserved and still in flight. NOT reset by the
   *  window roll: a hold is a live request, and it is booked (as actual usage)
   *  in whichever window its response lands in. */
  private held = 0;
  private callCount = 0;

  constructor(opts: {
    capUsd?: number;
    windowS?: number;
    priceInPerMtok?: number;
    priceOutPerMtok?: number;
    /** Seconds; injectable for tests. */
    now?: () => number;
  } = {}) {
    this.cap = opts.capUsd ?? envNumber("OPENAI_RUN_BUDGET_USD", DEFAULT_CAP_USD);
    this.window = opts.windowS ?? envNumber("OPENAI_RUN_BUDGET_WINDOW_S", DEFAULT_WINDOW_S, 1);
    this.priceIn = opts.priceInPerMtok ?? envNumber("OPENAI_PRICE_PER_MTOK_IN", DEFAULT_PRICE_PER_MTOK_IN, 0, true);
    this.priceOut = opts.priceOutPerMtok ?? envNumber("OPENAI_PRICE_PER_MTOK_OUT", DEFAULT_PRICE_PER_MTOK_OUT, 0, true);
    this.now = opts.now ?? (() => Date.now() / 1000);
    this.windowStarted = this.now();
  }

  get capUsd(): number {
    return this.cap;
  }
  get windowS(): number {
    return this.window;
  }
  get spentUsd(): number {
    this.roll();
    return this.spent;
  }
  /** Worst-case cost currently held by in-flight reservations. */
  get heldUsd(): number {
    return this.held;
  }
  get calls(): number {
    return this.callCount;
  }

  estimateUsd(inputTokens: number, outputTokens: number): number {
    return (Math.max(0, inputTokens) / 1e6) * this.priceIn + (Math.max(0, outputTokens) / 1e6) * this.priceOut;
  }

  private roll(): void {
    const t = this.now();
    if (t - this.windowStarted >= this.window) {
      if (this.spent > 0) {
        console.log(
          JSON.stringify({ event: "openai.budget_window_reset", spentUsd: this.spent, capUsd: this.cap, windowS: this.window }),
        );
      }
      this.windowStarted = t;
      this.spent = 0;
      this.callCount = 0;
    }
  }

  /** Hard stop. Call BEFORE the request with the worst-case token shape. */
  precheck(inputTokens: number, outputTokens: number): BudgetVerdict {
    this.roll();
    const worst = this.estimateUsd(inputTokens, outputTokens);
    const projected = this.spent + this.held + worst;
    if (projected > this.cap) {
      return {
        ok: false,
        reason: `openai run budget: spent=$${this.spent.toFixed(4)} + held=$${this.held.toFixed(4)} + worst_case=$${worst.toFixed(4)} = $${projected.toFixed(4)} > cap=$${this.cap.toFixed(2)} (window ${this.window}s)`,
        spentUsd: this.spent,
        worstCaseUsd: worst,
        capUsd: this.cap,
      };
    }
    return { ok: true };
  }

  /** Accumulate ACTUAL usage after the request. Returns this call's cost. */
  record(inputTokens: number, outputTokens: number): number {
    this.roll();
    const cost = this.estimateUsd(inputTokens, outputTokens);
    // A non-finite cost would make the shared total NaN, and every later
    // `projected > cap` comparison false — an open gate. Refuse it loudly.
    if (!Number.isFinite(cost)) throw new RangeError(`openai run budget: refusing a non-finite cost (${inputTokens}, ${outputTokens})`);
    this.spent += cost;
    this.callCount += 1;
    console.log(
      JSON.stringify({ event: "openai.budget_record", callUsd: cost, spentUsd: this.spent, capUsd: this.cap, calls: this.callCount }),
    );
    return cost;
  }

  /**
   * Hard stop that also HOLDS the worst case while the request is in flight,
   * so N concurrent callers cannot each pass `precheck` against the same
   * unspent balance and together overshoot the cap. Holds are kept apart from
   * the window's settled spend and are NOT cleared by the window roll: a
   * request that straddles the boundary keeps counting against the cap until
   * it resolves, and its actual usage is booked in the window its response
   * lands in. The caller `settle`s with actual usage when the response lands
   * (or with the worst case when the outcome is unknown, e.g. a timeout after
   * the request was accepted) and `release`s only when the provider rejected
   * the request without billable work (a non-OK status). `precheck`/`record`
   * stay for callers that serialize their own requests.
   */
  reserve(inputTokens: number, outputTokens: number): ReserveVerdict {
    const verdict = this.precheck(inputTokens, outputTokens);
    if (!verdict.ok) return verdict;
    const worst = this.estimateUsd(inputTokens, outputTokens);
    this.held += worst;
    let open = true;
    const drop = (): void => {
      this.held = Math.max(0, this.held - worst);
    };
    return {
      ok: true,
      reservation: {
        settle: (actualIn: number, actualOut: number): number => {
          if (!open) return 0;
          open = false;
          // Drop the hold, then book the actual usage through the one accounting
          // path. A count that is not a finite, non-negative number is UNKNOWN and
          // books what this hold reserved for it — a malformed provider usage block
          // can neither poison the shared total with NaN nor read as free (Codex r2
          // F8 on #4355). Every caller is covered, the cascade included.
          drop();
          return this.record(...billableTokens({ prompt_tokens: actualIn, completion_tokens: actualOut }, inputTokens, outputTokens));
        },
        release: (): void => {
          if (!open) return;
          open = false;
          drop();
        },
      },
    };
  }
}

export type BudgetReservation = {
  /** The response landed (or the outcome is unknown): replace the hold with the usage to book. Returns this call's cost. */
  settle(inputTokens: number, outputTokens: number): number;
  /** The provider rejected the request without billable work (non-OK status): drop the hold. */
  release(): void;
};

export type ReserveVerdict = { ok: true; reservation: BudgetReservation } | Exclude<BudgetVerdict, { ok: true }>;

/** Cheap pre-call input estimate for a chat messages array (chars/4). */
export function estimateInputTokens(messages: unknown): number {
  let s = "";
  try {
    s = JSON.stringify(messages) ?? "";
  } catch {
    s = "";
  }
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

/** Per-message framing allowance (role and separator tokens) on top of the byte bound. */
export const MESSAGE_FRAMING_TOKENS = 8;

/**
 * Conservative UPPER BOUND on input tokens, for the pre-call HOLD and for
 * charging an outcome the caller could not observe (Codex r3 F4 on #4357).
 * `estimateInputTokens` is an average (chars/4) and under-counts token-dense
 * text (CJK, numerics, code), so a hold sized by it can admit spend past the
 * cap. Every BPE token encodes at least one byte, so the UTF-8 byte length of
 * the serialized messages cannot be exceeded by the token count; a framing
 * allowance per message covers role and separator tokens. Over-reserving only
 * tightens concurrent admission; a served response still settles at actual
 * usage.
 */
export function boundInputTokens(messages: unknown): number {
  let s = "";
  try {
    s = JSON.stringify(messages) ?? "";
  } catch {
    s = "";
  }
  const count = Array.isArray(messages) ? messages.length : 1;
  return Buffer.byteLength(s, "utf8") + (count + 1) * MESSAGE_FRAMING_TOKENS;
}

/** Pre-call input estimate for one vision call: the prompt text plus a fixed image block per image. */
export function estimateVisionInputTokens(promptChars: number, images: number): number {
  return Math.ceil(promptChars / CHARS_PER_TOKEN) + images * IMAGE_PART_TOKENS;
}

/**
 * WORST-CASE billable input tokens for ONE image, for sizing a vision hold
 * (Codex r1 F4 on #4355). OpenAI's vision tokenization table: at detail "auto"
 * (the default; no request here sets `detail`), which sizes like "high",
 * gpt-5.4-mini allows up to 2,500 patches at a 1.2 multiplier = 3,000 tokens.
 *
 * Only VERIFIED models are listed. A model that is not here has no known bound
 * — some size "auto" like "original", far above any guess (Codex r2 F4) — so a
 * metered vision call on it is REFUSED before the fetch, and the provider pick
 * falls back to the free Together recognizer. Adding a model means reading its
 * row in OpenAI's table. Invalidation trigger: a new OpenAI vision model, or
 * any request that sets an explicit `detail`. Mirrors
 * mira-bots/shared/inference/run_budget.py.
 */
export const IMAGE_PART_MAX_TOKENS_BY_MODEL: Readonly<Record<string, number>> = { "gpt-5.4-mini": 3_000 };

/** The verified worst case for one image on `model`, or null when the model is not verified. */
export function imagePartMaxTokens(model: string): number | null {
  return IMAGE_PART_MAX_TOKENS_BY_MODEL[model.trim()] ?? null;
}

/**
 * UPPER BOUND on one vision call's input tokens, for the hold: the prompt's
 * UTF-8 bytes (a token-dense hint cannot beat its byte length) plus framing,
 * plus the verified worst-case image cost for `model` per image. Null when the
 * call carries images and `model` has no verified bound: the caller must refuse.
 */
export function boundVisionInputTokens(prompt: string, images: number, model: string): number | null {
  const perImage = imagePartMaxTokens(model);
  if (images > 0 && perImage === null) return null;
  return Buffer.byteLength(prompt, "utf8") + 2 * MESSAGE_FRAMING_TOKENS + images * (perImage ?? 0);
}

/** One structured line an operator can grep when OpenAI vision is refused for an unverified model. */
export function logVisionModelUnverified(scope: string, model: string): void {
  console.warn(
    JSON.stringify({
      event: "openai.vision_model_unverified",
      scope,
      model,
      verified: Object.keys(IMAGE_PART_MAX_TOKENS_BY_MODEL),
    }),
  );
}

/**
 * The tokens to BOOK for a served response (Codex r1 F2/F3 on #4355). A
 * missing, null, negative or non-numeric count is UNKNOWN, not zero: the
 * provider billed it whether or not it reported it. Unknown input books the
 * hold's input bound; unknown output books the request's completion cap —
 * a reasoning model's hidden tokens never show up in the visible answer.
 */
export function billableTokens(usage: unknown, inputBound: number, outputCap: number): [number, number] {
  const u = (usage && typeof usage === "object" ? usage : {}) as { prompt_tokens?: unknown; completion_tokens?: unknown };
  const known = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  return [known(u.prompt_tokens) ? u.prompt_tokens : inputBound, known(u.completion_tokens) ? u.completion_tokens : outputCap];
}

let shared: OpenAiRunBudget | null = null;

/** The one budget for this process (built lazily from env on first use). */
export function openAiRunBudget(): OpenAiRunBudget {
  if (!shared) shared = new OpenAiRunBudget();
  return shared;
}

/** Tests only. */
export function resetOpenAiRunBudgetForTests(): void {
  shared = null;
}

/** One structured line when a call is refused; greppable next to turn.usage. */
export function logBudgetExhausted(scope: string, verdict: Exclude<BudgetVerdict, { ok: true }>): void {
  console.warn(
    JSON.stringify({
      service: "mira-hub",
      event: "openai.budget_exhausted",
      scope,
      spentUsd: verdict.spentUsd,
      worstCaseUsd: verdict.worstCaseUsd,
      capUsd: verdict.capUsd,
      reason: verdict.reason,
    }),
  );
}
