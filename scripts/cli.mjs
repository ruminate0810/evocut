#!/usr/bin/env node
// Keep a source checkout isolated from any pre-existing machine installation.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
process.env.EVOCUT_HOME ??= path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.evocut-home');
await import('../tools/evocut/launch.mjs');
