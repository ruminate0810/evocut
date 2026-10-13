#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {STATE,hash} from './branding.mjs';
const issues=[],results=[];
for(const f of fs.readdirSync(path.join(STATE,'installs')).filter(f=>f.endsWith('.json'))) {
  const m=JSON.parse(fs.readFileSync(path.join(STATE,'installs',f))),entry=fs.readFileSync(path.join(m.root,'dist/studio/index.html'),'utf8').match(/src="([^" ]+\.js)"/)?.[1];
  const local=[];
  if(hash(fs.readFileSync(path.join(m.root,'package.json')))!==m.packageHash)local.push('package metadata changed');
  for(const file of m.files)if(!fs.existsSync(path.join(m.root,file.path))||hash(fs.readFileSync(path.join(m.root,file.path)))!==file.after)local.push('file hash mismatch: '+file.path);
  for(const file of m.graphSources??[])if(hash(fs.readFileSync(path.join(m.root,file.path)))!==file.hash)local.push('original source changed: '+file.path);
  const graph=m.files.filter(f=>f.path.endsWith('.js')&&f.path.includes('/assets/'));
  for(const file of graph){const src=fs.readFileSync(path.join(m.root,file.path),'utf8');for(const source of m.graphSources??[]){const name=path.basename(source.path);if(src.includes('"./'+name+'"')||src.includes('"'+name+'"'))local.push('unbranded graph back-reference: '+name);}if(src.includes('"aria-label":"Hyperframes"'))local.push('old logo in browser graph');}
  try{execFileSync(process.execPath,['--check',path.join(m.root,'dist/cli.js')],{stdio:'pipe',timeout:30000});}catch(e){local.push('CLI syntax check failed');}
  results.push({root:m.root,version:m.version,entry,browserModules:graph.length,pass:local.length===0});if(local.length)issues.push({root:m.root,issues:local});
}
const output={checkedAt:new Date().toISOString(),installations:results.length,pass:issues.length===0,issues,results};
fs.writeFileSync(path.join(STATE,'verification.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({installations:output.installations,pass:output.pass,issues},null,2));
if(!output.pass)process.exitCode=1;
