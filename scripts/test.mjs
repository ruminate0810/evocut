import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {hostEnvironment} from './host.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tests=['tools/evocut','scripts'].flatMap(d=>fs.readdirSync(path.join(root,d)).filter(n=>n.endsWith('.test.mjs')).map(n=>path.join(d,n)));
const env={...hostEnvironment(process.env,root),PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:[root,path.join(root,'tools/video_qa')].join(path.delimiter)};
delete env.NODE_TEST_CONTEXT;
for(const [bin,args]of [[process.execPath,['--test',...tests]],[env.EVOCUT_PYTHON||'python3',['-m','unittest','discover','-s','tools/video_qa','-p','test_*.py']],[process.execPath,['scripts/audit-source.mjs']]]){
 const r=spawnSync(bin,args,{cwd:root,env,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);
}
