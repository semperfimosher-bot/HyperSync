import { test, expect } from './fixtures.js';
import { login, navigate, startTrack, expectPlaybackAdvancing } from './helpers.js';

test('create playlist, add tracks, reload and play persisted collection', async ({ page, identity, manifest }) => {
  const auth = await login(page, identity);
  await navigate(page, 'Library');
  await page.getByRole('button', { name: 'New Playlist', exact: true }).click();
  await page.getByPlaceholder('Playlist name').fill('Verification collection');
  const creating = page.waitForResponse(r => r.url().endsWith('/api/playlists') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create Playlist', exact: true }).click();
  const playlist = await (await creating).json();
  for (const track of manifest.tracks.slice(0, 2)) {
    await startTrack(page, track);
    await page.locator('.hs-search-track').filter({ hasText: track.title }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add to playlist', exact: true }).click();
    await page.getByRole('button', { name: /Verification collection/ }).click();
    await page.keyboard.press('Escape');
  }
  await page.reload();
  await navigate(page, 'Library');
  await page.getByText('Verification collection', { exact: true }).click();
  await expect(page.locator('.hs-library-playlist-view')).toContainText(manifest.tracks[0].title);
  await expect(page.locator('.hs-library-playlist-view')).toContainText(manifest.tracks[1].title);
  await page.locator('.hs-library-playlist-view').getByRole('button', { name: 'Play', exact: true }).click();
  await expectPlaybackAdvancing(page, manifest.tracks[0]);
  await page.getByRole('region', { name: 'Player', exact: true }).getByRole('button', { name: 'Next', exact: true }).click();
  await expectPlaybackAdvancing(page, manifest.tracks[1]);
  // Ordering is currently exposed through the API, not a drag/reorder control.
  const headers = { Authorization: `Bearer ${auth.access_token}` };
  const saved = await (await page.request.get(`/api/playlists/${playlist.id}`, { headers })).json();
  const reversed = [...saved.tracks].reverse();
  const reordered = await page.request.put(`/api/playlists/${playlist.id}/tracks/reorder`, {
    headers, data: { playlist_track_ids: reversed.map(track => track.playlist_track_id) },
  });
  expect(reordered.ok()).toBe(true);
  const persisted = await (await page.request.get(`/api/playlists/${playlist.id}`, { headers })).json();
  expect(persisted.tracks.map(track => track.id)).toEqual(reversed.map(track => track.id));
});
