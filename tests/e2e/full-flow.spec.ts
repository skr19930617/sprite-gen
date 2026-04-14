import { expect, test } from '@playwright/test';

// Authenticated end-to-end flow covering tasks 3.8 / 4.12 / 6.16 / 9.12 / 9.13.
//
// Skipped by default. To run:
//   RUN_LIVE_E2E=1 \
//     PLAYWRIGHT_TEST_USER_EMAIL=... \
//     PLAYWRIGHT_TEST_USER_PASSWORD=... \
//     PLAYWRIGHT_BASE_URL=https://your-preview \
//     npx playwright test full-flow.spec.ts
//
// The flow assumes the test user already exists (seed via `supabase/seed.sql`
// or the dashboard); we don't perform real signup here because Supabase email
// verification breaks the headless run.

const SHOULD_RUN = process.env.RUN_LIVE_E2E === '1';

test.describe('authenticated golden path', () => {
  test.skip(
    !SHOULD_RUN,
    'set RUN_LIVE_E2E=1 + PLAYWRIGHT_TEST_USER_EMAIL/PASSWORD to enable',
  );

  test.beforeEach(async ({ page }) => {
    const email = process.env.PLAYWRIGHT_TEST_USER_EMAIL;
    const password = process.env.PLAYWRIGHT_TEST_USER_PASSWORD;
    if (!email || !password) throw new Error('missing test user creds');
    await page.goto('/login');
    await page.getByLabel('メールアドレス').fill(email);
    await page.getByLabel('パスワード').fill(password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await page.waitForURL(/\/upload(\?|$)/);
  });

  test('upload PNG → mask → generate → save → list → reload → regenerate', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // 4.12: upload page renders quota badge + form pre-populated post-LLM.
    await expect(
      page.getByRole('heading', { level: 1, name: '画像アップロード' }),
    ).toBeVisible();

    await page.setInputFiles(
      'input[type="file"]',
      'tests/e2e/fixtures/fish.png',
    );
    await page.getByLabel(/動きの指示/).fill('ゆっくり泳いで尾を振る');
    await page.getByRole('button', { name: /アップロードして次へ/ }).click();

    // 6.16: mask page loads with editor + animation params panel.
    await page.waitForURL(/\/drafts\/[0-9a-f-]+\/mask/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'マスク編集' }),
    ).toBeVisible();
    await expect(page.getByText('animation_type')).toBeVisible();
    // Apply correction (auto-body should already be filled from source alpha).
    await page.getByRole('button', { name: '補正' }).click();
    await page.getByRole('button', { name: 'マスクを保存して生成へ' }).click();

    // Generation
    await page.waitForURL(/\/drafts\/[0-9a-f-]+\/preview/);
    await page.getByRole('button', { name: /生成/ }).click();
    await page.waitForFunction(
      () => document.querySelectorAll('img[alt="生成 GIF"]').length > 0,
      null,
      { timeout: 60_000 },
    );

    // 9.12: save → list → open → regenerate.
    await page.getByRole('button', { name: '新規保存' }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+/);
    await page.goto('/projects');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      '保存済みプロジェクト',
    );
    await page.locator('a[href^="/projects/"]').first().click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+/);

    // 9.13: regenerate button enabled when renderer_version matches.
    await expect(
      page.getByRole('button', { name: /Regenerate/ }),
    ).toBeEnabled();
    await page.getByRole('button', { name: /Regenerate/ }).click();
    await page.waitForURL(/\/drafts\/[0-9a-f-]+\/mask/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'マスク編集' }),
    ).toBeVisible();
  });
});
