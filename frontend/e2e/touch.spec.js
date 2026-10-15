import { test, expect } from './fixtures.js';
import { login, navigate } from './helpers.js';

test('Home touch long press offers Jam only on Home', async ({ page, identity }) => {
  await login(page, identity);
  const target = page.locator('.home-hero-image__status');
  // Pointer events exercise the real timer; the touch browser project also
  // validates the mobile layout. Physical OS long-press behavior is manual.
  await target.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 60, clientY: 160 });
  await expect(page.getByRole('menuitem', { name: 'Jam', exact: true })).toBeVisible();
  await target.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1 });
  await page.getByRole('menuitem', { name: 'Jam', exact: true }).tap();
  await expect(page.getByRole('region', { name: 'Jam session' })).toBeVisible();
  await navigate(page, 'Library');
  await expect(page.getByRole('region', { name: 'Jam session' })).toBeHidden();
});
