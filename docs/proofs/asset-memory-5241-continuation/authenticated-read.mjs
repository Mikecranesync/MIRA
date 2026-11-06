// Real authenticated I/O against the existing synthetic QA case. No seeding,
// mocks, chat/provider calls or source mutations. Keep auth state outside git.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../../..');
const require=createRequire(path.join(repo,'mira-hub/package.json')),{chromium}=require('playwright');
const base=process.env.ASSET_MEMORY_BASE??'http://127.0.0.1:55784/hub',auth=process.env.ASSET_MEMORY_AUTH_STATE,out=path.resolve(process.argv[2]??'/tmp/asset-memory-authenticated-proof');
if(!auth)throw Error('ASSET_MEMORY_AUTH_STATE must name a private authenticated Playwright state file');
if(!['127.0.0.1','localhost','app-staging.factorylm.com'].includes(new URL(base).hostname))throw Error('Only loopback or existing staging is allowed');
fs.mkdirSync(out,{recursive:true});const nb='d36d1927-d466-4cb4-8cad-3ce8394c3201',job='04bce10d-1acc-4a21-b5ba-fa06d3d14b05',asset='00000000-0000-0000-0000-000000001005';
const browser=await chromium.launch({headless:true});
try{
 const ctx=await browser.newContext({storageState:auth,viewport:{width:1440,height:900}}),times={};
 const get=async p=>{const t=performance.now(),r=await ctx.request.get(base+p);times[p]={status:r.status(),ms:performance.now()-t};if(!r.ok())throw Error(`${p}: ${r.status()}`);return r.json()};
 const session=await get('/api/auth/session/');if(session.user?.tenantId!=='00000000-0000-0000-0000-000000000099')throw Error('Expected existing synthetic QA tenant');
 const context=await get(`/api/assets/${asset}/context/`),documents=await get(`/api/assets/${asset}/documents/`),detail=await get(`/api/equipment-notebooks/${nb}/`),record=await get(`/api/equipment-notebooks/${nb}/sheets/${job}/?format=instruction-record-v2&assetMemory=1`);
 if(record.snapshot.machine.entityId!=='PUMP-01'||record.assetMemory.current.binding!=='same_confirmed_asset')throw Error('Asset identity mismatch');
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/v3/?notebook=${nb}`,{waitUntil:'domcontentloaded'});await page.getByTestId('living-sheet-pill').waitFor({timeout:30000});await page.getByTestId('living-sheet-pill').click();await page.getByTestId(`living-sheet-job-${job}`).click();await page.getByRole('button',{name:'Open saved job memory',exact:true}).click();await page.getByTestId('asset-memory-summary').first().waitFor();
 await page.getByTestId('living-sheet-layer').screenshot({path:path.join(out,'desktop.png')});await page.setViewportSize({width:412,height:915});await page.getByTestId('living-sheet-layer').screenshot({path:path.join(out,'mobile.png')});
 const href=await page.getByRole('link',{name:'Authenticated saved Living Sheet record'}).first().getAttribute('href'),response=page.waitForResponse(r=>r.url().includes('memorySelector='));await page.getByRole('link',{name:'Authenticated saved Living Sheet record'}).first().click();const link=await response,linked=await link.json();
 const result={classification:'live integration with synthetic QA data; not field acceptance',base,assetId:asset,notebookId:nb,jobId:job,snapshotId:record.snapshotId,components:context.components.length,attachedManuals:documents.attached.length,notebookSources:detail.sources.length,viewerChatTurns:detail.turns.length,hasImportedGuide:record.sourceEvidence!==null,sourceLink:{href,status:link.status(),snapshotSame:linked.snapshotId===record.snapshotId},timings:times,browserErrors:errors};
 if(!result.sourceLink.snapshotSame||link.status()!==200||errors.length)throw Error('Candidate/source-link regression');
 fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(!result.components||!result.attachedManuals||!result.notebookSources||!result.viewerChatTurns||!result.hasImportedGuide)process.exitCode=2;
 await ctx.close();
}finally{await browser.close()}
