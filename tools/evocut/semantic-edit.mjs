#!/usr/bin/env node
/** Conservative semantic edits over the native HyperFrames timeline/history contract.
 * HTML remains the source of truth. No provider, network install, or render is invoked.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveEngine } from './evocut.mjs';

const SCHEMA = 'evocut.semantic-edit/v1';
const ROLES = new Set(['video', 'voice', 'subtitle', 'sfx', 'bgm', 'graphic']);
const EPS = 1e-7;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => fs.readFileSync(file, 'utf8');
const round = n => Math.round(n * 1e9) / 1e9;
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const sign = value => sha(canonical(value));
const bare = ({ fingerprint, ...rest }) => rest;
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const number = (value, name) => { const n = Number(value); ensure(value !== '' && value != null && Number.isFinite(n), `${name} must be a finite number`); return n; };
const inside = (root, file) => { const r = path.relative(root, file); return r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r); };

export function engineFor(project, version) {
  const engine = resolveEngine({ cwd: project, version });
  // The mutation/receipt schema is only integration-tested on this installed version.
  ensure(engine.version === '0.8.81', `Semantic edit adapter is verified only on 0.8.81; selected ${engine.version}. No pin was changed.`);
  return engine;
}
function native(engine, args, cwd) {
  const result = spawnSync(process.execPath, [engine.entry, ...args], {
    cwd, encoding: 'utf8', timeout: 45_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_AUTO_INSTALL: '1',
      HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', CI: '1' },
  });
  if (result.error) throw new Error(`Native ${args.slice(0, 2).join(' ')} failed: ${result.error.message}`);
  let data;
  try { data = JSON.parse(result.stdout); } catch { throw new Error(`Native command did not return JSON: ${(result.stderr || result.stdout).slice(0, 1000)}`); }
  ensure(result.status === 0 && data.ok !== false, `Native command refused: ${data.reason ?? data.error ?? result.stderr ?? JSON.stringify(data)}`);
  return data;
}

// Small strict scanner: never serializes user HTML, never evaluates scripts. Anything
// outside the supported authored-flat subset is pending, not guessed from a regex hit.
function attributes(raw) {
  const attrs = {};
  let rest = raw;
  while (rest.trim()) {
    rest = rest.trimStart();
    const m = /^([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+)))?/.exec(rest);
    ensure(m, 'Unsupported/malformed HTML attributes');
    const key = m[1].toLowerCase();
    ensure(!(key in attrs), `Duplicate attribute ${key}`);
    attrs[key] = m[2] ?? m[3] ?? m[4] ?? '';
    rest = rest.slice(m[0].length);
  }
  return attrs;
}
function emptyRegistration(script) {
  let s = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '').trim();
  if (!s) return true;
  const declaration = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\(\s*\{\s*paused\s*:\s*true\s*\}\s*\)\s*;?/;
  const match = declaration.exec(s);
  if (!match) return false;
  s = s.slice(match[0].length).trim();
  s = s.replace(/^window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\s*\}\s*;?/, '').trim();
  const assignment = /^window\.__timelines\[\s*(['"])[^'"\n]+\1\s*\]\s*=\s*([\w$]+)\s*;?$/;
  const end = assignment.exec(s);
  return Boolean(end && end[2] === match[1]);
}
export function inspectHtml(source) {
  const nodes = [], pending = [], stack = [];
  const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  const tags = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>/g;
  let match;
  while ((match = tags.exec(source))) {
    const raw = match[0];
    if (raw.startsWith('<!')) continue;
    const close = /^<\//.test(raw), tag = /^<\/?([\w:-]+)/.exec(raw)[1].toLowerCase();
    if (close) { ensure(stack.at(-1)?.tag === tag, `Unsupported unbalanced HTML near </${tag}>`); stack.pop(); continue; }
    const prefix = /^<[\w:-]+/.exec(raw)[0].length;
    const attrs = attributes(raw.slice(prefix, raw.endsWith('/>') ? -2 : -1));
    const node = { tag, attrs, offset: match.index, openingEnd: tags.lastIndex, parent: stack.at(-1) ?? null };
    nodes.push(node);
    if (Object.keys(attrs).some(k => k.startsWith('on'))) pending.push('inline event handlers');
    if (['iframe', 'object', 'embed', 'animate', 'animatetransform', 'animatemotion', 'set'].includes(tag)) pending.push('embedded/SMIL timed content needs a dedicated adapter');
    if (tag === 'link' && /\bstylesheet\b/i.test(attrs.rel ?? '')) pending.push('external CSS may contain timeline animation; inline a verified static stylesheet first');
    if (tag === 'script' || tag === 'style') {
      const ending = new RegExp(`</${tag}\\s*>`, 'ig'); ending.lastIndex = tags.lastIndex;
      const end = ending.exec(source); ensure(end, `Unclosed ${tag}`);
      const text = source.slice(tags.lastIndex, end.index);
      if (tag === 'style' && /@keyframes|\banimation(?:-\w+)?\s*:|\btransition(?:-\w+)?\s*:/i.test(text)) pending.push('CSS animation/transition timing');
      if (tag === 'script' && !['application/json', 'application/ld+json'].includes(attrs.type)) {
        if (attrs.src) {
          if (!/(?:^|\/)(?:gsap(?:\.min)?|hyperframe(?:s)?[.-]runtime(?:\.iife)?|hyperframes-player\.global)\.js(?:\?.*)?$/.test(attrs.src)) pending.push(`unrecognized script ${attrs.src}`);
        } else if (!emptyRegistration(text)) pending.push('executable inline script/tween timing');
      }
      tags.lastIndex = ending.lastIndex;
      continue;
    }
    if (!voidTags.has(tag) && !raw.endsWith('/>')) stack.push(node);
  }
  ensure(!stack.length, 'Unsupported unclosed HTML');
  const roots = nodes.filter(n => 'data-composition-id' in n.attrs);
  ensure(roots.length, 'No composition root');
  if (roots.length !== 1 || nodes.some(n => n.tag === 'template' || 'data-composition-src' in n.attrs)) pending.push('nested/template compositions');
  const root = roots[0], duration = number(root.attrs['data-duration'], 'root data-duration');
  const fps = number(root.attrs['data-fps'], 'root data-fps');
  ensure(duration > 0 && fps > 0, 'Positive duration and fps required');
  const isTimed = n => n !== root && ('data-start' in n.attrs || 'data-track-index' in n.attrs && 'data-duration' in n.attrs || ['video', 'audio', 'img'].includes(n.tag));
  const clips = [], ids = new Set();
  for (const n of nodes) {
    if (/\banimation(?:-\w+)?\s*:|\btransition(?:-\w+)?\s*:/i.test(n.attrs.style ?? '')) pending.push('inline CSS animation/transition');
    if ('data-automation' in n.attrs || 'data-fx-chain' in n.attrs || 'data-audio-group' in n.attrs) pending.push('automation/audio FX/group needs dedicated retiming adapter');
    if (n.attrs.id) { if (ids.has(n.attrs.id)) pending.push(`duplicate id ${n.attrs.id}`); ids.add(n.attrs.id); }
    if (!isTimed(n)) continue;
    let p = n.parent, underRoot = false;
    while (p) { if (p === root) underRoot = true; else if (isTimed(p)) pending.push('timed clips nested inside timed wrappers'); p = p.parent; }
    if (!underRoot) { pending.push('timed media outside composition root'); continue; }
    const a = n.attrs, id = a.id;
    if (!id || !/^[A-Za-z_][\w-]*$/.test(id)) { pending.push('stable simple HTML clip id required'); continue; }
    if (!/^\d+(?:\.\d+)?$/.test(a['data-start'] ?? '') || !/^\d+(?:\.\d+)?$/.test(a['data-duration'] ?? '')) { pending.push(`${id}: explicit numeric timing required`); continue; }
    if ('data-end' in a || 'data-playback-rate' in a && Number(a['data-playback-rate']) !== 1 || 'data-hf-auto-start' in a || 'data-hf-media-start-basis' in a) pending.push(`${id}: relative/end/automatic/speed timing`);
    if ('data-media-start' in a && (!Number.isFinite(Number(a['data-media-start'])) || Number(a['data-media-start']) < 0)) pending.push(`${id}: invalid source offset`);
    if ('data-locked' in a || 'data-frozen' in a) pending.push(`${id}: locked/frozen clip`);
    const start = Number(a['data-start']), length = Number(a['data-duration']);
    if (length <= 0 || start + length > duration + EPS) pending.push(`${id}: outside positive root bounds`);
    const role = a['data-evocut-role'], link = a['data-evocut-link'];
    clips.push({ id, ref: `#${id}`, kind: n.tag, start, end: round(start + length), duration: length,
      track: Number(a['data-track-index'] ?? 0), role, link, cue: a['data-evocut-cue'], section: a['data-evocut-section'],
      src: a.src ?? null, mediaStart: Number(a['data-media-start'] ?? 0), node: n });
  }
  return { root, clips, duration, fps, pending: [...new Set(pending)] };
}
function bind(file) { return { path: fs.realpathSync(file), sha256: sha(fs.readFileSync(file)) }; }
function verifyBindings(bindings) {
  for (const b of bindings) ensure(fs.existsSync(b.path) && sha(fs.readFileSync(b.path)) === b.sha256, `Stale input: ${b.path}`);
}
function select(model, request, sourceHash, bindings) {
  const { selector } = request;
  ensure(selector && ['cue', 'section', 'range', 'text'].includes(selector.kind), 'Choose exactly one explicit cue, section, or range');
  let a, b, selected;
  if (selector.kind === 'range') {
    ensure(Array.isArray(selector.value) && selector.value.length === 2, 'range needs [start,end]');
    [a, b] = selector.value.map(v => number(v, 'range'));
    selected = model.clips.filter(c => c.role !== 'bgm' && c.start < b - EPS && c.end > a + EPS);
  } else if (request.semantic) {
    const semantic = JSON.parse(read(request.semantic)); bindings.push(bind(request.semantic));
    ensure(semantic.composition?.sha256 === sourceHash, 'Semantic timeline must bind composition.sha256 to the current index.html (no guessed clock alignment)');
    ensure(Math.abs(semantic.duration - model.duration) < EPS, 'Semantic clock duration differs from composition');
    for (const name of ['audio', 'transcript']) if (semantic[name]) {
      ensure(semantic[name].path && semantic[name].sha256, `Missing ${name} fingerprint`);
      bindings.push({ path: fs.realpathSync(semantic[name].path), sha256: semantic[name].sha256 });
    }
    const items = selector.kind === 'section' ? semantic.sections ?? [] : semantic.cues ?? [];
    const norm = s => String(s ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const matches = items.filter(c => selector.kind === 'text' ? norm(c.phrase) === norm(selector.value) : c.id === selector.value);
    ensure(matches.length === 1, matches.length ? 'Ambiguous repeated text/ID; use one unique cue ID' : 'Semantic cue/section not found');
    ensure(matches[0].status === 'aligned' || matches[0].status === 'resolved', `Cue is pending: ${matches[0].reason ?? 'not aligned'}`);
    a = number(matches[0].start, 'cue start'); b = number(matches[0].end, 'cue end');
    selected = model.clips.filter(c => c.role !== 'bgm' && c.start < b - EPS && c.end > a + EPS);
  } else {
    ensure(selector.kind !== 'text', 'Text selection requires a hash-bound measured semantic timeline; no ASR or interpolation');
    selected = model.clips.filter(c => c[selector.kind] === selector.value && c.role !== 'bgm');
    ensure(selected.length, 'Cue/section has no explicitly marked clips');
    a = Math.min(...selected.map(c => c.start)); b = Math.max(...selected.map(c => c.end));
  }
  ensure(a >= 0 && b > a && b <= model.duration + EPS, 'Selection outside composition bounds');
  ensure([a, b].every(t => Math.abs(t * model.fps - Math.round(t * model.fps)) < 1e-5), 'Selection must use exact frame boundaries; no silent snapping');
  ensure(selected.length, 'No linked clips in selection');
  return { start: round(a), end: round(b), clips: selected };
}
function nextId(id, used) {
  const m = /^(.*)-(\d+)$/.exec(id), base = m && used.has(m[1]) ? m[1] : id;
  let suffix = 2; while (used.has(`${base}-${suffix}`)) suffix++;
  const result = `${base}-${suffix}`; used.add(result); return result;
}
function operations(model, selection, request) {
  const edits = [], pending = [...model.pending], affected = [], used = new Set(model.clips.map(c => c.id));
  const a = selection.start, b = selection.end, delta = round(b - a);
  const bgm = model.clips.filter(c => c.role === 'bgm');
  if (bgm.length > 1) pending.push('Only one explicitly marked continuous BGM bed is supported');
  for (const c of bgm) if (c.kind !== 'audio' || c.start !== 0 || Math.abs(c.end - model.duration) > EPS) pending.push(`${c.id}: BGM must span exactly [0,root duration]`);
  const requireLink = c => {
    if (!ROLES.has(c.role) || c.role !== 'bgm' && !c.link) pending.push(`${c.id}: explicit data-evocut-role and data-evocut-link required`);
    if (!Number.isInteger(c.track)) pending.push(`${c.id}: integer track required`);
    if (['voice', 'sfx', 'bgm'].includes(c.role) && c.kind !== 'audio' || c.role === 'video' && c.kind !== 'video') pending.push(`${c.id}: role does not match media tag`);
  };
  if (request.operation === 'cut') {
    ensure(delta < model.duration - EPS, 'Cannot delete the entire composition');
    for (const c of model.clips) {
      if (c.end <= a + EPS && c.role !== 'bgm') continue;
      requireLink(c); affected.push(c.id);
      if (c.role === 'bgm') { edits.push({ verb: 'trim', ref: c.ref, duration: String(round(model.duration - delta)), overwrite: true }); continue; }
      if (c.start >= b - EPS) { edits.push({ verb: 'move', ref: c.ref, time: String(round(c.start - delta)), overwrite: true }); continue; }
      if (c.start >= a - EPS && c.end <= b + EPS) { edits.push({ verb: 'delete', ref: c.ref }); continue; }
      if (c.start < a - EPS && c.end <= b + EPS) { edits.push({ verb: 'trim', ref: c.ref, duration: String(round(a - c.start)), overwrite: true }); continue; }
      // Native split owns source offsets and cloned IDs. Never implement media slip ourselves.
      const right = nextId(c.id, used);
      edits.push({ verb: 'split', ref: c.ref, time: String(b) });
      if (c.start >= a - EPS) edits.push({ verb: 'delete', ref: c.ref });
      else { const middle = nextId(c.id, used); edits.push({ verb: 'split', ref: c.ref, time: String(a) }, { verb: 'delete', ref: `#${middle}` }); }
      edits.push({ verb: 'move', ref: `#${right}`, time: String(a), overwrite: true });
    }
    return { edits, affected, pending, duration: round(model.duration - delta), bgmPolicy: 'continuous source from unchanged offset; shorten tail, no splice or automatic fade' };
  }
  ensure(request.operation === 'move', 'operation must be cut or move');
  const by = number(request.by, 'move --by'); ensure(by !== 0, 'move delta cannot be zero');
  ensure(Math.abs(by * model.fps - Math.round(by * model.fps)) < 1e-5, 'move delta must be frame aligned');
  const links = new Set(selection.clips.map(c => c.link).filter(Boolean));
  const chosen = model.clips.filter(c => c.role !== 'bgm' && (selection.clips.includes(c) || links.has(c.link)));
  for (const c of chosen) {
    requireLink(c); affected.push(c.id);
    if (c.start < a - EPS || c.end > b + EPS) pending.push(`${c.id}: linked group crosses selection; select the complete group`);
    if (c.start + by < -EPS || c.end + by > model.duration + EPS) pending.push(`${c.id}: move exceeds root duration; extension/source availability is not inferred`);
    for (const other of model.clips) {
      if (chosen.includes(other) || other.role === 'bgm' || c.track !== other.track) continue;
      const overlap = c.start + by < other.end - EPS && c.end + by > other.start + EPS;
      if (overlap) pending.push(`${c.id}: destination overlaps ${other.id} on track ${c.track}`);
    }
    edits.push({ verb: 'move', ref: c.ref, time: String(round(c.start + by)), overwrite: true });
  }
  return { edits, affected, pending, duration: model.duration, bgmPolicy: 'unchanged continuous BGM' };
}
function withDuration(source, duration) {
  const { root } = inspectHtml(source);
  const opening = source.slice(root.offset, root.openingEnd);
  const replaced = opening.replace(/(\bdata-duration\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/, `$1"${duration}"`);
  ensure(replaced !== opening || Number(root.attrs['data-duration']) === duration, 'Root duration patch failed');
  return source.slice(0, root.offset) + replaced + source.slice(root.openingEnd);
}
function stage(engine, source, edits, duration) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evocut-semantic-'));
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), source);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'evocut-semantic-scratch', private: true }));
    const file = path.join(dir, 'native-plan.json'); fs.writeFileSync(file, JSON.stringify(edits));
    const planned = native(engine, ['timeline', 'apply', file, '--dir', dir, '--plan', '--json'], dir);
    const applied = native(engine, ['timeline', 'apply', file, '--dir', dir, '--json'], dir);
    ensure(applied.receipt?.length === 1 && applied.receipt[0].file === 'index.html', 'Native apply must mutate exactly index.html');
    const after = withDuration(read(path.join(dir, 'index.html')), duration);
    const verified = inspectHtml(after);
    ensure(!verified.pending.length && verified.clips.every(c => c.end <= duration + EPS), 'Native result falls outside safe flat composition contract');
    return { after, native: { plan: planned, receipt: applied.receipt, stagingOnly: true,
      note: 'Native receipt proves isolated edit execution, not a live-project undo receipt; live undo uses history entry.' } };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export async function createPlan(input) {
  const project = fs.realpathSync(input.project ?? process.cwd()), index = path.join(project, 'index.html');
  ensure(fs.realpathSync(index) === index, 'Symlinked index.html is not supported');
  const source = read(index), model = inspectHtml(source), engine = engineFor(project, input.engineVersion);
  const bindings = [bind(index), bind(path.join(engine.root, 'package.json')), bind(path.join(engine.root, 'dist/cli.js'))];
  if (engine.packageFile) bindings.push(bind(engine.packageFile));
  const request = { project, operation: input.operation, selector: input.selector,
    ...(input.by != null ? { by: number(input.by, 'by') } : {}),
    ...(input.semantic ? { semantic: fs.realpathSync(input.semantic) } : {}), engineVersion: engine.version };
  const selection = select(model, request, sha(source), bindings), op = operations(model, selection, request);
  verifyBindings(bindings);
  const payload = { schema: SCHEMA, kind: 'edit-plan', request, engine: { version: engine.version, root: engine.root },
    inputs: bindings, range: { start: selection.start, end: selection.end },
    beforeDuration: model.duration, afterDuration: op.duration, bgmPolicy: op.bgmPolicy,
    affected: op.affected, edits: op.edits, pending: [...new Set(op.pending)],
    qa: { status: 'must-rerun-after-apply', checks: ['semantic-timing', 'audio-sync', 'first-5-and-15-seconds', 'boundary-frames', 'render', 'human-review'] },
    paidRequests: 0 };
  if (!payload.pending.length) {
    const result = stage(engine, source, op.edits, op.duration);
    payload.afterSha256 = sha(result.after);
    // Exclude ephemeral staging receipt paths/tokens from the deterministic plan.
    payload.nativeValidation = { ok: true, planned: true, appliedInIsolation: true,
      beforeRows: result.native.plan.before.length, afterRows: result.native.plan.after.length };
    verifyBindings(bindings);
  }
  payload.status = payload.pending.length ? 'pending' : 'ready';
  return { ...payload, fingerprint: sign(payload) };
}
function safeState(project) {
  const base = path.join(project, '.hyperframes'), dir = path.join(base, 'evocut');
  for (const part of [base, dir]) { if (fs.existsSync(part)) ensure(fs.realpathSync(part) === part, 'Symlinked edit state is not supported'); else fs.mkdirSync(part); }
  return dir;
}
function atomicWrite(file, content, expected) {
  const temp = `${file}.evocut-${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { mode: fs.existsSync(file) ? fs.statSync(file).mode : 0o600, flag: 'wx' });
    if (expected != null) ensure(sha(fs.readFileSync(file)) === expected, `Stale file before atomic replace: ${file}`);
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function invalidation(project, transaction, reason) {
  const marker = path.join(safeState(project), 'qa-invalidated.json');
  atomicWrite(marker, JSON.stringify({ schema: 'evocut.qa-invalidation/v1', status: 'invalidated', reason,
    transaction, indexSha256: sha(fs.readFileSync(path.join(project, 'index.html'))), at: new Date().toISOString(),
    invalidates: ['semantic-timeline', 'QA-samples', 'audio-sync', 'check', 'render', 'human-review'],
    note: 'Existing evidence is retained for audit but cannot approve this revision. No QA has been rerun.' }, null, 2) + '\n');
  return marker;
}
async function locked(project, fn) {
  const file = path.join(safeState(project), 'semantic-edit.lock');
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); } catch { throw new Error('Another semantic edit may be running; inspect the lock instead of deleting it automatically'); }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  try { return await fn(); } finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
function checkedPlan(plan) {
  ensure(plan.schema === SCHEMA && plan.kind === 'edit-plan', 'Not a semantic edit plan');
  ensure(plan.fingerprint === sign(bare(plan)), 'Plan fingerprint mismatch');
  ensure(plan.status === 'ready' && plan.pending.length === 0, 'Plan has pending unsafe work; nothing applied');
  verifyBindings(plan.inputs);
}
export async function applyPlan(plan, { apply = false } = {}) {
  checkedPlan(plan);
  if (!apply) return { status: 'dry-run', fingerprint: plan.fingerprint, message: 'No project change. Add --apply to commit this exact reviewed plan.' };
  const project = fs.realpathSync(plan.request.project);
  return locked(project, async () => {
    checkedPlan(plan);
    const rebuilt = await createPlan(plan.request);
    ensure(rebuilt.fingerprint === plan.fingerprint, 'Plan no longer reproduces exactly; review a new plan');
    const engine = engineFor(project, plan.engine.version), index = path.join(project, 'index.html');
    const before = read(index), result = stage(engine, before, plan.edits, plan.afterDuration);
    ensure(sha(result.after) === plan.afterSha256, 'Native result differs from reviewed plan');
    checkedPlan(plan);
    ensure(!fs.existsSync(path.join(project, '.hyperframes', 'history-turn.json')), 'An existing history turn is active; finish it before semantic edits');
    const id = crypto.randomUUID(), dir = path.join(safeState(project), 'semantic-edits');
    fs.mkdirSync(dir, { recursive: true }); ensure(fs.realpathSync(dir) === dir, 'Symlinked receipts directory');
    const receiptPath = path.join(dir, `${id}.json`);
    const receipt = { schema: SCHEMA, kind: 'edit-receipt', id, project, planFingerprint: plan.fingerprint,
      beforeSha256: sha(before), afterSha256: sha(result.after), engineVersion: engine.version,
      state: 'prepared', nativeIsolatedReceipt: result.native.receipt, history: null };
    const save = () => atomicWrite(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    save();
    let began = false, wrote = false;
    try {
      receipt.historyBegin = native(engine, ['history', 'begin', '--who', 'evocut-semantic-edit', '--label', `${plan.request.operation} ${plan.range.start}-${plan.range.end} ${id}`, '--dir', project, '--json'], project);
      began = true;
      checkedPlan(plan);
      // Fail closed even if the process dies between the content commit and the
      // final marker update. An early invalidation is harmless; stale approval is not.
      receipt.qaInvalidation = invalidation(project, id, 'semantic-edit-commit-started');
      // Only one live content file is committed. Native history captures the exact
      // pre/post bytes including root duration; this avoids a half-retimed project.
      atomicWrite(index, result.after, receipt.beforeSha256); wrote = true;
      receipt.state = 'committed-awaiting-history'; save();
      receipt.qaInvalidation = invalidation(project, id, 'semantic-edit');
      const ended = native(engine, ['history', 'end', '--dir', project, '--json'], project); began = false;
      receipt.history = ended;
      ensure(ended.entry?.id && ended.entry.files.length === 1 && ended.entry.files[0] === 'index.html' && (ended.parts ?? []).length <= 1,
        'History captured concurrent/non-index changes; automatic undo is withheld for review');
      receipt.state = 'applied'; save();
      return { status: 'applied', receipt: receiptPath, historyEntry: ended.entry.id, indexSha256: receipt.afterSha256, qa: 'invalidated' };
    } catch (error) {
      if (began) { try { receipt.history = native(engine, ['history', 'end', '--dir', project, '--json'], project); } catch (e) { receipt.historyError = e.message; } }
      receipt.state = wrote ? 'recovery-required' : 'not-applied'; receipt.error = error.message;
      if (wrote) { try { receipt.qaInvalidation = invalidation(project, id, 'edit-recovery-required'); } catch {} }
      save(); throw new Error(`${error.message}. Receipt: ${receiptPath}; state: ${receipt.state}`);
    }
  });
}
export async function undoReceipt(receiptPath, { apply = false } = {}) {
  const receipt = JSON.parse(read(receiptPath));
  ensure(receipt.schema === SCHEMA && receipt.kind === 'edit-receipt' && receipt.state === 'applied', 'Only completed, not-yet-undone receipts can be undone');
  const project = fs.realpathSync(receipt.project), expectedDir = path.join(project, '.hyperframes', 'evocut', 'semantic-edits');
  ensure(inside(expectedDir, fs.realpathSync(receiptPath)), 'Receipt must remain in its owning project');
  const entry = receipt.history?.entry;
  ensure(entry?.id && entry.files?.length === 1 && entry.files[0] === 'index.html', 'Receipt has no safe native history entry');
  ensure(sha(fs.readFileSync(path.join(project, 'index.html'))) === receipt.afterSha256, 'Stale undo: project changed after this edit');
  if (!apply) return { status: 'dry-run', historyEntry: entry.id, message: 'No changes. Add --apply to undo.' };
  return locked(project, async () => {
    ensure(!fs.existsSync(path.join(project, '.hyperframes', 'history-turn.json')), 'An existing history turn is active');
    ensure(sha(fs.readFileSync(path.join(project, 'index.html'))) === receipt.afterSha256, 'Stale undo: project changed after this edit');
    const engine = engineFor(project, receipt.engineVersion);
    // Native history enforces its own newer-entry conflict protection as well.
    const undone = native(engine, ['history', 'undo', entry.id, '--who', 'evocut-semantic-edit', '--dir', project, '--json'], project);
    ensure(sha(fs.readFileSync(path.join(project, 'index.html'))) === receipt.beforeSha256, 'Native undo returned unexpected bytes; inspect history before continuing');
    receipt.state = 'undone'; receipt.undo = undone;
    receipt.qaInvalidation = invalidation(project, receipt.id, 'semantic-edit-undone; QA must be rerun');
    atomicWrite(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    return { status: 'undone', receipt: receiptPath, indexSha256: receipt.beforeSha256, qa: 'invalidated' };
  });
}
export async function createRemake(input) {
  const project = fs.realpathSync(input.project ?? process.cwd()), index = path.join(project, 'index.html');
  const source = read(index), model = inspectHtml(source), inputs = [bind(index)];
  ensure(typeof input.prompt === 'string' && input.prompt.trim(), 'remake requires an explicit prompt');
  const request = { project, selector: input.selector, ...(input.semantic ? { semantic: fs.realpathSync(input.semantic) } : {}) };
  const selection = select(model, request, sha(source), inputs);
  const clips = selection.clips.filter(c => c.role === 'video' || c.role === 'graphic');
  ensure(clips.length, 'No explicitly marked visual shot selected');
  for (const clip of clips) if (clip.src) {
    ensure(!/^[a-z]+:/i.test(clip.src), 'Remake source must be an existing local asset, not a remote URL');
    const file = fs.realpathSync(path.resolve(project, clip.src)); ensure(inside(project, file), 'Remake asset outside project'); inputs.push(bind(file));
  }
  verifyBindings(inputs);
  const payload = { schema: SCHEMA, kind: 'remake-request', status: 'pending-generation-and-human-approval', request,
    prompt: input.prompt, inputs, range: { start: selection.start, end: selection.end },
    shots: clips.map(({ node, ...clip }) => ({ ...clip, replacement: null })),
    pending: [...model.pending, 'Generate approved replacement separately; probe dimensions/duration/audio and review before replacement.'],
    constraints: { preserveIds: true, preserveTimeline: true, equalDurationRequired: true,
      replacementImplemented: false, noProviderInvoked: true }, paidRequests: 0, estimatedCharges: 0 };
  return { ...payload, fingerprint: sign(payload) };
}

export function parseEditArgs(argv) {
  const [command = 'help', ...args] = argv, opts = {}, positionals = [];
  const allowed = {
    plan: new Set(['project', 'operation', 'cue', 'section', 'range', 'text', 'by', 'semantic', 'out', 'engine-version', 'json']),
    remake: new Set(['project', 'cue', 'section', 'range', 'text', 'semantic', 'out', 'prompt', 'json']),
    apply: new Set(['apply', 'json']), undo: new Set(['apply', 'json']),
    help: new Set(['json']), '--help': new Set(['json']),
  }[command];
  ensure(allowed, `Unknown semantic edit command ${command}`);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { positionals.push(args[i]); continue; }
    const [key, ...tail] = args[i].slice(2).split('=');
    if (key === 'apply' && ['plan', 'remake'].includes(command)) throw new Error(`${command} never applies edits`);
    // Validate the complete command surface before reading plans or touching state.
    ensure(allowed.has(key), `--${key} is not supported by edit ${command}; no action executed`);
    ensure(!seen.has(key), `Duplicate option --${key}`); seen.add(key);
    if (key === 'apply' || key === 'json') { ensure(!tail.length, `--${key} takes no value`); if (key === 'apply') opts.apply = true; continue; }
    opts[key] = tail.length ? tail.join('=') : args[++i];
    ensure(opts[key] != null && opts[key] !== '' && !opts[key].startsWith('--'), `Missing --${key} value`);
  }
  ensure(positionals.length === (['apply', 'undo'].includes(command) ? 1 : 0),
    ['apply', 'undo'].includes(command) ? `${command} requires exactly one plan/receipt path` : `edit ${command} takes no positional arguments; use --project`);
  if (command === 'plan' || command === 'remake') {
    const selectors = ['cue', 'section', 'range', 'text'].filter(k => k in opts);
    ensure(selectors.length === 1, 'Choose exactly one of --cue, --section, --range, --text');
    const kind = selectors[0]; opts.selector = { kind, value: kind === 'range' ? opts.range.split(':').map(Number) : opts[kind] };
    if (command === 'plan') {
      ensure(['cut', 'move'].includes(opts.operation), 'plan requires --operation cut or move');
      ensure(opts.operation === 'move' || opts.by == null, '--by is only supported with --operation move');
    }
  }
  return { command, opts, positionals };
}
export async function main(argv = process.argv.slice(2)) {
  try {
    const { command, opts, positionals } = parseEditArgs(argv);
    let result;
    if (command === 'help' || command === '--help') result = { commands: [
      'edit plan --project DIR --operation cut|move --cue ID|--section ID|--range START:END [--by SECONDS] [--out PLAN.json]',
      'edit apply PLAN.json [--apply]', 'edit undo RECEIPT.json [--apply]',
      'edit remake --project DIR --cue ID|--section ID|--range START:END --prompt TEXT [--out REQUEST.json]',
    ], safety: 'Dry-run default; explicit links, hash checks, native 0.8.81 history; no paid generation.' };
    else if (command === 'plan') result = await createPlan({ ...opts, engineVersion: opts['engine-version'] });
    else if (command === 'apply') { ensure(positionals.length === 1, 'apply requires one plan path'); result = await applyPlan(JSON.parse(read(positionals[0])), { apply: opts.apply }); }
    else if (command === 'undo') { ensure(positionals.length === 1, 'undo requires one receipt path'); result = await undoReceipt(positionals[0], { apply: opts.apply }); }
    else if (command === 'remake') result = await createRemake(opts);
    else throw new Error(`Unknown semantic edit command ${command}`);
    if (opts.out) { ensure(['plan', 'remake'].includes(command), '--out is only for plans/requests'); fs.writeFileSync(path.resolve(opts.out), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); }
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'pending' ? 2 : 0;
  } catch (error) { console.log(JSON.stringify({ ok: false, error: error.message, paidRequests: 0 }, null, 2)); return 2; }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
