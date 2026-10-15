import { test, expect } from './fixtures.js';
import { login, navigate, startTrack, expectPlaybackAdvancing } from './helpers.js';

async function prepareOfflineApp(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(
    () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  ).toBe(true);

  await page.evaluate(async () => {
    const controller = navigator.serviceWorker.controller;
    if (!controller) throw new Error('Service worker is not controlling the page.');

    const requestId =
      globalThis.crypto?.randomUUID?.() ??
      `prepare-${Date.now()}-${Math.random()}`;

    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener('message', onMessage);
        reject(new Error('Timed out preparing the offline app shell.'));
      }, 10000);

      const onMessage = event => {
        if (
          event.data?.type !== 'HYPERSYNC_PREPARE_OFFLINE_APP_COMPLETE' ||
          event.data?.requestId !== requestId
        ) {
          return;
        }

        window.clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('message', onMessage);
        if (event.data?.ok === false) {
          reject(new Error('Service worker could not prepare the offline app shell.'));
          return;
        }
        resolve();
      };

      navigator.serviceWorker.addEventListener('message', onMessage);
      controller.postMessage({
        type: 'HYPERSYNC_PREPARE_OFFLINE_APP',
        requestId,
      });
    });
  });
}

async function setVerificationAudioFailure(page, manifest, trackId, enabled) {
  const url =
    `http://127.0.0.1:${manifest.api_port}/__verification/audio-failures/${encodeURIComponent(trackId)}`;
  const response = enabled
    ? await page.request.put(url)
    : await page.request.delete(url);
  expect(response.ok(), await response.text()).toBe(true);
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

test('completed download survives offline reload and plays real cached audio', async ({ page, identity, manifest, context }) => {
  const audioRequests = recordAudioRequests(page);
  await login(page, identity);
  const track = manifest.tracks[0];

  await navigate(page, 'Search');
  await page
    .getByPlaceholder('Search songs, artists, genres, or type a vibe...')
    .first()
    .fill(track.title);
  const row = page.locator('.hs-search-track').filter({ hasText: track.title }).first();
  await row.click({ button: 'right' });
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
    throw new Error(
      `Offline download did not complete: ${JSON.stringify(await offlineMenuState(page, audioRequests))}\n${error.message}`,
    );
  }

  await page.keyboard.press('Escape');
  await prepareOfflineApp(page);

  await navigate(page, 'Library');
  const visibleLibrary = page.locator('.hs-library-page:visible');
  await visibleLibrary.getByRole('tab', { name: /^Songs/ }).click();
  await expect(page.locator('main')).toContainText(track.title);

  const shellReady = await page.evaluate(async () => {
    const cacheName = (await caches.keys())
      .find(name => name.startsWith('hypersync-app-shell-'));
    if (!cacheName) return false;

    const cache = await caches.open(cacheName);
    const shell = await cache.match('/');
    if (!shell?.ok) return false;

    const html = await shell.clone().text();
    const assetUrls = [
      ...html.matchAll(/(?:src|href)=["']([^"']+)["']/g),
    ]
      .map(match => match[1])
      .filter(value => value && !value.startsWith('data:'))
      .map(value => new URL(value, location.origin))
      .filter(url => url.origin === location.origin);

    for (const url of assetUrls) {
      if (!(await cache.match(url.href))) return false;
    }
    return true;
  });
  expect(shellReady, 'service worker app shell should be fully cached before offline reload').toBe(true);

  /*
   * Playwright's browser-level offline switch is not portable for
   * service-worker navigations: Firefox replaces the document with
   * NS_ERROR_OFFLINE before the worker can answer, while Chromium can
   * fail subresource requests outside the worker path. Exercise the
   * application-level offline contract consistently instead: the
   * browser reports offline and every API request is unavailable.
   */
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
  });
  await context.route('**/api/**', route => route.abort('connectionreset'));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await navigate(page, 'Library');
  await page.getByRole('tab', { name: /^Songs/ }).click();
  const downloadedRow = page
    .locator('.hs-library-page:visible .hs-search-track')
    .filter({ hasText: track.title })
    .first();
  await expect(downloadedRow).toBeVisible();
  await downloadedRow.click();
  await expectPlaybackAdvancing(page, track);
});

test('interrupted download remains incomplete and can be retried', async ({ page, identity, manifest }) => {
  const audioRequests = recordAudioRequests(page);
  await login(page, identity);
  const track = manifest.tracks[2];

  await setVerificationAudioFailure(page, manifest, track.id, true);
  try {
    await navigate(page, 'Search');
    await page
      .getByPlaceholder('Search songs, artists, genres, or type a vibe...')
      .first()
      .fill(track.title);
    const row = page.locator('.hs-search-track').filter({ hasText: track.title }).first();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Download for offline', exact: true }).click();

    const notice = page.locator('.track-action-menu__notice');
    try {
      await expect.poll(async () => {
        return (await notice.textContent().catch(() => ''))?.trim() || 'pending';
      }).not.toBe('pending');
    } catch (error) {
      throw new Error(
        `Interrupted download stayed pending: ${JSON.stringify(await offlineMenuState(page, audioRequests))}\n${error.message}`,
      );
    }

    await expect(
      page.getByRole('menuitem', { name: 'Download for offline', exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole('menuitem', { name: 'Downloaded for offline', exact: true }),
    ).toHaveCount(0);
  } finally {
    await setVerificationAudioFailure(page, manifest, track.id, false);
  }

  await page.keyboard.press('Escape');
  await navigate(page, 'Library');
  await page.getByRole('tab', { name: /^Songs/ }).click();
  await expect(
    page.locator('.hs-library-page:visible').getByText(track.title, { exact: true }),
  ).toHaveCount(0);

  await navigate(page, 'Search');
  await page
    .getByPlaceholder('Search songs, artists, genres, or type a vibe...')
    .first()
    .fill(track.title);
  const row = page.locator('.hs-search-track').filter({ hasText: track.title }).first();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Download for offline', exact: true }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Downloaded for offline', exact: true }),
  ).toBeVisible();
});
