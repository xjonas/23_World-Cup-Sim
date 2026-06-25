import { expect, test } from '@playwright/test';

test('opens from bundled fallback, edits a score, and persists it', async ({ page }, testInfo) => {
  const authUser = {
    id: 'user-1',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'jonas@example.com',
    email_confirmed_at: '2026-06-01T00:00:00Z',
    phone: '',
    app_metadata: {},
    user_metadata: { display_name: 'Jonas' },
    identities: [],
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z'
  };
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'content-type': 'application/json'
  };
  const profiles = [
    {
      user_id: 'user-1',
      display_name: 'Jonas',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z'
    },
    {
      user_id: 'user-2',
      display_name: 'Alex',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z'
    }
  ];
  const predictions = [
    {
      user_id: 'user-1',
      match_id: '760415',
      home_goals: 2,
      away_goals: 0,
      source: 'manual',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z'
    },
    {
      user_id: 'user-2',
      match_id: '760415',
      home_goals: 1,
      away_goals: 1,
      source: 'manual',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z'
    }
  ];

  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    if (url.pathname === '/auth/v1/token') {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          access_token: 'test-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'test-refresh-token',
          user: authUser
        })
      });
      return;
    }

    if (url.pathname === '/auth/v1/user') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify(authUser) });
      return;
    }

    if (url.pathname === '/auth/v1/logout') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    if (url.pathname === '/rest/v1/profiles') {
      if (request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify(profiles) });
        return;
      }
      await route.fulfill({ status: 201, headers: corsHeaders, body: '[]' });
      return;
    }

    if (url.pathname === '/rest/v1/match_predictions') {
      if (request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify(predictions) });
        return;
      }
      if (request.method() === 'DELETE') {
        const sourceFilter = url.searchParams.get('source')?.replace(/^eq\./, '');
        const userFilter = url.searchParams.get('user_id')?.replace(/^eq\./, '');
        for (let index = predictions.length - 1; index >= 0; index -= 1) {
          const prediction = predictions[index];
          if (userFilter && prediction.user_id !== userFilter) {
            continue;
          }
          if (sourceFilter && prediction.source !== sourceFilter) {
            continue;
          }
          predictions.splice(index, 1);
        }
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      if (request.method() === 'POST') {
        const payload = request.postDataJSON();
        const rows = Array.isArray(payload) ? payload : [payload];
        for (const row of rows) {
          const index = predictions.findIndex(
            (prediction) => prediction.user_id === row.user_id && prediction.match_id === row.match_id
          );
          if (index >= 0) {
            predictions[index] = { ...predictions[index], ...row };
          } else {
            predictions.push({
              source: 'manual',
              ...row,
              created_at: '2026-06-01T00:00:00Z',
              updated_at: '2026-06-01T00:00:00Z'
            });
          }
        }
        await route.fulfill({ status: 201, headers: corsHeaders, body: '[]' });
        return;
      }
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    await route.fulfill({ status: 404, headers: corsHeaders, body: '{}' });
  });
  await page.route('**/apis/site/v2/sports/soccer/fifa.world/scoreboard**', (route) => route.abort());
  await page.route('**/gamma-api.polymarket.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.addInitScript(() => {
    const fixedNow = new Date('2026-06-20T08:00:00.000Z').getTime();
    const RealDate = Date;

    function FixedDate(this: Date, ...args: ConstructorParameters<DateConstructor>) {
      return Reflect.construct(RealDate, args.length ? args : [fixedNow], new.target);
    }

    Object.setPrototypeOf(FixedDate, RealDate);
    FixedDate.prototype = RealDate.prototype;
    FixedDate.now = () => fixedNow;
    FixedDate.parse = RealDate.parse;
    FixedDate.UTC = RealDate.UTC;
    window.Date = FixedDate as unknown as DateConstructor;
  });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Tournament' })).toBeVisible();
  await expect(page.getByText('Bundled snapshot fallback')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Overview' })).toHaveCount(0);
  await expect(page.getByLabel('Your home prediction')).toHaveCount(0);
  await expect(page.getByLabel('Your away prediction')).toHaveCount(0);

  const authPanel = page.locator('[aria-label="Predictor account"]');
  await authPanel.getByRole('button', { name: 'Sign in / Sign up' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill('jonas@example.com');
  await page.getByLabel('Password').fill('password123');
  await page.locator('.auth-card form').getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Jonas' })).toBeVisible();
  await expect(page.locator('.current-player-row')).toContainText('4');
  await expect(page.locator('.current-player-row')).toContainText('1');
  await page.getByText('Scoring rules').click();
  await expect(page.getByText('Exact score: 4 points.')).toBeVisible();

  await page.getByRole('button', { name: 'Matches' }).click();
  await expect(page.locator('.predictor-status-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Jump to latest game' })).toBeVisible();
  await expect(page.locator('.match-toolbar')).toContainText(/Live:|Next: .*PT|Latest: .*PT/);
  await page.getByRole('button', { name: 'Jump to latest game' }).click();
  await expect(page.locator('.match-row.jump-highlight')).toBeVisible();
  const finalRow = page.locator('.match-row').filter({ hasText: 'Mexico' }).filter({ hasText: 'South Africa' }).first();
  await expect(finalRow).toBeVisible();
  await expect(finalRow.getByLabel('Home score')).toHaveValue('2');
  await expect(finalRow.getByLabel('Home score')).toBeDisabled();
  await expect(finalRow.getByLabel('Away score')).toBeDisabled();
  await expect(finalRow.getByText('Your pick 2-0')).toBeVisible();
  await expect(finalRow.getByText('4 pts')).toBeVisible();
  const missedFinalRow = page.locator('.match-row').filter({ hasText: 'South Korea' }).filter({ hasText: 'Czechia' }).first();
  await expect(missedFinalRow.getByText('No prediction')).toBeVisible();
  await expect(missedFinalRow.getByText('0 pts')).toBeVisible();

  const editableRow = page.locator('.match-row').filter({ hasText: 'Netherlands' }).filter({ hasText: 'Sweden' }).first();
  await expect(editableRow).toBeVisible();
  await editableRow.getByLabel('Home score').fill('1');
  await editableRow.getByLabel('Away score').fill('2');
  await expect(page.locator('.top-notice.success').getByText('Prediction saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate Group Stage' }).click();
  await expect(page.getByText(/Simulated \d+ group match/)).toBeVisible();
  await expect(page.getByText(/Preserved \d+ existing tips?\./)).toBeVisible();
  await expect(page.locator('.top-notice.success').getByText(/Filled \d+ empty predictions? from simulation\./)).toBeVisible();
  await expect(page.locator('.odds-pill.simulated').first()).toBeVisible();
  await expect(editableRow.getByLabel('Home score')).toHaveValue('1');
  await expect(editableRow.getByLabel('Away score')).toHaveValue('2');
  const simulatedOnlyRow = page.locator('.match-row').filter({ hasText: 'Germany' }).filter({ hasText: 'Ivory Coast' }).first();
  await expect(simulatedOnlyRow.getByLabel('Home score')).not.toHaveValue('');

  await page.reload();
  await page.getByRole('button', { name: 'Matches' }).click();
  const persistedRow = page.locator('.match-row').filter({ hasText: 'Netherlands' }).filter({ hasText: 'Sweden' }).first();
  const persistedSimulatedOnlyRow = page.locator('.match-row').filter({ hasText: 'Germany' }).filter({ hasText: 'Ivory Coast' }).first();
  await expect(persistedRow.getByLabel('Home score')).toHaveValue('1');
  await expect(persistedRow.getByLabel('Away score')).toHaveValue('2');
  await expect(page.locator('.odds-pill.simulated').first()).toBeVisible();
  await page.getByRole('button', { name: 'Clear Simulated Scores' }).click();
  await expect(page.locator('.odds-pill.simulated')).toHaveCount(0);
  await expect(persistedSimulatedOnlyRow.getByLabel('Home score')).toHaveValue('');
  await expect(persistedRow.getByLabel('Home score')).toHaveValue('1');
  await expect(finalRow.getByLabel('Home score')).toHaveValue('2');

  await page.getByRole('button', { name: 'Groups' }).click();
  await expect(page.locator('.mini-match.played').first()).toBeVisible();

  await page.getByRole('button', { name: 'Knockout' }).click();
  await expect(page.getByRole('heading', { name: 'Knockout' })).toBeVisible();
  await expect(page.locator('.bracket-card').first()).toBeVisible();
  await expect(page.locator('.bracket-connector').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete all' })).toBeDisabled();
  const firstBracketCard = page.locator('.bracket-card').first();
  await firstBracketCard.getByLabel('Home score').fill('1');
  await firstBracketCard.getByLabel('Away score').fill('0');
  await expect(page.getByRole('button', { name: 'Delete all' })).toBeEnabled();
  await page.getByRole('button', { name: 'Delete all' }).click();
  await expect(firstBracketCard.getByLabel('Home score')).toHaveValue('');
  await expect(firstBracketCard.getByLabel('Away score')).toHaveValue('');

  await page.screenshot({ path: `test-results/world-cup-sim-${testInfo.project.name}.png`, fullPage: true });
});
