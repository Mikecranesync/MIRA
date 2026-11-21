/** Local-only rehearsal of the real bounded public adapter; no upstream services. */
import { Hono } from "hono";
import { createFactorylmMarketingRouter } from "../src/factorylm-ui/marketing-next";
import { withFreeTechnicianTerms } from "../src/factorylm-ui/free-technician-terms";

const app = new Hono().route("/", createFactorylmMarketingRouter());
app.get("/terms", async () => new Response(withFreeTechnicianTerms(await Bun.file(new URL("../public/terms.html", import.meta.url)).text()), { headers: { "Content-Type": "text/html; charset=utf-8" } }));
app.all("*", (c) => c.text("This route remains with the existing application.", 404));
const port = Number(process.env.PORT ?? 4188);
Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch });
console.log(`Local marketing adapter: http://127.0.0.1:${port}`);
