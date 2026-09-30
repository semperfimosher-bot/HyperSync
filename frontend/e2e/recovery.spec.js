import { test, expect } from './fixtures.js';
import { login, navigate, startTrack, expectPlaybackAdvancing } from './helpers.js';

test('unavailable media has bounded retries and another track remains playable', async ({ page, identity, manifest, context }) => {
  await login(page, identity);
  let failedRequests = 0;
  await context.route(`**/api/audio/${manifest.tracks[0].id}**`, route => {
    failedRequests++;
    return route.fulfill({ status: 503, body: 'Simulated unavailable fixture audio' });
  });
  await navigate(page, 'Search');
  await page.getByPlaceholder('Search songs, artists, genres, or type a vibe...').first().fill(manifest.tracks[0].title);
  await page.locator('.hs-search-track').filter({ hasText: manifest.tracks[0].title }).first().click();
  await expect.poll(() => failedRequests).toBeGreaterThan(0);
  await navigate(page, 'Library');
  await startTrack(page, manifest.tracks[1]);
  await expectPlaybackAdvancing(page, manifest.tracks[1]);
  expect(failedRequests).toBeLessThanOrEqual(6);
});

test('latest selection wins when an earlier audio response is delayed', async ({ page, identity, manifest, context }) => {
  await login(page, identity);
  let release;
  let started;
  const gate = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  await context.route(`**/api/audio/${manifest.tracks[0].id}**`, async route => {
    started();
    await gate;
    await route.continue().catch(() => {}); // Superseded media requests may be cancelled.
  });
  try {
    await navigate(page, 'Search');
    const query = page.getByPlaceholder('Search songs, artists, genres, or type a vibe...').first();
    await query.fill(manifest.tracks[0].title);
    await page.locator('.hs-search-track').filter({ hasText: manifest.tracks[0].title }).first().click();
    await requested;
    await startTrack(page, manifest.tracks[1]);
    release();
    await expectPlaybackAdvancing(page, manifest.tracks[1]);
  } finally { release(); }
});
