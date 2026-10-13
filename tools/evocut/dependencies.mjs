import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
export function loadAcorn(){
  const local=path.join(path.dirname(fileURLToPath(import.meta.url)),'vendor/acorn/dist/acorn.js');
  if(fs.existsSync(local))return require(local);
  throw new Error('EvoCut parser dependency is missing. Restore the backed-up local Acorn package; no dependency is downloaded automatically.');
}
