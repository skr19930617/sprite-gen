import { expect, test } from '@playwright/test';

test('home page redirects to login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'ログイン' }),
  ).toBeVisible();
});
