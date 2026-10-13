/** Bind an actual successful single-file render to the source it rendered. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {atomicJSON,sha} from './release-manager.mjs';

// Receipt eligibility is narrower than render CLI support: an unfamiliar flag may
// still be passed to the engine, but must not produce a guessed source binding.
const VALUE_FLAGS=new Map([
  ['--output','output'],['-o','output'],['--format','format'],['--fps','fps'],['-f','fps'],
  ['--quality','quality'],['-q','quality'],['--workers','workers'],['-w','workers'],
  ...['skill','video-frame-format','crf','video-bitrate','vp9-cpu-used','max-concurrent-renders',
    'resolution','browser-timeout','protocol-timeout','player-ready-timeout'].map(k=>['--'+k,k]),
]);
const BOOLEAN_FLAGS=new Set(['docker','hdr','sdr','gpu','browser-gpu','quiet','lint-verbose','debug',
  'best-effort','strict','strict-all','json','page-side-compositing','keep-segments','low-memory-mode','experimental-fast-capture']);
function renderArguments(args,cwd) {
  if(!Array.isArray(args)||args[0]!=='render'||args.some(a=>typeof a!=='string'))return null;
  const values={},seen=new Set(),positionals=[];
  for(let i=1;i<args.length;i++) {
    const a=args[i];
    if(a==='--'){positionals.push(...args.slice(i+1));break;}
    if(!a.startsWith('-')){positionals.push(a);continue;}
    const equal=a.indexOf('='),flag=equal<0?a:a.slice(0,equal),inline=equal<0?null:a.slice(equal+1);
    const field=VALUE_FLAGS.get(flag);
    if(field) {
      if(seen.has(field))return null;seen.add(field);
      const value=inline??args[++i];
      if(!value||value.startsWith('-'))return null;
      values[field]=value;continue;
    }
    const boolean=flag.replace(/^--(?:no-)?/,'');
    if(!flag.startsWith('--')||!BOOLEAN_FLAGS.has(boolean)||seen.has(boolean))return null;
    seen.add(boolean);
    if(inline!=null&&!['true','false'].includes(inline))return null;
    if(inline==null&&['true','false'].includes(args[i+1]))i++;
  }
  if(positionals.length>1||values.format&&values.format!=='mp4'||!values.output?.toLowerCase().endsWith('.mp4'))return null;
  return {project:path.resolve(cwd,positionals[0]??'.'),output:path.resolve(cwd,values.output)};
}
const signature=s=>['dev','ino','size','mtimeNs','ctimeNs'].map(k=>String(s[k])).join(':');
function snapshot(file) {
  const original=fs.lstatSync(file,{bigint:true});
  if(!original.isFile()||original.isSymbolicLink())throw new Error('Source/output must be a regular non-symlink file; receipt withheld');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
  try {
    const begin=fs.fstatSync(fd,{bigint:true});
    if(signature(begin)!==signature(original))throw new Error('File changed while opening snapshot; receipt withheld');
    const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let count;
    while((count=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,count));
    const end=fs.fstatSync(fd,{bigint:true}),current=fs.lstatSync(file,{bigint:true});
    if(signature(begin)!==signature(end)||signature(end)!==signature(current))throw new Error('File changed while hashing; receipt withheld');
    return {path:fs.realpathSync(file),sha256:hash.digest('hex'),identity:signature(end),size:Number(end.size),mtimeMs:Number(end.mtimeNs)/1e6,ctimeMs:Number(end.ctimeNs)/1e6};
  }finally{fs.closeSync(fd);}
}
function safeReceiptPath(project) {
  let current=project;
  for(const part of ['.hyperframes','evocut','render-receipt.json']) {
    current=path.join(current,part);
    try{if(fs.lstatSync(current).isSymbolicLink())throw new Error('Symlink receipt destination refused');}
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return current;
}
export function startRenderReceipt({project,args,engineVersion,cwd=process.cwd(),now=new Date().toISOString()}) {
  if(engineVersion!=='0.8.81')return null;
  const parsed=renderArguments(args,cwd);if(!parsed)return null;
  // Native render resolves the positional project, NOT the nearest package root.
  if(!fs.existsSync(parsed.project)||!fs.existsSync(project))return null;
  const actualProject=fs.realpathSync(parsed.project);
  if(actualProject!==fs.realpathSync(project))return null;
  const index=path.join(actualProject,'index.html');if(!fs.existsSync(index))return null;
  if(!Number.isFinite(Date.parse(now)))throw new Error('Invalid render start timestamp');
  safeReceiptPath(actualProject);
  const beforeOutput=fs.existsSync(parsed.output)?snapshot(parsed.output):null;
  // Dangling output symlinks must not count as a previously absent file.
  if(!beforeOutput){try{if(fs.lstatSync(parsed.output).isSymbolicLink())throw new Error('Symlink output refused');}catch(e){if(e.code!=='ENOENT')throw e;}}
  return {schema:'evocut.render-start/v1',project:actualProject,index:snapshot(index),
    videoPath:parsed.output,beforeOutput,engineVersion,startedAt:now,argvSha256:sha(JSON.stringify(args))};
}
export function finishRenderReceipt(start,{exitCode,now=new Date().toISOString()}={}) {
  if(!start||exitCode!==0)return null;
  const file=start.videoPath;
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.statSync(file).size===0)throw new Error('Successful render did not create its explicit MP4 output; source receipt withheld');
  const index=snapshot(path.join(start.project,'index.html'));
  if(index.path!==start.index.path||index.sha256!==start.index.sha256||index.identity!==start.index.identity)throw new Error('Project changed during render; source receipt withheld');
  const video=snapshot(file),began=Date.parse(start.startedAt),ended=Date.parse(now);
  if(!Number.isFinite(ended)||ended<began)throw new Error('Invalid render completion timestamp; source receipt withheld');
  if(video.mtimeMs<began||video.ctimeMs<began)throw new Error('Output predates this render; source receipt withheld');
  if(start.beforeOutput&&video.sha256===start.beforeOutput.sha256)throw new Error('Output bytes did not change; an old/touched MP4 cannot be rebound. Render to a fresh output path.');
  const receipt={schema:'evocut.render-receipt/v1',project:start.project,index:{path:index.path,sha256:index.sha256},
    video:{path:video.path,sha256:video.sha256},engineVersion:start.engineVersion,renderedAt:now,sourceUnchanged:true,
    invocation:{startedAt:start.startedAt,argvSha256:start.argvSha256,outputPreviouslyExisted:Boolean(start.beforeOutput)},
    scope:'index.html only; external dependencies are not bound; exit/output evidence is not creative or audio approval'};
  const dest=safeReceiptPath(start.project);atomicJSON(dest,receipt);return {path:dest,receipt};
}
