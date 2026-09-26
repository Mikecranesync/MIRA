import {describe,it,expect,vi,afterEach} from 'vitest';
import {openaiVisionCall} from '../passes';
const args={prompt:'exact inspection prompt',images:[{base64:'aW1hZ2U=',mimeType:'image/jpeg'}],temperature:0.1,maxTokens:1200};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});
describe('opt-in OpenAI Responses vision',()=>{
 it('preserves small-label detail with original sizing, no storage, bounded reasoning and only completed text',async()=>{
  vi.stubEnv('OPENAI_API_KEY','test'); const fetcher=vi.fn(async(_url: string, _init: RequestInit)=>Response.json({status:'completed',model:'returned-model',output:[{type:'message',content:[{type:'output_text',text:'{"observation":"panel"}'}]}]}));vi.stubGlobal('fetch',fetcher);
  expect(await openaiVisionCall(args)).toMatchObject({finishReason:'stop',text:'{"observation":"panel"}',model:'returned-model'});
  const body=JSON.parse(fetcher.mock.calls[0][1].body as string);
  expect(body).toMatchObject({store:false,max_output_tokens:4096,reasoning:{effort:'medium'}});
  expect(body.input[0].content[1]).toMatchObject({type:'input_image',detail:'original'});
 });
 it.each(['incomplete','failed','in_progress',undefined])('rejects %s even if text exists',async(status)=>{
  vi.stubEnv('OPENAI_API_KEY','test');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({status,output:[{type:'message',content:[{type:'output_text',text:'{}'}]}]})));
  await expect(openaiVisionCall(args)).rejects.toThrow('vision_incomplete_response');
 });
 it('does not expose refusal as observation',async()=>{
  vi.stubEnv('OPENAI_API_KEY','test');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'cannot'}]}]})));
  await expect(openaiVisionCall(args)).rejects.toThrow('vision_empty_response');
 });
});
