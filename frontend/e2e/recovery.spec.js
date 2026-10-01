import { test, expect } from './fixtures.js';
import { login, navigate, startTrack, expectPlaybackAdvancing } from './helpers.js';

// These journeys assert network failures and response ordering. A service
// worker can answer the media request before Playwright's network route sees it.
test.use({ serviceWorkers: 'block' });

test('unavailable media has bounded retries and another track remains playable', async ({ page, identity, manifest, context }) => {
  await login(page, identity);
  let failedRequests = 0;
  const trackId = manifest.tracks[0].id;
  const failAudio = route => {
    failedRequests++;
    return route.fulfill({ status: 503, body: 'Simulated unavailable fixture audio' });
  };
  const audioPatterns = [
    `**/api/audio/${trackId}**`,
    `**/__hypersync/media/${trackId}/**`,
  ];
  for (const pattern of audioPatterns) await page.route(pattern, failAudio);
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
  const trackId = manifest.tracks[0].id;
  const gate = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  const delayAudio = async route => {
    started();
    await gate;
    await route.continue().catch(() => {}); // Superseded media requests may be cancelled.
  };
  const audioPatterns = [
    `**/api/audio/${trackId}**`,
    `**/__hypersync/media/${trackId}/**`,
  ];
  for (const pattern of audioPatterns) await page.route(pattern, delayAudio);
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

