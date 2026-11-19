/** Return explicit endpoint fields: pg must never reinterpret an unchecked URL. */
export function workflowDatabaseConfig(value, confirmation) {
  if (!value || confirmation !== "DISPOSABLE") throw new Error("WF-01 requires an explicitly confirmed disposable database");
  const url = new URL(value);
  const port = Number(url.port || 5432);
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/mira_wf01_test" ||
    url.search || url.hash || !url.username || port < 1 || port > 65535) throw new Error("WF-01 refuses unsafe endpoint/options");
  return { host: url.hostname.replace(/^\[|\]$/g, ""), port,
    database: "mira_wf01_test", user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), ssl: false };
}
