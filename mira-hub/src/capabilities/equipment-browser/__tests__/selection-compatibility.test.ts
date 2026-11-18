import { describe,expect,it,vi } from "vitest";
import type { ComponentRecord } from "@/capabilities/bench-components/store";
const store=vi.hoisted(()=>({getSelection:vi.fn(),listComponents:vi.fn(),advanceSelectionRevision:vi.fn(),getSelectionState:vi.fn()}));
vi.mock("@/capabilities/bench-components/store",()=>store);
import { resolveComponentTurn } from "@/capabilities/bench-components/chat-turn";

function record(id:string,catalogNumber:string):ComponentRecord {
  return {id,notebookId:"nb",position:1,kind:"drive",origin:"technician",createdAt:"2026-11-17T00:00:00Z",retiredAt:null,
    current:{componentId:id,revision:1,rawLabel:catalogNumber,inputKind:"typed",manufacturer:"AutomationDirect",family:"GS10",catalogNumber,
      serialNumber:null,hardwareRevision:null,localTag:"VFD1",identityStatus:"user_confirmed",unresolved:[],confirmedAt:"2026-11-17T00:00:00Z",createdAt:"2026-11-17T00:00:00Z",evidenceFileId:null,evidenceNote:null}};
}
describe("direct API compatibility with existing question selection",()=>{
  it.each([["Unicode hyphen","What about GS13N\u201120P2?"],["long spaced catalog","Please keep this maintenance context while we consider the recorded observations. ".repeat(80)+"Does GS13N - 20P2 have the same limit?"]])("catalog mention offers switch without moving selection: %s",async(_name,question)=>{
    const selected=record("selected","GS11N-20P2"), other=record("other","GS13N-20P2");
    const selection={componentId:selected.id,revision:1,version:1,selectedAt:"2026-11-17T01:00:00Z",selectedVia:"picker"};
    store.getSelection.mockResolvedValue(selection);store.listComponents.mockResolvedValue([selected,other]);
    const result=await resolveComponentTurn("tenant","nb","user","thread",{componentId:selected.id,selectionVersion:1},question);
    expect(result.kind).toBe("hold");
    if(result.kind!=="hold")throw new Error("Expected an explicit switch offer");
    expect(result.actions).toEqual([{action:"switch",componentId:other.id,label:expect.any(String)},{action:"stay",componentId:selected.id,label:expect.any(String)}]);
    expect(store.advanceSelectionRevision).not.toHaveBeenCalled();expect(selection.componentId).toBe(selected.id);
  });
});
