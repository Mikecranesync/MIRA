import { api, login } from "./hub.mjs"; import { readFileSync } from "node:fs";
const c=JSON.parse(readFileSync("created.json")); await login();
for (let i=0;i<70;i++){ let all=true; const line=[];
 for (const [k,v] of Object.entries(c)) { const d=await (await api(`/api/equipment-notebooks/${v.notebookId}/`)).json(); const r=d.sources?.[0]?.readiness; line.push(k+":"+r?.state+":"+r?.embeddingCoverage); if(r?.state!=="chat_ready_enhanced") all=false; }
 console.log(new Date().toLocaleTimeString(), line.join(" ")); if(all) break; await new Promise(r=>setTimeout(r,20000)); }
