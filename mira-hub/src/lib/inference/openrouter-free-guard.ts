/**
 * True for a model OpenRouter could serve as Claude, or a `:free` id.
 * Anthropic is banned from this cascade (PR #610); OpenRouter serves it as `anthropic/...`, through
 * `~anthropic/...-latest` aliases, and through its `openrouter/...` auto-routers.
 * A preset reference (`@preset/x`, alone or as `model@preset/x`) is refused too:
 * the preset chooses its models remotely and can be switched to Claude without
 * any change here (Codex r1 F1 on #4436).
 *
 * A model id ending in `:free` is also refused on the customer path. Those are
 * unpaid OpenRouter community hosts, not a production SLA; the same suffix is
 * honoured if a primary or pool provider is pointed at one.
 */
export function openRouterModelRefused(model: string): boolean {
  const m = model.trim().toLowerCase();
  return (
    m.includes("anthropic") ||
    m.includes("claude") ||
    m.startsWith("openrouter/") ||
    m.includes("@") ||
    m.endsWith(":free")
  );
}

/** Drop cascade members whose model id is an OpenRouter `:free` host. */
export function withoutFreeOpenRouterModels<T extends { model: string }>(providers: T[]): T[] {
  return providers.filter((p) => {
    if (
      p.model &&
      openRouterModelRefused(p.model) &&
      p.model.trim().toLowerCase().endsWith(":free")
    ) {
      console.error(`OPENROUTER_MODEL_REFUSED model=${p.model} — provider left out`);
      return false;
    }
    return true;
  });
}
