import { writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures.js';
import { login, navigate, startTrack, mediaState, expectPlaybackAdvancing } from './helpers.js';

test('bounded playback navigation and reconnect endurance', async ({ page, identity, manifest }, testInfo) => {
  const minutes = Number(process.env.HYPERSYNC_ENDURANCE_MINUTES || 30);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) throw new Error('Invalid endurance duration');
  testInfo.setTimeout(minutes * 60_000 + 120_000);
  const start = Date.now();
  let cycles = 0;
  let requests = 0;
  page.on('request', () => requests++);
  await login(page, identity);
  const checkpoint = path.join(process.env.HYPERSYNC_REPORT_DIR, 'endurance-checkpoint.json');
  while (Date.now() - start < minutes * 60_000) {
    const track = manifest.tracks[cycles % 3];
    await startTrack(page, track);
    if (cycles % 10 === 0) {
      await page.locator('.hs-search-track').filter({ hasText: track.title }).first().click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Play next', exact: true }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('region', { name: 'Player', exact: true }).getByRole('button', { name: 'Next', exact: true }).click();
      await expectPlaybackAdvancing(page, track);
    }
    await navigate(page, cycles % 2 ? 'Home' : 'Library');
    const before = (await mediaState(page)).time;
    await expect.poll(async () => (await mediaState(page))?.time, { timeout: 10_000 }).toBeGreaterThan(before + 2);
    if (cycles % 5 === 4) {
      await page.context().setOffline(true);
      await expect.poll(async () => page.evaluate(() => navigator.onLine)).toBe(false);
      await page.context().setOffline(false);
      await expect.poll(async () => page.evaluate(() => navigator.onLine)).toBe(true);
      await expectPlaybackAdvancing(page, track);
      await expect.poll(() => page.evaluate(async () => (await fetch('/api/catalog/tracks?q=Verification')).status)).toBe(200);
    }
    cycles++;
    const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    writeFileSync(checkpoint + '.tmp', JSON.stringify({ cycles, requests, elapsedSeconds: (Date.now() - start) / 1000,
      browser: page.context().browser().version(), jsHeapBytes: heap, status: 'running' }, null, 2));
    renameSync(checkpoint + '.tmp', checkpoint);
    if (cycles % 10 === 0) console.log(`Endurance: ${cycles} cycles, ${Math.round((Date.now() - start) / 1000)} seconds`);
  }
  expect(cycles).toBeGreaterThan(0);
  writeFileSync(checkpoint, JSON.stringify({ cycles, requests, elapsedSeconds: (Date.now() - start) / 1000,
    browser: page.context().browser().version(), status: 'passed' }, null, 2));
});
