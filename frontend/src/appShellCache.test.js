import test from 'node:test';
import assert from 'node:assert/strict';
import { matchAppShell } from './appShellCache.js';

test('same-origin public shell may reuse an Origin-varying precache', async () => {
  const response = new Response('script', { headers: { Vary: 'Origin' } });
  const cache = { match: async (_request, options) => options?.ignoreVary ? response : undefined };
  assert.equal(await matchAppShell(cache, new Request('https://app.test/assets/app.js'), 'https://app.test'), response);
});

test('authorization variants and other origins must never bypass Vary', async () => {
  for (const vary of ['Authorization', 'Origin, Cookie', '*']) {
    const response = new Response('private', { headers: { Vary: vary } });
    const cache = { match: async (_request, options) => options?.ignoreVary ? response : undefined };
    assert.equal(await matchAppShell(cache, new Request('https://app.test/assets/app.js'), 'https://app.test'), undefined);
  }
  const cache = { match: async (_request, options) => options?.ignoreVary ? new Response('external', { headers: { Vary: 'Origin' } }) : undefined };
  assert.equal(await matchAppShell(cache, new Request('https://other.test/a.js'), 'https://app.test'), undefined);
});
