import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Page, Locator } from 'playwright';

const text = z.string().min(1).refine(s => !s.includes('CONFIGURE'), 'Replace CONFIGURE with evidence from the live page');
export const targetSchema = z.object({
  role: z.enum(['button', 'link', 'textbox', 'searchbox', 'heading', 'application']), name: text,
  within: z.object({ role: z.enum(['navigation', 'main', 'dialog']), name: text.optional() }).strict().optional()
}).strict();
const stepSchema = z.object({
  id: z.enum(['templates', 'search', 'choose', 'editor']),
  target: targetSchema,
  action: z.enum(['click', 'search']),
  after: targetSchema,
  pauseMs: z.number().int().min(250).max(5000).default(1000)
}).strict();
export const recipeSchema = z.object({
  title: text, referenceLocale: z.literal('en'), locale: z.enum(['en-AU', 'es-AR', 'th-TH']),
  startUrl: z.url().refine(s => new URL(s).origin === 'https://www.canva.com'),
  accountContext: text,
  uiLanguage: text,
  startReady: targetSchema,
  query: text,
  choice: z.object({ nativeTitle: text, previewHeading: text, editorLink: text }).strict(),
  steps: z.array(stepSchema).length(4)
}).strict().superRefine((r, c) => {
  const expected = ['templates', 'search', 'choose', 'editor'];
  r.steps.forEach((s, i) => {
    if (s.id !== expected[i] || s.action !== (i === 1 ? 'search' : 'click'))
      c.addIssue({ code: 'custom', path: ['steps', i], message: 'Use the four lesson steps in order: templates, search, choose, editor' });
  });
  if (r.steps[2]?.target.role !== 'button')
    c.addIssue({ code: 'custom', path: ['choice'], message: 'The Canva preview adapter requires a template preview button' });
});
export type Recipe = z.infer<typeof recipeSchema>;
export type Target = z.infer<typeof targetSchema>;
export const hash = (r: Recipe) => createHash('sha256').update(JSON.stringify(r)).digest('hex');

export async function unique(page: Page, t: Target): Promise<Locator> {
  const root = t.within ? page.getByRole(t.within.role, { name: t.within.name, exact: true }) : page;
  const locator = root.getByRole(t.role, { name: t.name, exact: true });
  await locator.first().waitFor({ state: 'visible' });
  if (await locator.count() !== 1) throw new Error(`Ambiguous target: ${t.role} ${t.name}`);
  if (!await locator.isEnabled()) throw new Error(`Disabled target: ${t.name}`);
  return locator;
}

export type ChoiceIdentity = { templateId: string; designType: string; nativeTitle: string };
export function templateIdentity(href: string, nativeTitle: string): ChoiceIdentity {
  const url = new URL(href, 'https://www.canva.com');
  const templateId = url.searchParams.get('template');
  const designType = url.searchParams.get('type');
  if (url.origin !== 'https://www.canva.com' || url.pathname !== '/design/editor/shell' ||
      !url.searchParams.has('create') || !templateId || !designType ||
      !/^[A-Za-z0-9_-]+$/.test(templateId) || !/^[A-Za-z0-9_-]+$/.test(designType))
    throw new Error('Preview does not expose a supported Canva template identity. Stop and inspect it.');
  return { templateId, designType, nativeTitle };
}

export function checkIdentity(actual: ChoiceIdentity, expected: ChoiceIdentity) {
  if (actual.templateId !== expected.templateId || actual.designType !== expected.designType || actual.nativeTitle !== expected.nativeTitle)
    throw new Error('Approved template identity changed. Prepare and approve again.');
}

export type Timing = { id: string; startMs: number; endMs: number };
export function validateTiming(steps: Timing[], duration: number) {
  if (steps.length !== 4) throw new Error('All four teaching steps must be present');
  let previous = 0;
  for (const [index, s] of steps.entries()) {
    if (s.id !== ['templates', 'search', 'choose', 'editor'][index] ||
      !Number.isFinite(s.startMs) || !Number.isFinite(s.endMs) ||
      s.startMs < previous || s.endMs < s.startMs || s.endMs > duration * 1000 + 100)
      throw new Error(`Invalid timing for ${s.id}`);
    previous = s.endMs;
  }
}
