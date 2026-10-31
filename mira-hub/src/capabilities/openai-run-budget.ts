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
 *   OPENAI_PRICE_PER_MTOK_IN     explicit override, USD per million input tokens
 *   OPENAI_PRICE_PER_MTOK_OUT    explicit override, USD per million output tokens
 *
 * Prices are keyed by the RESOLVED model id (#4968): each call is priced from
 * the one shared table in `capabilities/openai-prices.ts` (the table telemetry
 * reads too, #4961) for the model that call sends, defaulting to
 * `OPENAI_MODEL || gpt-5.4-mini`. A model missing from that table is UNPRICED
 * and refused at reserve time — never $0, never another model's rate. The two
 * overrides replace a priced model's table rate (tests use them); they never
 * price an unlisted model, and junk or 0 falls back to the table rate.
 */
import { OPENAI_PRICE_PER_MTOK_BY_MODEL, openAiPricePerMtok, type OpenAiPrice } from "./openai-prices";

export const DEFAULT_CAP_USD = 10;
export const DEFAULT_WINDOW_S = 86_400;
/** The model a call is priced as when it names none: the same default the cascades send. */
export const OPENAI_DEFAULT_MODEL = "gpt-5.4-mini";
/** gpt-5.4-mini's rate, read from the shared table (not a second copy). */
export const DEFAULT_PRICE_PER_MTOK_IN = OPENAI_PRICE_PER_MTOK_BY_MODEL[OPENAI_DEFAULT_MODEL].input;
export const DEFAULT_PRICE_PER_MTOK_OUT = OPENAI_PRICE_PER_MTOK_BY_MODEL[OPENAI_DEFAULT_MODEL].output;

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

/** An explicit price override from env, or null when unset / junk / not > 0 (0 is junk, not free). */
function envPrice(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type BudgetVerdict =
  | { ok: true }
  | { ok: false; reason: string; spentUsd: number; worstCaseUsd: number; capUsd: number };

export class OpenAiRunBudget {
  private readonly cap: number;
  private readonly window: number;
  /** Explicit per-Mtok overrides (constructor opts or env); null = use the model's table rate. */
  private readonly priceInOverride: number | null;
  private readonly priceOutOverride: number | null;
  private readonly priceLookup: (model: string) => OpenAiPrice | null;
  private readonly defaultModel: string;
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
    /** The model a call is priced as when it names none; default `OPENAI_MODEL || gpt-5.4-mini`. */
    model?: string;
    /** Injectable for tests; default is the shared table. */
    priceLookup?: (model: string) => OpenAiPrice | null;
    /** Seconds; injectable for tests. */
    now?: () => number;
  } = {}) {
    this.cap = opts.capUsd ?? envNumber("OPENAI_RUN_BUDGET_USD", DEFAULT_CAP_USD);
    this.window = opts.windowS ?? envNumber("OPENAI_RUN_BUDGET_WINDOW_S", DEFAULT_WINDOW_S, 1);
    this.priceInOverride = opts.priceInPerMtok ?? envPrice("OPENAI_PRICE_PER_MTOK_IN");
    this.priceOutOverride = opts.priceOutPerMtok ?? envPrice("OPENAI_PRICE_PER_MTOK_OUT");
    this.priceLookup = opts.priceLookup ?? openAiPricePerMtok;
    // `||` because compose maps ${OPENAI_MODEL:-} to an EMPTY STRING in-container.
    this.defaultModel = (opts.model || process.env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL).trim();
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

  /** The model a call is priced as: the one it names, else this budget's default. */
  private modelOf(model?: string | null): string {
    return (model || this.defaultModel).trim();
  }

  /** Per-Mtok price for `model`, or null when it is unpriced (the caller must refuse). */
  private priceOf(model?: string | null): OpenAiPrice | null {
    const table = this.priceLookup(this.modelOf(model));
    if (!table) return null;
    // cached_input is carried through untouched: the cap charges every input
    // token at the full rate (it bounds spend), only telemetry uses the cached rate.
    return {
      input: this.priceInOverride ?? table.input,
      cached_input: table.cached_input,
      output: this.priceOutOverride ?? table.output,
    };
  }

  /** USD for this token shape on `model`. +Infinity when the model is unpriced: never $0. */
  estimateUsd(inputTokens: number, outputTokens: number, model?: string | null): number {
    const price = this.priceOf(model);
    if (!price) return Number.POSITIVE_INFINITY;
    return (Math.max(0, inputTokens) / 1e6) * price.input + (Math.max(0, outputTokens) / 1e6) * price.output;
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
  precheck(inputTokens: number, outputTokens: number, model?: string | null): BudgetVerdict {
    this.roll();
    if (!this.priceOf(model)) {
      // Fail closed (#4968): an unpriced model would otherwise be counted at $0 or
      // at another model's rate. Refused here, BEFORE the fetch, never at settle.
      return {
        ok: false,
        reason: `openai run budget: unpriced model "${this.modelOf(model)}" — refusing; add it to capabilities/openai-prices.ts`,
        spentUsd: this.spent,
        worstCaseUsd: Number.POSITIVE_INFINITY,
        capUsd: this.cap,
      };
    }
    const worst = this.estimateUsd(inputTokens, outputTokens, model);
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
  record(inputTokens: number, outputTokens: number, model?: string | null): number {
    this.roll();
    const cost = this.estimateUsd(inputTokens, outputTokens, model);
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
  reserve(inputTokens: number, outputTokens: number, model?: string | null): ReserveVerdict {
    const verdict = this.precheck(inputTokens, outputTokens, model);
    if (!verdict.ok) return verdict;
    const worst = this.estimateUsd(inputTokens, outputTokens, model);
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
          return this.record(...billableTokens({ prompt_tokens: actualIn, completion_tokens: actualOut }, inputTokens, outputTokens), model);
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

/** The default OpenAI model the Hub's vision calls name — the SAME variable the
 *  text cascade reads (`||` because compose maps an unset var to ""). */
export const OPENAI_VISION_DEFAULT_MODEL = "gpt-5.4-mini";

export function openAiVisionModelId(): string {
  return process.env.OPENAI_MODEL || OPENAI_VISION_DEFAULT_MODEL;
}

/**
 * THE vision pick policy (Codex r2 F4 / r4 F10 on #4355): OpenAI serves vision
 * only when its key is set AND the configured model has a VERIFIED worst-case
 * image cost; otherwise the free Together path serves. `defaultRecognizer`,
 * `defaultVisionCall` and the LOOK route all read this one function, so no
 * surface can pick an OpenAI vision call that would only be refused.
 */
export function openAiVisionSelectable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && imagePartMaxTokens(openAiVisionModelId()) !== null;
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
/**
 * The ONE gate for a provider attempt that may hit OpenAI (the canonical cascade
 * names OpenAI "OpenAI"). Every Hub call site that fetches a canonical provider
 * calls this before the fetch:
 *  - a free provider: `{ ok: true, reservation: null }` — nothing to hold;
 *  - OpenAI within the cap: the worst case is HELD for the life of the request;
 *    the caller settles billable usage when a response lands, releases on a
 *    rejection (non-2xx), and settles the worst case in a `finally` for any
 *    other exit (settle/release are idempotent);
 *  - OpenAI past the cap: logged and refused — the caller falls through to the
 *    next provider, exactly as for a provider that is down.
 * A default-deny contract test (openai-attempt-gate.test.ts) fails if a Hub file
 * fetches a canonical provider without going through this or `reserve`.
 */
export function reserveOpenAiAttempt(
  providerName: string,
  scope: string,
  inputBound: number,
  outputCap: number,
  /** The model this attempt sends; priced from the shared table (#4968). */
  model?: string | null,
): { ok: true; reservation: BudgetReservation | null } | { ok: false } {
  if (providerName !== "OpenAI") return { ok: true, reservation: null };
  const verdict = openAiRunBudget().reserve(inputBound, outputCap, model);
  if (!verdict.ok) {
    logBudgetExhausted(scope, verdict);
    return { ok: false };
  }
  return { ok: true, reservation: verdict.reservation };
}

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
