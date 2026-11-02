import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type BrowserContext } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { recipeSchema, checkIdentity } from '../src/model.js';
import { action, executeTake, previewIdentity, reset } from '../src/runner.js';

const title = 'Red Black Bold Graphic Designer Resume';
const identity = { templateId: 'FIXTURE-ASSET', designType: 'FIXTURE-TYPE', nativeTitle: title };

async function fixture(context: BrowserContext, missing = false, wrongIdentity = false) {
  await context.route('https://www.canva.com/**', async route => {
    const url = new URL(route.request().url());
    let content: string;
    let color: string;
    if (url.pathname.startsWith('/design/')) {
      color = '#00ff00';
      content = `<h1>Canva editor</h1><input aria-label="Design title" value="${title}"><main aria-label="Canvas"><div role="application" aria-label="Canvas content">Editable resume fixture</div></main>`;
    } else {
      color = url.searchParams.has('query') ? '#ffff00' : url.pathname === '/' ? '#ff0000' : '#ff8800';
      const result = url.searchParams.has('query') && !missing
        ? `<button onclick="document.querySelector('#preview').hidden=false">Preview, ${title}, template</button>` : '';
      content = `<nav aria-label="Main menu"><a href="/templates">Templates</a></nav>
        <h2>What will you Canva today?</h2><main><a href="/unrelated">Templates</a>
        ${url.pathname !== '/' ? `<input type="search" aria-label="Search millions of templates" onkeydown="if(event.key==='Enter')location.href='/s/templates?query='+encodeURIComponent(this.value)">` : ''}
        ${result}</main><div id="preview" role="dialog" hidden>
        <h1>${title}</h1><a href="/not-the-editor">Customise this template</a>
        <a aria-label="Customise this template (opens in a new tab or window)" target="_blank"
        href="/design/editor/shell?create&type=FIXTURE-TYPE&template=${wrongIdentity ? 'OTHER-ASSET' : identity.templateId}&analyticsCorrelationId=changing">Open editor</a></div>`;
    }
    await route.fulfill({ contentType: 'text/html', body: `<html lang="en-AU"><head><title>Canva fixture</title><style>html,body{margin:0;min-height:100%;background:${color};font:32px sans-serif} [hidden]{display:none!important} #preview{position:fixed;inset:0;background:#0000ff;color:white}</style></head><body>${content}</body></html>` });
  });
}

async function recipe() {
  const r = recipeSchema.parse(JSON.parse(await readFile('recipes/english-test.json', 'utf8')));
  // Shorter editorial pauses keep the fixture quick without bypassing waits.
  return { ...r, steps: r.steps.map(s => ({ ...s, pauseMs: 250 })) };
}

test('complete fixture route records the search and popup editor on one video timeline', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LOCALISE_TEST_CHROMIUM });
  const folder = await mkdtemp(join(tmpdir(), 'flow-multi-tab-'));
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await fixture(context);
    const page = await context.newPage(); page.setDefaultTimeout(3000);
    const r = await recipe();
    await reset(page, r); // preflight traverses the search route and reads identity
    await action(page, r, 0); await action(page, r, 1); await action(page, r, 2);
    checkIdentity((await previewIdentity(page, r)).identity, identity);
    await reset(page, r); // then resets to the real start before capture
    await executeTake(context, page, r, identity, folder);
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
    assert.equal(manifest.status, 'awaiting-review');
    assert.equal(manifest.capture.pages, 2);
    assert.equal(manifest.technical, 'passed');
    assert.equal(manifest.languageReview, 'pending'); assert.equal(manifest.creativeReview, 'pending');
    const steps = JSON.parse(await readFile(join(folder, 'steps.json'), 'utf8'));
    assert.deepEqual(steps.map((s: { id: string }) => s.id), ['templates', 'search', 'choose', 'editor']);
    const source = JSON.parse(await readFile(join(folder, 'frames.json'), 'utf8'));
    assert.ok(source.frames.some((f: { page: number }) => f.page === 0));
    assert.ok(source.frames.some((f: { page: number }) => f.page === 1));
    const pixelAt = (seconds: number) => execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-ss', String(seconds),
      '-i', join(folder, 'clip.mp4'), '-frames:v', '1', '-vf', 'crop=2:2:1900:1060,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const first = pixelAt(0.2); const last = pixelAt(manifest.media.duration - 0.2);
    const search = pixelAt((steps[1].endMs - 100) / 1000);
    const preview = pixelAt((steps[2].endMs - 100) / 1000);
    assert.ok(first[0] > 220 && first[1] < 30, 'initial home page must be present in the delivered MP4');
    assert.ok(search[0] > 220 && search[1] > 220 && search[2] < 30, 'search results must be present in the delivered MP4');
    assert.ok(preview[2] > 220 && preview[0] < 30, 'template preview must be present in the delivered MP4');
    assert.ok(last[1] > 220 && last[0] < 30, 'new editor tab must be present in the delivered MP4');
  } finally { await browser.close(); await rm(folder, { recursive: true, force: true }); }
});

test('a missing chosen template stops the search without opening an editor', async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LOCALISE_TEST_CHROMIUM });
  try {
    const context = await browser.newContext(); await fixture(context, true);
    const page = await context.newPage(); page.setDefaultTimeout(500);
    const r = await recipe(); await reset(page, r); await action(page, r, 0);
    await assert.rejects(action(page, r, 1), /No replacement was selected/);
    assert.equal(context.pages().length, 1);
  } finally { await browser.close(); }
});

test('a changed template ID makes a failed attempt and never opens the editor', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LOCALISE_TEST_CHROMIUM });
  const folder = await mkdtemp(join(tmpdir(), 'flow-wrong-identity-'));
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await fixture(context, false, true);
    const page = await context.newPage(); page.setDefaultTimeout(3000);
    const r = await recipe(); await reset(page, r);
    await assert.rejects(executeTake(context, page, r, identity, folder), /identity changed/);
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
    assert.equal(manifest.status, 'failed'); assert.equal(manifest.technical, 'failed');
    assert.equal(context.pages().length, 1);
  } finally { await browser.close(); await rm(folder, { recursive: true, force: true }); }
});
