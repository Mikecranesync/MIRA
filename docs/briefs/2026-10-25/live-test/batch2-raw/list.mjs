import { api, login } from "./hub.mjs";
await login();
const r=await api("/api/equipment-notebooks/"); const t=await r.text(); let d; try{d=JSON.parse(t)}catch{console.log(r.status,t.slice(0,300));process.exit()}
const arr=d.notebooks||d.items||d;
for (const n of arr) { const s=n.sources||[]; console.log(n.id, "|", n.name, "|", (n.sourceDocIds||[]).length, s.map(x=>x.filename||x.title).join(",")); }
