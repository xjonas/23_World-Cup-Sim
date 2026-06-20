import { defineConfig, devices } from '@playwright/test';

const e2ePort = process.env.E2E_PORT ?? '5176';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.e2e\.ts/,
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${e2ePort} --strictPort`,
    url: `http://127.0.0.1:${e2ePort}`,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key'
    },
    reuseExistingServer: !process.env.CI
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] }
    }
  ]
});
