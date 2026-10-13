#!/usr/bin/env node
// Keep a source checkout isolated from any pre-existing machine installation.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
process.env.EVOCUT_HOME ??= path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.evocut-home');
const {applyHostEnvironment, main} = await import('./host.mjs');
try {
  applyHostEnvironment();
  if (['env', 'agent'].includes(process.argv[2])) {
    process.exitCode = await main(process.argv.slice(2));
  } else {
    if (['--help', '-h'].includes(process.argv[2])) {
      console.log('Portable setup: env doctor | env init | env prepare | agent instructions | agent install\nRun env --help or agent --help. Setup commands are checkout-local.');
    }
    await import('../tools/evocut/launch.mjs');
  }
} catch (error) {
  console.error('EvoCut setup: ' + error.message);
  process.exitCode = 1;
}
