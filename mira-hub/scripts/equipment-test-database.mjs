/** The equipment profile runs schema-changing fixtures on an explicit local DB. */
export function equipmentTestDatabaseUrl(value = "", confirmation = "") {
  if (confirmation !== "DISPOSABLE") {
    throw new Error("Set MIRA_TEST_DB_CONFIRM=DISPOSABLE for the equipment-browser test database.");
  }
  const url = new URL(value);
  // pg accepts connection options in the query string. Use a canonical,
  // option-free URI so setup and the test pools connect to the address checked here.
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !/^\/[a-zA-Z0-9_-]+$/.test(url.pathname) ||
      /prod|prd|staging/i.test(url.pathname) ||
      url.search || url.hash) {
    throw new Error("The equipment-browser profile requires an explicit disposable loopback PostgreSQL database without URL options.");
  }
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.toString();
}
