#!/usr/bin/env node
/** Explicit pinned bootstrap; never changes global npm, skills or old projects. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ensureCommandShims} from './host.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.env.EVOCUT_HOME ??= path.join(root,'.evocut-home');
const args=process.argv.slice(2);
if(args.some(a=>!['--install-engine','--help'].includes(a)))throw new Error('Unknown setup flag');
if(args.includes('--help')){console.log('npm run setup -- --install-engine\nInstalls pinned HyperFrames 0.8.81 locally, brands, tests and promotes into EVOCUT_HOME (default: checkout/.evocut-home). No global changes.');process.exit(0);}
const pythonCheck=spawnSync(process.env.EVOCUT_PYTHON||'python3',['-I','-c','import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)'],{stdio:'ignore',timeout:15000});
if(pythonCheck.status!==0)throw new Error('Python 3.11+ is required by QA (hashlib.file_digest). Set EVOCUT_PYTHON to a compatible interpreter.');
const {readCurrent,stageRelease,validateRelease,promoteRelease,verifyRelease}=await import('../tools/evocut/release-manager.mjs');
const current=readCurrent();
if(current){const result=verifyRelease(current.manifest.id);if(!result.ok)throw new Error('Existing release integrity failed');ensureCommandShims({root,home:process.env.EVOCUT_HOME});console.log('Already initialized: '+current.manifest.id+'; use release stage/validate/promote for deliberate updates.');process.exit(0);}
const engine=path.join(root,'.runtime/node_modules/hyperframes');
if(!fs.existsSync(path.join(engine,'package.json'))){
 if(!args.includes('--install-engine'))throw new Error('No local engine. Re-run with --install-engine to explicitly allow a pinned npm download.');
 const runtime=path.join(root,'.runtime');fs.mkdirSync(runtime,{recursive:true});
 fs.copyFileSync(path.join(root,'runtime/package.json'),path.join(runtime,'package.json'));
 fs.copyFileSync(path.join(root,'runtime/package-lock.json'),path.join(runtime,'package-lock.json'));
 const r=spawnSync('npm',['ci','--prefix',runtime,'--install-strategy=nested','--no-audit','--no-fund'],{stdio:'inherit',env:{...process.env,HYPERFRAMES_SKIP_SKILLS:'1',HYPERFRAMES_NO_TELEMETRY:'1'}});
 if(r.status!==0)throw new Error('Pinned engine installation failed');
}
const pkg=JSON.parse(fs.readFileSync(path.join(engine,'package.json')));
if(pkg.name!=='hyperframes'||pkg.version!=='0.8.81')throw new Error('Bootstrap requires exact HyperFrames 0.8.81');
const {prepare,install}=await import('../tools/evocut/branding.mjs');
const branded=install(prepare(engine));
if(!['branded','already-branded'].includes(branded.status))throw new Error('Branding did not complete');
const id='evocut-'+JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version+'-'+Date.now();
stageRelease({engineRoot:engine,skillsSource:path.join(root,'tools/evocut/skills-src'),id});
const validation=validateRelease(id);
for(const t of validation.results)console.log(t.name+': '+t.exitCode);
if(!validation.ok){for(const t of validation.results)if(t.exitCode!==0)console.error(t.output);throw new Error('Candidate failed validation; not promoted');}
console.log(JSON.stringify(promoteRelease(id),null,2));
ensureCommandShims({root,home:process.env.EVOCUT_HOME});
console.log('Ready. npm run evocut -- about\nOptional global command: npm link (never required).');
