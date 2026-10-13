import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {ROOT,readHost,hostEnvironment,doctor,preparePlan,parseOptions,installAgent,ensureCommandShims} from './host.mjs';
import {stageRelease,verifyRelease,atomicJSON,promoteRelease,restoreBindings,treeHash} from '../tools/evocut/release-manager.mjs';

function temp(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'evocut-host-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function put(p,s){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof s==='string'?s:JSON.stringify(s));}
function env(root){return {PATH:process.env.PATH,EVOCUT_HOME:path.join(root,'home')};}
function cli(root,args){return spawnSync(process.execPath,[path.join(ROOT,'scripts/cli.mjs'),...args],{env:{...process.env,EVOCUT_HOME:path.join(root,'home'),EVOCUT_PYTHON:''},encoding:'utf8'});}
function fixture(t){
 const root=temp(t),home=path.join(root,'home'),engineRoot=path.join(root,'engine'),skillsSource=path.join(root,'skills'),toolDir=path.join(root,'tools/evocut'),qaDir=path.join(root,'tools/video_qa');
 put(path.join(engineRoot,'package.json'),{name:'hyperframes',version:'0.8.81'});put(path.join(engineRoot,'dist/cli.js'),'// fixture');put(path.join(engineRoot,'dist/studio/index.html'),'<title>EvoCut</title>');
 put(path.join(skillsSource,'evocut/SKILL.md'),'# fixture');put(path.join(skillsSource,'_evocut-local/LOCAL-WORKFLOW.md'),'# sibling');
 put(path.join(toolDir,'evocut.mjs'),'// fixture');put(path.join(qaDir,'quality_gate.py'),'# fixture');
 stageRelease({engineRoot,skillsSource,toolDir,qaDir,home,id:'test'});
 const v=verifyRelease('test',{home});atomicJSON(path.join(v.dir,'validation.json'),{schema:'evocut.release-validation/v1',id:'test',ok:true,contentHash:v.manifest.contentHash,results:['engine-help','node-tests','quality-gate-tests'].map(name=>({name,exitCode:0}))});
 promoteRelease('test',{home});return {root,home};
}
test('options fail closed for unknown, duplicate and missing values',()=>{
 assert.throws(()=>parseOptions(['--oops'],['--json']),/Unknown/);
 assert.throws(()=>parseOptions(['--json','--json'],['--json']),/Duplicate/);
 assert.throws(()=>parseOptions(['--feature','--json'],['--feature','--json']),/requires/);
});
test('read-only checks never create configuration and never report secret env values',t=>{
 const root=temp(t),e={...env(root),EXAMPLE_API_KEY:'private-test-value'};
 const result=doctor({feature:'asr',root,env:e,run:()=>({ok:false,stdout:'',reason:'ENOENT'})});
 assert.equal(result.ok,false);assert.equal(fs.existsSync(e.EVOCUT_HOME),false);assert.doesNotMatch(JSON.stringify(result),/private-test-value/);
 assert.ok(result.checks.some(c=>c.id==='python'&&c.status==='missing'));
});
test('host config rejects credentials and relative path injection',t=>{
 const root=temp(t),home=env(root).EVOCUT_HOME;
 put(path.join(home,'host.json'),{schema:'evocut.host/v1',apiKey:'private-test-value'});assert.throws(()=>readHost(home),/Invalid/);
 put(path.join(home,'host.json'),{schema:'evocut.host/v1',python:'python3'});assert.throws(()=>readHost(home),/absolute/);
});
test('selected interpreter propagates to QA, legacy audio and subprocess PATH',t=>{
 const root=temp(t),home=env(root).EVOCUT_HOME,python=path.join(root,'venv/bin/python');
 put(path.join(home,'host.json'),{schema:'evocut.host/v1',python,browser:path.join(root,'chrome'),asrModel:path.join(root,'model')});
 const result=hostEnvironment({...env(root),HYPERFRAMES_PYTHON:'/old/python'},root);
 assert.equal(result.EVOCUT_PYTHON,python);assert.equal(result.HYPERFRAMES_PYTHON,python);assert.ok(result.PATH.startsWith(path.dirname(python)+path.delimiter));
 assert.equal(hostEnvironment({...env(root),EVOCUT_PYTHON:'/explicit/python'},root).EVOCUT_PYTHON,'/explicit/python');
});
test('doctor rejects Python 3.10 and malformed successful probes',t=>{
 const root=temp(t);
 for(const data of [{version:[3,10],modules:{numpy:true,scipy:true,PIL:true}},{}]){
  const r=doctor({feature:'qa',root,env:env(root),run:()=>({ok:true,stdout:JSON.stringify(data)})});assert.equal(r.ok,false);
 }
});
test('ASR model readiness matches adapter vocabulary.txt and requires regular files',t=>{
 const root=temp(t),model=path.join(root,'model');
 const e={...env(root),EVOCUT_ASR_MODEL_PATH:model};
 const run=()=>({ok:true,stdout:JSON.stringify({version:[3,12],modules:{faster_whisper:true,ctranslate2:true,numpy:true,opencc:true}})});
 for(const n of ['model.bin','config.json','tokenizer.json','vocabulary.txt'])put(path.join(model,n),'fixture');
 assert.equal(doctor({feature:'asr',root,env:e,run}).ok,true);
 fs.unlinkSync(path.join(model,'vocabulary.txt'));put(path.join(model,'vocabulary.json'),'wrong');
 assert.equal(doctor({feature:'asr',root,env:e,run}).ok,false);
});
test('feature plans are scoped, shell-free and perform no writes',t=>{
 const root=temp(t),e=env(root);
 for(const feature of ['core','render','qa','asr','beats']){
  const p=preparePlan(feature,{env:e,root});assert.equal(p.planned,true);assert.ok(p.steps.every(s=>Array.isArray(s.args)));
  if(['qa','asr','beats'].includes(feature))assert.ok(p.steps.at(-1).args.includes('--require-virtualenv'));
 }
 assert.deepEqual(fs.readdirSync(root),[]);assert.throws(()=>preparePlan('all',{env:e,root}),/Unknown/);
});
test('prepare apply requires explicit download permission before filesystem changes',t=>{
 const root=temp(t),r=cli(root,['env','prepare','--feature','asr','--apply']);assert.equal(r.status,1);assert.match(r.stderr,/allow-downloads/);assert.equal(fs.existsSync(path.join(root,'home')),false);
});
test('env init defaults to preview, persists explicit paths only on apply',t=>{
 const root=temp(t),args=['env','init','--python',process.execPath];
 assert.equal(cli(root,args).status,0);assert.equal(fs.existsSync(path.join(root,'home')),false);
 assert.equal(cli(root,[...args,'--apply']).status,0);assert.equal(readHost(path.join(root,'home')).python,process.execPath);
});
test('agent instructions does not require a selected runtime or touch skill roots',t=>{
 const root=temp(t),r=cli(root,['agent','instructions']);assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);
 assert.equal(out.launcher.args[0],path.join(ROOT,'scripts/cli.mjs'));assert.equal(fs.existsSync(path.join(root,'home')),false);
 assert.equal(out.launcher.env.EVOCUT_HOME,path.join(root,'home'));
});
test('custom Agent binding touches only requested directory and can restore',t=>{
 const {root,home}=fixture(t),dir=path.join(root,'other-agent/skills'),before=treeHash(home);
 const plan=installAgent({dir,root,home});assert.equal(plan.planned,true);assert.equal(fs.existsSync(dir),false);assert.equal(treeHash(home),before);
 const applied=installAgent({dir,root,home,apply:true});assert.equal(applied.ok,true);assert.ok(fs.lstatSync(path.join(dir,'evocut')).isSymbolicLink());assert.equal(fs.existsSync(path.join(root,'.codex')),false);
 restoreBindings(applied.receipt,{home});assert.equal(fs.existsSync(path.join(dir,'evocut')),false);
});
test('existing skills require explicit replace and are recoverable',t=>{
 const {root,home}=fixture(t),dir=path.join(root,'agent/skills');put(path.join(dir,'evocut/SKILL.md'),'user custom');
 assert.throws(()=>installAgent({dir,root,home,apply:true}),/--replace/);assert.equal(fs.readFileSync(path.join(dir,'evocut/SKILL.md'),'utf8'),'user custom');
 const r=installAgent({dir,root,home,apply:true,replace:true});restoreBindings(r.receipt,{home});assert.equal(fs.readFileSync(path.join(dir,'evocut/SKILL.md'),'utf8'),'user custom');
});
test('Agent installation refuses managed roots and symlink aliases to them',t=>{
 const {root,home}=fixture(t);
 assert.throws(()=>installAgent({dir:home,root,home}),/overlaps/);
 fs.symlinkSync(home,path.join(root,'alias'));
 assert.throws(()=>installAgent({dir:path.join(root,'alias/new'),root,home}),/overlaps/);
 assert.throws(()=>installAgent({dir:root,root,home}),/overlaps/);
});
test('tampered release cannot be installed into another Agent',t=>{
 const {root,home}=fixture(t);put(path.join(home,'current/skills/evocut/SKILL.md'),'tampered');
 assert.throws(()=>installAgent({dir:path.join(root,'agent'),root,home}),/integrity/);
});
test('managed-home alias cannot bypass protected destination check',t=>{
 const {root,home}=fixture(t),alias=path.join(root,'alias-home');fs.symlinkSync(home,alias);
 assert.throws(()=>installAgent({dir:path.join(home,'new-skills'),root,home:alias}),/overlaps/);
});
test('core doctor detects modified engine critical files',t=>{
 const {root,home}=fixture(t);put(path.join(home,'current/engine/dist/cli.js'),'changed');
 assert.equal(doctor({feature:'core',root,env:{...env(root),EVOCUT_HOME:home}}).ok,false);
});
test('local child-command shims precede globals without editing global PATH',t=>{
 const root=temp(t),home=env(root).EVOCUT_HOME;put(path.join(root,'scripts/cli.mjs'),'// fixture');
 const original=env(root),bin=ensureCommandShims({root,home}),out=hostEnvironment(original,root);
 assert.ok(out.PATH.startsWith(bin+path.delimiter));assert.equal(original.PATH,process.env.PATH);
 assert.equal(fs.realpathSync(path.join(bin,'hyperframes')),path.join(root,'scripts/cli.mjs'));
 assert.equal(ensureCommandShims({root,home}),bin);
});
test('unmanaged shim conflicts fail before any command is replaced',t=>{
 const root=temp(t),home=env(root).EVOCUT_HOME;put(path.join(root,'scripts/cli.mjs'),'// fixture');put(path.join(home,'bin/hyperframes'),'user command');
 assert.throws(()=>ensureCommandShims({root,home}),/unmanaged/);assert.equal(fs.existsSync(path.join(home,'bin/evocut')),false);
});
