import {EventEmitter} from 'node:events';
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
vi.mock('node:child_process',()=>({spawn:vi.fn()}));
import {spawn} from 'node:child_process';
import {readInspectionOrientation} from '../preprocess';
let child: EventEmitter & {stdin:EventEmitter & {end:ReturnType<typeof vi.fn>};stdout:EventEmitter;stderr:EventEmitter;kill:ReturnType<typeof vi.fn>};
beforeEach(()=>{
 child=Object.assign(new EventEmitter(),{stdin:Object.assign(new EventEmitter(),{end:vi.fn()}),stdout:new EventEmitter(),stderr:new EventEmitter(),kill:vi.fn()});
 vi.mocked(spawn).mockReturnValue(child as never);
});
afterEach(()=>{vi.clearAllMocks();vi.useRealTimers()});
describe('bounded native OSD',()=>{
 it('uses fixed argv/stdin and parses only finite correction/confidence',async()=>{
  const pending=readInspectionOrientation(Buffer.from('probe'));
  child.stdout.emit('data',Buffer.from('Rotate: 270\nOrientation confidence: 1.68\n'));child.emit('close',0);
  expect(await pending).toEqual({rotation:270,confidence:1.68});
  expect(spawn).toHaveBeenCalledWith('tesseract',['stdin','stdout','--psm','0','-l','osd'],expect.objectContaining({stdio:['pipe','pipe','pipe']}));
  expect(child.stdin.end).toHaveBeenCalledWith(Buffer.from('probe'));
 });
 it('kills a hung OSD process after five seconds',async()=>{
  vi.useFakeTimers();const pending=readInspectionOrientation(Buffer.from('probe'));const check=expect(pending).rejects.toThrow('osd_timeout');
  await vi.advanceTimersByTimeAsync(5000);await check;expect(child.kill).toHaveBeenCalledWith('SIGKILL');
 });
 it.each(['stdout','stderr'] as const)('caps %s output',async(channel)=>{
  const pending=readInspectionOrientation(Buffer.from('probe'));child[channel].emit('data',Buffer.alloc(16385));
  await expect(pending).rejects.toThrow('osd_output_too_large');expect(child.kill).toHaveBeenCalled();
 });
 it.each(['Rotate: 45\nOrientation confidence: 2','Rotate: 90\nOrientation confidence: NaN','unstructured output'])('rejects malformed output',async(output)=>{
  const pending=readInspectionOrientation(Buffer.from('probe'));child.stdout.emit('data',Buffer.from(output));child.emit('close',0);await expect(pending).rejects.toThrow('osd_invalid_output');
 });
 it('accepts too little text as a normal no-rotation observation',async()=>{
  const pending=readInspectionOrientation(Buffer.from('probe'));child.stderr.emit('data',Buffer.from('Too few characters. Skipping this page'));child.emit('close',1);
  expect(await pending).toEqual({rotation:0,confidence:0});
 });
 it('rejects missing native runtime distinctly',async()=>{
  const pending=readInspectionOrientation(Buffer.from('probe'));child.emit('error',new Error('ENOENT'));await expect(pending).rejects.toThrow('osd_unavailable');
 });
 it('bounds probe bytes before spawning',async()=>{
  await expect(readInspectionOrientation(Buffer.alloc(4*1024*1024+1))).rejects.toThrow('osd_probe_too_large');expect(spawn).not.toHaveBeenCalled();
 });
});
