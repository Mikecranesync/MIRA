import { api, login, BASE } from "./hub.mjs"; import { ask } from "./ask.mjs";
import { randomBytes } from "node:crypto"; import { readFileSync, writeFileSync } from "node:fs";
const RAW="/workspace/live-test/batch2-raw"; process.env.RAW_DIR=RAW;
const c=JSON.parse(readFileSync(RAW+"/nbs.json")); const Q=JSON.parse(readFileSync(process.argv[2])); await login();
const out=[];
for (const [id,k,q] of Q) { const nb=c[k];
  const r=await ask(id, nb.notebookId, nb.docId, q, { threadId: "thrd_"+randomBytes(16).toString("hex") });
  const g=kk=>r.frames.find(f=>f.kind===kk)||{}; const cites=g("sources").citations||[];
  for (const ci of cites) { const p=await api(`/api/equipment-notebooks/${nb.notebookId}/sources/${ci.docId}/passage/?page=${ci.page}`); writeFileSync(`${RAW}/${id}-chip${ci.citationId}-p${ci.page}-passage.json`, await p.text()); }
  const o={id,model:k,thread:r.requestBody.threadId,http:r.httpStatus,ms:r.totalMs,status:g("status").status,label:g("evidence").label,cites:cites.map(x=>({id:x.citationId,page:x.page,file:x.filename||x.title})),answer:r.answer.trim()};
  out.push(o); console.log(JSON.stringify(o));
}
writeFileSync(process.argv[3], JSON.stringify(out,null,1));
