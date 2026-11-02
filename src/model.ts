import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Page, Locator } from 'playwright';

const text = z.string().min(1).refine(s => !s.includes('CONFIGURE'), 'Replace CONFIGURE with evidence from the live page');
export const targetSchema = z.object({ role: z.enum(['button', 'link', 'textbox', 'searchbox', 'heading']), name: text }).strict();
const stepSchema = z.object({
  id: z.enum(['templates', 'search', 'choose', 'editor']),
  target: targetSchema,
  action: z.enum(['click', 'search']),
  after: targetSchema,
  pauseMs: z.number().int().min(250).max(5000).default(1000)
}).strict();
export const recipeSchema = z.object({
  title: text, referenceLocale: z.literal('en'), locale: z.enum(['es-AR', 'th-TH']),
  startUrl: z.url().refine(s => new URL(s).hostname === 'www.canva.com'),
  accountContext: text,
  uiLanguage: text,
  startReady: targetSchema,
  query: text,
  choice: z.object({ nativeTitle: text, href: z.url().refine(s => new URL(s).hostname === 'www.canva.com') }).strict(),
  steps: z.array(stepSchema).length(4)
}).strict().superRefine((r, c) => {
  const expected = ['templates', 'search', 'choose', 'editor'];
  r.steps.forEach((s, i) => {
    if (s.id !== expected[i] || s.action !== (i === 1 ? 'search' : 'click'))
      c.addIssue({ code: 'custom', path: ['steps', i], message: 'Use the four lesson steps in order: templates, search, choose, editor' });
  });
  if (r.steps[2]?.target.role !== 'link' || r.steps[2]?.target.name !== r.choice.nativeTitle)
    c.addIssue({ code: 'custom', path: ['choice'], message: 'Choice must match the exact accessible name of the template link' });
});
export type Recipe = z.infer<typeof recipeSchema>;
export type Target = z.infer<typeof targetSchema>;
export const hash = (r: Recipe) => createHash('sha256').update(JSON.stringify(r)).digest('hex');

export async function unique(page: Page, t: Target): Promise<Locator> {
  const locator = page.getByRole(t.role, { name: t.name, exact: true });
  await locator.first().waitFor({ state: 'visible' });
  if (await locator.count() !== 1) throw new Error(`Ambiguous target: ${t.role} ${t.name}`);
  if (!await locator.isEnabled()) throw new Error(`Disabled target: ${t.name}`);
  return locator;
}

export async function choiceTarget(page: Page, r: Recipe) {
  const target = await unique(page, r.steps[2].target);
  const actual = await target.getAttribute('href');
  if (!actual || new URL(actual, page.url()).href !== r.choice.href)
    throw new Error('Approved template identity changed. Prepare and approve again.');
  return target;
}

export type Timing = { id: string; startMs: number; endMs: number };
export function validateTiming(steps: Timing[], duration: number) {
  if (steps.length !== 4) throw new Error('All four teaching steps must be present');
  let previous = 0;
  for (const s of steps) {
    if (s.startMs < previous || s.endMs < s.startMs || s.endMs > duration * 1000 + 100)
      throw new Error(`Invalid timing for ${s.id}`);
    previous = s.endMs;
  }
}
