import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('fresh isolated checkout exposes local CLI without active machine release',t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'evocut-public-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const env={...process.env,EVOCUT_HOME:home};
 const r=spawnSync(process.execPath,['scripts/cli.mjs','about'],{cwd:root,env,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/EvoCut/);assert.match(r.stdout,/HyperFrames/);
 const v=spawnSync(process.execPath,['scripts/cli.mjs','voice','list'],{cwd:root,env,encoding:'utf8'});
 assert.equal(v.status,0,v.stderr);assert.doesNotMatch(v.stdout,/Warm_Bestie/);
});
test('core QA help does not import business publishing or require installed model',()=>{
 const r=spawnSync(process.env.EVOCUT_PYTHON||'python3',['tools/video_qa/quality_gate.py','--help'],{cwd:root,encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/--video/);
});
