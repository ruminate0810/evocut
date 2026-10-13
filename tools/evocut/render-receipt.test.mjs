import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {startRenderReceipt,finishRenderReceipt} from './render-receipt.mjs';
function fixture(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'evocut-render-binding-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));fs.writeFileSync(path.join(d,'index.html'),'original');return d;}
const start=(d,args=['render','-o','result.mp4'],extra={})=>startRenderReceipt({project:d,cwd:d,args,engineVersion:'0.8.81',...extra});
test('receipt binds exact source and final bytes only after successful new output',t=>{const d=fixture(t),out=path.join(d,'result.mp4'),s=start(d,['render',d,'--output',out]);assert.equal(finishRenderReceipt(s,{exitCode:2}),null);fs.writeFileSync(out,'test video bytes');const r=finishRenderReceipt(s,{exitCode:0});assert.equal(r.receipt.sourceUnchanged,true);assert.equal(r.receipt.index.sha256.length,64);assert.equal(r.receipt.video.path,fs.realpathSync(out));assert.equal(r.receipt.invocation.outputPreviouslyExisted,false);});
test('source change, stale output or absent output refuses receipt',t=>{const d=fixture(t),out=path.join(d,'result.mp4'),s=start(d);assert.throws(()=>finishRenderReceipt(s,{exitCode:0}),/did not create/);fs.writeFileSync(out,'test');fs.utimesSync(out,new Date(0),new Date(0));assert.throws(()=>finishRenderReceipt(s,{exitCode:0}),/predates/);fs.writeFileSync(path.join(d,'index.html'),'changed');assert.throws(()=>finishRenderReceipt(s,{exitCode:0}),/changed during/);});
test('multi-output, composition, variable, cached resume and unknown flags withhold binding',t=>{
  const d=fixture(t);
  for(const flags of [['--batch','rows.json'],['--batch=rows.json'],['--composition','sub'],['--composition=sub'],['-c','sub'],['-csub'],
    ['--variables','{}'],['--variables-file','vars.json'],['--resume'],['--frames-cache-dir','cache'],['--made-up','value'],['--made-up=value']])
    assert.equal(start(d,['render','-o','out.mp4',...flags]),null,flags.join(' '));
  assert.equal(start(d,['render']),null);
});
test('help/version zero-exit cannot relabel a freshly created old MP4',t=>{
  const d=fixture(t),out=path.join(d,'result.mp4');fs.writeFileSync(out,'old but fresh mtime');
  for(const flag of ['--help','-h','--version','-v'])assert.equal(finishRenderReceipt(start(d,['render','-o','result.mp4',flag]),{exitCode:0}),null);
  assert.equal(fs.existsSync(path.join(d,'.hyperframes/evocut/render-receipt.json')),false);
});
test('no-op success and touching or recopying old output bytes never rebinds it',t=>{
  const d=fixture(t),out=path.join(d,'result.mp4');fs.writeFileSync(out,'old bytes');
  const s=start(d);assert.throws(()=>finishRenderReceipt(s,{exitCode:0}),/did not change|predates/);
  fs.utimesSync(out,new Date(),new Date(Date.now()+1000));assert.throws(()=>finishRenderReceipt(s,{exitCode:0}),/did not change/);
  fs.unlinkSync(out);fs.writeFileSync(out,'old bytes');assert.throws(()=>finishRenderReceipt(s,{exitCode:0}),/did not change/);
});
test('rewritten output with different bytes can be bound after zero exit',t=>{
  const d=fixture(t),out=path.join(d,'result.mp4');fs.writeFileSync(out,'old bytes');const s=start(d);fs.writeFileSync(out,'new output bytes');
  const r=finishRenderReceipt(s,{exitCode:0});assert.equal(r.receipt.invocation.outputPreviouslyExisted,true);
});
test('changing source then restoring identical text is detected through file identity',t=>{
  const d=fixture(t),s=start(d),index=path.join(d,'index.html');fs.writeFileSync(index,'temporary mutation');fs.writeFileSync(index,'original');
  fs.writeFileSync(path.join(d,'result.mp4'),'new');assert.throws(()=>finishRenderReceipt(s,{exitCode:0}),/changed during/);
});
test('positional child project cannot be bound to nearest package parent or another cwd',t=>{
  const d=fixture(t),child=path.join(d,'child');fs.mkdirSync(child);fs.writeFileSync(path.join(child,'index.html'),'child source');
  fs.writeFileSync(path.join(d,'package.json'),'{}');
  assert.equal(start(d,['render','child','-o','out.mp4']),null);
  const good=startRenderReceipt({project:child,cwd:d,args:['render','child','-o','out.mp4'],engineVersion:'0.8.81'});
  assert.equal(good.project,fs.realpathSync(child));assert.equal(good.videoPath,path.join(d,'out.mp4'));
  assert.equal(startRenderReceipt({project:child,cwd:d,args:['render','-o','out.mp4'],engineVersion:'0.8.81'}),null);
});
test('only unambiguous single-project MP4 flags are eligible; options do not become project names',t=>{
  const d=fixture(t);
  assert.ok(start(d,['render','-q','draft','--fps=30','-w','2','--no-browser-gpu','--strict','false','--output=result.mp4',d]));
  assert.ok(start(d,['render','-o','result.mp4','--',d]));
  for(const args of [['render',d,d,'-o','out.mp4'],['render','-o','one.mp4','--output','two.mp4'],['render','--format','webm','-o','out.mp4'],
    ['render','--output'],['render','-o','--help'],['render','--dir',d,'-o','out.mp4'],['render','--strict=maybe','-o','out.mp4']])assert.equal(start(d,args),null,args.join(' '));
  assert.equal(start(d,undefined,{engineVersion:'0.8.62'}),null);
});
test('source and output symlinks and escaped receipt state are refused',t=>{
  const d=fixture(t),out=path.join(d,'result.mp4'),other=path.join(d,'other.mp4');fs.writeFileSync(other,'old');fs.symlinkSync(other,out);
  assert.throws(()=>start(d),/symlink/);fs.unlinkSync(out);
  const index=path.join(d,'index.html');fs.unlinkSync(index);fs.writeFileSync(path.join(d,'source.html'),'original');fs.symlinkSync(path.join(d,'source.html'),index);
  assert.throws(()=>start(d),/symlink/);fs.unlinkSync(index);fs.writeFileSync(index,'original');
  const state=path.join(d,'elsewhere');fs.mkdirSync(state);fs.symlinkSync(state,path.join(d,'.hyperframes'));
  assert.throws(()=>start(d),/Symlink receipt/);assert.equal(fs.readdirSync(state).length,0);
});
test('output replaced with a symlink during render is not accepted',t=>{
  const d=fixture(t),s=start(d),other=path.join(d,'other.mp4');fs.writeFileSync(other,'new');fs.symlinkSync(other,path.join(d,'result.mp4'));
  assert.throws(()=>finishRenderReceipt(s,{exitCode:0}),/symlink/);
});
test('failed and signalled subprocess exits never write a receipt',t=>{
  const d=fixture(t),s=start(d);fs.writeFileSync(path.join(d,'result.mp4'),'new');
  for(const exitCode of [1,2,null,undefined])assert.equal(finishRenderReceipt(s,{exitCode}),null);
  assert.equal(fs.existsSync(path.join(d,'.hyperframes/evocut/render-receipt.json')),false);
});
