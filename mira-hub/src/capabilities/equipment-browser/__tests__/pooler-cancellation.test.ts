/** Regression for transaction-pooled transports: an autocommit backend PID is not
 * the backend leased by BEGIN. This is a control-path simulation, not Neon proof. */
import { describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({
  transaction:false, targets:[] as number[], started:null as null|(()=>void),
  cancelled:null as null|(()=>void), primaryStalled:false, rollbackStalled:false, response:"confirmed", end:vi.fn(),
}));
const client=vi.hoisted(()=>({
  query:vi.fn(async(query:string|{text:string})=>{
    const text = typeof query === "string" ? query : query.text;
    if(text.startsWith("BEGIN"))state.transaction=true;
    if(text==="ROLLBACK" || text==="COMMIT")state.transaction=false;
    if(text.includes("pg_backend_pid"))return {rows:[{pid:state.transaction?222:111}]};
    if(text==="ROLLBACK" && state.rollbackStalled) await new Promise<void>(()=>{});
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
  async query(_sql:string,params:number[]){
    state.targets.push(params[0]);
    if (!state.primaryStalled) state.cancelled?.();
    if (state.response === "stalled") await new Promise<void>(()=>{});
    return {rows:[{cancelled:state.response === "confirmed"}]};
  }
  async end(){state.end();}
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

  it.each(["query", "rollback"])("bounds the original %s after a positive cancellation acknowledgement", async (stage)=>{
    vi.useFakeTimers();
    try {
      state.response = "confirmed";
      state.primaryStalled = stage === "query";
      state.rollbackStalled = stage === "rollback";
      client.release.mockClear();
      const controller = new AbortController();
      const started = new Promise<void>((resolve)=>{state.started=resolve;});
      let outcome: unknown;
      const pending = withTenantContext("tenant",async(c)=>{await c.query("slow fixture query");},{signal:controller.signal,readOnly:true})
        .catch((error)=>{outcome=error;});
      await started;
      controller.abort();
      await vi.advanceTimersByTimeAsync(5_001);
      expect(outcome).toMatchObject({name:"AbortError"});
      await pending;
      expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
      state.primaryStalled = false;
      state.rollbackStalled = false;
      await expect(withTenantContext("other-tenant",async()=>"next",{readOnly:true})).resolves.toBe("next");
    } finally {
      state.primaryStalled = false;
      state.rollbackStalled = false;
      vi.useRealTimers();
    }
  });

  it.each(["stalled", "refused"])("discards the lease when cancellation is %s and leaves the pool usable", async (response)=>{
    vi.useFakeTimers();
    try {
      state.response = response;
      client.release.mockClear();
      state.end.mockClear();
      const controller=new AbortController();
      const started=new Promise<void>((resolve)=>{state.started=resolve;});
      const pending=withTenantContext("tenant",async(c)=>{await c.query("slow fixture query");},{signal:controller.signal,readOnly:true});
      const rejected = expect(pending).rejects.toMatchObject({name:"AbortError"});
      await started;
      controller.abort();
      await vi.advanceTimersByTimeAsync(5_000);
      await rejected;
      expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
      expect(state.end).toHaveBeenCalledTimes(1);
      await expect(withTenantContext("other-tenant",async()=>"next",{readOnly:true})).resolves.toBe("next");
    } finally {
      state.response = "confirmed";
      vi.useRealTimers();
    }
  });
});
