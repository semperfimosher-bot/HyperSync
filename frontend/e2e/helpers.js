import { expect } from '@playwright/test';

export async function navigate(page, name) {
  const desktopNavigation = page.getByRole('navigation', { name: 'Desktop navigation' });
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  const navigation = await desktopNavigation.isVisible() ? desktopNavigation : mobileNavigation;
  await expect(navigation).toBeVisible();
  await navigation.getByRole('button', { name, exact: true }).click();
}
export async function login(page, identity) {
  await page.goto('/');
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Username or email').fill(identity.username);
  await dialog.getByPlaceholder('Password', { exact: true }).fill(identity.password);
  await dialog.getByRole('checkbox', { name: 'Remember me' }).check();
  const signedIn = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'SIGN IN', exact: true }).click();
  await expect(dialog).toBeHidden();
  const desktopNavigation = page.getByRole('navigation', { name: 'Desktop navigation' });
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  const navigation = await desktopNavigation.isVisible() ? desktopNavigation : mobileNavigation;
  await expect(navigation.getByRole('button', { name: 'Profile', exact: true })).toBeVisible();
  return (await signedIn).json();
}
export async function startTrack(page, track) {
  await navigate(page, "Search");
  const search = page.getByPlaceholder('Search songs, artists, genres, or type a vibe...').first();
  await search.fill(track.title);
  const row = page.locator('.hs-search-track').filter({ hasText: track.title }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expectPlaybackAdvancing(page, track);
}
export async function mediaState(page) {
  return page.evaluate(() => {
    const media = [...(window.__verificationAudio || []), ...document.querySelectorAll('audio')].find(item => item.currentSrc) || document.querySelector('audio');
    return media ? { time: media.currentTime, paused: media.paused, src: media.currentSrc, ready: media.readyState } : null;
  });
}
export async function expectPlaybackAdvancing(page, track) {
  await expect(page.getByRole('region', { name: 'Player', exact: true })).toContainText(track.title);
  await expect.poll(async () => (await mediaState(page))?.paused).toBe(false);
  const before = (await mediaState(page)).time;
  await expect.poll(async () => (await mediaState(page))?.time).toBeGreaterThan(before + .15);
}

export async function openJam(page) {
  await navigate(page, 'Home');
  await page.locator('.home-hero-image__status').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Jam', exact: true }).click();
  return page.getByRole('region', { name: 'Jam session' });
}
