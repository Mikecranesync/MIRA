/** Regression for transaction-pooled transports: an autocommit backend PID is not
 * the backend leased by BEGIN. This is a control-path simulation, not Neon proof. */
import { describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({transaction:false,targets:[] as number[],started:null as null|(()=>void),cancelled:null as null|(()=>void)}));
const client=vi.hoisted(()=>({
  query:vi.fn(async(text:string)=>{
    if(text.startsWith("BEGIN"))state.transaction=true;
    if(text==="ROLLBACK" || text==="COMMIT")state.transaction=false;
    if(text.includes("pg_backend_pid"))return {rows:[{pid:state.transaction?222:111}]};
    if(text==="slow fixture query"){
      state.started?.();
      await new Promise<void>((resolve)=>{state.cancelled=resolve;});
      throw Object.assign(new Error("cancelled"),{code:"57014"});
    }
    return {rows:[]};
  }),release:vi.fn(),
}));
vi.mock("@/lib/db",()=>({default:{options:{},connect:async()=>client}}));
vi.mock("pg",()=>({Client:class{
  async connect(){}
  async query(_sql:string,params:number[]){state.targets.push(params[0]);state.cancelled?.();return {rows:[{pg_cancel_backend:true}]};}
  async end(){}
}}));
import { withTenantContext } from "@/lib/tenant-context";
describe("transaction pooler cancellation identity",()=>{
  it("cancels the backend pinned by BEGIN, never a previously borrowed autocommit backend",async()=>{
    const controller=new AbortController();let began!:()=>void;
    const started=new Promise<void>((resolve)=>{began=resolve;});state.started=began;state.targets=[];
    const pending=withTenantContext("tenant",async(c)=>{await c.query("slow fixture query");},{signal:controller.signal,readOnly:true});
    await started;controller.abort();await expect(pending).rejects.toMatchObject({name:"AbortError"});
    expect(state.targets).toEqual([222]);expect(client.release).toHaveBeenCalledTimes(1);
  });
});
