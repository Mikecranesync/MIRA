import { api, json, login, BASE } from "./hub.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const M={ pf525:"/workspace/manuals/rockwell/520-um001.pdf", acs355:"/workspace/manuals/abb/abb-acs355-users-manual-3AUA0000066143.pdf"};
const NAMES={pf525:"Batch2 2026-10-25 PowerFlex 525", acs355:"Batch2 2026-10-25 ACS355"};
const created = existsSync("created.json") ? JSON.parse(readFileSync("created.json")) : {};
const s=await login(); console.log("login ok");
console.log("health", (await (await fetch(BASE+"/api/health")).text()).slice(0,300));
for (const key of Object.keys(M)) {
  const rec = created[key] ?? {}; if (rec.attached) { console.log("skip",key); continue; }
  if (!rec.notebookId) {
    const res = await api("/api/equipment-notebooks/", json({ displayName: NAMES[key] })); const body = await res.json().catch(()=>({}));
    if (res.status !== 201) { console.log("create fail", key, res.status, JSON.stringify(body).slice(0,300)); continue; }
    rec.notebookId = body.notebook?.id ?? body.id; rec.name=NAMES[key]; created[key]=rec; writeFileSync("created.json", JSON.stringify(created,null,2)); console.log("nb",key,rec.notebookId);
  }
  const detail = await (await api(`/api/equipment-notebooks/${rec.notebookId}/`)).json(); rec.nodeId = detail.notebook?.nodeId;
  const fn=M[key].split("/").pop(); const form=new FormData(); form.append("file", new Blob([readFileSync(M[key])],{type:"application/pdf"}), fn);
  const t0=Date.now(); const res = await api(`/api/namespace/node/${rec.nodeId}/files/`, { method:"POST", body: form }); const up = await res.json().catch(()=>({}));
  rec.upload={status:res.status, ms:Date.now()-t0, raw:JSON.stringify(up).slice(0,500)}; console.log("upload",key,res.status,rec.upload.ms,rec.upload.raw);
  if (up.uploadId) { rec.docId=up.uploadId; const at=await api(`/api/equipment-notebooks/${rec.notebookId}/sources/`, json({docId:rec.docId, sourceRole:"manual"})); rec.attachStatus=at.status; rec.attached=at.status===201; console.log("attach",at.status,(await at.text()).slice(0,200)); }
  created[key]=rec; writeFileSync("created.json", JSON.stringify(created,null,2));
}
