import nativeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import { createPlan, applyPlan, undoReceipt, createRemake, inspectHtml, parseEditArgs, main } from './semantic-edit.mjs';

// Never borrow the developer's global engine or active stable release.
const here=path.dirname(fileURLToPath(import.meta.url));
const candidates=[process.env.EVOCUT_TEST_ENGINE_ROOT,path.resolve(here,'../../engine'),path.resolve(here,'../../.runtime/node_modules/hyperframes')].filter(Boolean);
const testEngine=candidates.find(p=>fs.existsSync(path.join(p,'package.json')));
const test=(name,fn)=>nativeTest(name,{skip:testEngine?false:'Run setup --install-engine for native engine integration tests'},fn);

const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const clip = (id, start, duration, role, link, extra = '') => {
  const tag = role === 'video' ? 'video' : ['voice', 'sfx', 'bgm'].includes(role) ? 'audio' : 'div';
  const track = { video: 0, voice: 1, subtitle: 2, sfx: 3, bgm: 4, graphic: 5 }[role];
  return `<${tag} id="${id}" class="clip" data-start="${start}" data-duration="${duration}" data-track-index="${track}" data-evocut-role="${role}" data-evocut-link="${link}" ${extra}>${tag === 'div' ? 'same words' : ''}</${tag}>`;
};
function html(extra = '', body) {
  const normal = [0, 2, 4].flatMap((start, i) => ['video', 'voice', 'subtitle', 'sfx'].map(role => clip(`${role}${i}`, start, 2, role, `g${i}`, `data-evocut-cue="cue${i}" data-evocut-section="section${i}"`)));
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><main id="root" data-composition-id="fixture" data-duration="6" data-fps="30" data-width="600" data-height="700">\n${body ?? [...normal, clip('music', 0, 6, 'bgm', 'bed')].join('\n')}\n</main>${extra}</body></html>`;
}
async function fixture(fn, source = html()) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'evocut-semantic-fixture-'));
  fs.writeFileSync(path.join(project, 'index.html'), source);
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'semantic-fixture', scripts: { check: 'evocut --engine-version 0.8.81 check' } }));
  fs.mkdirSync(path.join(project,'node_modules'));
  fs.symlinkSync(testEngine,path.join(project,'node_modules/hyperframes'),'dir');
  const previous=process.env.EVOCUT_HOME;process.env.EVOCUT_HOME=path.join(project,'isolated-home');
  try { return await fn(project, source); } finally { if(previous===undefined)delete process.env.EVOCUT_HOME;else process.env.EVOCUT_HOME=previous;fs.rmSync(project, { recursive: true, force: true }); }
}
const request = project => ({ project, operation: 'cut', selector: { kind: 'cue', value: 'cue1' } });

test('native isolated plan, actual atomic cross-track apply and native history undo', async () => fixture(async (project, source) => {
  const plan = await createPlan(request(project));
  assert.equal(plan.status, 'ready'); assert.equal(plan.afterDuration, 4);
  assert.equal(plan.edits.filter(e => e.verb === 'delete').length, 4);
  assert.equal(plan.edits.filter(e => e.verb === 'move').length, 4);
  assert.equal(plan.nativeValidation.appliedInIsolation, true);
  assert.equal(fs.readFileSync(path.join(project, 'index.html'), 'utf8'), source);
  const dry = await applyPlan(plan); assert.equal(dry.status, 'dry-run');
  assert.equal(fs.readFileSync(path.join(project, 'index.html'), 'utf8'), source);
  const applied = await applyPlan(plan, { apply: true }); assert.equal(applied.status, 'applied');
  const model = inspectHtml(fs.readFileSync(path.join(project, 'index.html'), 'utf8'));
  assert.equal(model.duration, 4); assert.equal(model.clips.length, 9);
  for (const role of ['video', 'voice', 'subtitle', 'sfx']) {
    assert.equal(model.clips.find(c => c.id === `${role}2`).start, 2);
    assert.ok(!model.clips.some(c => c.id === `${role}1`));
  }
  const music = model.clips.find(c => c.id === 'music');
  assert.equal(music.start, 0); assert.equal(music.duration, 4); assert.equal(music.mediaStart, 0);
  const qa = JSON.parse(fs.readFileSync(path.join(project, '.hyperframes/evocut/qa-invalidated.json')));
  assert.equal(qa.status, 'invalidated'); assert.equal(qa.indexSha256, applied.indexSha256);
  assert.equal((await undoReceipt(applied.receipt)).status, 'dry-run');
  const undone = await undoReceipt(applied.receipt, { apply: true }); assert.equal(undone.status, 'undone');
  assert.equal(fs.readFileSync(path.join(project, 'index.html'), 'utf8'), source);
  await assert.rejects(undoReceipt(applied.receipt, { apply: true }), /not-yet-undone/);
}));

test('native split preserves source offset across a middle cut', async () => fixture(async project => {
  const plan = await createPlan({ project, operation: 'cut', selector: { kind: 'range', value: [2, 4] } });
  assert.equal(plan.status, 'ready');
  const applied = await applyPlan(plan, { apply: true });
  const m = inspectHtml(fs.readFileSync(path.join(project, 'index.html'), 'utf8'));
  assert.deepEqual(m.clips.filter(c => c.role === 'video').map(c => [c.start, c.duration, c.mediaStart]), [[0, 2, 1], [2, 2, 5]]);
  await undoReceipt(applied.receipt, { apply: true });
}, html('', clip('video', 0, 6, 'video', 'long', 'data-media-start="1"') + clip('music', 0, 6, 'bgm', 'bed'))));

test('stale source prevents apply with no content change', async () => fixture(async project => {
  const plan = await createPlan(request(project)), file = path.join(project, 'index.html');
  fs.appendFileSync(file, '\n<!-- newer human edit -->'); const expected = fs.readFileSync(file, 'utf8');
  await assert.rejects(applyPlan(plan, { apply: true }), /Stale input/);
  assert.equal(fs.readFileSync(file, 'utf8'), expected);
}));

test('tampered native plan cannot be applied', async () => fixture(async project => {
  const plan = await createPlan(request(project)); plan.edits[0].ref = '#music';
  await assert.rejects(applyPlan(plan, { apply: true }), /fingerprint/);
}));

test('undo refuses concurrent content changes instead of overwriting', async () => fixture(async project => {
  const result = await applyPlan(await createPlan(request(project)), { apply: true });
  const file = path.join(project, 'index.html'); fs.appendFileSync(file, '\n<!-- concurrent -->');
  const expected = fs.readFileSync(file, 'utf8');
  await assert.rejects(undoReceipt(result.receipt, { apply: true }), /Stale undo/);
  assert.equal(fs.readFileSync(file, 'utf8'), expected);
}));

test('repeated measured sentence is ambiguous; explicit ID disambiguates', async () => fixture(async (project, source) => {
  const semantic = path.join(project, 'semantic.json');
  fs.writeFileSync(semantic, JSON.stringify({ duration: 6, composition: { sha256: hash(source) }, cues: [
    { id: 'first', phrase: 'same sentence', status: 'aligned', start: 0, end: 2 },
    { id: 'second', phrase: 'same sentence', status: 'aligned', start: 2, end: 4 },
  ] }));
  await assert.rejects(createPlan({ project, operation: 'cut', semantic, selector: { kind: 'text', value: 'same sentence' } }), /Ambiguous/);
  assert.equal((await createPlan({ project, operation: 'cut', semantic, selector: { kind: 'cue', value: 'second' } })).status, 'ready');
}));

test('semantic cue without composition binding is refused', async () => fixture(async project => {
  const semantic = path.join(project, 'semantic.json'); fs.writeFileSync(semantic, JSON.stringify({ duration: 6, cues: [{ id: 'x', status: 'aligned', start: 2, end: 4 }] }));
  await assert.rejects(createPlan({ project, semantic, operation: 'cut', selector: { kind: 'cue', value: 'x' } }), /composition.sha256/);
}));

test('nested, nonempty tween, and automation are pending, never applied', async () => {
  for (const source of [html('<script>tl.to("#video0",{x:4},2);</script>'), html().replace('data-evocut-cue="cue1"', 'data-composition-src="nested.html" data-evocut-cue="cue1"'), html().replace('id="music"', 'id="music" data-automation="{}"')]) {
    await fixture(async project => {
      const plan = await createPlan(request(project)); assert.equal(plan.status, 'pending'); assert.ok(plan.pending.length);
      await assert.rejects(applyPlan(plan, { apply: true }), /pending/);
    }, source);
  }
});

test('empty GSAP registration boilerplate is allowed', async () => fixture(async project => {
  assert.equal((await createPlan(request(project))).status, 'ready');
}, html('<script>const tl = gsap.timeline({paused:true}); window.__timelines = window.__timelines || {}; window.__timelines["fixture"] = tl;</script>')));

test('unlinked timed clip and partial BGM are pending', async () => {
  for (const source of [html().replace('data-evocut-link="g2"', ''), html().replace('id="music" class="clip" data-start="0" data-duration="6"', 'id="music" class="clip" data-start="0" data-duration="5"')]) await fixture(async project => {
    assert.equal((await createPlan(request(project))).status, 'pending');
  }, source);
});

test('linked move into an empty gap moves all tracks and leaves BGM continuous', async () => fixture(async project => {
  const plan = await createPlan({ project, operation: 'move', by: 2, selector: { kind: 'section', value: 'scene' } });
  assert.equal(plan.status, 'ready'); assert.equal(plan.afterDuration, 6); assert.equal(plan.edits.length, 4);
  const applied = await applyPlan(plan, { apply: true });
  const m = inspectHtml(fs.readFileSync(path.join(project, 'index.html'), 'utf8'));
  assert.ok(m.clips.filter(c => c.role !== 'bgm').every(c => c.start === 2));
  assert.equal(m.clips.find(c => c.role === 'bgm').duration, 6);
  await undoReceipt(applied.receipt, { apply: true });
}, html('', ['video', 'voice', 'subtitle', 'sfx'].map(role => clip(role, 0, 2, role, 'group', 'data-evocut-section="scene"')).join('') + clip('music', 0, 6, 'bgm', 'bed'))));

test('move outside root duration or into occupied track is pending', async () => fixture(async project => {
  for (const by of [2, 20]) assert.equal((await createPlan({ ...request(project), operation: 'move', by })).status, 'pending');
}));

test('local remake fingerprints existing assets but does not replace or generate', async () => fixture(async (project, source) => {
  const asset = path.join(project, 'dummy.mp4'); fs.writeFileSync(asset, 'not-real-media; fingerprint fixture only');
  const req = await createRemake({ project, selector: { kind: 'cue', value: 'cue1' }, prompt: 'More energetic, same character, 2 seconds' });
  assert.equal(req.paidRequests, 0); assert.equal(req.constraints.noProviderInvoked, true);
  assert.equal(req.constraints.replacementImplemented, false); assert.equal(req.shots.length, 1);
  assert.equal(req.inputs.find(i => i.path === fs.realpathSync(asset)).sha256, hash(fs.readFileSync(asset)));
  assert.equal(fs.readFileSync(path.join(project, 'index.html'), 'utf8'), source);
}, html().replace('id="video1"', 'id="video1" src="dummy.mp4"')));

test('CLI range parsing, explicit apply opt-in, and JSON integer status', async () => {
  assert.deepEqual(parseEditArgs(['plan', '--operation=cut', '--range', '2:4']).opts.selector.value, [2, 4]);
  assert.throws(() => parseEditArgs(['plan', '--cue', 'a', '--section', 'b']), /exactly one/);
  assert.throws(() => parseEditArgs(['remake', '--cue', 'a', '--apply']), /never applies/);
  const original = console.log; const output = []; console.log = s => output.push(s);
  try { assert.equal(await main(['help']), 0); assert.equal(await main(['not-a-command']), 2); } finally { console.log = original; }
  assert.ok(output.every(s => JSON.parse(s)));
});

test('apply rejects cross-command flags before any fixture content or history mutation', async () => fixture(async (project, source) => {
  const plan = await createPlan(request(project)), file = path.join(project, 'reviewed-plan.json');
  fs.writeFileSync(file, JSON.stringify(plan));
  const original = console.log, output = []; console.log = s => output.push(s);
  try {
    for (const flags of [['--out', path.join(project, 'should-not-exist.json')], ['--project', path.join(project, 'wrong-project')],
      ['--operation', 'move'], ['--semantic', 'other.json'], ['--engine-version', '0.8.81'], ['--prompt', 'ignored']]) {
      assert.equal(await main(['apply', file, '--apply', ...flags]), 2);
      assert.equal(fs.readFileSync(path.join(project, 'index.html'), 'utf8'), source);
      assert.equal(fs.existsSync(path.join(project, '.hyperframes')), false);
    }
  } finally { console.log = original; }
  assert.ok(output.every(s => /no action executed/.test(JSON.parse(s).error)));
  assert.equal(fs.existsSync(path.join(project, 'should-not-exist.json')), false);
}));

test('undo rejects unsupported destination/options before restoring content or changing receipt', async () => fixture(async project => {
  const applied = await applyPlan(await createPlan(request(project)), { apply: true });
  const after = fs.readFileSync(path.join(project, 'index.html'), 'utf8'), receipt = fs.readFileSync(applied.receipt, 'utf8');
  const original = console.log; console.log = () => {};
  try {
    for (const flags of [['--out', path.join(project, 'bad.json')], ['--project', 'elsewhere'], ['--range', '0:2']]) {
      assert.equal(await main(['undo', applied.receipt, '--apply', ...flags]), 2);
      assert.equal(fs.readFileSync(path.join(project, 'index.html'), 'utf8'), after);
      assert.equal(fs.readFileSync(applied.receipt, 'utf8'), receipt);
    }
  } finally { console.log = original; }
  assert.equal((await undoReceipt(applied.receipt, { apply: true })).status, 'undone');
}));

test('plan/remake reject stray positionals and unrelated flags before creating any state', async () => fixture(async (project, source) => {
  const original = console.log; console.log = () => {};
  try {
    for (const args of [
      ['plan', 'other-project', '--project', project, '--operation', 'cut', '--cue', 'cue1'],
      ['plan', '--project', project, '--operation', 'cut', '--cue', 'cue1', '--by', '1'],
      ['plan', '--project', project, '--operation', 'cut', '--cue', 'cue1', '--prompt', 'ignored'],
      ['remake', 'extra', '--project', project, '--cue', 'cue1', '--prompt', 'new performance'],
      ['remake', '--project', project, '--cue', 'cue1', '--prompt', 'new performance', '--operation', 'move'],
    ]) assert.equal(await main(args), 2);
  } finally { console.log = original; }
  assert.equal(fs.readFileSync(path.join(project, 'index.html'), 'utf8'), source);
  assert.equal(fs.existsSync(path.join(project, '.hyperframes')), false);
}));
