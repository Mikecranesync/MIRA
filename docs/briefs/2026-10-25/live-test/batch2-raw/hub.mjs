import { readFileSync } from "node:fs";
export const BASE = "https://app-staging.factorylm.com";
const [EMAIL, PW] = readFileSync("/workspace/punchlist/prover/.staging-account","utf8").trim().split(/\r?\n/).map(s=>s.trim());
const jar = new Map();
function stash(res){ for (const c of res.headers.getSetCookie?.() ?? []) { const [kv]=c.split(";"); const i=kv.indexOf("="); if(i>0) jar.set(kv.slice(0,i).trim(), kv.slice(i+1).trim()); } }
const cookieHeader = () => [...jar].map(([k,v])=>`${k}=${v}`).join("; ");
export async function api(path, init={}) {
  if (path.includes("/register") || path.includes("/api/hub/ask") || init.method==="DELETE") throw new Error("forbidden");
  const res = await fetch(`${BASE}${path}`, {...init, redirect:"manual", headers:{...(init.headers||{}), cookie: cookieHeader()}});
  stash(res); return res;
}
export const json = (body, method="POST") => ({ method, headers:{"content-type":"application/json"}, body: JSON.stringify(body) });
export async function login() {
  const { csrfToken } = await (await api("/api/auth/csrf/")).json();
  const cb = await api("/api/auth/callback/credentials/", { method:"POST", headers:{"content-type":"application/x-www-form-urlencoded"}, body: new URLSearchParams({csrfToken, email:EMAIL, password:PW, json:"true"}).toString() });
  const s = await (await api("/api/auth/session/")).json().catch(()=>({}));
  if (!s?.user?.tenantId) throw new Error(`login failed (callback ${cb.status})`);
  return s;
}
