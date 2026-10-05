import { test, expect } from './fixtures.js';
import { login, navigate, startTrack, expectPlaybackAdvancing } from './helpers.js';

async function clearOfflineClientState(page) {
  await page.evaluate(async () => {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    if (typeof indexedDB === "undefined") return;

    const names = [
      "hypersynced-media-v1",
      "hypersynced-offline-v1",
    ];

    const databases =
      typeof indexedDB.databases === "function"
        ? await indexedDB.databases()
        : [];

    for (const database of databases) {
      if (database?.name?.startsWith("hypersync")) {
        names.push(database.name);
      }
    }

    for (const name of new Set(names)) {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () =>
          reject(request.error || new Error("Unable to delete IndexedDB database: " + name));
        request.onblocked = () =>
          reject(new Error("IndexedDB deletion was blocked: " + name));
      });
    }
  });
}

function recordAudioRequests(page) {
  const requests = [];
  page.on('request', request => {
    const url = request.url();
    if (/\/api\/audio\/|\/__hypersync\/media\//.test(url)) requests.push(url);
  });
  return requests;
}

async function offlineMenuState(page, audioRequests) {
  return page.evaluate(requests => {
    const menu = document.querySelector('.track-action-menu');
    return {
      online: navigator.onLine,
      menuText: menu?.innerText ?? null,
      menuItems: [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map(item => ({
        text: item.innerText,
        disabled: item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('disabled'),
      })),
      notices: [...document.querySelectorAll('.track-action-menu__notice')].map(item => item.innerText),
      audioRequests: requests,
    };
  }, audioRequests);
}

test('completed download survives disconnected reload and plays real cached audio', async ({ page, identity, manifest, context }) => {
  const audioRequests = recordAudioRequests(page);
  await login(page, identity);
  await clearOfflineClientState(page);
  await startTrack(page, manifest.tracks[0]);
  await page.locator('.hs-search-track').filter({ hasText: manifest.tracks[0].title }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Download for offline', exact: true }).click();
  const downloaded = page.getByRole('menuitem', { name: 'Downloaded for offline', exact: true });
  const notice = page.locator('.track-action-menu__notice');
  try {
    await expect.poll(async () => {
      if (await downloaded.count()) return 'downloaded';
      const message = (await notice.textContent().catch(() => ''))?.trim();
      return message ? `failed: ${message}` : 'pending';
    }).toBe('downloaded');
  } catch (error) {
    throw new Error(`Offline download did not complete: ${JSON.stringify(await offlineMenuState(page, audioRequests))}\n${error.message}`);
  }
  await page.keyboard.press('Escape');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // Service-worker fetches must handle navigation while disconnected.
  await page.unroute('**/*');
  await navigate(page, 'Library');
  await page.getByRole('tab', { name: /^Songs/ }).click();
  await expect(page.locator('main')).toContainText(manifest.tracks[0].title);
  await context.setOffline(true);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await navigate(page, 'Library');
  await page.getByRole('tab', { name: /^Songs/ }).click();
  await page.getByText(manifest.tracks[0].title, { exact: true }).first().click();
  await expectPlaybackAdvancing(page, manifest.tracks[0]);
});

test('interrupted download remains incomplete and can be retried', async ({ page, identity, manifest, context }) => {
  const audioRequests = recordAudioRequests(page);
  await login(page, identity);
  await clearOfflineClientState(page);
  const track = manifest.tracks[2];
  let aborted = 0;
  const pattern = `**/api/audio/${track.id}**`;
  await page.route(pattern, route => { aborted++; return route.abort('connectionreset'); });
  await navigate(page, 'Search');
  await page.getByPlaceholder('Search songs, artists, genres, or type a vibe...').first().fill(track.title);
  const row = page.locator('.hs-search-track').filter({ hasText: track.title }).first();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Download for offline', exact: true }).click();
  const notice = page.locator('.track-action-menu__notice');
  try {
    await expect.poll(async () => {
      if (aborted > 0) return 'aborted';
      return (await notice.textContent().catch(() => ''))?.trim() || 'pending';
    }).not.toBe('pending');
  } catch (error) {
    throw new Error(`Interrupted download stayed pending: ${JSON.stringify(await offlineMenuState(page, audioRequests))}\n${error.message}`);
  }
  const downloadError = (await notice.textContent().catch(() => ''))?.trim();
  expect(aborted, `The interrupted download should reach the simulated audio failure${downloadError ? `; UI reported: ${downloadError}` : ''}`).toBeGreaterThan(0);
  await expect(page.getByRole('menuitem', { name: 'Download for offline', exact: true })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: 'Downloaded for offline', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await navigate(page, 'Library');
  await page.getByRole('tab', { name: /^Songs/ }).click();
  await expect(page.locator('.hs-library-page:visible').getByText(track.title, { exact: true })).toHaveCount(0);
  await page.unroute(pattern);
  await navigate(page, 'Search');
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Download for offline', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Downloaded for offline', exact: true })).toBeVisible();
});

