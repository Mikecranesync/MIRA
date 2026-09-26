import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { prepareInspectionImage } from '../preprocess';

async function image(width=80,height=40) { return sharp({create:{width,height,channels:3,background:'red'}}).jpeg().toBuffer(); }
describe('bounded inspection working view',()=>{
 it('rotates clockwise by OSD correction without changing original bytes',async()=>{
  const input=await image(); const copy=Buffer.from(input);
  const result=await prepareInspectionImage(input,async()=>({rotation:90,confidence:2}));
  expect(input.equals(copy)).toBe(true);
  expect(await sharp(result.buffer).metadata()).toMatchObject({width:40,height:80});
  expect(result.metadata).toMatchObject({rotationDegrees:90,osdStatus:'accepted'});
 });
 it('leaves low confidence orientation alone',async()=>{
  const result=await prepareInspectionImage(await image(),async()=>({rotation:90,confidence:0.9}));
  expect(result.metadata).toMatchObject({rotationDegrees:0,width:80,height:40,osdStatus:'low_confidence'});
 });
 it('keeps an upright image upright',async()=>{
  const result=await prepareInspectionImage(await image(),async()=>({rotation:0,confidence:3}));
  expect(result.metadata.rotationDegrees).toBe(0);
 });
 it('reports timeout rather than silently using an unnormalized image',async()=>{
  await expect(prepareInspectionImage(await image(),async()=>{throw new Error('osd_timeout')})).rejects.toThrow('osd_timeout');
 });
 it('bounds the working long edge',async()=>{
  const result=await prepareInspectionImage(await image(3000,30),async()=>({rotation:0,confidence:0}));
  expect(result.metadata.width).toBe(2576);
 });
 it('rejects corrupt and compressed oversized pixel data before OSD',async()=>{
  let calls=0; const osd=async()=>{calls++;return {rotation:0,confidence:3}};
  await expect(prepareInspectionImage(Buffer.from('bad'),osd)).rejects.toThrow();
  await expect(prepareInspectionImage(await image(5000,5000),osd)).rejects.toThrow();
  await expect(prepareInspectionImage(Buffer.alloc(8*1024*1024+1),osd)).rejects.toThrow('inspection_image_too_large');
  expect(calls).toBe(0);
 });
});
