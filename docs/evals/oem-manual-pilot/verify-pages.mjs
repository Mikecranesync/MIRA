import fs from 'node:fs';import {Pool} from 'pg';import {getDocumentProxy,extractText} from 'unpdf';import {createHash} from 'node:crypto';
globalThis.fetch=()=>{throw Error('offline verification network prohibited')};
const socket=fs.readFileSync('socket-path.txt','utf8').trim();const pool=new Pool({host:socket,port:55439,user:process.env.PROOF_DB_USER,database:'postgres'});
const results=JSON.parse(fs.readFileSync('results.json','utf8'));const checks=[];
try{for(const rec of results.records){if(rec.status==='ingest_failed')continue;
 const bytes=fs.readFileSync(`private-pdfs/${rec.corpus_id}.pdf`);const pdf=await getDocumentProxy(new Uint8Array(bytes));const {text}=await extractText(pdf,{mergePages:false});const pages=Array.isArray(text)?text:[text];
 const {rows}=await pool.query('SELECT content,source_page,page_start,page_end,doc_id,metadata,is_private FROM knowledge_entries WHERE tenant_id=$1 AND doc_id=$2',[rec.tenant_id,rec.upload_id]);
 const bad=rows.filter(r=>!pages[r.source_page-1].replace(/\r\n/g,'\n').replace(/[ \t]+\n/g,'\n').trim().includes(r.content)||r.source_page!==r.page_start||r.source_page!==r.page_end||r.metadata.node_id!==rec.node_id||!r.is_private);
 checks.push({corpus_id:rec.corpus_id,checked_rows:rows.length,mismatched_rows:bad.length,pdf_sha256:createHash('sha256').update(bytes).digest('hex'),page_text_hashes:pages.map((p,i)=>({pdf_page:i+1,sha256:createHash('sha256').update(p).digest('hex')}))});
 if(bad.length)throw Error('page provenance mismatch');
 }
 fs.writeFileSync('page-provenance.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks.map(({page_text_hashes,...x})=>x),null,2));
}finally{await pool.end()}
