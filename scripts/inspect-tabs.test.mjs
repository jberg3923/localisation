import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectTabs } from './inspect-tabs.mjs';

function page(url, content, error = false) {
  return { isClosed: () => false, url: () => url,
    waitForLoadState: async () => { if (error) throw new Error('Navigation failed'); },
    title: async () => 'Canva',
    locator: selector => selector === 'html' ? { getAttribute: async () => 'en-AU' }
      : { ariaSnapshot: async () => content },
    getByRole: () => ({ evaluateAll: async () => [] }) };
}

test('inspection retains both original search tab and newly opened editor tab', async () => {
  const evidence = await inspectTabs({ pages: () => [
    page('https://www.canva.com/s/templates?query=resume', 'Search'),
    page('https://www.canva.com/design/editor/example', 'Editor')
  ] });
  assert.deepEqual(evidence.tabs.map(t => t.accessibility), ['Search', 'Editor']);
});

test('unrelated tabs are excluded and failures are explicit', async () => {
  const evidence = await inspectTabs({ pages: () => [
    page('https://www.canva.com/', 'Home'),
    page('https://login.example.com/', 'Private login'),
    page('https://www.canva.com/design/editor/example', '', true)
  ] });
  assert.deepEqual(evidence.tabs.map(t => t.status), ['captured', 'excluded', 'failed']);
  assert.equal(JSON.stringify(evidence).includes('Private login'), false);
});

test('no readable Canva page produces a failure instead of a successful inspection', async () => {
  await assert.rejects(inspectTabs({ pages: () => [] }), /No Canva tab/);
});
