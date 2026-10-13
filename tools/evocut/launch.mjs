#!/usr/bin/env node
/** Tiny global entrypoint: business commands load the validated stable snapshot. */
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {releaseModule} from './release-manager.mjs';
const args=process.argv.slice(2);
try{
  // Release and branding maintenance intentionally use the editable admin code.
  // All production commands use the snapshotted launcher and tool dependencies.
  const admin=['release','brand'].includes(args[0]);
  const entry=admin?path.join(path.dirname(fileURLToPath(import.meta.url)),'evocut.mjs'):releaseModule('evocut.mjs');
  const {main}=await import(pathToFileURL(entry).href);await main(args);
}catch(error){console.error('EvoCut: '+error.message);process.exitCode=1;}
