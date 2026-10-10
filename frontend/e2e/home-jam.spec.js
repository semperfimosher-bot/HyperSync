import { test, expect } from './fixtures.js';
import { login, navigate, startTrack, openJam } from './helpers.js';


test('Home context and keyboard menus open Jam and other pages preserve track menus', async ({ page, identity, manifest }) => {
  await login(page, identity);
  const panel = await openJam(page);
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Close Jam panel' }).click();
  await page.locator('.home-page').press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Jam', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await startTrack(page, manifest.tracks[0]);
  await page.locator('.hs-search-track').filter({ hasText: manifest.tracks[0].title }).first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /Add to playlist/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Jam', exact: true })).toHaveCount(0);
});

test('active Jam survives navigation and a second member can join and reconnect', async ({ page, identity, manifest, browser, baseURL }) => {
  const auth = await login(page, identity);
  const panel = await openJam(page);
  const created = page.waitForResponse(r => r.url().endsWith('/api/jams') && r.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Play on my device', exact: true }).click();
  const jam = await (await created).json();
  await expect(panel.getByText('Your Jam', { exact: true })).toBeVisible();
  const guestContext = await browser.newContext({ baseURL });
  const guest = await guestContext.newPage();
  try {
    const guestIdentity = manifest.accounts[1];
    const guestAuth = await login(guest, guestIdentity);
    const guestPanel = await openJam(guest);
    await guestPanel.getByLabel('Join with an invite code').fill(jam.invite_code);
    await guestPanel.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(guestPanel.getByText('Your Jam', { exact: true })).toBeVisible();
    await expect(panel.locator('.jam-members')).toContainText(guestIdentity.username);
    await panel.getByLabel('Add a catalog track').fill(manifest.tracks[0].title);
    await panel.getByRole('button', { name: 'Search', exact: true }).click();
    await panel.getByRole('button', { name: `Add ${manifest.tracks[0].title}`, exact: true }).click();
    await expect(guestPanel.locator('.jam-queue')).toContainText(manifest.tracks[0].title);
    await navigate(page, 'Library');
    await expect(panel).toBeHidden();
    await openJam(page);
    await expect(panel.locator('.jam-queue')).toContainText(manifest.tracks[0].title);
    await guestContext.setOffline(true);
    await guestContext.setOffline(false);
    await guest.reload();
    await expect(guest.locator('nav:visible').getByRole('button', { name: 'Messages', exact: true })).toBeVisible();
    await openJam(guest);
    await expect(guestPanel.locator('.jam-queue')).toContainText(manifest.tracks[0].title);
    await panel.getByRole('button', { name: `Remove ${guestIdentity.username}`, exact: true }).click();
    await expect(panel.getByRole('button', { name: `Remove ${guestIdentity.username}`, exact: true })).toHaveCount(0);
    const forbidden = await guest.request.get(`/api/jams/${jam.id}`, { headers: { Authorization: `Bearer ${guestAuth.access_token}` } });
    expect(forbidden.status()).toBe(404);
    const removedMutation = await guest.request.post(`/api/jams/${jam.id}/queue`, { headers: { Authorization: `Bearer ${guestAuth.access_token}` }, data: { revision: 1, track_id: manifest.tracks[1].id } });
    expect(removedMutation.status()).toBe(404);
    const anonymous = await browser.newContext({ baseURL });
    try { expect((await anonymous.request.post(`/api/jams/${jam.id}/queue`, { data: { revision: 1, track_id: manifest.tracks[1].id } })).status()).toBe(401); }
    finally { await anonymous.close(); }
  } finally {
    const current = await page.request.get(`/api/jams/${jam.id}`, { headers: { Authorization: `Bearer ${auth.access_token}` } });
    if (current.ok()) await page.request.post(`/api/jams/${jam.id}/end`, { headers: { Authorization: `Bearer ${auth.access_token}` }, data: { revision: (await current.json()).revision } });
    await guestContext.close();
  }
});

