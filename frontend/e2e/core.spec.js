import { test, expect } from './fixtures.js';
import { login, navigate, startTrack, mediaState, expectPlaybackAdvancing } from './helpers.js';

test('guest can open the application and navigate', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'or use without account', exact: true }).click();
  await expect(page.locator('.home-page')).toBeVisible();
  await navigate(page, 'Search');
  await expect(page.locator('.home-page')).toBeHidden();
  await navigate(page, 'Home');
  await expect(page.locator('.home-page')).toBeVisible();
});
test('remembered login survives reload and logout clears account state', async ({ page, identity }) => {
  await login(page, identity);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Desktop navigation' }).getByRole('button', { name: 'Messages', exact: true })).toBeVisible();
  await navigate(page, 'Profile');
  await page.getByRole('button', { name: /log out|sign out/i }).click();
  await expect(page.getByRole('navigation', { name: 'Desktop navigation' }).getByRole('button', { name: 'Messages', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /sign in/i }).first()).toBeVisible();
});
test('playback continues across navigation and history updates without reload', async ({ page, identity, manifest }) => {
  await login(page, identity);
  await startTrack(page, manifest.tracks[0]);
  const original = await mediaState(page);
  await navigate(page, 'Home');
  await expect(page.locator('.home-track-card').filter({ hasText: manifest.tracks[0].title })).toBeVisible();
  await expectPlaybackAdvancing(page, manifest.tracks[0]);
  expect((await mediaState(page)).src).toBe(original.src);
  await startTrack(page, manifest.tracks[1]);
  await navigate(page, 'Home');
  await expect(page.locator('.home-track-card').first()).toContainText(manifest.tracks[1].title);
});
test('pause resume and seek affect actual media', async ({ page, identity, manifest }) => {
  await login(page, identity);
  await startTrack(page, manifest.tracks[0]);
  const player = page.getByRole('region', { name: 'Player', exact: true });
  await player.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await mediaState(page))?.paused).toBe(true);
  const pausedTime = (await mediaState(page)).time;
  await navigate(page, 'Library');
  expect(Math.abs((await mediaState(page)).time - pausedTime)).toBeLessThan(.15);
  const seek = player.getByRole('slider', { name: 'Playback progress' });
  await seek.fill('20');
  await seek.dispatchEvent('change');
  await expect.poll(async () => (await mediaState(page))?.time).toBeGreaterThan(5);
  await player.getByRole('button', { name: 'Play', exact: true }).click();
  await expectPlaybackAdvancing(page, manifest.tracks[0]);
});

test.describe('network race conditions', () => {
test.use({ serviceWorkers: 'block' });

test('delayed saved view cannot overwrite navigation after sign-in', async ({ page, identity }) => {
  let release;
  let captured;
  const gate = new Promise(resolve => { release = resolve; });
  const capturedRequest = new Promise(resolve => { captured = resolve; });
  await page.route('**/api/users/me/app-state', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await login(page, identity);
    await capturedRequest;
    await navigate(page, 'Search');
    const query = page.getByPlaceholder('Search songs, artists, genres, or type a vibe...').first();
    await query.fill('Verification');
    const response = page.waitForResponse(r => r.url().endsWith('/api/users/me/app-state') && r.request().method() === 'GET');
    release();
    await response;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('.desktop-topbar h1')).toHaveText('Search');
    await expect(query).toHaveValue('Verification');
  } finally { release(); }
});

test('natural track completion advances the collection queue once', async ({ page, identity, manifest }) => {
  const auth = await login(page, identity);
  const headers = { Authorization: `Bearer ${auth.access_token}` };
  const created = await page.request.post('/api/playlists', { headers, data: { title: 'Natural completion', visibility: 'private' } });
  expect(created.status()).toBe(201);
  const playlist = await created.json();
  for (const track of [manifest.tracks[3], manifest.tracks[0]]) {
    expect((await page.request.post(`/api/playlists/${playlist.id}/tracks`, { headers, data: { track_id: track.id } })).status()).toBe(201);
  }
  await navigate(page, 'Library');
  await page.getByText('Natural completion', { exact: true }).click();
  await page.locator('.hs-library-playlist-view').getByRole('button', { name: 'Play', exact: true }).click();
  await expectPlaybackAdvancing(page, manifest.tracks[3]);
  await expectPlaybackAdvancing(page, manifest.tracks[0]);
  await navigate(page, 'Home');
  await expectPlaybackAdvancing(page, manifest.tracks[0]);
});

test('older profile response cannot replace newer Recently Played data', async ({ page, identity, manifest }) => {
  await login(page, identity);
  await startTrack(page, manifest.tracks[0]);
  let release;
  let captured;
  let held = false;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { captured = resolve; });
  await page.route('**/api/users/me', async route => {
    if (held || route.request().method() !== 'GET') return route.fallback();
    held = true;
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await navigate(page, 'Home');
    await ready;
    await startTrack(page, manifest.tracks[1]);
    await navigate(page, 'Home');
    // The initial history request is still deliberately held, so Home must
    // keep all six skeleton cards visible instead of exposing partial data.
    await expect(page.locator('.home-track-card--skeleton')).toHaveCount(6);
    const oldResponse = page.waitForResponse(r => r.url().endsWith('/api/users/me'));
    release();
    await oldResponse;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('.home-track-card').first()).toContainText(manifest.tracks[1].title);
  } finally { release(); }
});

test('navigation during remembered-session restore wins over saved view', async ({ page, identity, manifest }) => {
  await login(page, identity);
  await startTrack(page, manifest.tracks[0]);
  let release;
  let captured;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { captured = resolve; });
  await page.route('**/api/users/me/app-state', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: { active_page: 'search', search_query: 'Verification', profile_username: '' } });
  });
  const delaySession = async route => {
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response });
  };
  await page.route('**/api/users/me', delaySession);
  await page.route('**/api/auth/refresh', delaySession);
  try {
    await page.reload();
    await ready;
    await navigate(page, 'Library');
    const restored = page.waitForResponse(r => r.url().endsWith('/api/users/me/app-state') && r.request().method() === 'GET');
    release();
    await restored;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('.hs-library-page:visible')).toBeVisible();
    // Subsequent authenticated interaction must stay on the user's chosen page.
    await page.getByRole('button', { name: 'New Playlist', exact: true }).click();
    await expect(page.getByPlaceholder('Playlist name')).toBeVisible();
    await expect(page.locator('.desktop-topbar h1')).toHaveText('My Library');
  } finally { release(); }
});
});

