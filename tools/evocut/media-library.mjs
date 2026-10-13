#!/usr/bin/env node
/** Offline, explicit-selection media library. Never downloads or edits upstream manifests. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const SYNONYMS = [
  ['transition','转场','过渡','切换','whoosh','swoosh','swipe','sweep'],
  ['cash-register','收银机','收银','结账','cash register','cashier','checkout','till','ka-ching','kaching','cha-ching'],
  ['coin','硬币','金币','钱币','零钱','coin','coins','coin drop'],
  ['upbeat','欢快','欢乐','轻快','愉快','开心','upbeat','cheerful','playful','happy','joyful'],
  ['click','点击','按钮','click','tap'],
  ['impact','撞击','冲击','重击','impact','hit','slam'],
  ['notification','提示','通知','提醒','notification','alert','ping'],
  ['sparkle','闪光','闪耀','魔法','sparkle','shimmer','magic'],
  ['typing','打字','键盘','typing','keyboard','keystroke'],
  ['wind','风声','风','wind','breeze'],
  ['footsteps','脚步','脚步声','footstep','footsteps','walking'],
  ['calm','舒缓','平静','安静','calm','gentle','peaceful','relaxing'],
  ['cinematic','电影感','史诗','cinematic','epic'],
];
const TYPES = new Set(['bgm','sfx','voice','video','image','icon','logo','lut','grade']);
const TYPE_ALIASES = {music:'bgm',音乐:'bgm',配乐:'bgm',音效:'sfx',旁白:'voice',人声:'voice',视频:'video',图片:'image'};
const MEDIA_EXTS = new Set('.mp3 .wav .m4a .aac .ogg .flac .opus .mp4 .mov .m4v .webm .png .jpg .jpeg .gif .webp .avif .svg .cube'.split(' '));
const PREVIEW = {'.mp3':'audio','.wav':'audio','.m4a':'audio','.aac':'audio','.ogg':'audio','.flac':'audio','.opus':'audio','.mp4':'video','.mov':'video','.m4v':'video','.webm':'video','.png':'img','.jpg':'img','.jpeg':'img','.gif':'img','.webp':'img','.avif':'img'};
export const hash = data => createHash('sha256').update(data).digest('hex');
const hashFile = file => hash(fs.readFileSync(file));
const text = value => typeof value === 'string' ? value.slice(0,4000) : '';
const norm = value => String(value ?? '').normalize('NFKC').toLowerCase().trim();
const within = (root,target) => {const rel=path.relative(root,target);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
const shellQuote = value => "'"+String(value).replaceAll("'","'\\''")+"'";
export const escapeHtml = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Only manifest-owned, regular media files under the named root are exposed. */
export function verifiedFile(root, requested, expectedSha=null) {
  if (!requested || typeof requested!=='string' || requested.includes('\0') || /^[a-z]+:\/\//i.test(requested)) throw new Error('invalid local media path');
  const base=fs.realpathSync(root), candidate=path.resolve(root,requested);
  if (!within(path.resolve(root),candidate)) throw new Error('path escapes library root');
  const resolved=fs.realpathSync(candidate);
  if (!within(base,resolved)) throw new Error('symlink escapes library root');
  const stat=fs.statSync(resolved);
  if (!stat.isFile() || !MEDIA_EXTS.has(path.extname(resolved).toLowerCase())) throw new Error('not a supported regular media file');
  const sha=hashFile(resolved);
  if (expectedSha && (!/^[a-f0-9]{64}$/i.test(expectedSha)||sha!==expectedSha.toLowerCase())) throw new Error('stale content SHA mismatch');
  return {path:resolved,sha256:sha,size:stat.size,verified:true};
}

function readJson(file,fallback) {return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback;}
export function settings(opts={}) {
  const releaseBundle=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../skills/media-use/audio/assets/sfx');
  const defaultBundle=fs.existsSync(path.join(releaseBundle,'manifest.json'))?releaseBundle:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'skills-src/media-use/audio/assets/sfx');
  return {home:path.resolve(opts.home??process.env.EVOCUT_HOME??path.join(os.homedir(),'.config','evocut')),
    mediaHome:path.resolve(opts.mediaHome??path.join(os.homedir(),'.media')),
    project:opts.project?path.resolve(opts.project):null,
    bundledDir:opts.bundledDir===false?null:path.resolve(opts.bundledDir??defaultBundle)};
}
export function readState(home) {
  const file=path.join(home,'media','library.json');
  const data=readJson(file,{version:1,tags:{},imports:[]});
  if(data.version!==1||!data.tags||typeof data.tags!=='object'||Array.isArray(data.tags)||!Array.isArray(data.imports))throw new Error('Unsupported media sidecar schema');
  return {file,data,revision:fs.existsSync(file)?hashFile(file):'missing'};
}
function declaredLicense(record,scope,bundledDir) {
  const name=text(typeof record.license==='string'?record.license:record.license?.name);
  if(name)return {status:'declared-unverified',name,evidence:'manifest declaration; no rights verification performed'};
  if(scope==='bundled'&&fs.existsSync(path.join(bundledDir,'CREDITS.md')))return {status:'declared-unverified',name:'See bundle credits',evidence:path.join(bundledDir,'CREDITS.md')};
  return {status:'unknown',name:null,evidence:null};
}
function entries(file,issues) {
  if(!fs.existsSync(file))return [];
  if(fs.statSync(file).size>16*1024*1024)throw new Error('Manifest exceeds 16 MiB read limit');
  return fs.readFileSync(file,'utf8').split(/\r?\n/).flatMap((line,index)=>{
    if(!line.trim())return [];
    try {const record=JSON.parse(line);if(!record||typeof record!=='object'||Array.isArray(record))throw Error();return [{record,line:index+1}];}
    catch {issues.push({scope:'manifest',manifest:file,line:index+1,reason:'malformed record'});return [];}
  });
}
function matchingConcepts(value) {
  const s=norm(value);
  return new Set(SYNONYMS.filter(group=>group.some(term=>{
    if(/[\u3400-\u9fff]/.test(term))return s.includes(term);
    return new RegExp('(?:^|[^a-z0-9])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])','i').test(s);
  })).map(group=>group[0]));
}
export function scoreAsset(asset,query) {
  const q=norm(query);if(!q)return 0;
  const hay=norm([asset.description,...asset.aliases.map(a=>a.id),...asset.tags,path.basename(asset.path)].join(' '));
  const concepts=matchingConcepts(q), have=matchingConcepts(hay);
  const qWords=q.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g)??[];
  const words=qWords.filter(word=>!['a','the','and','or','of','for','sfx','music','sound','effect'].includes(word));
  let score=hay.includes(q)?100:0;
  for(const concept of concepts)if(have.has(concept))score+=30;
  for(const word of words)if(hay.includes(word))score+=5;
  if(!concepts.size&&!words.length&&hay.includes(q))score+=20;
  return score;
}

/** All read-only: hashes actual bytes, reports stale records, collapses duplicate content. */
export function loadLibrary(options={}) {
  const opts=settings(options), state=readState(opts.home), issues=[], found=[];
  function add(record,scope,root,manifest,line,requested) {
    try {
      if(scope==='global'&&record.reusable===false)return;
      const type=TYPE_ALIASES[record.type]??record.type;
      if(!TYPES.has(type))throw new Error('unsupported asset type');
      const checked=verifiedFile(root,requested,record.sha256??record.sha??null);
      const description=text(record.description)||text(record.provenance?.prompt)||text(record.id)||path.basename(checked.path);
      found.push({...checked,type,types:[type],description,duration:Number.isFinite(record.duration)?record.duration:null,
        tags:[],aliases:[{scope,id:text(record.id)||path.basename(checked.path)}],
        sources:[{scope,manifest,line,provider:text(record.provenance?.provider)||text(record.source)||'unknown'}],
        license:declaredLicense(record,scope,opts.bundledDir)});
    } catch(e) {issues.push({scope,id:text(record.id),manifest,line,reason:e.code==='ENOENT'?'missing media file':e.message});}
  }
  const globalManifest=path.join(opts.mediaHome,'manifest.jsonl');
  for(const {record,line} of entries(globalManifest,issues))add(record,'global',opts.mediaHome,globalManifest,line,record.cached_path??record.path);
  if(opts.project) {
    const manifest=path.join(opts.project,'.media','manifest.jsonl');
    for(const {record,line} of entries(manifest,issues))add(record,'project',opts.project,manifest,line,record.path);
  }
  if(opts.bundledDir) {
    const manifest=path.join(opts.bundledDir,'manifest.json');
    if(fs.existsSync(manifest)) {
      try {for(const [id,r] of Object.entries(readJson(manifest,{})))add({...r,id,type:'sfx',provenance:{provider:'bundled.sfx'}},'bundled',opts.bundledDir,manifest,null,r.file);}
      catch(e){issues.push({scope:'bundled',manifest,reason:e.message});}
    } else issues.push({scope:'bundled',manifest,reason:'bundled manifest not installed'});
  }
  const bySha=new Map();
  for(const item of found) {
    const current=bySha.get(item.sha256);
    if(current){current.aliases.push(...item.aliases);current.sources.push(...item.sources);current.types=[...new Set([...current.types,item.type])];if(!current.description.includes(item.description))current.description+=' | '+item.description;if(current.license.status==='unknown'&&item.license.status!=='unknown')current.license=item.license;}
    else bySha.set(item.sha256,item);
  }
  for(const [sha,item] of bySha) {
    item.id='sha256:'+sha;
    item.tags=Array.isArray(state.data.tags[sha]?.tags)?state.data.tags[sha].tags.filter(x=>typeof x==='string'):[];
    item.duplicateRecords=item.sources.length-1;
  }
  return {assets:[...bySha.values()],issues,revision:state.revision,options:opts,
    summary:{verifiedUniqueFiles:bySha.size,validRecords:found.length,duplicateRecords:found.length-bySha.size,rejectedRecords:issues.length},
    rightsNotice:'A verified path/hash is not a license grant. Unknown/declaration-only rights require user review.'};
}
export function searchLibrary(library,{query='',type,scope,limit=100}={}) {
  const filterType=TYPE_ALIASES[type]??type;
  if(filterType&&!TYPES.has(filterType))throw new Error('Unknown --type');
  if(scope&&!['global','project','bundled'].includes(scope))throw new Error('Unknown --scope');
  if(!Number.isInteger(limit)||limit<1||limit>10000)throw new Error('--limit must be 1..10000');
  return library.assets.filter(a=>(!filterType||a.types.includes(filterType))&&(!scope||a.sources.some(s=>s.scope===scope)))
    .map(a=>({...a,score:scoreAsset(a,query)})).filter(a=>!query||a.score>0)
    .sort((a,b)=>b.score-a.score||a.description.localeCompare(b.description,'zh-Hans')).slice(0,limit);
}
export function selectAsset(library,{sha,id}={}) {
  if(Boolean(sha)===Boolean(id))throw new Error('Choose exactly one explicit --sha or --id');
  if(sha&&!/^[a-f0-9]{12,64}$/i.test(sha))throw new Error('--sha needs at least 12 hexadecimal characters');
  const rows=library.assets.filter(a=>sha?a.sha256.startsWith(sha.toLowerCase()):a.id===id||a.aliases.some(x=>x.id===id||`${x.scope}:${x.id}`===id));
  if(rows.length!==1)throw new Error(rows.length?'Ambiguous selection; use full --sha':'Asset not found or no longer verified');
  return rows[0];
}

/** Reject symlinks in every existing writable ancestor; never follow an output symlink. */
function writablePath(file) {
  let absolute=path.resolve(file);
  // macOS system aliases are not user-controlled output symlinks.
  if(process.platform==='darwin')for(const alias of ['/var','/tmp','/etc'])if((absolute===alias||absolute.startsWith(alias+'/'))&&fs.realpathSync(alias)==='/private'+alias)absolute='/private'+absolute;
  let current=path.parse(absolute).root;
  for(const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);
    if(fs.existsSync(current)||(()=>{try{return fs.lstatSync(current).isSymbolicLink();}catch{return false;}})()) {
      if(fs.lstatSync(current).isSymbolicLink())throw new Error('Symlink output path refused');
    }
  }
  return absolute;
}
function revision(file){return fs.existsSync(file)?hashFile(file):'missing';}
function expectRevision(file,expected) {if(!expected)throw new Error('Mutation requires --expect revision (use missing for a new sidecar)');if(revision(file)!==expected)throw new Error('CAS conflict: file changed since inspection');}
function atomicWrite(file,bytes) {
  writablePath(file);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temporary=file+'.tmp-'+randomUUID();
  try {fs.writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}finally{fs.rmSync(temporary,{force:true});}
}
function locked(home,operation) {
  const directory=writablePath(path.join(home,'media'));fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const lock=writablePath(path.join(directory,'.lock'));let fd;
  try {fd=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('Media mutation already locked; inspect a stale lock manually');throw e;}
  try{return operation();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function transaction(home,expected,action,mutate,assetWrite=null) {
  return locked(home,()=>{
    const state=readState(home);writablePath(state.file);expectRevision(state.file,expected);
    const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
    const backup=writablePath(path.join(home,'media','backups',id));fs.mkdirSync(backup,{recursive:true,mode:0o700});
    const ledger=writablePath(path.join(home,'media','ledger.jsonl'));
    if(fs.existsSync(state.file))fs.copyFileSync(state.file,path.join(backup,'library-before.json'));
    const next=structuredClone(state.data);mutate(next);
    const bytes=JSON.stringify(next,null,2)+'\n';
    if(assetWrite){writablePath(assetWrite.file);expectRevision(assetWrite.file,assetWrite.expected);if(fs.existsSync(assetWrite.file))fs.copyFileSync(assetWrite.file,path.join(backup,'asset-before'+path.extname(assetWrite.file)));}
    const record={transaction:id,at:new Date().toISOString(),action,before:state.revision,after:hash(bytes),backup,
      ...(assetWrite?{destination:assetWrite.file,destinationBefore:assetWrite.expected,destinationAfter:hash(assetWrite.bytes)}:{})};
    fs.appendFileSync(ledger,JSON.stringify({...record,phase:'prepare'})+'\n',{mode:0o600});
    expectRevision(state.file,expected);
    if(assetWrite){expectRevision(assetWrite.file,assetWrite.expected);atomicWrite(assetWrite.file,assetWrite.bytes);}
    try{expectRevision(state.file,expected);atomicWrite(state.file,bytes);}
    catch(e){fs.appendFileSync(ledger,JSON.stringify({...record,phase:'incomplete',error:e.message})+'\n');throw new Error('Incomplete transaction; inspect backup/ledger before retry: '+e.message);}
    fs.appendFileSync(ledger,JSON.stringify({...record,phase:'commit'})+'\n');
    return {revision:hash(bytes),transaction:id,backup,ledger};
  });
}
export function setTags(library,selection,tags,expected) {
  const asset=selectAsset(library,selection);
  if(!Array.isArray(tags)||tags.length>40||tags.some(x=>typeof x!=='string'||!x.trim()||x.length>80||/[\x00-\x1f]/.test(x)))throw new Error('Tags must be 0..40 nonempty strings of at most 80 characters');
  const unique=[...new Set(tags.map(x=>x.trim()))];
  return {sha256:asset.sha256,tags:unique,...transaction(library.options.home,expected,'set-tags',state=>{state.tags[asset.sha256]={tags:unique,updatedAt:new Date().toISOString()};})};
}
export function importAsset(library,selection,{project,to,expect,expectDest='missing'}={}) {
  if(!project)throw new Error('--project is required for explicit import');
  const root=fs.realpathSync(project), asset=selectAsset(library,selection);
  const bytes=fs.readFileSync(asset.path);if(hash(bytes)!==asset.sha256)throw new Error('Source changed after inspection');
  const basename=path.basename(asset.path).replace(/[^\p{L}\p{N}._-]/gu,'_');
  const relative=to??path.join('assets','evocut',asset.type,asset.sha256.slice(0,16)+'-'+basename);
  if(path.isAbsolute(relative)||relative.includes('\0')||relative.split(/[\\/]/).includes('..'))throw new Error('Import destination must be a project-relative assets path');
  const destination=path.resolve(root,relative);
  if(!within(path.join(root,'assets'),destination)||destination===path.join(root,'assets'))throw new Error('Import destination must stay inside project/assets');
  if(path.extname(destination).toLowerCase()!==path.extname(asset.path).toLowerCase())throw new Error('Import must preserve the media extension');
  writablePath(destination);
  const existing=revision(destination);
  if(existing===asset.sha256) {
    if(expectDest!=='missing'&&expectDest!==existing)throw new Error('CAS conflict: unexpected existing destination');
    return {alreadyPresent:true,path:destination,sha256:existing,revision:readState(library.options.home).revision,license:asset.license};
  }
  const record={sha256:asset.sha256,source:asset.path,project:root,path:destination,license:asset.license,at:new Date().toISOString()};
  return {...record,alreadyPresent:false,...transaction(library.options.home,expect,'import',state=>state.imports.push(record),{file:destination,bytes,expected:expectDest})};
}
export function catalogHtml(assets) {
  const cards=assets.map(asset=>{
    const tag=PREVIEW[path.extname(asset.path).toLowerCase()];
    const url=escapeHtml(pathToFileURL(asset.path).href);
    const preview=tag==='img'?`<img loading="lazy" src="${url}" alt="${escapeHtml(asset.description)}">`:tag?`<${tag} controls preload="none" src="${url}"></${tag}>`:'<p>No inline preview for this file type.</p>';
    return `<article><h2>${escapeHtml(asset.description)}</h2><p>${escapeHtml(asset.types.join(', '))} · ${escapeHtml(asset.tags.join(' / '))}</p>${preview}<p>License: ${escapeHtml(asset.license.status)} — ${escapeHtml(asset.license.name??'unknown')}</p><code>${escapeHtml(asset.sha256)}</code><p>${escapeHtml(asset.path)}</p></article>`;
  }).join('\n');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file:; img-src file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EvoCut 本地素材库</title><style>body{font:16px system-ui;max-width:1050px;margin:36px auto;padding:0 20px;background:#171923;color:#eee}article{padding:18px;margin:18px 0;background:#242838;border-radius:12px;overflow-wrap:anywhere}h2{font-size:18px}audio,video,img{max-width:100%;max-height:360px}code{font-size:12px}p{color:#ccc}</style><h1>EvoCut 本地素材库</h1><p>仅显示已验证文件。未下载、未自动选用。许可 unknown/declared-unverified 均不代表已获授权。浏览器可能限制本地媒体预览，可使用列出的路径打开。</p>${cards}</html>`;
}
export function writeCatalog(library,assets,output,expected='missing') {
  if(!output)throw new Error('--output is required');
  const file=writablePath(output);if(path.extname(file).toLowerCase()!=='.html')throw new Error('Catalog output must be .html');
  expectRevision(file,expected);
  for(const asset of assets)if(hashFile(asset.path)!==asset.sha256)throw new Error('Source changed after inspection');
  atomicWrite(file,catalogHtml(assets));
  return {path:file,url:pathToFileURL(file).href,assets:assets.length,sha256:hashFile(file),static:true};
}

const HELP = `evocut assets list|search [query] [--type sfx|bgm|video|image] [--scope global|project|bundled]
  [--project DIR] [--home DIR] [--media-home DIR] [--bundled-dir DIR|none] [--limit N]
evocut assets tag --sha SHA --tags '转场,短促' --expect REVISION
evocut assets untag --sha SHA --expect REVISION
evocut assets import --sha SHA --project DIR --expect REVISION [--to assets/... --expect-dest SHA|missing]
evocut assets catalog --output catalog.html [search/filter flags] [--expect-output SHA|missing]
No downloads, synthesis, automatic asset choice, license grant, or upstream manifest writes.`;
function parse(argv) {
  const opts={},pos=[];const booleans=new Set(['json','help']);
  const allowed=new Set(['type','scope','project','home','media-home','bundled-dir','limit','sha','id','tags','expect','to','expect-dest','output','expect-output','query']);
  for(let i=0;i<argv.length;i++) {
    const arg=argv[i];if(!arg.startsWith('--')){pos.push(arg);continue;}
    const equal=arg.indexOf('='),key=arg.slice(2,equal<0?undefined:equal);
    if(booleans.has(key)){opts[key]=true;continue;}
    if(!allowed.has(key))throw new Error('Unknown option --'+key);
    const value=equal<0?argv[++i]:arg.slice(equal+1);if(value==null||value.startsWith('--'))throw new Error('--'+key+' needs a value');opts[key]=value;
  }
  return {command:pos.shift()??'list',query:opts.query??pos.join(' '),opts};
}
export async function run(argv=[]) {
  const {command,query,opts}=parse(argv);if(opts.help||command==='help')return {help:HELP};
  if(!['list','search','tag','untag','import','catalog'].includes(command))throw new Error('Unknown assets command');
  const library=loadLibrary({home:opts.home,mediaHome:opts['media-home'],project:opts.project,bundledDir:opts['bundled-dir']==='none'?false:opts['bundled-dir']});
  const selection={sha:opts.sha,id:opts.id};
  if(command==='tag'&&!Object.hasOwn(opts,'tags'))throw new Error('tag requires --tags; use untag to clear');
  if(command==='tag'||command==='untag')return {ok:true,...setTags(library,selection,command==='untag'?[]:(opts.tags??'').split(/[,，]/).map(x=>x.trim()).filter(Boolean),opts.expect)};
  if(command==='import')return {ok:true,...importAsset(library,selection,{project:opts.project,to:opts.to,expect:opts.expect,expectDest:opts['expect-dest']??'missing'})};
  const assets=searchLibrary(library,{query,type:opts.type,scope:opts.scope,limit:opts.limit?Number(opts.limit):100});
  if(command==='catalog')return {ok:true,...writeCatalog(library,assets,opts.output,opts['expect-output']??'missing'),issues:library.issues};
  // Freeze the effective lookup/config roots, including environment/default roots.
  // Copying this template must not silently switch to a different global library.
  const roots=library.options;
  const importTemplate=`evocut assets import --sha <SELECTED_SHA> --project ${roots.project?shellQuote(roots.project):'<DIR>'} --expect ${shellQuote(library.revision)} --home ${shellQuote(roots.home)} --media-home ${shellQuote(roots.mediaHome)} --bundled-dir ${shellQuote(roots.bundledDir??'none')}`;
  return {ok:true,revision:library.revision,summary:library.summary,assets,issues:library.issues,rightsNotice:library.rightsNotice,
    selectionRequired:true,importTemplate};
}
export async function main(argv=process.argv.slice(2)) {
  try {console.log(JSON.stringify(await run(argv),null,2));return 0;}
  catch(e){console.error(JSON.stringify({ok:false,error:e.message}));return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
