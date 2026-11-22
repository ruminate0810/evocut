import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {importPack} from './sound-pack.mjs';

test('public inventory has a unique path and payload for all 617 tracks',()=>{
  const {items} = JSON.parse(fs.readFileSync(new URL('../sound-packs/studio-617/catalog.json',import.meta.url)));
  assert.equal(items.length,617);
  for(const field of ['id','path','sha256']) assert.equal(new Set(items.map(r=>r[field])).size,617);
  assert.equal(new Set(items.map(r=>r.category)).size,32);
  assert.equal(items.filter(r=>r.license==='CC0-1.0' && r.source_url?.startsWith('https://freesound.org/')).length,415);
  assert.equal(items.filter(r=>r.license==='Apache-2.0' && r.kind==='design').length,202);
});

test('verification precedes writes, import is idempotent, and corrupt files are rejected',()=>{
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'evocut-sfx-'));
  const input = fs.realpathSync(temp), home=path.join(input,'library');
  const old=process.env.HYPERFRAMES_MEDIA_HOME; process.env.HYPERFRAMES_MEDIA_HOME=home;
  try {
    const base=path.join(input,'audio/click'); fs.mkdirSync(base,{recursive:true});
    const items=['one','two'].map((id)=>{
      const p='audio/click/'+id+'.flac', data=Buffer.from('fixture '+id);
      fs.writeFileSync(path.join(input,p),data);
      return {id,path:p,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),title:id,category:'click',kind:'design'};
    });
    const pack={edition:'test',items}, run=(apply)=>importPack(input,apply,pack);
    assert.equal(run(false).verified,2);assert.ok(!fs.existsSync(home));
    const last=path.join(input,items[1].path), safe=fs.readFileSync(last);
    fs.writeFileSync(last,'corrupt');assert.throws(()=>run(true));assert.ok(!fs.existsSync(home));
    fs.unlinkSync(last);fs.symlinkSync(path.join(input,items[0].path),last);assert.throws(()=>run(true));fs.unlinkSync(last);
    fs.writeFileSync(last,safe);
    assert.equal(run(true).imported,2); assert.equal(run(true).alreadyPresent,2);
    const manifest=fs.readFileSync(path.join(home,'.media/manifest.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
    assert.equal(manifest.length,2); assert.equal(manifest[0].type,'sfx');
    fs.writeFileSync(manifest[0].cached_path,'corrupt');assert.throws(()=>run(true));
  } finally {
    if(old===undefined)delete process.env.HYPERFRAMES_MEDIA_HOME;else process.env.HYPERFRAMES_MEDIA_HOME=old;
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
