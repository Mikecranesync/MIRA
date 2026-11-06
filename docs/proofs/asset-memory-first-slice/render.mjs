import {createRequire} from 'node:module';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../../..'),out=path.resolve(process.argv[2]??'/tmp/mira-asset-memory-proof'),hub=path.join(repo,'mira-hub');
fs.mkdirSync(out,{recursive:true});
const require=createRequire(hub+'/package.json'),pdf=path.resolve(process.argv[3]??path.join(out,'guide.pdf'));
fs.mkdirSync(path.dirname(pdf),{recursive:true});process.env.ASSET_MEMORY_PROOF_OUTPUT=out;process.env.ASSET_MEMORY_PROOF_INPUT=path.join(repo,'docs/proofs/living-guide-qc-field-completeness/synthetic-fixture.json');
const stub='export async function getNotebook(){return null}; export async function resolveBoundAsset(){return {state:"unbound"}}; export async function validateChatSources(){return {ok:false,error:"stub"}}; export async function maintenanceContext(){return null}; export function observationStateEnabled(){return false}; export async function listProjectionRows(){return []}; export async function deliveryStatusForWorkOrderRequest(){return null}; export async function loadJob(){return {status:"job_not_found"}}; export async function latestCloseout(){return null}; export async function getJobSheetRevision(){return {status:"not_found"}};';
const aliases=new Set(['@/lib/equipment-notebooks','@/lib/knowledge-graph/traversal','@/capabilities/observations/flag','@/capabilities/observations/store','@/capabilities/cmms-dispatch/status']);
await require('esbuild').build({entryPoints:[path.join(here,'entry.tsx')],outfile:out+'/render.cjs',bundle:true,platform:'node',absWorkingDir:hub,tsconfig:hub+'/tsconfig.json',jsx:'automatic',nodePaths:[hub+'/node_modules'],plugins:[{name:'hermetic-proof-inputs',setup(b){b.onResolve({filter:/.*/},a=>aliases.has(a.path)||a.importer.endsWith('/asset-memory.ts')&&['./store','./intake-closeout-store','./job-sheet-store'].includes(a.path)?{path:'stub',namespace:'proof-input'}:null);b.onLoad({filter:/.*/,namespace:'proof-input'},()=>({contents:stub,loader:'js'}))}}]});
require(out+'/render.cjs');
const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
try{
const page=await browser.newPage({viewport:{width:412,height:915}});await page.goto('file://'+out+'/guide.html');
const metrics=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,images:[...document.images].filter(i=>i.getBoundingClientRect().width>0).length}));
fs.writeFileSync(out+'/metrics.json',JSON.stringify(metrics,null,2));
await page.screenshot({path:out+'/screen-412.png',fullPage:true});
await page.emulateMedia({media:'print'});
await page.pdf({path:pdf,format:'A4',printBackground:true,preferCSSPageSize:true});
console.log(JSON.stringify(metrics));
}finally{await browser.close()}
