// Copy strings for the work-order surfaces that need to be unit-testable.
//
// The New Work Order wizard's photo helper text was reported (secret-shopper
// QA) as "…QA-CMMS-SS-214546in MIRA's knowledge base." — a missing space
// before "in". The JSX form already renders a space, but building the sentence
// as a single string here removes any dependency on JSX inter-node whitespace
// and lets us assert the spacing in a test.
export function photoAttachHelp(tag?: string | null): string {
  const target = tag && tag.trim() ? `asset ${tag.trim()}` : "the selected asset";
  return `Photos attach to ${target} in MIRA's knowledge base.`;
}
