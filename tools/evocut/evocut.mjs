#!/usr/bin/env node
/** EvoCut launcher: preserve project-pinned HyperFrames engines and machine output. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { stableEngine, configHome, releaseModule, readCurrent } from './release-manager.mjs';
import { startRenderReceipt, finishRenderReceipt } from './render-receipt.mjs';
const VERSION=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
export function findPin(cwd) {
  for(let dir=path.resolve(cwd);;dir=path.dirname(dir)) {
    const f=path.join(dir,'package.json');
    if(fs.existsSync(f)) {
      const p=JSON.parse(fs.readFileSync(f,'utf8')),pins=new Set(),bad=[];
      for(const cmd of Object.values(p.scripts??{})) {
        for(const m of String(cmd).matchAll(/\bhyperframes@([^\s"';&|]+)/g)) {if(VERSION.test(m[1]))pins.add(m[1]);else bad.push(m[1]);}
        if(/\bevocut\b/.test(cmd))for(const m of String(cmd).matchAll(/--engine-version(?:=|\s+)([^\s"';&|]+)/g)){if(VERSION.test(m[1]))pins.add(m[1]);else bad.push(m[1]);}
      }
      for(const table of ['dependencies','devDependencies','optionalDependencies'])if(p[table]?.hyperframes) {const v=p[table].hyperframes;if(VERSION.test(v))pins.add(v);else bad.push(v);}
      if(bad.length)throw new Error('Non-exact HyperFrames pin requires explicit --engine-version: '+bad.join(', '));
      if(pins.size>1)throw new Error('Conflicting HyperFrames project pins: '+[...pins].join(', '));
      return {version:[...pins][0]??null,projectDir:dir,packageFile:f};
    }
    if(path.dirname(dir)===dir)return {version:null,projectDir:path.resolve(cwd),packageFile:null};
  }
}
export function parseArgs(argv) {
  let version=null,resolveOnly=false;const args=[];
  for(let i=0;i<argv.length;i++) {const a=argv[i];if(a==='--engine-version'||a.startsWith('--engine-version=')){version=a.includes('=')?a.slice(a.indexOf('=')+1):argv[++i];if(!VERSION.test(version??''))throw new Error('--engine-version requires an exact X.Y.Z version');}else if(a==='--resolve-engine')resolveOnly=true;else args.push(a);}
  return {version,resolveOnly,args};
}
const PROJECT_COMMANDS=new Set('check preview render play lint validate inspect snapshot info timeline compositions present publish compare grade-compare benchmark keyframes beats normalize-audio history media-treatment'.split(' '));
const VALUE_FLAGS=new Set(('--output -o --composition -c --fps --quality --format --resolution --crf --video-bitrate --workers --browser-timeout --variables --variables-file --gif-loop --hls-segment-seconds --port --browser-path --user-data-dir --remote-debugging-port --timeout --at --times --time --interval --limit --samples --report --report-dir --timestamps --viewport --width --height --threshold --max-errors --context-fields --context-detail --track --selector --grading --frames-cache-dir --encoding --capture-mode --codec --audio-bitrate --duration --start --end --scale --preset --cache-dir --screenshot-dir --output-dir --font-dir --host').split(' '));
const BOOLEAN_FLAGS=new Set(('--json --help -h --version -v --quiet --verbose --debug --background --foreground --selection --context --stop --strict --strict-all --strict-variables --gpu --no-gpu --browser-gpu --no-browser-gpu --docker --hdr --sdr --yes --public --no-open --open --no-audio --transparent --force --all --fix --fail-on-warning --no-overlap --lint-only --runtime-only --layout-only').split(' '));
const SCHEMA_FILE=path.join(path.dirname(fileURLToPath(import.meta.url)),'engine-options.json');
function schemaFor(command,version) {if(!fs.existsSync(SCHEMA_FILE))return null;const versions=JSON.parse(fs.readFileSync(SCHEMA_FILE,'utf8')).versions;const latest=Object.keys(versions).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1);return versions[version??latest]?.[command]??null;}
export function projectCwd(cwd,args,version=null) {
  // Child commands consume clip refs / edit plans, not a project positional.
  // Only the explicit --dir/--project flag identifies their owning project.
  if(args[0]==='timeline'&&new Set(['move','trim','split','delete','set','duplicate','ids','apply','undo']).has(args[1])) {
    for(let i=2;i<args.length;i++) {
      if(args[i]==='--dir'||args[i]==='--project'){if(!args[i+1]||args[i+1].startsWith('-'))throw new Error(args[i]+' requires a project directory');return path.resolve(cwd,args[i+1]);}
      if(/^--(?:dir|project)=/.test(args[i]))return path.resolve(cwd,args[i].slice(args[i].indexOf('=')+1));
    }
    return cwd;
  }
  const schema=schemaFor(args[0],version);
  if(!schema&&!PROJECT_COMMANDS.has(args[0]))return cwd;
  let positional=0;
  for(let i=1;i<args.length;i++) {
    const a=args[i];if(a==='--')return args[i+1]?path.resolve(cwd,args[i+1]):cwd;
    if(a==='--dir'||a==='--project'){if(!args[i+1])throw new Error(a+' requires a project directory');return path.resolve(cwd,args[i+1]);}
    if(a.startsWith('--dir=')||a.startsWith('--project='))return path.resolve(cwd,a.slice(a.indexOf('=')+1));
    if(a.startsWith('-')) {
      if(a.includes('='))continue;
      const type=schema?.options[a]??(schema?.options[a.replace(/^--no-/,'--')]==='boolean'?'boolean':null);
      if(type==='string'||!schema&&(VALUE_FLAGS.has(a)||a==='--describe')){i++;continue;}
      if(type==='boolean'||BOOLEAN_FLAGS.has(a)||a.startsWith('--no-')){if(['true','false'].includes(args[i+1]))i++;continue;}
      if(/^-[A-Za-z].+/.test(a)&&schema?.options[a.slice(0,2)]==='string')continue;
      // Never guess whether an unknown option consumes a directory-looking value.
      if(args[i+1]&&!args[i+1].startsWith('-'))throw new Error('Cannot safely resolve project after unknown option '+a+'; run from the project directory or use --option=value syntax.');
      continue;
    }
    // The first positional directory owns the pin. All subsequent command options belong to
    // the upstream parser; do not reject new engine flags that cannot change the project.
    const positionalSpec=schema?.positionals[positional++];
    if(!schema||positionalSpec?.project)return path.resolve(cwd,a);
  }
  return cwd;
}
export function resolveEngine({cwd=process.cwd(),version=null,home=os.homedir(),managedHome=configHome(home)}={}) {
  let pin;try{pin=findPin(cwd);}catch(e){if(!version)throw e;pin={version:null,projectDir:cwd,packageFile:null,pinWarning:e.message};}
  const globalRoot=path.join(home,'.npm-global/lib/node_modules/hyperframes');
  let defaultVersion;try{defaultVersion=JSON.parse(fs.readFileSync(path.join(globalRoot,'package.json'))).version;}catch{}
  // A damaged stable release must not block a project pinned to an unrelated
  // installed version. Such projects never load anything from that release.
  const requested=version??pin.version;
  let current;
  try{current=readCurrent(managedHome);}catch(error){if(!requested)throw error;current=null;}
  const stable=current&&(!requested||requested===current.manifest.engineVersion)?stableEngine(managedHome):null;
  const selected=version??pin.version??stable?.version??defaultVersion;if(!selected)throw new Error('No installed engine or project pin');
  const candidates=[...(stable&&stable.version===selected?[stable.root]:[]),path.join(pin.projectDir,'node_modules/hyperframes'),globalRoot];
  const cache=path.join(home,'npm-cache/_npx');if(fs.existsSync(cache))for(const d of fs.readdirSync(cache,{withFileTypes:true}))if(d.isDirectory())candidates.push(path.join(cache,d.name,'node_modules/hyperframes'));
  for(const root of candidates)try{const p=JSON.parse(fs.readFileSync(path.join(root,'package.json')));const entry=path.resolve(root,typeof p.bin==='string'?p.bin:p.bin?.hyperframes??'dist/cli.js');if(p.name==='hyperframes'&&p.version===selected&&entry.startsWith(path.resolve(root)+path.sep)&&fs.existsSync(entry))return {brand:'EvoCut',version:selected,root:fs.realpathSync(root),entry,source:version?'explicit':pin.version?'project-pin':stable?'managed-stable':'installed-global-default',releaseId:root===stable?.root?stable.releaseId:null,projectDir:pin.projectDir,packageFile:pin.packageFile,overridesProjectPin:Boolean(version&&pin.version&&version!==pin.version),pinWarning:pin.pinWarning};}catch{}
  throw new Error(`Pinned HyperFrames ${selected} is not installed. Install that exact upstream version, then run EvoCut branding again; no automatic network install was performed.`);
}
export function launcherEnv(env=process.env,home=os.homedir()) {
  const out={...env,HYPERFRAMES_NO_TELEMETRY:env.HYPERFRAMES_NO_TELEMETRY??'1',DO_NOT_TRACK:env.DO_NOT_TRACK??'1',HYPERFRAMES_NO_UPDATE_CHECK:'1',HYPERFRAMES_NO_AUTO_INSTALL:'1',HYPERFRAMES_SKIP_SKILLS:'1'};
  if(!out.XDG_STATE_HOME) {
    let probe=path.join(home,'.local/state');while(!fs.existsSync(probe)&&path.dirname(probe)!==probe)probe=path.dirname(probe);
    try{fs.accessSync(probe,fs.constants.W_OK);}catch{out.XDG_STATE_HOME=path.join(home,'.cache/evocut/state');fs.mkdirSync(out.XDG_STATE_HOME,{recursive:true});}
  }
  return out;
}
export async function main(argv=process.argv.slice(2)) {
  const opts=parseArgs(argv);
  const localCommand=new Set(['release','assets','voice','edit','qa','brand','about']).has(opts.args[0]);
  if(localCommand&&opts.resolveOnly)throw new Error('--resolve-engine cannot be combined with local extension commands; no extension action was executed. Run it separately in the project directory.');
  if(localCommand&&opts.version&&!(opts.args[0]==='edit'&&opts.args[1]==='plan'))throw new Error('--engine-version is only supported for engine commands and edit plan; no extension action was executed.');
  if(opts.args.length===1&&['--help','-h'].includes(opts.args[0]))console.log('EvoCut local extensions:\n  release   stage / validate / promote / rollback shared releases\n  assets    Chinese search / tags / local preview / explicit import\n  voice     fixed voice profiles and neutral synthesis requests\n  edit      conservative linked cut / move / undo / remake plans\n  qa        typed offline QA, with separate human review\nRun evocut <extension> --help. Engine commands follow below.\n');
  if(opts.args[0]==='release') {const {main:run}=await import('./release-manager.mjs');process.exitCode=await run(opts.args.slice(1));return;}
  const local={assets:'media-library.mjs',voice:'voice-profile.mjs',edit:'semantic-edit.mjs'};
  if(local[opts.args[0]]){const {main:run}=await import(pathToFileURL(releaseModule(local[opts.args[0]])).href);const extensionArgs=opts.args.slice(1);if(opts.version)extensionArgs.push('--engine-version',opts.version);const code=await run(extensionArgs);if(Number.isInteger(code))process.exitCode=code;return;}
  if(opts.args[0]==='qa') {
    const entry=releaseModule('../video_qa/quality_gate.py');
    const child=spawn(process.env.EVOCUT_PYTHON||'python3',[entry,...opts.args.slice(1)],{stdio:'inherit',env:{...launcherEnv(),PYTHONDONTWRITEBYTECODE:'1'}});
    child.on('error',e=>{console.error('EvoCut QA: '+e.message);process.exitCode=1;});child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});return;
  }
  if(opts.args[0]==='upgrade'||opts.args[0]==='skills'&&opts.args[1]!=='check')throw new Error('Managed EvoCut does not upgrade live engines or skills. Install an upstream candidate separately, then use evocut release stage / validate / promote. Project pins remain unchanged.');
  if(opts.args[0]==='brand') {const {main:brand}=await import('./branding.mjs');brand(opts.args.slice(1));return;}
  if(opts.args[0]==='about') {console.log('EvoCut — local video workspace\nPowered by HyperFrames (HeyGen), Apache-2.0. Not an official HeyGen product.\nCompatibility names, engine packages and protocols remain HyperFrames.');return;}
  let hint=opts.version;try{hint??=findPin(process.cwd()).version;}catch{}
  const target=projectCwd(process.cwd(),opts.args,hint),engine=resolveEngine({cwd:target,version:opts.version});
  if(path.resolve(projectCwd(process.cwd(),opts.args,engine.version))!==path.resolve(target))throw new Error('Project argument schema differs for the pinned engine; run from the project directory.');
  if(opts.resolveOnly){console.log(JSON.stringify(engine,null,2));return;}
  if(engine.overridesProjectPin)console.error(`EvoCut: explicit engine override ${engine.version}; project package is unchanged.`);
  const renderStart=startRenderReceipt({project:target,args:opts.args,engineVersion:engine.version});
  const child=spawn(process.execPath,[engine.entry,...opts.args],{stdio:'inherit',cwd:process.cwd(),env:launcherEnv()});
  const forward=signal=>{if(!child.killed)child.kill(signal);};for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>forward(s));
  child.on('error',e=>{console.error('EvoCut: '+e.message);process.exitCode=1;});child.on('exit',(code,signal)=>{
    process.exitCode=code??(signal?1:0);
    try{const binding=finishRenderReceipt(renderStart,{exitCode:code});if(binding)console.error('EvoCut source receipt: '+binding.path+' (not a quality approval)');}
    catch(error){console.error('EvoCut: render exited successfully, but QA source binding failed: '+error.message);process.exitCode=2;}
  });
}
if(process.argv[1]&&fs.existsSync(path.resolve(process.argv[1]))&&pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href===import.meta.url)main().catch(e=>{console.error('EvoCut: '+e.message);process.exitCode=1;});
