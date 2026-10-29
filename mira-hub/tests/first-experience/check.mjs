// Render the REAL components with local-only auth/navigation/API fixtures.
// No production credentials, customers, slots, email, telemetry or model calls.
// Run from mira-hub: node tests/first-experience/check.mjs
import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const root = process.cwd();
const output = process.env.PILOT_EVIDENCE_DIR ?? await mkdtemp(path.join(os.tmpdir(), "pilot-first-experience-"));
await mkdir(output, { recursive: true });
const result = await build({ entryPoints: ["tests/first-experience/fixture.tsx"], bundle: true, write: false, format: "esm", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"test"', "process.env.NEXT_PUBLIC_BASE_PATH": '""' }, alias: { "next/link": path.join(root,"tests/first-experience/mocks.tsx"), "next/navigation": path.join(root,"tests/first-experience/mocks.tsx"), "next-auth/react": path.join(root,"tests/first-experience/mocks.tsx") } });
const css = await compile(await readFile("src/app/globals.css", "utf8"), { base: path.join(root,"src/app"), onDependency() {} });
const candidates = new Scanner({ sources: [{ base: path.join(root,"src"), pattern: "**/*.{ts,tsx}", negated: false }] }).scan();
const style = css.build(candidates);
const server = createServer((req,res) => {
  if(req.url === "/fixture.js") { res.setHeader("Content-Type","text/javascript"); res.end(result.outputFiles[0].text); }
  else if(req.url === "/style.css") { res.setHeader("Content-Type","text/css"); res.end(style); }
  else { res.setHeader("Content-Type","text/html");res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/fixture.js"></script>'); }
});
await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless:true });
let checks=0;
try {
 for(const [device,viewport] of [["mobile",{width:412,height:915}],["desktop",{width:1440,height:1000}]]) {
  const page=await browser.newPage({viewport});
  const errors=[];page.on("pageerror",e=>{errors.push(e.message);console.error(e.message)});
  await page.route("**/*",route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(base+"/signup");
  await expect(page.getByRole("button",{name:"Apply for a free pilot",exact:true})).toBeVisible();
  await expect(page.getByText(/Waiting uses no pilot days/)).toBeVisible();
  await page.getByRole("button",{name:"Apply with Google"}).click();
  await expect(page.getByText(/Google sign-in could not start/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Apply with Google"})).toBeEnabled(); checks+=4;
  await page.route("**/api/auth/register/",route=>route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({error:"account already exists"})}));
  await page.getByLabel("Email",{exact:true}).fill("pilot-fixture@example.invalid");
  await page.getByLabel("Password",{exact:true}).fill("local-fixture-password");
  await page.getByRole("button",{name:"Apply for a free pilot",exact:true}).click();
  await expect(page.getByText(/You already have an account/)).toBeVisible();checks++;
  await page.screenshot({path:path.join(output,`signup-${device}.png`),fullPage:true});
  await page.goto(base+"/pending-approval");
  await page.route("**/api/auth/check-approval/",route=>route.fulfill({contentType:"application/json",body:'{"status":"pending"}'}));
  await page.getByRole("button",{name:"Check approval status"}).click();
  await expect(page.getByRole("status")).toContainText("still awaiting review");checks++;
  await page.unroute("**/api/auth/check-approval/");
  await page.route("**/api/auth/check-approval/",route=>route.abort());
  await page.getByRole("button",{name:"Check approval status"}).click();
  await expect(page.getByRole("status")).toContainText("We could not connect");
  await expect(page.getByRole("button",{name:"Check approval status"})).toBeEnabled();checks+=2;
  await page.reload();await expect(page.getByText("Your pilot application is under review")).toBeVisible();checks++;
  await page.screenshot({path:path.join(output,`pending-${device}.png`),fullPage:true});
  await page.unroute("**/api/auth/check-approval/");
  await page.route("**/api/auth/check-approval/",route=>route.fulfill({contentType:"application/json",body:'{"status":"trial"}'}));
  await page.getByRole("button",{name:"Check approval status"}).click();
  await expect(page.getByText("You're approved!")).toBeVisible();
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);checks+=2;
  await page.route("**/api/quickstart/manufacturers/",route=>route.fulfill({contentType:"application/json",body:'{"manufacturers":[]}'}));
  await page.route("**/api/quickstart/ask/",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({answer:"**Catalog guide**\n\n- Read the model number. [1]",citations:[{index:1,title:"Catalog guide",url:"internal://fixture",page:2}],provider:null})}));
  await page.goto(base+"/quickstart");
  await expect(page.getByText(/not your private workspace/)).toBeVisible();
  await page.locator("textarea").fill("What does this catalog number mean?");await page.getByTestId("quickstart-submit").click();
  await expect(page.getByTestId("quickstart-answer").locator("strong")).toHaveText("Catalog guide");
  await expect(page.getByText("(source link unavailable in this sample)")).toBeVisible();
  await expect(page.locator('a[href^="internal:"]')).toHaveCount(0);checks+=4;
  await page.screenshot({path:path.join(output,`quickstart-${device}.png`),fullPage:true});
  await page.goto(base+"/upgrade");
  await expect(page.getByRole("link",{name:/Discuss paid continuation/})).toHaveAttribute("href",/^mailto:/);
  await expect(page.getByRole("link",{name:/Ask about consulting/})).toHaveAttribute("href",/^mailto:/);
  await expect(page.locator('a[href*="/buy"],a[href*="checkout"]')).toHaveCount(0);checks+=3;
  await page.screenshot({path:path.join(output,`continuation-${device}.png`),fullPage:true});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)) throw Error("horizontal overflow");
  expect(errors).toEqual([]);checks+=2;
  await page.close();
 }
 console.log(JSON.stringify({checks,result:"PASS",scope:"real components, mocked APIs/auth; not deployed E2E",evidence:output}));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
