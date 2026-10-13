#!/usr/bin/env node
/** EvoCut local presentation layer. HyperFrames engine identity and licenses stay intact. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { loadAcorn } from './dependencies.mjs';

export const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const STATE = path.join(WORKSPACE, 'tools/evocut/state');
const NOTICE = 'Modified locally for EvoCut presentation, 2026-09-23. HyperFrames engine by HeyGen; Apache-2.0. Runtime protocols unchanged.';
const require = createRequire(import.meta.url);
const acorn = loadAcorn();
export const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const read = file => fs.existsSync(file) ? fs.readFileSync(file) : null;
const digest = file => { const b = read(file); return b ? hash(b) : null; };
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); const mode=fs.existsSync(file)?fs.statSync(file).mode:0o644; const tmp = `${file}.evocut-${process.pid}.tmp`; fs.writeFileSync(tmp, data,{mode}); fs.renameSync(tmp, file); }
function walk(ast, fn) { const stack = [ast]; while (stack.length) { const n = stack.pop(); if (!n || typeof n !== 'object') continue; if (n.type) fn(n); for (const v of Object.values(n)) { if (Array.isArray(v)) stack.push(...v); else if (v?.type) stack.push(v); } } }
function applyEdits(source, edits) {
  edits.sort((a,b) => b.start-a.start); let last=source.length+1;
  for (const e of edits) { if(e.end>last) throw new Error('Overlapping branding edits'); source=source.slice(0,e.start)+e.text+source.slice(e.end); last=e.start; }
  return source;
}
const DISPLAY = new Map([
  ['HyperFrames Studio','EvoCut Studio'], ['Hyperframes Studio','EvoCut Studio'],
  ['HyperFrames Player','EvoCut Player'], ['HyperFrames Grade Compare','EvoCut Grade Compare'],
  ['Fix these HyperFrames lint issues','Fix these EvoCut lint issues'],
  ['HyperFrames','EvoCut'],
  ['HyperFrames Composition','EvoCut Composition'],
  ['Hyperframes Composition','EvoCut Composition'],
  ['Select an element in HyperFrames Studio, exactly as clicking it would:','Select an element in EvoCut Studio, exactly as clicking it would:'],
  ["Read HyperFrames Studio's live state in one call: the open project and composition,","Read EvoCut Studio's live state in one call: the open project and composition,"],
]);
export function patchStudio(source, { requireHeader=true, wordmarkUrl='/assets/evocut-wordmark-dark.svg' }={}) {
  const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}), edits=[], logoRanges=[];
  let headers=0,marks=0,labels=0;
  walk(ast,n=>{
    if(n.type!=='CallExpression'||n.arguments[0]?.value!=='svg'||n.arguments[1]?.type!=='ObjectExpression') return;
    const obj=n.arguments[1], props=obj.properties, body=source.slice(n.start,n.end), callee=source.slice(n.callee.start,n.callee.end);
    const get=k=>props.find(p=>(p.key?.name??p.key?.value)===k)?.value;
    if(get('viewBox')?.value==='0 0 263 79'&&/Hyperframes|HyperFrames/.test(get('aria-label')?.value??'')) {
      edits.push({start:n.start,end:n.end,text:`${callee}("img",{src:${JSON.stringify(wordmarkUrl)},alt:"EvoCut",title:"EvoCut Studio",width:104,height:36,style:{objectFit:"contain",display:"block"}})`});
      logoRanges.push([n.start,n.end]); headers++;
    } else if(body.includes('M10.1851 57.8021L33.1145')) {
      const keep=props.filter(p=>(p.key?.name??p.key?.value)!=='children'&&(p.key?.name??p.key?.value)!=='viewBox').map(p=>source.slice(p.start,p.end));
      const paths=['M28 22h80L92 46H20V30a8 8 0 0 1 8-8Z','M28 52h48l22 12-22 12H20V60a8 8 0 0 1 8-8Z','M20 82h72l16 24H28a8 8 0 0 1-8-8V82Z'];
      const children=paths.map(d=>`${callee}("path",{d:${JSON.stringify(d)},fill:"#C5F541"})`).join(',');
      edits.push({start:n.start,end:n.end,text:`${callee}("svg",{${keep.join(',')},viewBox:"0 0 128 128",children:[${children}]})`});
      logoRanges.push([n.start,n.end]); marks++;
    }
  });
  if(requireHeader&&headers!==1) throw new Error(`Unsupported Studio header shape: ${headers}`);
  if(headers>1||marks>3) throw new Error(`Ambiguous logo matches: ${headers}/${marks}`);
  walk(ast,n=>{ if(n.type==='Literal'&&typeof n.value==='string'&&DISPLAY.has(n.value)&&!logoRanges.some(([a,b])=>n.start>=a&&n.end<=b)) { edits.push({start:n.start,end:n.end,text:JSON.stringify(DISPLAY.get(n.value))}); labels++; } });
  const output=`/* ${NOTICE} */\n`+applyEdits(source,edits);
  acorn.parse(output,{ecmaVersion:'latest',sourceType:'module'});
  for(const token of ['__hyperframes','hyperframes-player','X-Hyperframes-Write-Token','hyperframes-studio:telemetryDisabled']) {
    if(source.split(token).length!==output.split(token).length) throw new Error(`Protected runtime token changed: ${token}`);
  }
  return {output,headers,marks,labels};
}
export function patchCli(source) {
  let out=source,changes=0;
  for(const [a,b] of [['<title>HyperFrames Studio unavailable</title>','<title>EvoCut Studio unavailable</title>'],['HyperFrames Player</title>','EvoCut Player</title>'],['<title>HyperFrames Grade Compare</title>','<title>EvoCut Grade Compare</title>'],['"Create a new HyperFrames project"','"Create a new EvoCut project"']]) {
    changes+=out.split(a).length-1; out=out.split(a).join(b);
  }
  const meta=/(\b(?:var|const) main = defineCommand\(\{\s*meta: \{\s*name: )"hyperframes"/g;
  out=out.replace(meta,(_,prefix)=>{ changes++; return `${prefix}"evocut"`; });
  // Root help is a custom renderer, separate from citty metadata. Patch only its bounded display body.
  const hs=out.indexOf('function renderRootHelp() {'),he=out.indexOf('\nfunction formatExamples(',hs);
  if(hs>=0&&he>hs) {const before=out.slice(hs,he),after=before.replace(/\bhyperframes\b/g,'evocut');changes+=before===after?0:1;out=out.slice(0,hs)+after+out.slice(he);}
  const es=out.indexOf('    ROOT_EXAMPLES = ['),ee=out.indexOf('\n    STATIC_EXAMPLES =',es);
  if(es>=0&&ee>es) {const before=out.slice(es,ee),after=before.replace(/"hyperframes /g,'"evocut ');changes+=before===after?0:1;out=out.slice(0,es)+after+out.slice(ee);}
  out=out.replace('"Install HyperFrames and GSAP skills for AI coding tools"','"Install EvoCut-compatible engine and GSAP skills for AI coding tools"');
  out=out.replace(/(\b\w+\.bold\(")hyperframes ([^"\n]+)("\))/g,(_,a,b,c)=>{changes++;return a+'evocut '+b+c;});
  out=out.replace(/Stop with: hyperframes preview /g,()=>{changes++;return 'Stop with: evocut preview ';});
  out=out.replace(/Start one with: npx hyperframes preview/g,'Start one with: evocut preview');
  // Preserve the executable shebang and every machine-readable error, command, URL and API identifier.
  out=out.startsWith('#!')?out.replace(/\n/,`\n// ${NOTICE}\n`):`// ${NOTICE}\n${out}`;
  return {output:out,changes};
}
export function discover() {
  const roots=new Set(), add=r=>{try{const p=json(path.join(r,'package.json'));if(p.name==='hyperframes')roots.add(fs.realpathSync(r));}catch{}};
  add(path.join(os.homedir(),'.npm-global/lib/node_modules/hyperframes'));
  add(path.join(WORKSPACE,'.runtime/node_modules/hyperframes'));
  const cache=path.join(os.homedir(),'npm-cache/_npx');
  if(fs.existsSync(cache))for(const d of fs.readdirSync(cache,{withFileTypes:true})) if(d.isDirectory())add(path.join(cache,d.name,'node_modules/hyperframes'));
  const report=path.join(WORKSPACE,'outputs/hyperframes-upgrade-20260923/projects/report.json');
  if(fs.existsSync(report))for(const p of json(report).projects??[]) {
    if(/(?:^|\/)(?:node_modules|\.git|\.hyperframes|upstream|backups?)(?:\/|$)|hyperframes-upgrade-/i.test(p.file))continue;
    add(path.join(WORKSPACE,path.dirname(p.file),'node_modules/hyperframes'));
  }
  // Include projects created after the migration inventory; never scan inside a dependency,
  // audit backup or checked-out upstream tree as if it were a user project.
  const manifests=execFileSync('rg',['--files','--hidden','--no-ignore','-g','package.json','-g','!**/node_modules/**','-g','!**/.git/**','-g','!**/.hyperframes/**','-g','!**/hyperframes-upgrade-*/**','-g','!**/backups/**','-g','!**/upstream/**','-g','!**/state/**'],{cwd:WORKSPACE,encoding:'utf8',maxBuffer:16*1024*1024}).split('\n').filter(Boolean);
  for(const file of manifests) {
    if(/(?:^|\/)[^/]*(?:backup|staging|upstream|hyperframes-upgrade)[^/]*(?:\/|$)/i.test(file))continue;
    add(path.join(WORKSPACE,path.dirname(file),'node_modules/hyperframes'));
  }
  return [...roots].sort();
}
export function prepare(root) {
  const pkg=json(path.join(root,'package.json'));
  if(pkg.name!=='hyperframes'||!/^0\.(7|8)\.\d+$/.test(pkg.version))throw new Error('Unsupported package identity/version');
  const manifestPath=path.join(STATE,'installs',hash(root).slice(0,16)+'.json');
  if(fs.existsSync(manifestPath)) {
    const prior=json(manifestPath);
    if(prior.version===pkg.version&&prior.files.every(f=>digest(path.join(root,f.path))===f.after))return {root,version:pkg.version,status:'already-branded',manifestPath};
    // npm upgrades may overwrite some or all old files. Do not auto-merge a mixed/custom installation.
    if(prior.version===pkg.version) {
      const pristine=prior.packageHash===digest(path.join(root,'package.json'))&&prior.files.every(f=>f.before===null?[null,f.after].includes(digest(path.join(root,f.path))):digest(path.join(root,f.path))===f.before);
      if(!pristine)throw new Error('Hash guard: branded installation modified; restore or review before reapplying');
    }
  }
  const htmlPath='dist/studio/index.html', html=fs.readFileSync(path.join(root,htmlPath),'utf8');
  const m=html.match(/src="(\/assets\/[^"/]+\.js)"/); if(!m)throw new Error('Unsupported Studio entry');
  const entry='dist/studio'+m[1], source=fs.readFileSync(path.join(root,entry),'utf8');
  const wordmark=fs.readFileSync(path.join(WORKSPACE,'assets/evocut/wordmark-dark.svg'));
  const wordmarkFile=`evocut-wordmark-${hash(wordmark).slice(0,12)}.svg`,wordmarkUrl='/assets/'+wordmarkFile;
  // Vite shared chunks import the entry's exports. Renaming only the entry would cause
  // those chunks to load the original entry again and mount an unbranded second app.
  // Clone and rename the WHOLE browser JS graph, including reverse imports and preload lists.
  const assetDir=path.join(root,'dist/studio/assets');
  const graph=fs.readdirSync(assetDir).filter(f=>f.endsWith('.js')&&!f.startsWith('evocut-')).sort().map(name=>({name,source:fs.readFileSync(path.join(assetDir,name),'utf8')}));
  let transformed;
  for(const file of graph){const result=patchStudio(file.source,{wordmarkUrl,requireHeader:file.name===path.basename(entry)});file.output=result.output;if(file.name===path.basename(entry))transformed=result;}
  const graphHash=hash(graph.map(f=>f.name+':'+hash(f.output)).join('\n')).slice(0,12);
  const names=new Map(graph.map(f=>[f.name,`evocut-${graphHash}-${f.name}`]));
  for(const file of graph)for(const [from,to]of names)file.output=file.output.split(from).join(to);
  const nextEntry='dist/studio/assets/'+names.get(path.basename(entry));
  const cli=patchCli(fs.readFileSync(path.join(root,'dist/cli.js'),'utf8'));
  const patchFiles=[
    ...graph.map(f=>({path:'dist/studio/assets/'+names.get(f.name),data:f.output})),
    {path:htmlPath,data:`<!-- ${NOTICE} -->\n`+html.replace(/<title>Hyper[Ff]rames Studio<\/title>/,'<title>EvoCut Studio</title>').replace(m[1],'/assets/'+path.basename(nextEntry))},
    {path:'dist/cli.js',data:cli.output},
    {path:'dist/studio/favicon.svg',data:fs.readFileSync(path.join(WORKSPACE,'assets/evocut/icon.svg'))},
    {path:'dist/studio/assets/'+wordmarkFile,data:wordmark},
    {path:'EVOCUT-MODIFICATIONS.txt',data:NOTICE+'\nLocal display fork only; no endorsement by HeyGen is implied.\nOriginal npm name, package metadata, API/runtime identifiers, notices and licenses are retained.\nSource and reproducible patch: '+path.join(WORKSPACE,'tools/evocut')+'\n'},
  ];
  const library='dist/studio/index.js';
  if(fs.existsSync(path.join(root,library))) {
    const src=fs.readFileSync(path.join(root,library),'utf8');
    // Only the readable Studio library; no SDK/player runtime bundle is rewritten.
    if(src.includes('function HyperframesLogo('))patchFiles.push({path:library,data:patchStudio(src,{wordmarkUrl}).output});
  }
  return {root,version:pkg.version,manifestPath,status:'ready',originalEntry:entry,originalEntryHash:hash(source),packageHash:digest(path.join(root,'package.json')),graphSources:graph.map(f=>({path:'dist/studio/assets/'+f.name,hash:hash(f.source)})),stats:{headers:transformed.headers,marks:transformed.marks,labels:transformed.labels,cli:cli.changes,browserModules:graph.length},files:patchFiles.map(f=>({...f,before:digest(path.join(root,f.path)),after:hash(f.data)}))};
}
export function install(plan) {
  if(plan.status!=='ready')return plan;
  const check=()=>{if(digest(path.join(plan.root,'package.json'))!==plan.packageHash||digest(path.join(plan.root,plan.originalEntry))!==plan.originalEntryHash)throw new Error('Concurrent package/entry change');for(const f of plan.graphSources??[])if(digest(path.join(plan.root,f.path))!==f.hash)throw new Error('Concurrent browser module change');for(const f of plan.files)if(digest(path.join(plan.root,f.path))!==f.before)throw new Error('Concurrent file change: '+f.path);};
  check();
  const backupRoot=path.join(STATE,'backups',hash(plan.root).slice(0,16),`${plan.version}-${Date.now()}`);
  for(const f of plan.files)if(f.before!==null)write(path.join(backupRoot,f.path),fs.readFileSync(path.join(plan.root,f.path)));
  check();const applied=[];
  try {
    for(const f of plan.files) { if(digest(path.join(plan.root,f.path))!==f.before)throw new Error('Concurrent file change: '+f.path); write(path.join(plan.root,f.path),f.data); applied.push(f); }
    const manifest={...plan,backupRoot,status:'branded',completedAt:new Date().toISOString(),files:plan.files.map(({data,...f})=>f)};
    write(plan.manifestPath,JSON.stringify(manifest,null,2)+'\n');return manifest;
  } catch(error) {
    for(const f of applied.reverse()) { const dest=path.join(plan.root,f.path);if(digest(dest)!==f.after)continue;if(f.before===null)fs.unlinkSync(dest);else write(dest,fs.readFileSync(path.join(backupRoot,f.path))); }
    throw error;
  }
}
export function restore(manifestPath) {
  const m=json(manifestPath);for(const f of m.files)if(digest(path.join(m.root,f.path))!==f.after)throw new Error('Restore hash conflict: '+f.path);
  for(const f of m.files)if(f.before!==null&&digest(path.join(m.backupRoot,f.path))!==f.before)throw new Error('Backup hash mismatch: '+f.path);
  for(const f of [...m.files].reverse()) {const dest=path.join(m.root,f.path);if(f.before===null)fs.unlinkSync(dest);else{const b=fs.readFileSync(path.join(m.backupRoot,f.path));if(hash(b)!==f.before)throw new Error('Backup hash mismatch');write(dest,b);}}
  fs.renameSync(manifestPath,manifestPath+'.restored-'+Date.now());return {root:m.root,status:'restored'};
}
export function main(argv=process.argv.slice(2)) {
  if(argv[0]==='restore') {console.log(JSON.stringify(restore(argv[1]),null,2));return;}
  const apply=argv.includes('--apply'), roots=argv.includes('--root')?[path.resolve(argv[argv.indexOf('--root')+1])]:discover();
  fs.mkdirSync(STATE,{recursive:true});const lock=path.join(STATE,'brand.lock');
  const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,started:new Date().toISOString()}));
  const result=[];
  try {for(const root of roots) {try{const p=prepare(root);const r=apply?install(p):p;const {files,...small}=r;result.push({...small,files:files?.map(({data,...f})=>f)});console.log(JSON.stringify({root,version:r.version,status:r.status,stats:r.stats}));}catch(e){result.push({root,status:'guard-skipped',error:e.message});console.error(JSON.stringify(result.at(-1)));}}
    const report={brand:'EvoCut',at:new Date().toISOString(),apply,results:result};write(path.join(STATE,apply?'report.json':'plan.json'),JSON.stringify(report,null,2)+'\n');
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main();
