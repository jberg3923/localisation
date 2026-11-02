import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdir, readFile, writeFile, open, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { checkIdentity, hash, templateIdentity, unique, type ChoiceIdentity, type Recipe, type Timing } from './model.js';
import { checkTools, finishMedia } from './media.js';
import { Capture } from './capture.js';

export const adapterVersion = 2;
export const dataHome = join(homedir(), 'Library', 'Application Support', 'Flow Localise');
export const profile = join(dataHome, 'canva-demo-profile');
export async function withBrowser<T>(locale: string, headless: boolean, fn: (context: BrowserContext, page: Page) => Promise<T>) {
  await mkdir(dataHome, { recursive: true, mode: 0o700 });
  const lock = join(dataHome, 'account.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch { throw new Error(`Another session is active, or a prior run crashed. Close all app browsers before removing ${lock}`); }
  let context: BrowserContext | undefined;
  let interrupted = false;
  const interrupt = () => { interrupted = true; void context?.close().catch(() => {}); };
  process.once('SIGINT', interrupt);
  try {
    await handle.writeFile(String(process.pid));
    context = await chromium.launchPersistentContext(profile, { headless, locale,
      viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    if (interrupted) throw new Error('Cancelled');
    context.setDefaultTimeout(15000);
    const page = context.pages()[0] ?? await context.newPage();
    for (const other of context.pages()) if (other !== page) await other.close();
    return await fn(context, page);
  } finally {
    process.removeListener('SIGINT', interrupt);
    try { await context?.close(); } finally { await handle.close(); await unlink(lock); }
  }
}

async function checkLanguage(page: Page, r: Recipe) {
  const lang = await page.locator('html').getAttribute('lang');
  if (!lang || lang.toLowerCase() !== r.uiLanguage.toLowerCase())
    throw new Error(`Page language is ${lang ?? 'unknown'}, expected ${r.uiLanguage}. Change the Canva account language manually, then prepare again.`);
}

async function noDialogs(page: Page) {
  if (await page.getByRole('dialog').count()) throw new Error('Unexpected dialog: return to preparation');
}

export async function reset(page: Page, r: Recipe) {
  await page.bringToFront();
  await page.goto(r.startUrl, { waitUntil: 'domcontentloaded' });
  await unique(page, r.startReady);
  await checkLanguage(page, r);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await noDialogs(page);
}

export async function action(page: Page, r: Recipe, i: number) {
  if (i >= 3) throw new Error('Use openEditor for the editor transition');
  await noDialogs(page);
  const s = r.steps[i];
  console.log(`  ${s.id}: ${s.target.name}`);
  let target;
  try { target = await unique(page, s.target); }
  catch (error) {
    if (i === 2) throw new Error(`The approved template "${r.choice.nativeTitle}" is missing or ambiguous. No replacement was selected. Prepare again.`, { cause: error });
    throw error;
  }
  if (s.action === 'search') { await target.fill(r.query); await target.press('Enter'); }
  else await target.click();
  try { await unique(page, s.after); }
  catch (error) {
    if (i === 1) throw new Error(`Search completed but the approved template "${r.choice.nativeTitle}" was not uniquely available. No replacement was selected.`, { cause: error });
    throw error;
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await checkLanguage(page, r);
  await page.waitForTimeout(s.pauseMs);
}

export async function previewIdentity(page: Page, r: Recipe) {
  const dialogs = page.getByRole('dialog');
  if (await dialogs.count() !== 1) throw new Error('Expected exactly one template preview dialog');
  const heading = dialogs.getByRole('heading', { name: r.choice.previewHeading, exact: true });
  await heading.waitFor({ state: 'visible' });
  if (await heading.count() !== 1) throw new Error('Template preview heading is ambiguous');
  const link = dialogs.getByRole('link', { name: r.choice.editorLink, exact: true });
  await link.first().waitFor({ state: 'visible' });
  if (await link.count() !== 1) throw new Error('Editor link is ambiguous');
  const href = await link.getAttribute('href');
  if (!href) throw new Error('Template preview has no editor link identity');
  const identity = templateIdentity(href, r.choice.nativeTitle);
  const title = await heading.innerText();
  if (title.trim() !== r.choice.nativeTitle) throw new Error('Preview title does not match the approved template title');
  return { link, identity, dialog: dialogs };
}

export async function openEditor(page: Page, r: Recipe, expected: ChoiceIdentity, capture?: Capture) {
  const preview = await previewIdentity(page, r);
  checkIdentity(preview.identity, expected);
  console.log('  editor: opening the approved template in a new tab');
  let follow: Promise<void> | undefined;
  const followPopup = (popup: Page) => {
    follow = capture?.follow(popup);
    void follow?.catch(() => {});
  };
  page.once('popup', followPopup);
  const popupPromise = page.waitForEvent('popup', { timeout: 15000 });
  void popupPromise.catch(() => {});
  let editor: Page;
  try {
    await preview.link.click();
    editor = await popupPromise;
    if (await editor.opener() !== page) throw new Error('Editor tab has an unexpected opener');
    await follow;
    await editor.waitForLoadState('domcontentloaded');
    const url = new URL(editor.url());
    if (url.origin !== 'https://www.canva.com' || !url.pathname.startsWith('/design/')) throw new Error('Unexpected editor destination');
    await unique(editor, r.steps[3].after);
    const title = await unique(editor, { role: 'textbox', name: 'Design title' });
    if (!await title.isEditable() || await title.inputValue() !== expected.nativeTitle)
      throw new Error('Editor title or editability does not match the approved template');
    await unique(editor, { role: 'application', name: 'Canvas content' });
    await checkLanguage(editor, r);
    await noDialogs(editor);
    await editor.evaluate(() => document.fonts.ready.then(() => undefined));
    await editor.waitForTimeout(r.steps[3].pauseMs);
    return editor;
  } finally { page.off('popup', followPopup); }
}

type Confirm = (prompt: string) => Promise<void>;
type Preparation = {
  adapterVersion: number; recipeHash: string; locale: string; profile: string;
  identity: ChoiceIdentity; createdAt: string; choiceApproved: boolean;
  endpointAndResetHumanChecked: boolean;
};

export function validatePreparation(prepared: Preparation, r: Recipe) {
  const age = Date.now() - Date.parse(prepared.createdAt);
  if (prepared.adapterVersion !== adapterVersion || prepared.recipeHash !== hash(r) ||
      prepared.profile !== profile || prepared.choiceApproved !== true || !prepared.endpointAndResetHumanChecked ||
      !Number.isFinite(age) || age < 0 || age > 86400000 ||
      !prepared.identity?.templateId || !prepared.identity?.designType || prepared.identity.nativeTitle !== r.choice.nativeTitle)
    throw new Error('Preparation is stale, incompatible or unapproved. Prepare again.');
}

export async function prepare(r: Recipe, confirm: Confirm) {
  return withBrowser(r.locale, false, async (context, page) => {
    await reset(page, r);
    await action(page, r, 0); await action(page, r, 1); await action(page, r, 2);
    if (context.pages().length !== 1) throw new Error('Unexpected tab during preparation');
    const preview = await previewIdentity(page, r);
    const folder = join(dataHome, 'preparations', randomUUID());
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await preview.dialog.screenshot({ path: join(folder, 'candidate.png') });
    await confirm(`Check the live preview, signed-in account/workspace, UI language and query "${r.query}".\nApprove "${r.choice.nativeTitle}" (template ${preview.identity.templateId})?`);
    const editor = await openEditor(page, r, preview.identity);
    if (context.pages().length !== 2) throw new Error('Unexpected additional tabs during editor opening');
    await confirm('Check that this is the approved resume, its content is editable, and the language and fonts look correct. Confirm?');
    await editor.close();
    await reset(page, r);
    await confirm('Check reset: the browser is back at the clean Canva home screen with no editor or unexpected overlays. Confirm?');
    const prepared: Preparation = { adapterVersion, recipeHash: hash(r), locale: r.locale, profile,
      identity: preview.identity, createdAt: new Date().toISOString(), choiceApproved: true, endpointAndResetHumanChecked: true };
    const path = join(folder, 'preparation.json');
    await writeFile(path, JSON.stringify(prepared, null, 2), { mode: 0o600 });
    return path;
  });
}

export async function executeTake(context: BrowserContext, page: Page, r: Recipe, identity: ChoiceIdentity, folder: string, preparationId?: string) {
  const steps: Timing[] = [];
  const capture = new Capture(folder);
  const baseline = context.pages().length;
  const manifest: Record<string, unknown> = { adapterVersion, recipeHash: hash(r), requestedLocale: r.locale,
    observedUiLanguage: r.uiLanguage, choice: identity, preparationId, createdAt: new Date().toISOString(),
    technical: 'pending', languageReview: 'pending', creativeReview: 'pending', status: 'recording' };
  let current = page;
  let stopped = false;
  await mkdir(join(folder, 'diagnostics'), { recursive: true, mode: 0o700 });
  await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));
  try {
    await capture.follow(page);
    await page.waitForTimeout(1000);
    for (let i = 0; i < 4; i++) {
      const startMs = capture.elapsed();
      if (i === 3) current = await openEditor(page, r, identity, capture);
      else await action(page, r, i);
      if (context.pages().length !== baseline + (i === 3 ? 1 : 0)) throw new Error('Unexpected tab opened or closed during the lesson');
      if (i === 2) checkIdentity((await previewIdentity(page, r)).identity, identity);
      steps.push({ id: r.steps[i].id, startMs, endMs: capture.elapsed() });
    }
    await current.waitForTimeout(1000);
    stopped = true;
    await capture.stop();
    manifest.status = 'processing';
    await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));
    manifest.capture = capture.renderSource();
    await writeFile(join(folder, 'steps.json'), JSON.stringify(steps, null, 2));
    manifest.media = finishMedia(folder, steps);
    manifest.technical = 'passed'; manifest.status = 'awaiting-review';
    return folder;
  } catch (error) {
    manifest.status = 'failed'; manifest.technical = 'failed';
    manifest.reason = error instanceof Error ? error.message : 'Unknown failure';
    await current.screenshot({ path: join(folder, 'diagnostics', 'failed.png') }).catch(() => {});
    throw new Error(`Take failed; diagnostics retained in ${folder}. ${manifest.reason}`);
  } finally {
    if (!stopped) await capture.stop().catch(() => {});
    await writeFile(join(folder, 'steps.json'), JSON.stringify(steps, null, 2));
    await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
}

export async function record(r: Recipe, preparationPath: string, confirm: Confirm) {
  checkTools();
  const prepared: Preparation = JSON.parse(await readFile(preparationPath, 'utf8'));
  validatePreparation(prepared, r);
  return withBrowser(r.locale, false, async (context, page) => {
    await reset(page, r);
    await action(page, r, 0); await action(page, r, 1); await action(page, r, 2);
    checkIdentity((await previewIdentity(page, r)).identity, prepared.identity);
    await reset(page, r);
    if (context.pages().length !== 1) throw new Error('Unexpected tab during preflight');
    await confirm('Confirm the correct account/workspace, UI language and clean lesson start. Begin recording?');
    validatePreparation(prepared, r);
    await page.bringToFront(); await noDialogs(page); await checkLanguage(page, r); await unique(page, r.startReady);
    const folder = join(process.cwd(), 'outputs', hash(r).slice(0, 12), r.locale, randomUUID());
    return executeTake(context, page, r, prepared.identity, folder, basename(dirname(preparationPath)));
  });
}
