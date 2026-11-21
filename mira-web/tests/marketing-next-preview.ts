/** Local-only rehearsal of the real bounded public adapter; no upstream services. */
import { Hono } from "hono";
import { createFactorylmMarketingRouter } from "../src/factorylm-ui/marketing-next";

const app = new Hono().route("/", createFactorylmMarketingRouter());
app.get("/terms", async () => new Response(await Bun.file(new URL("../public/terms.html", import.meta.url)).text(), { headers: { "Content-Type": "text/html; charset=utf-8" } }));
app.get("/pricing", c => c.html("<main><h1>Existing pricing restored</h1></main>"));
app.get("/blog", c => c.html('<main><h1>Existing published articles</h1><a href="/blog/fresh-published-article">Fresh database article</a></main>'));
app.get("/blog/fresh-published-article", c => c.html('<main><h1>Fresh database article</h1></main>'));
app.all("*", (c) => c.text("This route remains with the existing application.", 404));
const port = Number(process.env.PORT ?? 4188);
Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch });
console.log(`Local marketing adapter: http://127.0.0.1:${port}`);
