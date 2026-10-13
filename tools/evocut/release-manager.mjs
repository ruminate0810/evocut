#!/usr/bin/env node
/** Local, offline EvoCut releases. Never installs packages or rewrites project pins. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE = path.resolve(TOOL_DIR, '../..');
export const SKILL_NAMES = ['evocut','evocut-animation','evocut-audio','evocut-cli','evocut-core','evocut-creative','evocut-keyframes','evocut-media','evocut-registry','evocut-studio','media-use','embedded-captions','faceless-explainer','figma','general-video','motion-graphics','music-to-video','pr-to-video','product-launch-video','remotion-to-evocut','slideshow','talking-head-recut','motion-doctrine','seam-craft','captions-overlay','cut-the-curve','oversized-cursor','website-to-video','changelog-video'];
const ALIASES = Object.fromEntries(SKILL_NAMES.filter(n=>n==='evocut'||n.startsWith('evocut-')||n==='remotion-to-evocut').map(n=>[n.replace('evocut','hyperframes'),n]));
const SKIP = new Set(['.git','__pycache__','.DS_Store']);
const RELEASE_METADATA = new Set(['release.json','validation.json']);
const NODE_RELEASE_TESTS = ['evocut.test.mjs','release-manager.test.mjs','media-library.test.mjs','voice-profile.test.mjs','semantic-edit.test.mjs','render-receipt.test.mjs'];
export const sha = data => crypto.createHash('sha256').update(data).digest('hex');
export const configHome = (home=os.homedir(), env=process.env) => path.resolve(env.EVOCUT_HOME || path.join(home,'.config/evocut'));
const readJSON = p => JSON.parse(fs.readFileSync(p,'utf8'));
const exists = p => {try{fs.lstatSync(p);return true;}catch{return false;}};
const validId = id => {if(!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(id)||id.includes('..'))throw new Error('Invalid release id');return id;};
export function atomicJSON(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.renameSync(temp,file);
}
export function treeRecords(root, prefix='') {
  const records=[];
  for(const e of fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    if(SKIP.has(e.name))continue;
    const rel=prefix?`${prefix}/${e.name}`:e.name,file=path.join(root,e.name);
    if(e.isSymbolicLink())records.push({path:rel,link:fs.readlinkSync(file)});
    else if(e.isDirectory())records.push(...treeRecords(file,rel));
    else if(e.isFile())records.push({path:rel,sha256:sha(fs.readFileSync(file)),mode:fs.statSync(file).mode&0o777});
  }
  return records;
}
export const treeHash = dir => sha(JSON.stringify(treeRecords(dir)));
export function assertClosedTree(root) {
  const canonical=fs.realpathSync(root);
  for(const r of treeRecords(root))if(r.link!==undefined) {
    let target;try{target=fs.realpathSync(path.join(root,r.path));}catch{throw new Error(`Broken snapshot link: ${r.path}`);}
    if(target!==canonical&&!target.startsWith(canonical+path.sep))throw new Error(`Snapshot link escapes source: ${r.path}`);
  }
}
function safePath(root,rel) {
  const p=path.resolve(root,rel);
  if(p===root||!p.startsWith(path.resolve(root)+path.sep))throw new Error('Path escapes managed release');
  return p;
}
export function readCurrent(home=configHome()) {
  const current=path.join(home,'current');
  if(!exists(current))return null;
  if(!fs.lstatSync(current).isSymbolicLink())throw new Error('EvoCut current must be a managed symlink');
  const dir=fs.realpathSync(current),releases=path.join(fs.realpathSync(home),'releases');
  if(!dir.startsWith(releases+path.sep))throw new Error('EvoCut current points outside managed releases');
  const manifest=readJSON(path.join(dir,'release.json'));
  if(manifest.schema!=='evocut.release/v1')throw new Error('Unsupported EvoCut release manifest');
  return {dir,manifest};
}
function withLock(home,fn) {
  fs.mkdirSync(home,{recursive:true});const lock=path.join(home,'release.lock');
  let fd;try{fd=fs.openSync(lock,'wx',0o600);}catch{throw new Error(`Another release operation holds ${lock}; do not remove it while that process is running`);}
  try{fs.writeSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));return fn();}
  finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function treeCopy(source,dest) {
  fs.cpSync(source,dest,{recursive:true,dereference:false,verbatimSymlinks:true,filter:p=>!SKIP.has(path.basename(p))});
}
function toolRecords(root, extensions, vendor=false) {
  const records=[];
  for(const e of fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const file=path.join(root,e.name);
    if(vendor&&e.name==='vendor') {
      if(!e.isDirectory())throw new Error('Tool vendor must be a real directory');
      assertClosedTree(file);records.push(...treeRecords(file,'vendor'));
    } else if(extensions.test(e.name)) {
      if(!e.isFile())throw new Error(`Tool source must be a regular file: ${e.name}`);
      records.push({path:e.name,sha256:sha(fs.readFileSync(file)),mode:fs.statSync(file).mode&0o777});
    }
  }
  return records;
}
function copyToolRecords(source,dest,records,vendor=false) {
  fs.mkdirSync(dest,{recursive:true});
  for(const record of records)if(!record.path.includes('/'))fs.copyFileSync(path.join(source,record.path),path.join(dest,record.path));
  if(vendor&&fs.existsSync(path.join(source,'vendor')))treeCopy(path.join(source,'vendor'),path.join(dest,'vendor'));
}
function validateSnapshotManifest(manifest,id) {
  if(manifest.id!==id||manifest.schema!=='evocut.release/v1'||!Array.isArray(manifest.files)||manifest.contentHash!==sha(JSON.stringify(manifest.files)))throw new Error('Invalid release manifest');
  const paths=new Set();
  for(const r of manifest.files) {
    if(!r||typeof r.path!=='string'||r.path!==path.posix.normalize(r.path)||r.path.startsWith('/')||r.path==='..'||r.path.startsWith('../')||RELEASE_METADATA.has(r.path)||paths.has(r.path))throw new Error('Invalid or duplicate snapshot path');
    if(r.link!==undefined?typeof r.link!=='string':(!/^[a-f0-9]{64}$/.test(r.sha256)||!Number.isInteger(r.mode)))throw new Error('Invalid snapshot file record');
    paths.add(r.path);
  }
}
function compareSnapshotRecords(expected,actual,root,closureRoot=root) {
  const issues=[],expectedByPath=new Map(expected.map(r=>[r.path,r])),actualByPath=new Map(actual.map(r=>[r.path,r]));
  const canonical=fs.realpathSync(closureRoot);
  for(const r of actual) {
    const wanted=expectedByPath.get(r.path);
    if(!wanted)issues.push({path:r.path,reason:'unrecorded_file'});
    else if(JSON.stringify(r)!==JSON.stringify(wanted))issues.push({path:r.path,reason:r.link!==undefined||wanted.link!==undefined?'link_changed':'content_or_mode_changed'});
    if(r.link!==undefined) {
      try{const target=fs.realpathSync(path.join(root,r.path));if(target!==canonical&&!target.startsWith(canonical+path.sep))issues.push({path:r.path,reason:'external_link'});}
      catch{issues.push({path:r.path,reason:'broken_link'});}
    }
  }
  for(const r of expected)if(!actualByPath.has(r.path))issues.push({path:r.path,reason:'missing_or_unreadable'});
  return issues;
}
export function stageRelease({engineRoot,skillsSource,id,home=configHome(),toolDir=TOOL_DIR,qaDir=path.resolve(TOOL_DIR,'../video_qa')}) {
  validId(id);engineRoot=fs.realpathSync(engineRoot);skillsSource=fs.realpathSync(skillsSource);toolDir=fs.realpathSync(toolDir);qaDir=fs.realpathSync(qaDir);
  const pkg=readJSON(path.join(engineRoot,'package.json'));
  if(pkg.name!=='hyperframes'||!/^\d+\.\d+\.\d+/.test(pkg.version))throw new Error('Expected an installed HyperFrames engine');
  const studio=fs.readFileSync(path.join(engineRoot,'dist/studio/index.html'),'utf8');
  if(!studio.includes('EvoCut'))throw new Error('Candidate engine is not branded; apply the guarded brand patch to the candidate before staging');
  assertClosedTree(engineRoot);assertClosedTree(skillsSource);
  return withLock(home,()=>{
    const dest=path.join(home,'releases',id);
    if(exists(dest))throw new Error('Release id already exists; releases are immutable');
    const staging=path.join(home,'releases',`.staging-${id}-${process.pid}`);
    fs.mkdirSync(staging,{recursive:true});
    try {
      const before=treeHash(engineRoot),skillsBefore=treeHash(skillsSource);
      const toolsBefore=toolRecords(toolDir,/\.(mjs|json|md|txt)$/,true),qaBefore=toolRecords(qaDir,/\.(py|md|json)$/);
      treeCopy(engineRoot,path.join(staging,'engine'));treeCopy(skillsSource,path.join(staging,'skills'));
      copyToolRecords(toolDir,path.join(staging,'tools/evocut'),toolsBefore,true);
      copyToolRecords(qaDir,path.join(staging,'tools/video_qa'),qaBefore);
      if(before!==treeHash(engineRoot)||skillsBefore!==treeHash(skillsSource))throw new Error('Source changed during staging; candidate not published');
      if(JSON.stringify(toolsBefore)!==JSON.stringify(toolRecords(toolDir,/\.(mjs|json|md|txt)$/,true))||JSON.stringify(qaBefore)!==JSON.stringify(toolRecords(qaDir,/\.(py|md|json)$/)))throw new Error('Tool source changed during staging; candidate not published');
      if(before!==treeHash(path.join(staging,'engine'))||skillsBefore!==treeHash(path.join(staging,'skills')))throw new Error('Snapshot copy did not preserve source');
      if(JSON.stringify(toolsBefore)!==JSON.stringify(treeRecords(path.join(staging,'tools/evocut')))||JSON.stringify(qaBefore)!==JSON.stringify(treeRecords(path.join(staging,'tools/video_qa'))))throw new Error('Tool snapshot copy did not preserve source');
      assertClosedTree(staging);
      const files=treeRecords(staging);
      const manifest={schema:'evocut.release/v1',id,engineVersion:pkg.version,createdAt:new Date().toISOString(),source:{engineRoot,skillsSource,toolDir,qaDir},files,contentHash:sha(JSON.stringify(files)),limits:['No project pin is upgraded','Automated validation is not a subjective video-quality review']};
      atomicJSON(path.join(staging,'release.json'),manifest);fs.renameSync(staging,dest);
      return {ok:true,state:'candidate',id,engineVersion:pkg.version,dir:dest,contentHash:manifest.contentHash};
    } catch(error) {fs.rmSync(staging,{recursive:true,force:true});throw error;}
  });
}
export function verifyRelease(id,{home=configHome(),quick=false}={}) {
  validId(id);const dir=path.join(home,'releases',id),manifest=readJSON(path.join(dir,'release.json')),issues=[];
  validateSnapshotManifest(manifest,id);
  if(!quick) {
    try{issues.push(...compareSnapshotRecords(manifest.files,treeRecords(dir).filter(r=>!RELEASE_METADATA.has(r.path)||r.link!==undefined),dir));}
    catch(error){issues.push({path:'.',reason:'unreadable_snapshot',message:error.message});}
    return {ok:issues.length===0,id,dir,manifest,issues,scope:'complete-snapshot'};
  }
  const critical=new Set(['engine/package.json','engine/bin/hyperframes.mjs','engine/dist/cli.js','engine/dist/studio/index.html']);
  for(const record of manifest.files) {
    if(quick&&!critical.has(record.path))continue;
    const file=safePath(dir,record.path);
    try{const canonical=fs.realpathSync(file);if(!canonical.startsWith(fs.realpathSync(dir)+path.sep))throw new Error('External path');if(record.link!==undefined){if(!fs.lstatSync(file).isSymbolicLink()||fs.readlinkSync(file)!==record.link)issues.push({path:record.path,reason:'link_changed'});}else if(fs.lstatSync(file).isSymbolicLink()||sha(fs.readFileSync(file))!==record.sha256)issues.push({path:record.path,reason:'content_changed'});}
    catch{issues.push({path:record.path,reason:'missing_or_unreadable'});}
  }
  return {ok:issues.length===0,id,dir,manifest,issues,scope:quick?'critical-files':'all-recorded-files'};
}
export function stableEngine(home=configHome()) {
  const current=readCurrent(home);if(!current)return null;
  const verified=verifyRelease(current.manifest.id,{home,quick:true});
  if(!verified.ok)throw new Error(`EvoCut stable release was modified: ${JSON.stringify(verified.issues)}. Restore or promote a verified candidate.`);
  return {version:current.manifest.engineVersion,root:path.join(current.dir,'engine'),releaseId:current.manifest.id};
}
export function releaseModule(relative,{home=configHome(),fallback=TOOL_DIR}={}) {
  const current=readCurrent(home);if(!current)return path.resolve(fallback,relative);
  validateSnapshotManifest(current.manifest,current.manifest.id);
  const rel=`tools/evocut/${relative}`;
  const normalized=path.posix.normalize(rel);
  if(!normalized.startsWith('tools/evocut/')&&!normalized.startsWith('tools/video_qa/'))throw new Error('Module path escapes managed tool directories');
  const toolsRoot=path.join(current.dir,'tools');
  if(!fs.lstatSync(toolsRoot).isDirectory()||fs.realpathSync(toolsRoot)!==path.join(fs.realpathSync(current.dir),'tools'))throw new Error('Stable tool directory must not be a symlink');
  const issues=compareSnapshotRecords(current.manifest.files.filter(r=>r.path.startsWith('tools/')),treeRecords(toolsRoot,'tools'),current.dir,toolsRoot);
  if(issues.length)throw new Error(`Stable tool dependency snapshot missing or changed: ${JSON.stringify(issues)}`);
  const record=current.manifest.files.find(f=>f.path===normalized),file=safePath(current.dir,normalized);
  if(!record||!record.sha256)throw new Error(`Stable module missing or changed: ${relative}`);
  return file;
}
export function validateRelease(id,{home=configHome()}={}) {
  return withLock(home,()=>{
    const before=verifyRelease(id,{home});if(!before.ok)throw new Error(`Candidate integrity failed: ${JSON.stringify(before.issues)}`);
    const dir=before.dir,env={...process.env,HYPERFRAMES_NO_UPDATE_CHECK:'1',HYPERFRAMES_NO_AUTO_INSTALL:'1',HYPERFRAMES_NO_TELEMETRY:'1',HYPERFRAMES_SKIP_SKILLS:'1',DO_NOT_TRACK:'1',PYTHONDONTWRITEBYTECODE:'1'};
    // An inherited node:test worker marker makes nested --test silently skip its
    // files with exit 0. Validation must launch an independent test runner.
    delete env.NODE_TEST_CONTEXT;
    // Unit/integration tests own temporary fixtures; never test against a user's video.
    const nodeTests=NODE_RELEASE_TESTS.map(f=>path.join(dir,'tools/evocut',f));
    for(const file of nodeTests)if(!fs.existsSync(file))throw new Error(`Required release test missing: ${path.basename(file)}`);
    const tasks=[
      {name:'engine-help',bin:process.execPath,args:[path.join(dir,'engine/bin/hyperframes.mjs'),'--help'],cwd:dir},
      {name:'node-tests',bin:process.execPath,args:['--test',...nodeTests],cwd:path.join(dir,'tools/evocut')},
      {name:'quality-gate-tests',bin:process.env.EVOCUT_PYTHON||'python3',args:['-m','unittest','test_quality_gate'],cwd:path.join(dir,'tools/video_qa')}
    ];
    const results=tasks.map(t=>{const r=spawnSync(t.bin,t.args,{cwd:t.cwd,env,encoding:'utf8',timeout:240000,maxBuffer:12*1024*1024});return {name:t.name,exitCode:r.status,error:r.error?.message??null,output:(r.stdout??'')+(r.stderr??'')};});
    const after=verifyRelease(id,{home});
    const report={schema:'evocut.release-validation/v1',id,contentHash:before.manifest.contentHash,checkedAt:new Date().toISOString(),ok:results.every(r=>r.exitCode===0)&&after.ok,results,integrity:after.issues};
    atomicJSON(path.join(dir,'validation.json'),report);return report;
  });
}
function setPointer(home,id) {
  const link=path.join(home,'current'),temp=path.join(home,`.current-${process.pid}`);
  if(exists(link)&&!fs.lstatSync(link).isSymbolicLink())throw new Error('Refusing to overwrite non-symlink current');
  fs.symlinkSync(path.join('releases',id),temp);fs.renameSync(temp,link);
}
export function promoteRelease(id,{home=configHome()}={}) {
  return withLock(home,()=>{
    const verified=verifyRelease(id,{home});if(!verified.ok)throw new Error('Candidate integrity failed');
    const proof=readJSON(path.join(verified.dir,'validation.json'));
    const required=['engine-help','node-tests','quality-gate-tests'];
    if(proof.schema!=='evocut.release-validation/v1'||proof.id!==id||proof.ok!==true||proof.contentHash!==verified.manifest.contentHash||!Array.isArray(proof.results)||required.some(name=>!proof.results.some(r=>r.name===name&&r.exitCode===0))||proof.results.some(r=>r.exitCode!==0))throw new Error('Candidate needs matching successful validation');
    const previous=readCurrent(home)?.manifest.id??null;
    setPointer(home,id);const receipt={at:new Date().toISOString(),from:previous,to:id,contentHash:verified.manifest.contentHash};
    fs.appendFileSync(path.join(home,'release-history.jsonl'),JSON.stringify(receipt)+'\n',{mode:0o600});
    return {ok:true,state:'stable',...receipt};
  });
}
export function bindSkills({roots,home=configHome(),apply=false}={}) {
  const current=readCurrent(home);if(!current)throw new Error('Promote a release before binding skill entry points');
  const names=SKILL_NAMES.filter(n=>fs.existsSync(path.join(current.dir,'skills',n,'SKILL.md')));
  const bindings=[...names.map(n=>[n,n]),...Object.entries(ALIASES).filter(([,n])=>names.includes(n))];
  if(fs.existsSync(path.join(current.dir,'skills/_evocut-local/LOCAL-WORKFLOW.md')))bindings.push(['_evocut-local','_evocut-local']);
  const changes=[];
  for(const root of roots)for(const [name,canonical] of bindings) {
    const target=path.join(home,'current/skills',canonical),dest=path.join(root,name);
    if(exists(dest)&&fs.lstatSync(dest).isSymbolicLink()&&path.resolve(path.dirname(dest),fs.readlinkSync(dest))===target)continue;
    const before=exists(dest)?(fs.lstatSync(dest).isSymbolicLink()?{link:fs.readlinkSync(dest)}:{treeHash:treeHash(dest)}):null;
    changes.push({dest,target,before});
  }
  if(!apply)return {ok:true,planned:true,changes};
  return withLock(home,()=>{
    const migrationId=`skills-${Date.now()}-${process.pid}`,backupRoot=path.join(home,'backups',migrationId),done=[];
    fs.mkdirSync(backupRoot,{recursive:true});
    const report={schema:'evocut.skill-bindings/v1',releaseId:current.manifest.id,changes:done};
    atomicJSON(path.join(backupRoot,'receipt.json'),report);
    try {
      for(const [i,c] of changes.entries()) {
        const observed=exists(c.dest)?(fs.lstatSync(c.dest).isSymbolicLink()?{link:fs.readlinkSync(c.dest)}:{treeHash:treeHash(c.dest)}):null;
        if(JSON.stringify(observed)!==JSON.stringify(c.before))throw new Error(`Concurrent skill edit: ${c.dest}`);
        fs.mkdirSync(path.dirname(c.dest),{recursive:true});const backup=path.join(backupRoot,String(i));
        // Persist the recovery path BEFORE removing the existing entry point.
        const step={...c,backup:c.before?backup:null,state:'prepared'};done.push(step);atomicJSON(path.join(backupRoot,'receipt.json'),report);
        if(c.before)fs.renameSync(c.dest,backup);
        try{fs.symlinkSync(c.target,c.dest);}catch(error){if(c.before)fs.renameSync(backup,c.dest);throw error;}
        step.state='bound';atomicJSON(path.join(backupRoot,'receipt.json'),report);
      }
      return {ok:true,planned:false,bindings:done.length,backupRoot,receipt:path.join(backupRoot,'receipt.json')};
    } catch(error) {
      for(const c of [...done].reverse()){
        if(exists(c.dest)&&fs.lstatSync(c.dest).isSymbolicLink()&&fs.readlinkSync(c.dest)===c.target)fs.unlinkSync(c.dest);
        if(!exists(c.dest)&&c.backup&&exists(c.backup))fs.renameSync(c.backup,c.dest);
      }
      report.rolledBack=true;atomicJSON(path.join(backupRoot,'receipt.json'),report);
      throw error;
    }
  });
}
export function restoreBindings(receipt,{home=configHome()}={}) {
  const real=fs.realpathSync(receipt);if(!real.startsWith(path.join(fs.realpathSync(home),'backups')+path.sep))throw new Error('Receipt must be in EvoCut backups');
  return withLock(home,()=>{
    const data=readJSON(real);if(data.schema!=='evocut.skill-bindings/v1'||data.rolledBack)throw new Error('Invalid or already rolled-back binding receipt');
    for(const c of data.changes){
      if(c.backup){if(!path.resolve(c.backup).startsWith(path.dirname(real)+path.sep)||!exists(c.backup))throw new Error(`Backup missing: ${c.dest}`);const observed=fs.lstatSync(c.backup).isSymbolicLink()?{link:fs.readlinkSync(c.backup)}:{treeHash:treeHash(c.backup)};if(JSON.stringify(observed)!==JSON.stringify(c.before))throw new Error(`Backup changed: ${c.dest}`);}
      if(exists(c.dest)&&(!fs.lstatSync(c.dest).isSymbolicLink()||fs.readlinkSync(c.dest)!==c.target))throw new Error(`Binding changed; refusing restore: ${c.dest}`);
    }
    const restored=[];
    try{for(const c of [...data.changes].reverse()){if(exists(c.dest))fs.unlinkSync(c.dest);if(c.backup)fs.renameSync(c.backup,c.dest);restored.push(c);}}
    catch(error){for(const c of restored.reverse()){if(c.backup&&exists(c.dest))fs.renameSync(c.dest,c.backup);if(!exists(c.dest))fs.symlinkSync(c.target,c.dest);}throw error;}
    data.restoredAt=new Date().toISOString();atomicJSON(real,data);
    return {ok:true,restored:data.changes.length};
  });
}
export async function main(argv=process.argv.slice(2)) {
  const [verb,...rest]=argv;const opts={};for(let i=0;i<rest.length;i++){const x=rest[i];if(x==='--apply'||x==='--json')opts[x.slice(2)]=true;else if(x.startsWith('--')){if(!rest[i+1]||rest[i+1].startsWith('--'))throw new Error(`${x} requires a value`);opts[x.slice(2)]=rest[++i];}else if(!opts.id)opts.id=x;else throw new Error(`Unexpected argument: ${x}`);}
  const home=path.resolve(opts.home||configHome());let result;
  if(!verb||verb==='help'||verb==='--help'){console.log('evocut release status | stage --engine-root DIR --skills-source DIR --id ID --apply | validate ID | promote ID --apply | rollback ID --apply | bind-skills [--apply] | restore-skills RECEIPT --apply | verify [ID]\nAll operations are local. stage snapshots an already installed engine; no downloads. bind-skills backs up old skill folders.');return 0;}
  if(verb==='status'){const c=readCurrent(home);result={ok:true,home,current:c?{id:c.manifest.id,engineVersion:c.manifest.engineVersion,dir:c.dir}:null,sourceDirectory:path.join(TOOL_DIR,'skills-src')};}
  else if(verb==='verify'){const id=opts.id||readCurrent(home)?.manifest.id;if(!id)throw new Error('No release selected');const v=verifyRelease(id,{home});result={ok:v.ok,id,scope:v.scope,issues:v.issues};}
  else if(verb==='stage'){if(!opts.apply)throw new Error('stage writes an isolated candidate; pass --apply');result=stageRelease({engineRoot:opts['engine-root'],skillsSource:opts['skills-source']||path.join(TOOL_DIR,'skills-src'),id:opts.id,home});}
  else if(verb==='validate'){result=validateRelease(opts.id,{home});}
  else if(verb==='promote'||verb==='rollback'){if(!opts.apply)throw new Error(`${verb} changes the stable pointer; pass --apply`);result=promoteRelease(opts.id,{home});}
  else if(verb==='bind-skills')result=bindSkills({home,apply:opts.apply,roots:[path.join(WORKSPACE,'.agents/skills'),path.join(WORKSPACE,'.claude/skills'),path.join(os.homedir(),'.agents/skills'),path.join(os.homedir(),'.claude/skills'),path.join(os.homedir(),'.codex/skills')]});
  else if(verb==='restore-skills'){if(!opts.apply)throw new Error('restore-skills needs --apply');result=restoreBindings(opts.id,{home});}
  else throw new Error(`Unknown release command: ${verb}`);
  console.log(JSON.stringify(result,null,2));return result.ok===false?2:0;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().then(c=>{process.exitCode=c;}).catch(e=>{console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=2;});
