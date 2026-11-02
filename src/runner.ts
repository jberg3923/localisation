import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdir, readFile, writeFile, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { choiceTarget, hash, unique, type Recipe, type Timing } from './model.js';
import { checkTools, finishMedia } from './media.js';

export const dataHome = join(homedir(), 'Library', 'Application Support', 'Flow Localise');
export const profile = join(dataHome, 'canva-demo-profile');
export async function withBrowser<T>(locale: string, headless: boolean, fn: (context: BrowserContext, page: Page) => Promise<T>) {
  await mkdir(dataHome, { recursive: true, mode: 0o700 });
  const lock = join(dataHome, 'account.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch { throw new Error(`Another session is active, or a prior run crashed. Close all app browsers before removing ${lock}`); }
  let context: BrowserContext | undefined;
  try {
    await handle.writeFile(String(process.pid));
    context = await chromium.launchPersistentContext(profile, { headless, locale,
      viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    context.setDefaultTimeout(15000);
    const page = context.pages()[0] ?? await context.newPage();
    for (const other of context.pages()) if (other !== page) await other.close();
    return await fn(context, page);
  } finally {
    try { await context?.close(); } finally { await handle.close(); await unlink(lock); }
  }
}

async function ready(page: Page, r: Recipe) {
  await page.goto(r.startUrl, { waitUntil: 'domcontentloaded' });
  const lang = await page.locator('html').getAttribute('lang');
  if (!lang || lang.toLowerCase() !== r.uiLanguage.toLowerCase())
    throw new Error(`Page language is ${lang ?? 'unknown'}, expected ${r.uiLanguage}. Change the Canva account language manually, then prepare again.`);
  await unique(page, r.startReady);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  if (await page.locator('[role="dialog"]:visible').count()) throw new Error('Unexpected dialog at lesson start');
}

async function action(page: Page, r: Recipe, i: number) {
  if (await page.locator('[role="dialog"]:visible').count()) throw new Error('Unexpected dialog: return to preparation');
  const s = r.steps[i];
  const target = i === 2 ? await choiceTarget(page, r) : await unique(page, s.target);
  if (s.action === 'search') { await target.fill(r.query); await target.press('Enter'); }
  else await target.click();
  await unique(page, s.after);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(s.pauseMs);
}

export async function prepare(r: Recipe, confirm: (prompt: string) => Promise<void>) {
  return withBrowser(r.locale, false, async (context, page) => {
    let extraTab = false;
    context.on('page', () => { extraTab = true; });
    await ready(page, r);
    await action(page, r, 0); await action(page, r, 1);
    const candidate = await choiceTarget(page, r);
    const folder = join(dataHome, 'preparations', randomUUID());
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await candidate.screenshot({ path: join(folder, 'candidate.png') });
    await confirm(`Check the live page, account/workspace (${r.accountContext}), UI language, query "${r.query}" and template "${r.choice.nativeTitle}". Approve this choice?`);
    await action(page, r, 2); await action(page, r, 3);
    if (extraTab) throw new Error('Canva opened another tab. This capture adapter cannot follow tabs yet; live feasibility is blocked.');
    await confirm('Verify that the approved template is editable and all visible language/font rendering is correct. Confirm?');
    await ready(page, r);
    await confirm('Verify reset: the browser is back at the clean lesson start with no editor or onboarding overlays. Confirm?');
    const preparation = { recipeHash: hash(r), locale: r.locale, accountContext: r.accountContext,
      choice: r.choice, observedUiLanguage: r.uiLanguage, createdAt: new Date().toISOString(),
      choiceApproved: true, endpointAndResetHumanChecked: true, browserMode: 'headed', profile,
      limitations: ['same-page capture only', 'live account identity and visual language verified by operator'] };
    const path = join(folder, 'preparation.json');
    await writeFile(path, JSON.stringify(preparation, null, 2), { mode: 0o600 });
    return path;
  });
}

export async function record(r: Recipe, preparationPath: string, confirm: (prompt: string) => Promise<void>) {
  checkTools();
  const prepared = JSON.parse(await readFile(preparationPath, 'utf8'));
  if (prepared.recipeHash !== hash(r) || prepared.profile !== profile || prepared.choiceApproved !== true ||
      !prepared.endpointAndResetHumanChecked || Date.now() - Date.parse(prepared.createdAt) > 86400000 ||
      !Number.isFinite(Date.parse(prepared.createdAt))) throw new Error('Preparation is stale, incompatible or unapproved. Prepare again.');
  return withBrowser(r.locale, false, async (context, page) => {
    await ready(page, r);
    await action(page, r, 0); await action(page, r, 1); await choiceTarget(page, r);
    await ready(page, r);
    await confirm(`Confirm the correct demo account/workspace (${r.accountContext}), language and clean start. Begin a take?`);
    const folder = join(process.cwd(), 'outputs', hash(r).slice(0, 12), r.locale, randomUUID());
    await mkdir(join(folder, 'diagnostics'), { recursive: true, mode: 0o700 });
    const steps: Timing[] = [];
    const manifest: Record<string, unknown> = { recipeHash: hash(r), requestedLocale: r.locale,
      observedUiLanguage: r.uiLanguage, preparationId: preparationPath.split('/').at(-2),
      choice: r.choice, createdAt: new Date().toISOString(), technical: 'pending',
      languageReview: 'pending', creativeReview: 'pending', status: 'recording' };
    let extraTab = false, recording = false;
    context.on('page', () => { extraTab = true; });
    try {
      await page.screencast.start({ path: join(folder, 'source.webm'), size: { width: 1920, height: 1080 }, fps: 25 });
      recording = true;
      const start = performance.now();
      await page.waitForTimeout(1000);
      for (let i = 0; i < r.steps.length; i++) {
        const startMs = Math.round(performance.now() - start);
        await action(page, r, i);
        if (extraTab) throw new Error('Unexpected new tab: capture cannot include the full lesson. Return to preparation.');
        steps.push({ id: r.steps[i].id, startMs, endMs: Math.round(performance.now() - start) });
      }
      await page.waitForTimeout(1000);
      await page.screencast.stop(); recording = false;
      await writeFile(join(folder, 'steps.json'), JSON.stringify(steps, null, 2));
      manifest.media = finishMedia(folder, steps);
      manifest.technical = 'passed'; manifest.status = 'awaiting-review';
    } catch (error) {
      manifest.status = 'failed'; manifest.technical = 'failed';
      manifest.reason = error instanceof Error ? error.message : 'Unknown failure';
      await page.screenshot({ path: join(folder, 'diagnostics', 'failed.png') }).catch(() => {});
      throw new Error(`Take failed; diagnostics retained in ${folder}. ${manifest.reason}`);
    } finally {
      if (recording) await page.screencast.stop().catch(() => {});
      await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));
    }
    return folder;
  });
}
