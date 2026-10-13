import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {hash,loadLibrary,searchLibrary,selectAsset,setTags,importAsset,writeCatalog,catalogHtml,run} from './media-library.mjs';

function put(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));}
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'evocut-library-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const home=path.join(root,'config'),mediaHome=path.join(root,'media'),project=path.join(root,'project'),bundledDir=path.join(root,'bundled');
  fs.mkdirSync(project);const records=[];
  for(const [id,description,type] of [['whoosh','Fast sweeping transition','sfx'],['cash','Cash register checkout ka-ching','sfx'],['coin','Coin drop coins','sfx'],['happy','Upbeat cheerful joyful music','bgm']]){
    const bytes='fixture-'+id, file=path.join(mediaHome,id+'.mp3');put(file,bytes);records.push({id,type,description,sha:hash(bytes),cached_path:file,reusable:true,provenance:{provider:'fixture'}});
  }
  put(path.join(mediaHome,'manifest.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  put(path.join(bundledDir,'manifest.json'),{click:{file:'click.mp3',description:'Crisp click'}});put(path.join(bundledDir,'click.mp3'),'click');
  return {root,home,mediaHome,project,bundledDir,records};
}
test('offline Chinese synonyms find transition/register/coin/upbeat without inventing assets',t=>{
  const f=fixture(t),library=loadLibrary(f);
  for(const [query,id] of [['转场','whoosh'],['收银机','cash'],['硬币','coin'],['欢快','happy'],['whoosh','whoosh'],['cash register','cash']])assert.equal(searchLibrary(library,{query})[0].aliases[0].id,id);
  assert.equal(searchLibrary(library,{query:'不存在的音效'}).length,0);
  assert.equal(searchLibrary(library,{query:'欢快',type:'音乐'}).length,1);
  assert.equal(searchLibrary(library,{query:'欢快',type:'sfx'}).length,0);
  assert.equal(library.assets[0].license.status,'unknown');
});
test('duplicates collapse by actual SHA; stale/missing/malformed entries remain diagnostics',t=>{
  const f=fixture(t),manifest=path.join(f.mediaHome,'manifest.jsonl');
  const duplicate={...f.records[0],id:'second-name'},stale={...f.records[1],sha:'0'.repeat(64)},missing={...f.records[2],cached_path:path.join(f.mediaHome,'absent.mp3')};
  fs.appendFileSync(manifest,[duplicate,stale,missing].map(JSON.stringify).join('\n')+'\n{broken\n');
  const l=loadLibrary(f);assert.equal(l.summary.verifiedUniqueFiles,5);assert.equal(l.summary.duplicateRecords,1);assert.equal(l.issues.length,3);assert.equal(l.assets.find(x=>x.sha256===f.records[0].sha).aliases.length,2);
});
test('reject global escapes, symlink escapes, URLs and unsupported files',t=>{
  const f=fixture(t),outside=path.join(f.root,'outside.mp3');put(outside,'private');
  fs.symlinkSync(outside,path.join(f.mediaHome,'link.mp3'));put(path.join(f.mediaHome,'config.json'),'{}');
  const records=[outside,path.join(f.mediaHome,'link.mp3'),'https://invalid.example/media.mp3',path.join(f.mediaHome,'config.json')].map((cached_path,i)=>({id:'unsafe'+i,type:'sfx',cached_path}));
  fs.appendFileSync(path.join(f.mediaHome,'manifest.jsonl'),records.map(JSON.stringify).join('\n')+'\n');
  const l=loadLibrary(f);assert.equal(l.issues.length,4);assert.equal(l.assets.some(x=>x.path===outside),false);
});
test('project manifest gets scoped path verification and id ambiguity is rejected',t=>{
  const f=fixture(t);put(path.join(f.project,'assets/local.mp3'),'local');
  put(path.join(f.project,'.media/manifest.jsonl'),JSON.stringify({id:'coin',type:'sfx',path:'assets/local.mp3',description:'new coin'})+'\n'+JSON.stringify({id:'escape',type:'sfx',path:'../media/coin.mp3'})+'\n');
  const l=loadLibrary(f);assert.throws(()=>selectAsset(l,{id:'coin'}),/Ambiguous/);assert.equal(selectAsset(l,{id:'project:coin'}).sources[0].scope,'project');assert.equal(l.issues.length,1);
});
test('Chinese tags persist only in sidecar with CAS, immutable backup and ledger',t=>{
  const f=fixture(t),source=path.join(f.mediaHome,'manifest.jsonl'),before=fs.readFileSync(source),l=loadLibrary(f);
  const first=setTags(l,{id:'whoosh'},['镜头过渡','定制中文标签'],'missing');assert.equal(loadLibrary(f).revision,first.revision);
  assert.equal(searchLibrary(loadLibrary(f),{query:'定制中文标签'}).length,1);
  assert.throws(()=>setTags(loadLibrary(f),{id:'whoosh'},['changed'],'missing'),/CAS conflict/);
  const next=setTags(loadLibrary(f),{id:'whoosh'},['新标签'],first.revision);assert.ok(fs.existsSync(path.join(next.backup,'library-before.json')));
  const ledger=fs.readFileSync(next.ledger,'utf8').trim().split('\n').map(JSON.parse);assert.equal(ledger.length,4);assert.equal(ledger.at(-1).phase,'commit');assert.deepEqual(fs.readFileSync(source),before);
});
test('explicit import preserves source index, requires destination CAS, records backup and supports idempotency',t=>{
  const f=fixture(t),manifest=path.join(f.mediaHome,'manifest.jsonl'),original=fs.readFileSync(manifest),l=loadLibrary(f);
  const result=importAsset(l,{id:'coin'},{project:f.project,expect:'missing'});assert.equal(fs.readFileSync(result.path,'utf8'),'fixture-coin');assert.deepEqual(fs.readFileSync(manifest),original);assert.equal(fs.existsSync(path.join(f.project,'.media/manifest.jsonl')),false);
  const again=importAsset(loadLibrary(f),{id:'coin'},{project:f.project,expect:result.revision});assert.equal(again.alreadyPresent,true);
  put(result.path,'user-edit');assert.throws(()=>importAsset(loadLibrary(f),{id:'coin'},{project:f.project,expect:result.revision}),/CAS conflict/);assert.equal(fs.readFileSync(result.path,'utf8'),'user-edit');
  const replacement=importAsset(loadLibrary(f),{id:'coin'},{project:f.project,expect:result.revision,expectDest:hash('user-edit')});assert.equal(fs.readFileSync(path.join(replacement.backup,'asset-before.mp3'),'utf8'),'user-edit');
});
test('import cannot overwrite project files or follow assets symlink',t=>{
  const f=fixture(t),l=loadLibrary(f);for(const to of ['../evil.mp3','index.html','/tmp/escape.mp3','assets/../../escape.mp3'])assert.throws(()=>importAsset(l,{id:'coin'},{project:f.project,to,expect:'missing'}));
  fs.symlinkSync(f.mediaHome,path.join(f.project,'assets'));assert.throws(()=>importAsset(l,{id:'coin'},{project:f.project,expect:'missing'}),/Symlink/);
});
test('import rechecks source bytes after candidate inspection',t=>{
  const f=fixture(t),l=loadLibrary(f);put(f.records[0].cached_path,'changed');assert.throws(()=>importAsset(l,{id:'whoosh'},{project:f.project,expect:'missing'}),/Source changed/);
});
test('static catalog escapes markup, contains no scripts/remote requests and will not overwrite without CAS',t=>{
  const f=fixture(t),l=loadLibrary(f),asset=l.assets[0];asset.description='<script>alert("x")</script>';asset.tags=['<img onerror=x>'];
  const html=catalogHtml([asset]);assert.ok(html.includes('&lt;script&gt;'));assert.equal(html.includes('<script>'),false);assert.ok(html.includes('default-src'));assert.ok(html.includes('src="file:'));
  const output=path.join(f.root,'catalog.html'),result=writeCatalog(l,[asset],output);assert.equal(fs.existsSync(output),true);assert.throws(()=>writeCatalog(l,[asset],output),/CAS conflict/);assert.doesNotThrow(()=>writeCatalog(l,[asset],output,result.sha256));
  fs.symlinkSync(output,path.join(f.root,'link.html'));assert.throws(()=>writeCatalog(l,[asset],path.join(f.root,'link.html')),/Symlink/);
});
test('CLI API uses temp roots, JSON result and explicit selection',async t=>{
  const f=fixture(t),args=['--home',f.home,'--media-home',f.mediaHome,'--bundled-dir',f.bundledDir];
  const found=await run(['search','收银机',...args]);assert.equal(found.ok,true);assert.equal(found.assets.length,1);assert.equal(found.selectionRequired,true);
  await assert.rejects(run(['import',...args,'--project',f.project,'--expect','missing']),/exactly one/);
  await assert.rejects(run(['search',...args,'--unknown']),/Unknown/);
});
test('copyable import template preserves custom roots, project, disabled bundle and shell quoting',async t=>{
  const f=fixture(t),home=path.join(f.root,"custom config 'quoted'"),project=path.join(f.root,"custom project 'quoted'");
  fs.mkdirSync(project);
  const found=await run(['search','收银机','--home',home,'--media-home',f.mediaHome,'--bundled-dir','none','--project',project]);
  const command=found.importTemplate.replace('<SELECTED_SHA>',found.assets[0].sha256);
  // Parse the generated shell command without executing a real global launcher.
  // The stub emits its exact argument vector, then the local module imports only
  // into these temporary roots. No real config or upstream manifest is touched.
  const parsed=spawnSync('/bin/bash',['-c',`evocut() { printf '%s\\0' "$@"; }\n${command}`],{encoding:'utf8'});
  assert.equal(parsed.status,0,parsed.stderr);
  const argv=parsed.stdout.split('\0').slice(0,-1);
  const value=flag=>argv[argv.indexOf(flag)+1];
  assert.equal(value('--home'),home);assert.equal(value('--media-home'),f.mediaHome);
  assert.equal(value('--project'),project);assert.equal(value('--bundled-dir'),'none');
  assert.equal(value('--expect'),'missing');assert.equal(argv[0],'assets');
  const original=fs.readFileSync(path.join(f.mediaHome,'manifest.jsonl'));
  const imported=await run(argv.slice(1));
  assert.equal(imported.ok,true);assert.equal(fs.readFileSync(imported.path,'utf8'),'fixture-cash');
  assert.ok(fs.existsSync(path.join(home,'media/library.json')));
  assert.equal(fs.existsSync(f.home),false);
  assert.deepEqual(fs.readFileSync(path.join(f.mediaHome,'manifest.jsonl')),original);
});
test('import template preserves custom bundled root and leaves destination explicit when not supplied',async t=>{
  const f=fixture(t);
  const found=await run(['list','--home',f.home,'--media-home',f.mediaHome,'--bundled-dir',f.bundledDir]);
  assert.ok(found.importTemplate.includes(`--bundled-dir '${f.bundledDir}'`));
  assert.ok(found.importTemplate.includes('--project <DIR>'));
  assert.equal(fs.existsSync(f.home),false);
});
