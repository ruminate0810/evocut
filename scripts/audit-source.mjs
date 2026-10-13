/** Offline heuristic: emit paths/reasons, never secret values. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const skip=new Set(['.git','node_modules','.runtime','.evocut-home','.venv','__pycache__','state','renders','.hyperframes','.media']);
const issues=[];let files=0;
const secrets=[new RegExp('s'+'k-[A-Za-z0-9_-]{24,}'),new RegExp('gh'+'[pousr]_[A-Za-z0-9]{25,}'),new RegExp('AK'+'IA[A-Z0-9]{16}'),new RegExp('BEGIN '+'(?:RSA |OPENSSH |EC )?PRIVATE KEY')];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
 if(skip.has(e.name))continue;const p=path.join(dir,e.name),rel=path.relative(root,p);
 if(e.isSymbolicLink()){const resolved=fs.realpathSync(p);if(!resolved.startsWith(root+path.sep))issues.push({path:rel,reason:'external symlink'});continue;}
 if(e.isDirectory()){walk(p);continue;}files++;
 if(/^\.env(?:\.|$)/.test(e.name)&&e.name!=='.env.example'||/\.(pem|key)$/.test(e.name))issues.push({path:rel,reason:'credential file'});
 if(/\.(mp4|mp3|wav|woff2?|ttf|otf)$/.test(e.name))issues.push({path:rel,reason:'unreviewed media binary'});
 const buf=fs.readFileSync(p);if(buf.includes(0))continue;const s=buf.toString('utf8');
 if(secrets.some(r=>r.test(s)))issues.push({path:rel,reason:'potential credential'});
 if(new RegExp('/Users/'+'[a-zA-Z][^/\\s]*/').test(s))issues.push({path:rel,reason:'personal home path'});
 if(s.includes('tools/'+'finance_pipeline')||s.includes('tools.'+'finance_pipeline'))issues.push({path:rel,reason:'business workflow dependency'});
}}
walk(root);console.log(JSON.stringify({ok:issues.length===0,files,issues},null,2));if(issues.length)process.exitCode=1;
