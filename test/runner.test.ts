import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { choiceTarget, hash, recipeSchema, unique, validateTiming, type Recipe } from '../src/model.js';
import { finishMedia } from '../src/media.js';

test('unconfigured sample cannot be approved or run', async () => {
  assert.equal(recipeSchema.safeParse(JSON.parse(await readFile('recipes/example.json', 'utf8'))).success, false);
});

test('recipe hash invalidates approval when the query changes', () => {
  const a = { query: 'one' } as Recipe;
  assert.notEqual(hash(a), hash({ ...a, query: 'two' }));
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

test('browser checks reject ambiguity and changed identity; recording produces valid media', async () => {
  const browser = await chromium.launch({ headless: true });
  const folder = await mkdtemp(join(tmpdir(), 'flow-localise-test-'));
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(1000);
    await page.setContent('<html lang="th"><body><h1>แม่แบบ</h1><a href="https://www.canva.com/templates/approved">Approved</a><a href="https://www.canva.com/templates/other">Other</a></body></html>');
    const recipe = { steps: [{}, {}, { target: { role: 'link', name: 'Approved' } }], choice: { href: 'https://www.canva.com/templates/approved' } } as Recipe;
    await choiceTarget(page, recipe);
    await page.evaluate(() => { const a = document.querySelector('a')!; a.parentElement!.append(a); });
    await choiceTarget(page, recipe); // identity survives reordered results
    await page.getByRole('link', { name: 'Approved', exact: true }).evaluate(el => el.setAttribute('href', '/templates/different'));
    await assert.rejects(choiceTarget(page, recipe), /identity changed/);
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<button>Duplicate</button><button>Duplicate</button>'));
    await assert.rejects(unique(page, { role: 'button', name: 'Duplicate' }), /Ambiguous/);
    await page.screencast.start({ path: join(folder, 'source.webm'), size: { width: 1920, height: 1080 }, fps: 25 });
    await page.waitForTimeout(500);
    for (const title of ['Templates', 'Search', 'Choose', 'Editor']) {
      await page.locator('h1').evaluate((el, value) => { el.textContent = value; }, title);
      await page.waitForTimeout(500);
    }
    await page.screencast.stop();
    const timings = ['templates', 'search', 'choose', 'editor'].map((id, i) => ({ id, startMs: 500 + i * 500, endMs: 900 + i * 500 }));
    const media = finishMedia(folder, timings);
    assert.equal(media.width, 1920); assert.equal(media.height, 1080);
    assert.equal(media.fps, 25); assert.equal(media.decode, 'passed');
  } finally { await browser.close(); await rm(folder, { recursive: true, force: true }); }
});
