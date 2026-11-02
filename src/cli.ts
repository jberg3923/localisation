import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { recipeSchema } from './model.js';
import { checkTools } from './media.js';
import { prepare, record, withBrowser } from './runner.js';

const rl = createInterface({ input: stdin, output: stdout });
async function confirm(prompt: string) {
  if ((await rl.question(`${prompt}\nType APPROVE to continue: `)).trim() !== 'APPROVE') throw new Error('Cancelled; no approval recorded');
}
async function main() {
  const [command, file, preparation] = process.argv.slice(2);
  if (command === 'doctor') {
    checkTools(); console.log(`Node ${process.version}; FFmpeg and ffprobe available. Live Canva and browser capture not checked.`); return;
  }
  if (command === 'login' || command === 'inspect') {
    await withBrowser('en', false, async (_context, page) => {
      await page.goto('https://www.canva.com/');
      console.log('Use a dedicated demo account. Never paste passwords into this terminal.');
      if (command === 'login') {
        await rl.question('Sign in in the browser, then press Enter here to save the private local session.');
      } else {
        await rl.question('Navigate to the screen you want to inspect, then press Enter.');
        const path = resolve(file ?? 'local-inspection.json');
        const evidence = { observedAt: new Date().toISOString(), url: page.url(),
          lang: await page.locator('html').getAttribute('lang'),
          accessibility: await page.locator('body').ariaSnapshot(),
          links: await page.getByRole('link').evaluateAll(els => els.map(el => ({ title: el.textContent, href: (el as HTMLAnchorElement).href }))) };
        await writeFile(path, JSON.stringify(evidence, null, 2), { mode: 0o600 });
        console.log(`Private inspection saved to ${path}. Keep this outside GitHub and production exports.`);
      }
    }); return;
  }
  if (['validate', 'prepare', 'record'].includes(command) && file) {
    const recipe = recipeSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (command === 'validate') console.log('Recipe structure valid. Live targets have not been checked.');
    if (command === 'prepare') console.log(`Preparation saved: ${await prepare(recipe, confirm)}`);
    if (command === 'record') {
      if (!preparation) throw new Error('Provide the preparation.json path printed by prepare');
      console.log(`Take saved for human review: ${await record(recipe, preparation, confirm)}`);
    }
    return;
  }
  console.log('Flow Localise — Phase 0\n\nCommands:\n  doctor\n  login\n  inspect local/evidence.json\n  validate local/recipe.json\n  prepare local/recipe.json\n  record local/recipe.json /path/to/preparation.json\n\nRun with: npm run localise -- <command>');
}
try { await main(); } catch (error) {
  console.error(error instanceof Error ? error.message : 'Command failed'); process.exitCode = 1;
} finally { rl.close(); }
