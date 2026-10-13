#!/usr/bin/env node
/** Read installed upstream command definitions; no engine code is executed. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadAcorn} from './dependencies.mjs';
const require=createRequire(import.meta.url);
const acorn=loadAcorn();
const key=p=>p?.key?.name??p?.key?.value;
const prop=(n,k)=>n?.properties?.find(p=>key(p)===k)?.value;
const literal=n=>n?.type==='Literal'?n.value:undefined;
export function extractSchema(source) {
  const schema={},scores={};
  function object(n,depth=0){if(depth>5)return null;if(n?.type==='ObjectExpression')return n;if(n?.type==='Identifier'){const re=new RegExp('\\b'+n.name+'\\s*=\\s*\\{','g'),m=re.exec(source);if(m)return acorn.parseExpressionAt(source,m.index+m[0].lastIndexOf('{'),{ecmaVersion:'latest',sourceType:'module'});}return null;}
  function properties(n,depth=0){const o=object(n,depth);if(!o)return [];return o.properties.flatMap(p=>p.type==='SpreadElement'?properties(p.argument,depth+1):[p]);}
  for(const m of source.matchAll(/\bdefineCommand\(\{/g)) {
    const node=acorn.parseExpressionAt(source,m.index+m[0].length-1,{ecmaVersion:'latest',sourceType:'module'});
    const context=[...source.slice(0,m.index).matchAll(/\/\/ src\/commands\/([\w/-]+)\.ts/g)].at(-1)?.[1];
    const declaredName=literal(prop(prop(node,'meta'),'name'));
    const name=declaredName??context;
    // A factory inside timeline.ts can precede the actual top-level timeline
    // command. Its dynamic `name: verb` is NOT the project's positional schema.
    const score=(declaredName?4:0)+(context===name?2:1);
    if(!name||(schema[name]&&scores[name]>=score))continue;
    const args=properties(prop(node,'args')),options={},positionals=[];let projectFlag=null;
    for(const a of args){const name=key(a),type=literal(prop(a.value,'type')),desc=literal(prop(a.value,'description'))??'';if(!name||!type)continue;
      const project=['dir','project'].includes(name)||type==='positional'&&/project (?:dir|directory)|project dir or composition/i.test(desc);
      if(type==='positional'){positionals.push({name,project});continue;}
      options['--'+name]=type;
      const alias=prop(a.value,'alias'),aliases=alias?.type==='ArrayExpression'?alias.elements.map(literal):[literal(alias)];for(const x of aliases.filter(Boolean))options['-'+x]=type;
      if(project&&type==='string')projectFlag='--'+name;
    }
    if(positionals.some(p=>p.project)||projectFlag){schema[name]={options,positionals,projectFlag};scores[name]=score;}
  }
  // The CLI exposes createInspectCommand from commands/layout.ts as `inspect`.
  if(schema.layout&&!schema.inspect)schema.inspect=schema.layout;
  return schema;
}
export async function main(argv=process.argv.slice(2)) {
  const {discover,hash}=await import('./branding.mjs');const dest=path.join(path.dirname(fileURLToPath(import.meta.url)),'engine-options.json');
  const at=argv.indexOf('--root');if(at>=0&&!argv[at+1])throw new Error('--root requires an installed package directory');
  const prior=at>=0&&fs.existsSync(dest)?JSON.parse(fs.readFileSync(dest,'utf8')):{versions:{},sources:[]};const versions={...prior.versions},sources=[...prior.sources],seen=new Set();
  for(const root of at>=0?[path.resolve(argv[at+1])]:discover()){const p=JSON.parse(fs.readFileSync(path.join(root,'package.json')));if(p.name!=='hyperframes')throw new Error('Expected HyperFrames package');if(seen.has(p.version))continue;seen.add(p.version);const source=fs.readFileSync(path.join(root,'dist/cli.js'),'utf8');versions[p.version]=extractSchema(source);const old=sources.findIndex(s=>s.version===p.version);if(old>=0)sources.splice(old,1);sources.push({version:p.version,cliSha256:hash(source),commands:Object.keys(versions[p.version]).length});}
  const output={generatedAt:new Date().toISOString(),sources,versions};const tmp=dest+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(output,null,2)+'\n',{flag:'wx'});fs.renameSync(tmp,dest);console.log(JSON.stringify({versions:sources.length,updated:[...seen],commands:Object.keys(versions[[...seen].at(-1)]??{})}));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main();
