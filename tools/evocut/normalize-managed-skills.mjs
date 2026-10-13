#!/usr/bin/env node
/** Mechanical documentation normalization, only in our owned editable source. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'skills-src');
let changed=0;
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(e.isSymbolicLink())continue;
  const file=path.join(dir,e.name);
  if(e.isDirectory()){walk(file);continue;}
  if(!e.name.endsWith('.md'))continue;
  const before=fs.readFileSync(file,'utf8');
  const after=before.replace(/\bnpx\s+(?:--yes\s+)?hyperframes(?:@(\d+\.\d+\.\d+))?\b/g,(_,v)=>v?`evocut --engine-version ${v}`:'evocut')
    .replaceAll('`/absolute/evocut/tools/evocut/LOCAL-WORKFLOW.md`','`../_evocut-local/LOCAL-WORKFLOW.md` (relative to this skill directory)')
    .replace(/Upstream skill refreshes can overwrite locally branded prose\.[\s\S]*?This migration touches skill copies only, not old videos or QA evidence\./g,
      'Upstream refreshes are staged separately. Do not run the legacy in-place skill\nmigration against managed links; edit skills-src and publish a tested release.\nExisting projects and their QA evidence stay unchanged.');
  if(after!==before){fs.writeFileSync(file,after);changed++;}
}}
for(const e of fs.readdirSync(root,{withFileTypes:true}))if(e.isDirectory()&&e.name!=='_evocut-local'){
  const doc=path.join(root,e.name,'SKILL.md');
  if(!fs.readFileSync(doc,'utf8').includes('evocut-managed-release-v1'))throw new Error(`Unowned skill source: ${e.name}`);
}
walk(root);
const common=path.join(root,'_evocut-local');fs.mkdirSync(common,{recursive:true});
for(const name of ['LOCAL-WORKFLOW.md','MEDIA-LIBRARY.md','SEMANTIC-EDIT.md']){
  const source=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),name),'utf8');
  fs.writeFileSync(path.join(common,name),source.replaceAll('../video_qa/QUALITY_GATE.md','QUALITY_GATE.md'));
}
fs.copyFileSync(path.resolve(root,'../../video_qa/QUALITY_GATE.md'),path.join(common,'QUALITY_GATE.md'));
console.log(JSON.stringify({ok:true,changedMarkdownFiles:changed,scope:root}));
