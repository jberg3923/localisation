import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { checkIdentity, hash, recipeSchema, templateIdentity, unique, validateTiming, type Recipe } from '../src/model.js';
import { finishMedia } from '../src/media.js';
import { adapterVersion, profile, validatePreparation } from '../src/runner.js';

test('unconfigured sample cannot be approved or run', async () => {
  assert.equal(recipeSchema.safeParse(JSON.parse(await readFile('recipes/example.json', 'utf8'))).success, false);
});

test('recipe hash invalidates approval when the query changes', () => {
  const a = { query: 'one' } as Recipe;
  assert.notEqual(hash(a), hash({ ...a, query: 'two' }));
});

test('template identity ignores tracking but rejects replacements and foreign destinations', () => {
  const one = templateIdentity('/design/editor/shell?create&type=TYPE&template=ASSET&analyticsCorrelationId=1', 'Resume');
  const two = templateIdentity('/design/editor/shell?template=ASSET&type=TYPE&create&analyticsCorrelationId=2', 'Resume');
  checkIdentity(one, two);
  assert.throws(() => checkIdentity(one, { ...two, templateId: 'REPLACEMENT' }), /identity changed/);
  assert.throws(() => templateIdentity('https://example.com/design/editor/shell?create&type=TYPE&template=ASSET', 'Resume'));
  assert.throws(() => templateIdentity('/design/editor/shell?create&type=TYPE', 'Resume'));
});

test('English recipe validates and expired, future, changed, or unapproved preparations fail', async () => {
  const recipe = recipeSchema.parse(JSON.parse(await readFile('recipes/english-test.json', 'utf8')));
  const prepared = { adapterVersion, profile, recipeHash: hash(recipe), locale: recipe.locale,
    identity: { templateId: 'ASSET', designType: 'TYPE', nativeTitle: recipe.choice.nativeTitle },
    createdAt: new Date().toISOString(), choiceApproved: true, endpointAndResetHumanChecked: true };
  validatePreparation(prepared, recipe);
  for (const changed of [
    { ...prepared, choiceApproved: false }, { ...prepared, adapterVersion: 1 },
    { ...prepared, createdAt: new Date(Date.now() - 86401000).toISOString() },
    { ...prepared, createdAt: new Date(Date.now() + 60000).toISOString() },
    { ...prepared, recipeHash: 'changed' }
  ]) assert.throws(() => validatePreparation(changed, recipe), /Prepare again/);
});

test('timing rejects missing, overlapping and out-of-bounds teaching steps', () => {
  const steps = ['templates', 'search', 'choose', 'editor'].map((id, i) => ({ id, startMs: i * 100, endMs: (i + 1) * 100 }));
  validateTiming(steps, 1);
  assert.throws(() => validateTiming(steps.slice(1), 1));
  assert.throws(() => validateTiming([{ ...steps[0], endMs: 9999 }, ...steps.slice(1)], 1));
  assert.throws(() => validateTiming([steps[0], { ...steps[1], startMs: 0 }, ...steps.slice(2)], 1));
});

test('media pipeline encodes and decodes silent 1080p25 with bounded step timings', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'flow-localise-media-'));
  try {
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
      'testsrc2=size=1920x1080:rate=25:duration=3', '-c:v', 'libvpx', '-threads', '2',
      '-deadline', 'realtime', join(folder, 'source.webm')]);
    const timings = ['templates', 'search', 'choose', 'editor'].map((id, i) => ({ id, startMs: 100 + i * 500, endMs: 500 + i * 500 }));
    const media = finishMedia(folder, timings);
    assert.equal(media.width, 1920); assert.equal(media.height, 1080);
    assert.equal(media.fps, 25); assert.equal(media.silent, true); assert.equal(media.decode, 'passed');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('browser checks reject ambiguity and find named targets after result reordering', async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LOCALISE_TEST_CHROMIUM });
  const folder = await mkdtemp(join(tmpdir(), 'flow-localise-test-'));
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(1000);
    await page.setContent('<html lang="th"><body><h1>แม่แบบ</h1><a href="https://www.canva.com/templates/approved">Approved</a><a href="https://www.canva.com/templates/other">Other</a></body></html>');
    await unique(page, { role: 'link', name: 'Approved' });
    await page.evaluate(() => { const a = document.querySelector('a')!; a.parentElement!.append(a); });
    await unique(page, { role: 'link', name: 'Approved' });
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<button>Duplicate</button><button>Duplicate</button>'));
    await assert.rejects(unique(page, { role: 'button', name: 'Duplicate' }), /Ambiguous/);
  } finally { await browser.close(); await rm(folder, { recursive: true, force: true }); }
});
