import { createInterface } from 'node:readline/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Kept standalone so an existing Mac installation can use this helper without
// replacing its project folder, local evidence, dependencies or private profile.
export async function inspectTabs(context) {
  const tabs = [];
  for (const [index, page] of context.pages().entries()) {
    if (page.isClosed()) continue;
    const url = page.url();
    let hostname;
    try { hostname = new URL(url).hostname; } catch { /* Internal/blank tab. */ }
    // Do not collect a login provider or unrelated site that opened alongside Canva.
    if (hostname !== 'www.canva.com') {
      tabs.push({ index, status: 'excluded', reason: 'Not a www.canva.com page' });
      continue;
    }
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      tabs.push({ index, status: 'captured', url: page.url(), title: await page.title(),
        lang: await page.locator('html').getAttribute('lang'),
        accessibility: await page.locator('body').ariaSnapshot(),
        links: await page.getByRole('link').evaluateAll(elements => elements.map(el => ({
          title: el.textContent, href: el.href
        }))) });
    } catch (error) {
      tabs.push({ index, status: 'failed', reason: error instanceof Error ? error.message : 'Inspection failed' });
    }
  }
  if (!tabs.some(tab => tab.status === 'captured')) throw new Error('No Canva tab could be inspected. Keep the editor open and try again.');
  return { observedAt: new Date().toISOString(), tabs };
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const { withBrowser } = await import(pathToFileURL(resolve('dist/src/runner.js')).href);
    await withBrowser('en', false, async (context, page) => {
      await page.goto('https://www.canva.com/');
      console.log('Open the resume in the editor. New tabs are supported for this inspection.');
      await rl.question('Wait until the editor is ready, then return here and press Return.');
      const evidence = await inspectTabs(context);
      const output = resolve(process.argv[2] ?? 'local/editor-evidence.json');
      await mkdir(dirname(output), { recursive: true, mode: 0o700 });
      await writeFile(output, JSON.stringify(evidence, null, 2), { mode: 0o600 });
      const captured = evidence.tabs.filter(tab => tab.status === 'captured').length;
      const failed = evidence.tabs.filter(tab => tab.status === 'failed').length;
      console.log(`Saved ${captured} Canva tab(s) to ${output}. Failed tabs: ${failed}.`);
      console.log('This contains page text and links. Keep it private and check it before sharing.');
      if (failed) process.exitCode = 1;
    });
  } finally { rl.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
