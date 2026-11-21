import { api, login } from "./hub.mjs";
await login();
for (const id of process.argv.slice(2)) { const d=await (await api(`/api/equipment-notebooks/${id}/`)).json();
 const nb=d.notebook||d; console.log(id, nb.title||nb.name, JSON.stringify((d.sources||[]).map(s=>({id:s.docId||s.id,f:s.filename||s.title,st:s.status,r:s.readiness?.state,cov:s.readiness?.embeddingCoverage,p:s.pages}))));}
