import React,{useCallback,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LivingInstructionControls} from '../../../mira-hub/src/factorylm-ui/LivingInstructionControls';
import {scopedAssetMemorySelection,createFrozenSheetSend,withAssetMemorySelector} from '../../../mira-hub/src/factorylm-ui/living-sheet-client';
import {withLivingSheetRider} from '../../../mira-hub/src/factorylm-ui/hub-host-logic';
import records from 'asset-memory-proof-records';
const w=window as any;
w.__events=[];w.__requests=[];w.__responses=[];w.__selected=null;
window.fetch=async(input:any)=>{
 const url=String(input),isB=url.includes(records.B.snapshot.jobId);w.__requests.push({url,at:performance.now()});
 await new Promise(resolve=>setTimeout(resolve,isB?15:450));w.__responses.push(url);
 return new Response(JSON.stringify(isB?records.B:records.A),{status:200,headers:{'content-type':'application/json'}});
};
function App(){
 const [which,setWhich]=useState<'A'|'B'>('A'),[pending,setPending]=useState(0);
 const [selected,setSelected]=useState<any>(null),[printing,setPrinting]=useState(false);
 const record=records[which],nb=record.lineage.notebookId;
 const onSelection=useCallback((next:any,scope:any)=>{w.__events.push({next,scope,at:performance.now()});setSelected((cur:any)=>{const value=scopedAssetMemorySelection(cur,next,scope,nb);w.__selected=value;return value})},[nb]);
 const onPrintMode=useCallback((value:boolean)=>setPrinting(value),[]);
 w.__switch=(key:'A'|'B')=>setWhich(key);w.__pending=(n:number)=>setPending(n);
 w.__freeze=()=>{
  const freeze=createFrozenSheetSend<any>();
  const raw={message:'What work and evidence were recorded?',mode:'general',clientRequestId:'66666666-6666-4666-8666-666666666666'};
  const target={notebookId:nb,threadId:'77777777-7777-4777-8777-777777777777'};
  const first=freeze(raw,target,()=>withAssetMemorySelector(withLivingSheetRider(raw,nb,selected),nb,selected))!;
  const second=freeze(first.body,{notebookId:'88888888-8888-4888-8888-888888888888',threadId:'99999999-9999-4999-8999-999999999999'},()=>{throw Error('retry redecorated a frozen request')})!;
  w.__frozen={same:first===second,body:first.body,target:second.target,serialized:first.serialized};return w.__frozen;
 };
 return <main><h1>Fictional component journey</h1><p>Actual Controls/Guide and request helpers; server I/O mocked. Not an authenticated deployment or human acceptance.</p>
  <button onClick={()=>setWhich('B')}>Switch to second job</button><button onClick={()=>setPending(1)}>Queue job update</button><button onClick={()=>setPending(0)}>Save job update</button>
  <p>Shown job: {which}. Print mode: {String(printing)}. Selection: {selected?.jobId??'none'}</p>
  <LivingInstructionControls notebookId={nb} scopeId='synthetic-viewer-scope' view={record.snapshot as never} pendingCount={pending} onPrintMode={onPrintMode} onSelection={onSelection}/>
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
