/** Scope the owner-approved free account offer without replacing the existing contract. */
export function withFreeTechnicianTerms(source: string): string {
  if (process.env.MIRA_FREE_TECHNICIANS !== "true") return source;
  const marker = '<h2>2. Offers &amp; Billing</h2>';
  if (!source.includes(marker)) throw new Error("The free-technician terms insertion needs review against the current contract");
  const offer = `<p id="free-technician-access"><strong>Free for technicians.</strong> Accounts created under the free-technician offer have no trial deadline. Creating a free technician account does not require a credit card or enroll you in a paid plan. Paid assessments, plant pilots, team services and other separately ordered services are distinct offers agreed with FactoryLM.</p>`;
  return source.replace(marker, marker + "\n        " + offer);
}
