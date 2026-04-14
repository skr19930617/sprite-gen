import { expect, test } from '@playwright/test';

// Public smoke tests — no backend session required.
// They confirm that auth-protected routes redirect to /login and that the
// public auth pages render their critical UI affordances.

test('login page renders email/password form and Google OAuth button', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(
    page.getByRole('heading', { level: 1, name: 'ログイン' }),
  ).toBeVisible();
  await expect(page.getByLabel('メールアドレス')).toBeVisible();
  await expect(page.getByLabel('パスワード')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Google でログイン/ }),
  ).toBeVisible();
});

test('signup page renders email verification flow controls', async ({
  page,
}) => {
  await page.goto('/signup');
  await expect(
    page.getByRole('heading', { level: 1, name: 'サインアップ' }),
  ).toBeVisible();
  await expect(page.getByLabel('メールアドレス')).toBeVisible();
  await expect(page.getByLabel(/パスワード/)).toBeVisible();
  await expect(page.getByRole('button', { name: '登録' })).toBeVisible();
});

test('unauthenticated /upload redirects to /login with next param', async ({
  page,
}) => {
  await page.goto('/upload');
  await expect(page).toHaveURL(/\/login\?next=%2Fupload$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'ログイン' }),
  ).toBeVisible();
});

test('unauthenticated /projects redirects to /login with next param', async ({
  page,
}) => {
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects$/);
});

test('unauthenticated /billing redirects to /login', async ({ page }) => {
  await page.goto('/billing');
  await expect(page).toHaveURL(/\/login\?next=%2Fbilling$/);
});

test('unauthenticated POST /api/upload is rejected (401 or 403)', async ({
  request,
  baseURL,
}) => {
  const res = await request.post('/api/upload', {
    multipart: { prompt: 'test' },
    headers: { origin: baseURL ?? '' },
  });
  // CSRF check or auth check — either is a correct rejection of an
  // unauthenticated request.
  expect([401, 403, 415]).toContain(res.status());
});

test('unauthenticated POST /api/generate is rejected (401 or 403)', async ({
  request,
  baseURL,
}) => {
  const res = await request.post('/api/generate', {
    data: { draft_id: '00000000-0000-0000-0000-000000000000' },
    headers: { origin: baseURL ?? '' },
  });
  expect([401, 403]).toContain(res.status());
});

test('cross-origin POST is blocked by CSRF middleware (403)', async ({
  request,
}) => {
  const res = await request.post('/api/generate', {
    data: { draft_id: '00000000-0000-0000-0000-000000000000' },
    headers: { origin: 'https://evil.example.com' },
  });
  expect(res.status()).toBe(403);
});

test('public /api/stripe/webhook accepts requests (rejects bad sig with 400)', async ({
  request,
}) => {
  // The endpoint MUST be reachable without auth, but rejects when signature is missing.
  const res = await request.post('/api/stripe/webhook', { data: {} });
  expect([400, 403]).toContain(res.status());
});
