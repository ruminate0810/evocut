import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {stageRelease,verifyRelease,validateRelease,promoteRelease,readCurrent,stableEngine,bindSkills,restoreBindings,atomicJSON,releaseModule,treeHash} from './release-manager.mjs';
import {resolveEngine} from './evocut.mjs';

function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'evocut-release-test-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function put(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));}
function sources(root){
  const engineRoot=path.join(root,'source-engine'),skillsSource=path.join(root,'skills'),toolDir=path.join(root,'tools/evocut'),qaDir=path.join(root,'tools/video_qa');
  put(path.join(engineRoot,'package.json'),{name:'hyperframes',version:'0.8.81',bin:{hyperframes:'bin/hyperframes.mjs'}});
  put(path.join(engineRoot,'bin/hyperframes.mjs'),'console.log("0.8.81")');put(path.join(engineRoot,'dist/cli.js'),'const version="0.8.81";');
  put(path.join(engineRoot,'dist/studio/index.html'),'<title>EvoCut Studio</title>');
  put(path.join(skillsSource,'evocut/SKILL.md'),'---\nname: evocut\ndescription: test\n---\n# Test');
  put(path.join(toolDir,'media-library.mjs'),'export async function main(){return 0;}');put(path.join(qaDir,'quality_gate.py'),'print("test")');
  return {engineRoot,skillsSource,toolDir,qaDir,home:path.join(root,'home')};
}
function stage(s,id='v1'){return stageRelease({...s,id});}
function evidence(s,id){const v=verifyRelease(id,{home:s.home});atomicJSON(path.join(v.dir,'validation.json'),{schema:'evocut.release-validation/v1',id,ok:true,contentHash:v.manifest.contentHash,results:['engine-help','node-tests','quality-gate-tests'].map(name=>({name,exitCode:0}))});}
test('candidate is an independent byte-preserving engine/skill snapshot',t=>{
  const root=fixture(t),s=sources(root);stage(s);assert.equal(readCurrent(s.home),null);
  put(path.join(s.engineRoot,'dist/cli.js'),'updated by npm');
  assert.equal(verifyRelease('v1',{home:s.home}).ok,true);assert.equal(fs.readFileSync(path.join(s.home,'releases/v1/engine/dist/cli.js'),'utf8'),'const version="0.8.81";');
});
test('immutable ids, malformed ids and unbranded candidates are refused',t=>{
  const s=sources(fixture(t));stage(s);assert.throws(()=>stage(s),/already exists/);assert.throws(()=>stage(s,'../bad'),/Invalid/);
  put(path.join(s.engineRoot,'dist/studio/index.html'),'<title>HyperFrames</title>');assert.throws(()=>stage(s,'v2'),/not branded/);
});
test('promotion requires bound validation and intact bytes',t=>{
  const s=sources(fixture(t));stage(s);assert.throws(()=>promoteRelease('v1',{home:s.home}));evidence(s,'v1');
  put(path.join(s.home,'releases/v1/skills/evocut/SKILL.md'),'tampered');assert.equal(verifyRelease('v1',{home:s.home}).ok,false);assert.throws(()=>promoteRelease('v1',{home:s.home}),/integrity/);
});
test('stable pointer switches atomically and can return to an earlier verified release',t=>{
  const s=sources(fixture(t));for(const id of ['v1','v2']){stage(s,id);evidence(s,id);}
  promoteRelease('v1',{home:s.home});assert.equal(readCurrent(s.home).manifest.id,'v1');
  promoteRelease('v2',{home:s.home});assert.equal(readCurrent(s.home).manifest.id,'v2');
  promoteRelease('v1',{home:s.home});assert.equal(stableEngine(s.home).version,'0.8.81');
});
test('managed home path aliases are canonicalized without allowing current to escape',t=>{
  const root=fixture(t),s=sources(root);stage(s);evidence(s,'v1');promoteRelease('v1',{home:s.home});
  const alias=path.join(root,'home-alias');fs.symlinkSync(s.home,alias);
  assert.equal(readCurrent(alias).manifest.id,'v1');
  fs.unlinkSync(path.join(s.home,'current'));fs.symlinkSync(s.engineRoot,path.join(s.home,'current'));
  assert.throws(()=>readCurrent(alias),/outside managed releases/);
});
test('critical stable engine tampering fails closed',t=>{
  const s=sources(fixture(t));stage(s);evidence(s,'v1');promoteRelease('v1',{home:s.home});
  put(path.join(s.home,'releases/v1/engine/dist/cli.js'),'changed');assert.throws(()=>stableEngine(s.home),/modified/);
});
test('staging refuses dependencies that escape the candidate tree',t=>{const s=sources(fixture(t));put(path.join(s.home,'outside'),'external');fs.symlinkSync(path.join(s.home,'outside'),path.join(s.engineRoot,'external'));assert.throws(()=>stage(s),/escapes source/);});
test('empty or partial validation cannot publish a release',t=>{const s=sources(fixture(t));stage(s);evidence(s,'v1');const file=path.join(s.home,'releases/v1/validation.json'),proof=JSON.parse(fs.readFileSync(file));proof.results=[];atomicJSON(file,proof);assert.throws(()=>promoteRelease('v1',{home:s.home}),/validation/);});
test('default uses managed engine but old project retains exact installed pin',t=>{
  const root=fixture(t),s=sources(root);stage(s);evidence(s,'v1');promoteRelease('v1',{home:s.home});
  const userHome=path.join(root,'user'),project=path.join(root,'project');fs.mkdirSync(project,{recursive:true});
  let r=resolveEngine({cwd:project,home:userHome,managedHome:s.home});assert.equal(r.source,'managed-stable');assert.equal(r.root,path.join(s.home,'releases/v1/engine'));
  put(path.join(project,'package.json'),{scripts:{render:'hyperframes@0.8.41 render'}});
  const old=path.join(userHome,'npm-cache/_npx/old/node_modules/hyperframes');put(path.join(old,'package.json'),{name:'hyperframes',version:'0.8.41'});put(path.join(old,'dist/cli.js'),'');
  r=resolveEngine({cwd:project,home:userHome,managedHome:s.home});assert.equal(r.version,'0.8.41');assert.equal(r.source,'project-pin');
  put(path.join(s.home,'releases/v1/engine/dist/cli.js'),'damaged stable');r=resolveEngine({cwd:project,home:userHome,managedHome:s.home});assert.equal(r.version,'0.8.41');
});
test('skill binding is dry by default; actual migration preserves full original trees',t=>{
  const root=fixture(t),s=sources(root);stage(s);evidence(s,'v1');promoteRelease('v1',{home:s.home});
  const skillRoot=path.join(root,'installed');put(path.join(skillRoot,'evocut/SKILL.md'),'user custom');put(path.join(skillRoot,'evocut/custom.txt'),'keep me');
  const before=treeHash(path.join(skillRoot,'evocut'));const preview=bindSkills({roots:[skillRoot],home:s.home});assert.equal(preview.planned,true);assert.equal(treeHash(path.join(skillRoot,'evocut')),before);
  const installed=bindSkills({roots:[skillRoot],home:s.home,apply:true});assert.equal(fs.lstatSync(path.join(skillRoot,'evocut')).isSymbolicLink(),true);
  assert.equal(fs.realpathSync(path.join(skillRoot,'hyperframes')),fs.realpathSync(path.join(skillRoot,'evocut')));
  restoreBindings(installed.receipt,{home:s.home});assert.equal(treeHash(path.join(skillRoot,'evocut')),before);assert.equal(fs.existsSync(path.join(skillRoot,'hyperframes')),false);
});
test('restore refuses a skill path edited after migration',t=>{
  const root=fixture(t),s=sources(root);stage(s);evidence(s,'v1');promoteRelease('v1',{home:s.home});const skillRoot=path.join(root,'installed');
  const installed=bindSkills({roots:[skillRoot],home:s.home,apply:true});fs.unlinkSync(path.join(skillRoot,'evocut'));put(path.join(skillRoot,'evocut/SKILL.md'),'new edits');
  assert.throws(()=>restoreBindings(installed.receipt,{home:s.home}),/Binding changed/);assert.equal(fs.readFileSync(path.join(skillRoot,'evocut/SKILL.md'),'utf8'),'new edits');
});
test('missing restore backup does not remove the live binding',t=>{const root=fixture(t),s=sources(root);stage(s);evidence(s,'v1');promoteRelease('v1',{home:s.home});const skillRoot=path.join(root,'installed');put(path.join(skillRoot,'evocut/SKILL.md'),'old');const installed=bindSkills({roots:[skillRoot],home:s.home,apply:true});const receipt=JSON.parse(fs.readFileSync(installed.receipt));fs.rmSync(receipt.changes.find(c=>c.backup).backup,{recursive:true});assert.throws(()=>restoreBindings(installed.receipt,{home:s.home}),/Backup missing/);assert.equal(fs.lstatSync(path.join(skillRoot,'evocut')).isSymbolicLink(),true);});
test('release-module loading validates selected tool bytes and blocks path traversal',t=>{
  const s=sources(fixture(t));stage(s);evidence(s,'v1');promoteRelease('v1',{home:s.home});
  assert.ok(releaseModule('media-library.mjs',{home:s.home}).endsWith('/tools/evocut/media-library.mjs'));
  assert.throws(()=>releaseModule('../../../../escape',{home:s.home}),/escapes/);
  put(path.join(s.home,'releases/v1/tools/evocut/media-library.mjs'),'bad');assert.throws(()=>releaseModule('media-library.mjs',{home:s.home}),/changed/);
});
test('release mutation lock prevents concurrent publication',t=>{
  const s=sources(fixture(t));fs.mkdirSync(s.home,{recursive:true});put(path.join(s.home,'release.lock'),'other');assert.throws(()=>stage(s),/Another release operation/);
});
for(const source of ['toolDir','qaDir'])test(`${source} changes during copy reject staging and leave no candidate`,t=>{
  const s=sources(fixture(t)),file=path.join(s[source],source==='toolDir'?'media-library.mjs':'quality_gate.py');
  const copy=fs.copyFileSync;let edited=false;
  t.mock.method(fs,'copyFileSync',(from,to,...rest)=>{copy(from,to,...rest);if(from===file&&!edited){edited=true;put(file,'changed after copy');}});
  assert.throws(()=>stage(s),/Tool source changed during staging/);
  assert.equal(fs.existsSync(path.join(s.home,'releases/v1')),false);
  assert.deepEqual(fs.readdirSync(path.join(s.home,'releases')),[]);
});
test('new tool files and vendor mutations during staging cannot produce a mixed snapshot',t=>{
  const s=sources(fixture(t));put(path.join(s.toolDir,'vendor/parser.js'),'original parser');
  const copy=fs.copyFileSync;let edited=false;
  t.mock.method(fs,'copyFileSync',(from,to,...rest)=>{copy(from,to,...rest);if(from===path.join(s.toolDir,'media-library.mjs')&&!edited){edited=true;put(path.join(s.toolDir,'new.mjs'),'new dependency');put(path.join(s.toolDir,'vendor/parser.js'),'new parser');}});
  assert.throws(()=>stage(s),/Tool source changed during staging/);
});
test('tool copy bytes are checked independently of unchanged source hashes',t=>{
  const s=sources(fixture(t)),copy=fs.copyFileSync;
  t.mock.method(fs,'copyFileSync',(from,to,...rest)=>{copy(from,to,...rest);if(from===path.join(s.qaDir,'quality_gate.py'))put(to,'damaged copy');});
  assert.throws(()=>stage(s),/Tool snapshot copy did not preserve source/);
});
test('staging refuses top-level tool symlinks and external vendor dependencies',t=>{
  const root=fixture(t),s=sources(root),outside=path.join(root,'outside.mjs');put(outside,'outside');
  fs.symlinkSync(outside,path.join(s.toolDir,'linked.mjs'));
  assert.throws(()=>stage(s),/regular file/);fs.unlinkSync(path.join(s.toolDir,'linked.mjs'));
  fs.mkdirSync(path.join(s.toolDir,'vendor'));fs.symlinkSync(outside,path.join(s.toolDir,'vendor/parser.js'));
  assert.throws(()=>stage(s),/escapes source/);
});
test('full verification detects unrecorded files but ignores root metadata and known caches',t=>{
  const s=sources(fixture(t));stage(s);const dir=path.join(s.home,'releases/v1');
  put(path.join(dir,'validation.json'),{note:'root validation metadata'});
  put(path.join(dir,'engine/__pycache__/module.pyc'),'ignored cache');put(path.join(dir,'.DS_Store'),'ignored cache');
  assert.equal(verifyRelease('v1',{home:s.home}).ok,true);
  put(path.join(dir,'tools/evocut/validation.json'),{injected:true});
  let v=verifyRelease('v1',{home:s.home});assert.equal(v.ok,false);
  assert.ok(v.issues.some(i=>i.path==='tools/evocut/validation.json'&&i.reason==='unrecorded_file'));
  fs.unlinkSync(path.join(dir,'tools/evocut/validation.json'));put(path.join(dir,'injected.mjs'),'new code');
  v=verifyRelease('v1',{home:s.home});assert.ok(v.issues.some(i=>i.path==='injected.mjs'&&i.reason==='unrecorded_file'));
});
test('full verification detects file permissions and external same-byte symlinks',t=>{
  const root=fixture(t),s=sources(root);stage(s);const file=path.join(s.home,'releases/v1/tools/evocut/media-library.mjs');
  const mode=fs.statSync(file).mode&0o777;fs.chmodSync(file,mode^0o100);
  assert.equal(verifyRelease('v1',{home:s.home}).ok,false);fs.chmodSync(file,mode);
  const outside=path.join(root,'same.mjs');fs.copyFileSync(file,outside);fs.unlinkSync(file);fs.symlinkSync(outside,file);
  const v=verifyRelease('v1',{home:s.home});assert.equal(v.ok,false);assert.ok(v.issues.some(i=>i.reason==='external_link'));
});
test('root validation metadata exemption does not permit external symlinks',t=>{
  const root=fixture(t),s=sources(root);stage(s);const outside=path.join(root,'outside-validation.json');put(outside,{});
  fs.symlinkSync(outside,path.join(s.home,'releases/v1/validation.json'));
  const v=verifyRelease('v1',{home:s.home});assert.equal(v.ok,false);assert.ok(v.issues.some(i=>i.reason==='external_link'));
});
test('releaseModule verifies sibling, vendor and finance dependencies, not only the entry',t=>{
  const s=sources(fixture(t));put(path.join(s.toolDir,'helper.mjs'),'helper');put(path.join(s.toolDir,'vendor/parser.js'),'parser');
  stage(s);evidence(s,'v1');promoteRelease('v1',{home:s.home});const dir=path.join(s.home,'releases/v1');
  for(const dependency of ['tools/evocut/helper.mjs','tools/evocut/vendor/parser.js','tools/video_qa/quality_gate.py']) {
    const file=path.join(dir,dependency),before=fs.readFileSync(file);put(file,'changed dependency');
    assert.throws(()=>releaseModule('media-library.mjs',{home:s.home}),/dependency snapshot.*changed/);fs.writeFileSync(file,before);
  }
  assert.ok(releaseModule('../video_qa/quality_gate.py',{home:s.home}).endsWith('/quality_gate.py'));
  put(path.join(dir,'tools/video_qa/unrecorded.py'),'injected import');
  assert.throws(()=>releaseModule('media-library.mjs',{home:s.home}),/unrecorded_file/);
});
test('releaseModule rejects same-byte external links and paths outside tool directories',t=>{
  const root=fixture(t),s=sources(root);stage(s);evidence(s,'v1');promoteRelease('v1',{home:s.home});
  assert.throws(()=>releaseModule('../../engine/dist/cli.js',{home:s.home}),/escapes managed tool/);
  const file=path.join(s.home,'releases/v1/tools/video_qa/quality_gate.py'),outside=path.join(root,'same.py');
  fs.copyFileSync(file,outside);fs.unlinkSync(file);fs.symlinkSync(outside,file);
  assert.throws(()=>releaseModule('media-library.mjs',{home:s.home}),/external_link/);
});
test('render-receipt test is mandatory and actually runs in isolated validation',t=>{
  const s=sources(fixture(t));
  for(const name of ['evocut','release-manager','media-library','voice-profile','semantic-edit'])put(path.join(s.toolDir,`${name}.test.mjs`),`import test from 'node:test'; test('${name} fixture',()=>{});`);
  stage(s);assert.throws(()=>validateRelease('v1',{home:s.home}),/Required release test missing: render-receipt.test.mjs/);
  put(path.join(s.toolDir,'render-receipt.test.mjs'),"import test from 'node:test'; test('render-receipt required fixture executed',()=>{});");
  put(path.join(s.qaDir,'test_quality_gate.py'),'import unittest\nclass Fixture(unittest.TestCase):\n def test_ok(self): self.assertTrue(True)\n');
  stage(s,'v2');const result=validateRelease('v2',{home:s.home});
  assert.equal(result.ok,true,JSON.stringify(result));assert.match(result.results.find(r=>r.name==='node-tests').output,/render-receipt required fixture executed/);
  assert.equal(readCurrent(s.home),null);assert.equal(verifyRelease('v2',{home:s.home}).ok,true);
});
