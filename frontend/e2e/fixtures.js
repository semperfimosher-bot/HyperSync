import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const test = base.extend({
  manifest: async ({}, use) => {
    if (!process.env.HYPERSYNC_TEST_MANIFEST) throw new Error('Run through scripts/verify_project.py to create isolated fixtures');
    await use(JSON.parse(readFileSync(process.env.HYPERSYNC_TEST_MANIFEST, 'utf8')));
  },
  identity: async ({ request }, use) => {
    const username = `verify-${randomUUID().slice(0, 12)}`;
    const identity = { username, password: `Verify-${randomUUID()}!` };
    const response = await request.post('/api/auth/register', { data: { ...identity, email: `${username}@example.com` } });
    expect(response.status(), await response.text()).toBe(201);
    await use(identity);
  },
  page: async ({ page, baseURL }, use, testInfo) => {
    const errors = [];
    await page.addInitScript(() => {
      window.__verificationAudio = [];
      window.Audio = new Proxy(window.Audio, { construct(target, args) {
        const audio = Reflect.construct(target, args);
        window.__verificationAudio.push(audio);
        return audio;
      }});
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(baseURL).origin || ['data:', 'blob:'].includes(url.protocol)) return route.fallback();
      return route.abort('blockedbyclient');
    });
    await use(page);
    await testInfo.attach('browser-runtime', { body: JSON.stringify({ browser: page.context().browser()?.version(), errors }, null, 2), contentType: 'application/json' });
    expect(errors, 'Unhandled browser exceptions').toEqual([]);
  },
});
export { expect };
