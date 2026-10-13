#!/usr/bin/env node
/** Explicit, offline voice identity profiles. No provider calls or default voice inference. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash=file=>hash(fs.readFileSync(file));
const AUDIO_EXT=new Set('.mp3 .wav .m4a .flac .ogg .opus .aac .mp4 .mov .webm'.split(' '));
const ID=/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u;
const POLICY=Object.freeze({allow_voice_substitution:false,allow_extra_dialogue:false,allow_provider_fallback:false});
export function configHome(options={}) {return path.resolve(options.home??process.env.EVOCUT_HOME??path.join(os.homedir(),'.config','evocut'));}
function safePath(file) {
  let absolute=path.resolve(file);
  if(process.platform==='darwin')for(const alias of ['/var','/tmp','/etc'])if((absolute===alias||absolute.startsWith(alias+'/'))&&fs.realpathSync(alias)==='/private'+alias)absolute='/private'+absolute;
  let current=path.parse(absolute).root;
  for(const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);
    try {if(fs.lstatSync(current).isSymbolicLink())throw new Error('Symlink profile/output path refused');}
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return absolute;
}
function profilePath(home,id) {if(!ID.test(id??''))throw new Error('Profile ID must be 1..64 letters/numbers/dot/underscore/hyphen, starting with letter/number');return safePath(path.join(home,'voices',id+'.json'));}
function rejectUnknown(object,keys) {if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(object).some(k=>!keys.includes(k)))throw new Error('Unsupported configuration fields; credentials and arbitrary provider parameters are not accepted');}
function bounded(value,name,max=160) {if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>max||/[\x00-\x1f]/.test(value))throw new Error('Invalid '+name);return value;}
export function referenceInfo(reference) {
  if(reference==null)return null;
  rejectUnknown(reference,['path','sha256']);bounded(reference.path,'reference path',4096);
  if(!path.isAbsolute(reference.path))throw new Error('Reference path must be explicit and absolute');
  const actual=fs.realpathSync(reference.path);
  if(!AUDIO_EXT.has(path.extname(actual).toLowerCase())||!fs.statSync(actual).isFile())throw new Error('Reference must be a regular local audio/video file');
  const sha256=fileHash(actual);
  if(reference.sha256&&reference.sha256!==sha256)throw new Error('Reference changed: SHA mismatch');
  return {path:actual,sha256};
}
function pronunciations(rules=[]) {
  if(!Array.isArray(rules)||rules.length>100)throw new Error('Pronunciation rules must be an array of at most 100 literal replacements');
  const seen=new Set();
  return rules.map(rule=>{
    rejectUnknown(rule,['from','to']);bounded(rule.from,'pronunciation from',80);bounded(rule.to,'pronunciation to',80);
    if(seen.has(rule.from))throw new Error('Duplicate pronunciation source');seen.add(rule.from);
    if(/[\r\n。！？!?;]/.test(rule.from+rule.to))throw new Error('Pronunciation rules cannot add sentence boundaries or dialogue lines');
    return {from:rule.from,to:rule.to};
  });
}
export function normalizeProfile(input) {
  rejectUnknown(input,['version','id','provider','voice_id','lang','speed','reference','pronunciation','policy','registered_at','updated_at']);
  if(!ID.test(input.id??''))throw new Error('Invalid profile ID');
  const provider=bounded(input.provider,'provider',80),voice_id=bounded(input.voice_id,'voice_id',160),lang=bounded(input.lang,'lang',32);
  if(!/^[a-z0-9][a-z0-9._-]*$/i.test(provider)||!/^[-a-z0-9]+$/i.test(lang))throw new Error('Invalid provider or language identifier');
  if(typeof input.speed!=='number'||!Number.isFinite(input.speed)||input.speed<0.5||input.speed>2)throw new Error('Speed must be an explicit number from 0.5 to 2');
  if(input.version!=null&&input.version!==1)throw new Error('Unsupported profile version');
  if(input.policy&&JSON.stringify(Object.entries(input.policy).sort())!==JSON.stringify(Object.entries(POLICY).sort()))throw new Error('Voice identity/no-extra-dialogue policy cannot be weakened');
  return {version:1,id:input.id,provider,voice_id,lang,speed:input.speed,
    reference:referenceInfo(input.reference),pronunciation:pronunciations(input.pronunciation),policy:{...POLICY}};
}
export function readProfile(home,id,{checkReference=true}={}) {
  const file=profilePath(home,id);if(!fs.existsSync(file))throw new Error('Voice profile not registered; no default or legacy voice will be inferred');
  if(fs.statSync(file).size>1024*1024)throw new Error('Profile exceeds 1 MiB limit');
  const raw=fs.readFileSync(file),profile=JSON.parse(raw);
  // To show/list stale references, validate structure with reference omitted, retaining its stored binding.
  const validated=normalizeProfile(checkReference?profile:{...profile,reference:null});
  if(profile.id!==id)throw new Error('Profile filename/ID mismatch');
  if(!checkReference&&profile.reference!=null){rejectUnknown(profile.reference,['path','sha256']);bounded(profile.reference.path,'reference path',4096);if(!/^[a-f0-9]{64}$/.test(profile.reference.sha256??''))throw new Error('Invalid stored reference SHA');validated.reference=profile.reference;}
  return {profile:{...validated,registered_at:profile.registered_at,updated_at:profile.updated_at},revision:hash(raw),path:file};
}
function revision(file){return fs.existsSync(file)?fileHash(file):'missing';}
function compare(file,expected){if(!expected)throw new Error('Mutation requires --expect revision (missing for first registration)');if(revision(file)!==expected)throw new Error('CAS conflict: voice profile changed');}
function atomicWrite(file,bytes){const p=safePath(file),temporary=p+'.tmp-'+randomUUID();fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});try{fs.writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});fs.renameSync(temporary,p);}finally{fs.rmSync(temporary,{force:true});}}
function mutate(home,id,expected,operation,build) {
  const dir=safePath(path.join(home,'voices'));fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const lock=safePath(path.join(dir,'.lock'));let fd;
  try{fd=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('Voice configuration locked; inspect stale lock manually');throw e;}
  try{
    const file=profilePath(home,id);compare(file,expected);
    const before=fs.existsSync(file)?fs.readFileSync(file):null;
    const next=build(before?JSON.parse(before):null),after=next==null?null:Buffer.from(JSON.stringify(next,null,2)+'\n');
    const transaction=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
    const backup=safePath(path.join(dir,'backups',transaction));fs.mkdirSync(backup,{recursive:true,mode:0o700});
    if(before)fs.writeFileSync(path.join(backup,id+'.json'),before,{flag:'wx',mode:0o600});
    const ledger=safePath(path.join(dir,'ledger.jsonl'));
    const event={at:new Date().toISOString(),transaction,operation,id,before:expected,after:after?hash(after):'missing',backup};
    fs.appendFileSync(ledger,JSON.stringify({...event,phase:'prepare'})+'\n',{mode:0o600});compare(file,expected);
    if(after)atomicWrite(file,after);else fs.unlinkSync(file);
    fs.appendFileSync(ledger,JSON.stringify({...event,phase:'commit'})+'\n');
    return {id,revision:event.after,backup,ledger,transaction,...(next?{profile:next}:{deleted:true})};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
export function registerProfile(home,input,{expect,update=false}={}) {
  const profile=normalizeProfile(input);
  return mutate(home,profile.id,expect,update?'update':'register',existing=>{
    if(update&&!existing)throw new Error('Cannot update an unregistered voice');
    if(!update&&existing)throw new Error('Already registered; use update with CAS');
    if(existing&&(existing.provider!==profile.provider||existing.voice_id!==profile.voice_id))throw new Error('Voice identity override refused; explicitly register a different profile ID');
    const now=new Date().toISOString();return {...profile,registered_at:existing?.registered_at??now,updated_at:now};
  });
}
export function deleteProfile(home,id,expect){return mutate(home,id,expect,'delete',existing=>{if(!existing)throw new Error('Voice profile not registered');return null;});}
export function listProfiles(home) {
  const dir=safePath(path.join(home,'voices'));if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir).filter(name=>name.endsWith('.json')).sort().map(name=>{
    const id=name.slice(0,-5);try{const r=readProfile(home,id,{checkReference:false});let referenceStatus='not-configured';if(r.profile.reference){try{referenceInfo(r.profile.reference);referenceStatus='verified';}catch{referenceStatus='changed-or-missing';}}return {id,provider:r.profile.provider,voice_id:r.profile.voice_id,lang:r.profile.lang,speed:r.profile.speed,revision:r.revision,referenceStatus};}
    catch(e){return {id,error:e.message};}
  });
}
export function transformText(input,rules=[]) {
  if(typeof input!=='string'||!input.trim()||input.length>100000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input))throw new Error('Text must be nonempty, at most 100000 characters, without control bytes');
  const normalized=pronunciations(rules).sort((a,b)=>b.from.length-a.from.length),changes=[];
  let output='';
  for(let at=0;at<input.length;) {
    const rule=normalized.find(r=>input.startsWith(r.from,at));
    if(rule){changes.push({offset:at,from:rule.from,to:rule.to});output+=rule.to;at+=rule.from.length;}else output+=input[at++];
  }
  return {text:output,changes};
}
export function prepareRequest(home,id,text,options={}) {
  const loaded=readProfile(home,id),p=loaded.profile;
  if(options.expect&&options.expect!==loaded.revision)throw new Error('CAS conflict: voice profile changed before request preparation');
  for(const key of ['provider','voice_id','lang','speed'])if(options[key]!=null&&options[key]!==p[key])throw new Error('Voice override refused: update/register an explicit profile instead');
  const transformed=transformText(text,p.pronunciation);
  return {kind:'evocut-neutral-voice-request',version:1,profile_id:id,profile_revision:loaded.revision,
    provider:p.provider,voice_id:p.voice_id,lang:p.lang,speed:p.speed,reference:p.reference,
    original_text:text,original_text_sha256:hash(text),text:transformed.text,text_sha256:hash(transformed.text),pronunciation_changes:transformed.changes,
    policy:{...POLICY},execution:{synthesis_requested:false,network_calls:0,paid_calls:0},
    notice:'Preparation only. No provider invocation, voice identity listening verification, or guaranteed pronunciation quality.'};
}
const HELP=`evocut voice register --file profile.json --expect missing [--home DIR]
evocut voice update --file profile.json --expect REVISION [--home DIR]
evocut voice list | show --id ID | validate --id ID
evocut voice delete --id ID --expect REVISION
evocut voice prepare-neutral-request --id ID --text-file script.txt [--expect REVISION]
Profiles never infer legacy/default voices. Credentials are not accepted. No synthesis or downloads.`;
function parse(argv){
  const pos=[],opts={};const allowed=new Set(['home','id','file','expect','text','text-file','provider','voice-id','lang','speed']);
  for(let i=0;i<argv.length;i++){const a=argv[i];if(!a.startsWith('--')){pos.push(a);continue;}const equal=a.indexOf('='),k=a.slice(2,equal<0?undefined:equal);if(['json','help'].includes(k)){opts[k]=true;continue;}if(!allowed.has(k))throw new Error('Unknown voice option');const v=equal<0?argv[++i]:a.slice(equal+1);if(v==null||v.startsWith('--'))throw new Error('Voice option requires a value');opts[k]=v;}
  if(pos.length>1)throw new Error('Unexpected voice positional arguments');return {command:pos[0]??'list',opts};
}
export async function run(argv=[]) {
  const {command,opts}=parse(argv);if(opts.help||command==='help')return {help:HELP};const home=configHome(opts);
  if(command==='list')return {ok:true,profiles:listProfiles(home),default_profile:null};
  if(command==='register'||command==='update'){
    if(!opts.file)throw new Error('--file is required for explicit registration');
    if(fs.statSync(opts.file).size>1024*1024)throw new Error('Profile input exceeds 1 MiB');
    const input=JSON.parse(fs.readFileSync(opts.file,'utf8'));if(opts.id&&opts.id!==input.id)throw new Error('Explicit profile ID mismatch');
    return {ok:true,...registerProfile(home,input,{expect:opts.expect,update:command==='update'})};
  }
  if(command==='show')return {ok:true,...readProfile(home,opts.id,{checkReference:false})};
  if(command==='validate')return {ok:true,...readProfile(home,opts.id),reference_binding:'checked-if-configured',provider_connectivity:'not-tested',synthesis_performed:false};
  if(command==='delete')return {ok:true,...deleteProfile(home,opts.id,opts.expect)};
  if(command==='prepare-neutral-request'||command==='prepare'){
    if(Boolean(opts.text)===Boolean(opts['text-file']))throw new Error('Provide exactly one --text or --text-file');
    if(opts['text-file']&&(!fs.statSync(opts['text-file']).isFile()||fs.statSync(opts['text-file']).size>1024*1024))throw new Error('Text input must be a regular file <= 1 MiB');
    const input=opts.text??fs.readFileSync(opts['text-file'],'utf8');
    return {ok:true,...prepareRequest(home,opts.id,input,{expect:opts.expect,provider:opts.provider,voice_id:opts['voice-id'],lang:opts.lang,speed:opts.speed==null?undefined:Number(opts.speed)})};
  }
  throw new Error('Unknown voice command');
}
export async function main(argv=process.argv.slice(2)) {try{console.log(JSON.stringify(await run(argv),null,2));return 0;}catch(e){console.error(JSON.stringify({ok:false,error:e.message}));return 1;}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
