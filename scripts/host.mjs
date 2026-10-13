/** Portable bootstrap administration; independent of installed production snapshots. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {readCurrent, verifyRelease, bindSkills, restoreBindings, atomicJSON} from '../tools/evocut/release-manager.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FEATURES = ['core', 'render', 'qa', 'asr', 'beats'];
const FIELDS = ['python', 'browser', 'asrModel'];
const exists = p => { try {fs.lstatSync(p); return true;} catch {return false;} };
export const homeOf = (env=process.env, root=ROOT) => path.resolve(env.EVOCUT_HOME || path.join(root, '.evocut-home'));
const pythonAt = root => path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

export function ensureCommandShims({root=ROOT,home=homeOf()}={}) {
  if(process.platform==='win32')throw new Error('POSIX command shims are not supported on Windows yet');
  const target=path.join(root,'scripts/cli.mjs'),bin=path.join(home,'bin');
  if(!fs.statSync(target).isFile())throw new Error('Checkout CLI is missing');
  const names=['evocut','hyperframes']; // compatibility name only inside child PATH
  for(const name of names){const file=path.join(bin,name);if(exists(file)&&(!fs.lstatSync(file).isSymbolicLink()||fs.realpathSync(file)!==fs.realpathSync(target)))throw new Error('Refusing to overwrite an unmanaged command shim: '+name);}
  fs.mkdirSync(bin,{recursive:true});
  for(const name of names){const file=path.join(bin,name);if(!exists(file))fs.symlinkSync(target,file);}
  return bin;
}

export function readHost(home=homeOf()) {
  const file=path.join(home,'host.json');
  if (!exists(file)) return {schema:'evocut.host/v1'};
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if (value.schema!=='evocut.host/v1' || Object.keys(value).some(k=>!['schema',...FIELDS].includes(k))) throw new Error('Invalid host configuration; only explicit tool/model paths are supported, never credentials.');
  for (const key of FIELDS) if (value[key]!==undefined && (typeof value[key]!=='string'||!path.isAbsolute(value[key])||value[key].includes('\0'))) throw new Error('Host paths must be absolute: '+key);
  return value;
}

export function hostEnvironment(env=process.env, root=ROOT) {
  const config=readHost(homeOf(env,root)), out={...env};
  const python=env.EVOCUT_PYTHON || config.python || (exists(pythonAt(root))?pythonAt(root):undefined);
  if (python) {
    out.EVOCUT_PYTHON=python;
    // Select one Python for QA and the legacy audio adapters. Explicit conflicting
    // variables are not silently retained; this wrapper's selected interpreter wins.
    out.HYPERFRAMES_PYTHON=python;
    if (path.isAbsolute(python)) out.PATH=path.dirname(python)+path.delimiter+(out.PATH||'');
  }
  if (config.browser && !env.HYPERFRAMES_BROWSER_PATH) out.HYPERFRAMES_BROWSER_PATH=config.browser;
  if (config.asrModel && !env.EVOCUT_ASR_MODEL_PATH) out.EVOCUT_ASR_MODEL_PATH=config.asrModel;
  const bin=path.join(homeOf(env,root),'bin');
  try{
    if(fs.realpathSync(path.join(bin,'evocut'))===fs.realpathSync(path.join(root,'scripts/cli.mjs')))out.PATH=bin+path.delimiter+(out.PATH||'');
  }catch{ /* prepare core creates command shims explicitly, never during read-only checks */ }
  return out;
}
export function applyHostEnvironment() {Object.assign(process.env,hostEnvironment());}

export function probe(bin,args,env=process.env) {
  const r=spawnSync(bin,args,{env,encoding:'utf8',timeout:15000,maxBuffer:512*1024,windowsHide:true});
  // Raw stderr/env never enter reports: third-party tools can print credentials.
  return {ok:r.status===0,stdout:r.status===0?(r.stdout||'').trim():'',reason:r.error?.code || (r.status===null?'terminated':`exit ${r.status}`)};
}
function cachedBrowser(env) {
  if (env.HYPERFRAMES_BROWSER_PATH) return env.HYPERFRAMES_BROWSER_PATH;
  const roots=[path.join(os.homedir(),'.cache/hyperframes/chrome'),path.join(os.homedir(),'.cache/puppeteer')];
  function find(dir,depth=0) {
    if(depth>5)return null;
    let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return null;}
    for(const e of entries)if(e.isFile()&&/^chrome-headless-shell(?:\.exe)?$/.test(e.name))return path.join(dir,e.name);
    for(const e of entries)if(e.isDirectory()){const p=find(path.join(dir,e.name),depth+1);if(p)return p;}
    return null;
  }
  return roots.map(r=>find(r)).find(Boolean)||null;
}
export function doctor({feature='render',env=process.env,root=ROOT,run=probe,browserLookup=cachedBrowser}={}) {
  if(!FEATURES.includes(feature))throw new Error('Unknown feature: '+feature);
  env=hostEnvironment(env,root);
  const checks=[];
  const add=(id,ok,detail,remedy)=>checks.push({id,status:ok?'ready':'missing',detail,...(!ok?{remedy}:{} )});
  add('node',Number(process.versions.node.split('.')[0])>=22,process.versions.node,'Install Node.js 22+');
  let current=null;
  try{current=readCurrent(homeOf(env,root));}catch{ /* reported below */ }
  if(['core','render'].includes(feature)){
    let intact=false;try{intact=!!current&&verifyRelease(current.manifest.id,{home:homeOf(env,root),quick:true}).ok;}catch{ /* invalid selected release */ }
    add('engine',intact,intact?current.manifest.id+' (critical-file integrity checked)':'No valid selected release or critical files changed','env prepare --feature core --apply --allow-downloads; investigate integrity errors without overwriting the release');
  }
  if(feature!=='core')for(const bin of ['ffmpeg','ffprobe']){const p=run(bin,['-version'],env);add(bin,p.ok,p.ok?'Executable responds':p.reason,'Install '+bin+' through the host package manager and expose it to the Agent PATH');}
  if(feature==='render'){
    const browser=browserLookup(env), p=browser?run(browser,['--version'],env):null;
    add('browser',!!p?.ok,p?.ok?'Configured/cached executable responds; render capability not yet tested':'No usable configured/cached browser','env prepare --feature render --apply --allow-downloads');
  }
  if(['qa','asr','beats'].includes(feature)){
    const modules={qa:['numpy','scipy','PIL'],asr:['faster_whisper','ctranslate2','numpy','opencc'],beats:['librosa','numpy','soundfile']}[feature];
    const py=env.EVOCUT_PYTHON||'python3';
    const code='import sys,json,importlib.util;print(json.dumps({"version":list(sys.version_info[:2]),"modules":{m:importlib.util.find_spec(m) is not None for m in '+JSON.stringify(modules)+'}}))';
    const p=run(py,['-I','-c',code],env);let observed=null;
    try{observed=JSON.parse(p.stdout);}catch{ /* malformed tool output is not readiness */ }
    const version=Array.isArray(observed?.version)?observed.version:[];
    add('python',version[0]>3||version[0]===3&&version[1]>=11,version.length?version.join('.'):'Python unavailable or probe failed','Install Python 3.11+; use env init --python ABSOLUTE_PATH --apply if needed');
    for(const m of modules)add('python:'+m,observed?.modules?.[m]===true,observed?.modules?.[m]?'Import discoverable (not an inference test)':'Not found in selected Python',`env prepare --feature ${feature} --apply --allow-downloads`);
    if(feature==='asr'){
      const dir=env.EVOCUT_ASR_MODEL_PATH;
      const ok=!!dir&&['model.bin','config.json','tokenizer.json','vocabulary.txt'].every(n=>{try{return fs.statSync(path.join(dir,n)).isFile();}catch{return false;}});
      add('asr-model',ok,ok?'Explicit local model files found; inference not tested':'No complete explicitly selected model','Acquire a compatible faster-whisper model separately; env init --asr-model ABSOLUTE_PATH --apply');
    }
  }
  return {schema:'evocut.environment/v1',feature,ok:checks.every(c=>c.status==='ready'),readOnly:true,platform:process.platform,checks,warnings:['Readiness checks do not certify actual rendering, inference or media quality.',...(process.platform==='win32'?['Windows runtime and skill symlink installation are not validated.']:[])]};
}

export function preparePlan(feature,{env=process.env,root=ROOT}={}) {
  if(!FEATURES.includes(feature))throw new Error('Unknown feature: '+feature);
  env=hostEnvironment(env,root);
  const steps=[],manual=[];
  if(['core','render'].includes(feature))steps.push({bin:process.execPath,args:[path.join(root,'scripts/setup.mjs'),'--install-engine'],purpose:'Install/verify the pinned checkout-local engine; preserve an existing active release'});
  if(feature==='render')steps.push({bin:process.execPath,args:[path.join(root,'scripts/cli.mjs'),'browser','ensure'],purpose:'Prepare the renderer browser; may download a browser archive'});
  if(['qa','asr','beats'].includes(feature)){
    const py=env.EVOCUT_PYTHON||pythonAt(root);
    if(!env.EVOCUT_PYTHON&&!exists(py))steps.push({bin:'python3',args:['-m','venv',path.join(root,'.venv')],purpose:'Create a checkout-local Python environment'});
    const req=path.join(root,feature==='qa'?'requirements-dev.txt':`requirements-${feature}.txt`);
    steps.push({bin:py,args:['-m','pip','--require-virtualenv','install','-r',req],purpose:'Install only the selected feature Python dependencies, never into system Python'});
    if(feature==='asr')manual.push('Model weights are not downloaded. Choose/acquire a compatible local model and configure asrModel explicitly.');
  }
  return {schema:'evocut.prepare-plan/v1',feature,planned:true,downloads:'Package/browser downloads require --allow-downloads. No paid API calls or model-weight downloads are performed by these plans.',steps,manual,hostRequirements:feature==='core'?['Node.js 22+','Python 3.11+ for release validation']:['Node.js 22+','Python 3.11+','FFmpeg','ffprobe'],platformSupported:process.platform!=='win32'};
}

export function parseOptions(args,allowed) {
  const values={};
  for(let i=0;i<args.length;i++){
    const a=args[i];if(!allowed.includes(a))throw new Error('Unknown option: '+a);
    if(Object.hasOwn(values,a))throw new Error('Duplicate option: '+a);
    if(['--apply','--allow-downloads','--replace','--json'].includes(a))values[a]=true;
    else{const value=args[++i];if(!value||value.startsWith('--'))throw new Error(a+' requires a value');values[a]=value;}
  }
  return values;
}
function canonicalDestination(dir){
  let target=path.resolve(dir), ancestor=target,tail=[];
  while(!exists(ancestor)){tail.unshift(path.basename(ancestor));const parent=path.dirname(ancestor);if(parent===ancestor)break;ancestor=parent;}
  return path.resolve(fs.realpathSync(ancestor),...tail);
}
function resolvedDestination(dir,root,home){
  const target=canonicalDestination(dir);
  const overlap=(a,b)=>a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);
  if(target===path.parse(target).root||target===os.homedir())throw new Error('Select a dedicated Agent skills directory, not a filesystem/home root');
  for(const protectedRoot of [home,path.join(root,'tools'),path.join(root,'scripts'),path.join(root,'.runtime')])if(overlap(target,canonicalDestination(protectedRoot)))throw new Error('Skills destination overlaps managed source/runtime');
  return target;
}
export function installAgent({dir,apply=false,replace=false,root=ROOT,home=homeOf()}={}) {
  if(!dir)throw new Error('--skills-dir is required; no Agent directories are selected automatically');
  if(process.platform==='win32'&&apply)throw new Error('Windows skill binding is not validated; use agent instructions with manual skill loading.');
  const target=resolvedDestination(dir,root,home), current=readCurrent(home);
  if(!current)throw new Error('Prepare the core feature before binding skills');
  if(!verifyRelease(current.manifest.id,{home}).ok)throw new Error('Active release integrity failed; no skills changed');
  const plan=bindSkills({roots:[target],home,apply:false});
  const conflicts=plan.changes.filter(c=>c.before).map(c=>c.dest);
  if(apply&&conflicts.length&&!replace)throw new Error('Existing entries would change; review the plan and explicitly pass --replace to back up and replace them');
  return apply?bindSkills({roots:[target],home,apply:true}):{...plan,conflicts,scope:'Only the supplied skills directory; existing entries require --replace'};
}

const HELP=`EvoCut portable setup (no changes without --apply)
  env doctor [--feature core|render|qa|asr|beats] [--json]
  env init [--python PATH] [--browser PATH] [--asr-model PATH] [--apply]
  env prepare --feature core|render|qa|asr|beats [--apply --allow-downloads]
  agent instructions
  agent install --skills-dir DIR [--apply] [--replace]
  agent restore --receipt PATH --apply
No model credentials, automatic global skill installation or paid API calls.
env doctor is offline and exits 2 when selected prerequisites are missing.
The engine's existing doctor command remains separate and unchanged.`;

export async function main(argv,{root=ROOT,env=process.env}={}) {
  const [group,verb,...args]=argv;
  if(!verb||['--help','help','-h'].includes(verb)){console.log(HELP);return 0;}
  const home=homeOf(env,root);let result;
  if(group==='env'&&verb==='doctor'){
    const o=parseOptions(args,['--feature','--json']);result=doctor({feature:o['--feature']||'render',env,root});
    console.log(JSON.stringify(result,null,2));return result.ok?0:2;
  } else if(group==='env'&&verb==='init'){
    const o=parseOptions(args,['--python','--browser','--asr-model','--apply','--json']),before=readHost(home),after={...before};
    for(const [flag,key]of [['--python','python'],['--browser','browser'],['--asr-model','asrModel']])if(o[flag]){
      if(o[flag].includes('\0'))throw new Error('Invalid path');
      after[key]=path.resolve(o[flag]);
    }
    result={ok:true,planned:!o['--apply'],file:path.join(home,'host.json'),config:after};
    if(o['--apply'])atomicJSON(result.file,after);
  } else if(group==='env'&&verb==='prepare'){
    const o=parseOptions(args,['--feature','--apply','--allow-downloads','--json']);
    if(!o['--feature'])throw new Error('--feature is required; features are never installed en masse');
    result=preparePlan(o['--feature'],{env,root});
    if(o['--apply']){
      if(!o['--allow-downloads'])throw new Error('Review the plan and pass --allow-downloads explicitly');
      if(!result.platformSupported)throw new Error('Windows preparation is not validated; plan only');
      const selected=hostEnvironment(env,root);
      if(!probe(selected.EVOCUT_PYTHON||'python3',['-I','-c','import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)'],selected).ok)throw new Error('Preparation requires Python 3.11+; no changes made');
      fs.mkdirSync(home,{recursive:true});const lock=path.join(home,'prepare.lock');let fd;
      try{fd=fs.openSync(lock,'wx',0o600);}catch{throw new Error('Another preparation holds prepare.lock; do not remove an active lock');}
      try{
        for(const step of result.steps){
          console.error(step.purpose);
          const r=spawnSync(step.bin,step.args,{cwd:root,env:hostEnvironment(env,root),stdio:['inherit',2,2]});
          if(r.status!==0)throw new Error('Preparation step failed: '+step.purpose+'; existing progress is retained');
        }
        result={...result,planned:false,prepared:true,readiness:doctor({feature:result.feature,env,root})};
      }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
      console.log(JSON.stringify(result,null,2));return result.readiness.ok?0:2;
    }
  } else if(group==='agent'&&verb==='install'){
    const o=parseOptions(args,['--skills-dir','--apply','--replace','--json']);result=installAgent({dir:o['--skills-dir'],apply:o['--apply'],replace:o['--replace'],root,home});
  } else if(group==='agent'&&verb==='restore'){
    const o=parseOptions(args,['--receipt','--apply','--json']);if(!o['--receipt']||!o['--apply'])throw new Error('Restore requires --receipt PATH --apply');result=restoreBindings(o['--receipt'],{home});
  } else if(group==='agent'&&verb==='instructions'){
    parseOptions(args,['--json']);result={schema:'evocut.agent-entry/v1',launcher:{executable:process.execPath,args:[path.join(root,'scripts/cli.mjs')],env:{EVOCUT_HOME:home}},skillEntry:path.join(home,'current/skills/evocut/SKILL.md'),requirements:['Read/write persistent project files','Execute local commands and retain long-running task logs','Load SKILL.md and its relative references','Show local images and deliver video/audio for review'],instructions:['Prepare core before loading skillEntry. Keep the full skills tree and sibling references.','Use this absolute launcher with its env from the video project directory; it does not require npm link or a global evocut command.','When a skill says evocut, substitute launcher executable + args. Do not replace the real dependency/protocol names.','The placeholder /absolute/evocut in portable docs means this checkout root: '+root,'Do not infer paid API authorization or install all optional models.','If the Agent cannot execute commands, a tool/MCP adapter is still required; this is not an MCP server.'],limitations:['CLI-based adapters that explicitly call codex still need that optional provider, or a separately integrated replacement.','Some optional legacy helper scripts require additional dependencies; a ready render feature does not certify all recipes.']};
  } else throw new Error('Unknown setup command; use env --help');
  console.log(JSON.stringify(result,null,2));return 0;
}
