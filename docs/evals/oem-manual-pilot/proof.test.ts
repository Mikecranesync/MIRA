import {it,expect} from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import {randomUUID,createHash} from 'node:crypto';
let deniedNetwork=0;
const deny=()=>{deniedNetwork++;throw new Error('OFFLINE: outbound network denied');};
globalThis.fetch=deny as any;
http.request=deny as any;https.request=deny as any;http.get=deny as any;https.get=deny as any;
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args:any[]){
 const a=Array.isArray(args[0])?args[0]:args;
 const v=a[0];const path=typeof v==='string'?v:v?.path;
 if(path!==`${process.env.PROOF_SOCKET}/.s.PGSQL.55439`)return deny();
 return connect.apply(this,args as any) as any;
} as any;
it('real MIRA writer and lexical retrieval against private postgres',async()=>{
 const {default:pool}=await import('./src/lib/db');
 const {writePdfChunksForNode}=await import('./src/lib/node-knowledge-ingest');
 const {withTenantContext}=await import('./src/lib/tenant-context');
 const {retrieveNodeChunks}=await import('./src/lib/manual-rag');
 const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
 const cases=JSON.parse(fs.readFileSync('cases.json','utf8'));
 const tenant=randomUUID(),otherTenant=randomUUID();
 const records:any[]=[];const results:any[]=[];
 try{
 for(const c of manifest.corpora){
  const buffer=fs.readFileSync(`private-pdfs/${c.corpus_id}.pdf`);
  expect(createHash('sha256').update(buffer).digest('hex')).toBe(c.sha256);
  const uploadId=randomUUID(),nodeId=randomUUID();
  let count:number;
  try {count=await writePdfChunksForNode({tenantId:tenant,uploadId,nodeId,unsPath:null,filename:`${c.corpus_id}.pdf`,buffer});}catch(e:any){
   const {getDocumentProxy,extractText}=await import('unpdf');const pdf=await getDocumentProxy(new Uint8Array(buffer));const out=await extractText(pdf,{mergePages:false});const pages=Array.isArray(out.text)?out.text:[out.text];
   records.push({corpus_id:c.corpus_id,tenant_id:tenant,upload_id:uploadId,node_id:nodeId,status:'ingest_failed',error:e.message,null_byte_pages:pages.map((text:string,i:number)=>({page:i+1,count:(text.match(/\x00/g)||[]).length})).filter((x:any)=>x.count),rows_after_failure:(await pool.query('SELECT count(*)::int n FROM knowledge_entries WHERE doc_id=$1',[uploadId])).rows[0].n});continue;
  }
  const {rows}=await pool.query('SELECT count(*)::int n,min(page_start) first,max(page_end) last,bool_and(is_private) private,bool_and(source_page=page_start AND page_start=page_end) pages_match FROM knowledge_entries WHERE tenant_id=$1 AND doc_id=$2',[tenant,uploadId]);
  expect(rows[0].n).toBe(count);expect(rows[0].private).toBe(true);expect(rows[0].pages_match).toBe(true);expect(rows[0].last).toBeLessThanOrEqual(c.pages);
  records.push({corpus_id:c.corpus_id,tenant_id:tenant,upload_id:uploadId,node_id:nodeId,chunks:count,db:rows[0],sha256:c.sha256});
 }
 const cross=await withTenantContext(otherTenant,async client=>(await client.query('SELECT count(*)::int n FROM knowledge_entries')).rows[0].n);
 expect(cross).toBe(0);
 for(const q of cases){
  const rec=records.find(x=>x.corpus_id===q.corpus_id),c=manifest.corpora.find((x:any)=>x.corpus_id===q.corpus_id);
  if(rec.status==='ingest_failed'){results.push({id:q.id,category:q.category,status:'blocked_by_ingest_failure'});continue;}
  const client=await pool.connect();
  try{
   const diagnostics:any={};
   const opts={nodeId:rec.node_id,unsPath:null,docIds:[rec.upload_id],approvedSourceDocIds:[rec.upload_id],validatedDocScope:true,identity:{manufacturer:c.oem,model:c.model},identityStatus:'user_confirmed' as const,topK:6,diagnostics};
   const chunks=await retrieveNodeChunks(client,tenant,q.question,opts);
   expect(chunks.every(x=>x.docId===rec.upload_id)).toBe(true);
   const foreign=await retrieveNodeChunks(client,otherTenant,q.question,opts);expect(foreign).toHaveLength(0);
   const returnedPages=chunks.map(x=>x.sourcePage);
   const hit=q.expected_pdf_pages.some((p:number)=>returnedPages.includes(p));
   results.push({id:q.id,category:q.category,expected_pages:q.expected_pdf_pages,returned_pages:returnedPages,target_page_in_top6:hit,document_isolation:true,foreign_tenant_hits:foreign.length,diagnostics,chunks});
  }finally{client.release();}
 }
 const settings=(await pool.query("SELECT current_setting('listen_addresses') listen_addresses,current_setting('unix_socket_directories') socket")).rows[0];
 expect(settings.listen_addresses).toBe('');expect(deniedNetwork).toBe(0);
 fs.writeFileSync('results.json',JSON.stringify({scope:'Local MIRA unpdf/chunker/SQL/lexical retrieval; no generated answer or hosted acceptance',source_sha:fs.readFileSync('source-sha.txt','utf8').trim(),synthetic_schema:true,real_postgres:true,settings,records,cases:results,network_attempts:deniedNetwork,paid_calls:0,embeddings:false,rls_other_tenant_rows:cross},null,2));
 }finally{await pool.end();}
});
