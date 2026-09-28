import type { ConversionIntent, ShellState } from "@factorylm/interaction";

import type { HostHooks } from "./parts";

export interface DemoNoticeProps {
  readonly state: ShellState;
  readonly hooks?: HostHooks;
}

const CONVERSIONS: ReadonlyArray<{ readonly intent: ConversionIntent; readonly label: string }> = [
  { intent: "try-your-equipment", label: "Try with your equipment" },
  { intent: "create-workspace", label: "Create workspace" },
  { intent: "sign-in", label: "Sign in" },
];

/**
 * Says plainly that the public surface is running on sample data.
 *
 * Rendered only on a `publicDemo` profile. It is deliberately a strip inside the
 * ordinary shell rather than a separate landing chrome: the public surface is
 * the SAME product, running with fewer capabilities and curated data, and a
 * bespoke wrapper around it would be the second landing-page architecture this
 * work exists to avoid.
 *
 * Why it is always visible rather than dismissible: everything the visitor reads
 * here -- machines, evidence, citations -- is curated sample data. If the notice
 * can be dismissed, the rest of the session looks like their own plant's data,
 * and a confident cited answer about a machine they do not own is exactly the
 * kind of false grounding the product exists to prevent.
 */
export function DemoNotice({ state, hooks }: DemoNoticeProps) {
  if (!state.profile.publicDemo) return null;

  const convert = hooks?.onConvert;

  return <aside className="fl-demo-notice" aria-label="Demo notice" data-surface="public">
    <p className="fl-demo-notice__text">
      <span className="fl-demo-notice__badge">Sample data</span>
      You are trying FactoryLM on curated example machines and documents. Answers
      cite those samples, not your equipment. Nothing here is saved.
    </p>
    {typeof convert === "function"
      ? <div className="fl-demo-notice__actions">
        {CONVERSIONS.map(({ intent, label }) => <button
          key={intent}
          type="button"
          className="fl-demo-notice__action"
          data-intent={intent}
          onClick={() => convert(intent)}
        >{label}</button>)}
      </div>
      // No host to convert to: state the limit instead of rendering buttons that
      // go nowhere. Same rule as onNewChat/onCreateProject elsewhere in the shell.
      : <p className="fl-demo-notice__hint">Sign-in is not wired up in this preview.</p>}
  </aside>;
}
