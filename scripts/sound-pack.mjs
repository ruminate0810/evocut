import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {cachePut, globalMediaDir, readGlobalManifest} from '../tools/evocut/skills-src/media-use/scripts/lib/cache.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('../sound-packs/studio-617/catalog.json', import.meta.url), 'utf8'));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function checkFile(root, row) {
  if (!/^audio\/[a-z0-9-]+\/[a-z0-9-]+\.flac$/.test(row.path)) throw Error('Invalid catalog path: '+row.id);
  const file = path.join(root, row.path);
  if (fs.realpathSync(file) !== file || !fs.statSync(file).isFile() ||
      fs.statSync(file).size !== row.bytes || hash(file) !== row.sha256) throw Error('Sound file failed verification: '+row.path);
  return file;
}

export function importPack(folder, apply = false, pack = catalog) {
  const root = fs.realpathSync(folder);
  // Fail before touching the user's library if even the last input is damaged.
  const inputs = pack.items.map(r => checkFile(root,r));
  const result = {pack:pack.edition, verified:inputs.length, imported:0, alreadyPresent:0, applied:apply};
  if (!apply) return result;
  const media = globalMediaDir(), bySha = new Map(readGlobalManifest().map(r=>[r.sha,r]));
  const clean = p => { if (fs.lstatSync(p,{throwIfNoEntry:false})?.isSymbolicLink()) throw Error('Refusing a symlink in the target library: '+p); };
  for (const p of [media,path.join(media,'manifest.jsonl'),path.join(media,'audio'),path.join(media,'audio/sfx')]) clean(p);
  for (const [i,r] of pack.items.entries()) {
    const dest = path.join(media,'mu-v1-'+r.sha256.slice(0,16)), hit = bySha.get(r.sha256);
    for (const p of [dest,path.join(dest,'.hf-complete'),path.join(dest,path.basename(inputs[i]))]) clean(p);
    if (hit) {
      if (!hit.cached_path || path.dirname(hit.cached_path)!==dest ||
          !fs.existsSync(path.join(dest,'.hf-complete'))) throw Error('Invalid existing entry: '+r.id);
      clean(hit.cached_path);
      if (!fs.statSync(hit.cached_path).isFile() || hash(hit.cached_path)!==r.sha256) throw Error('Damaged existing entry: '+r.id);
    } else if (fs.existsSync(dest)) {
      throw Error('Cache directory is already occupied for '+r.id+'; no files were replaced.');
    }
  }
  for (const [i,r] of pack.items.entries()) {
    if (bySha.has(r.sha256)) {result.alreadyPresent++; continue;}
    const description = r.category+' · '+r.title;
    const record = cachePut(inputs[i],{id:'evocut-offline-'+r.id,type:'sfx',source:r.kind==='design'?'generated':'ingested',
      path:r.path,description,duration:r.duration,license:r.license,provenance:{provider:r.provider,prompt:description,
        original_url:r.source_url,license_url:r.license_url,creator:r.author,pack:pack.edition}});
    if (!record.cached_path || hash(record.cached_path)!==r.sha256) throw Error('Imported audio failed verification: '+r.id);
    if (record.deduped) result.alreadyPresent++; else result.imported++;
  }
  return result;
}

export function runSoundPack(args) {
  const usage='Usage: evocut sound-pack <extracted-folder> [--apply]';
  if (args.length===1 && ['--help','-h'].includes(args[0])) { console.log(usage); return; }
  if (!args[0] || args[0].startsWith('-') || args.length>2 || (args.length===2 && args[1]!=='--apply')) throw Error(usage);
  console.log(JSON.stringify(importPack(args[0],args[1]==='--apply'),null,2));
}
