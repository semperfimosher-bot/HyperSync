import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const manifest = process.env.HYPERSYNC_TEST_MANIFEST
  ? JSON.parse(readFileSync(process.env.HYPERSYNC_TEST_MANIFEST, 'utf8')) : null;
const report = process.env.HYPERSYNC_REPORT_DIR || 'test-results';
const customChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const chromiumLaunch = customChromium ? {
  executablePath: customChromium,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu'],
} : {};
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, retries: 0,
  forbidOnly: Boolean(process.env.CI), timeout: 45_000,
  expect: { timeout: 12_000 },
  outputDir: path.join(report, 'browser-artifacts'),
  reporter: [['list'], ['html', { outputFolder: path.join(report, 'browser-report'), open: 'never' }],
    ['json', { outputFile: path.join(report, 'browser-results.json') }]],
  use: { baseURL: manifest?.base_url, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    serviceWorkers: 'allow' },
  projects: [
    { name: 'chromium', testIgnore: /endurance|touch/, use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunch } },
    { name: 'firefox', testIgnore: /endurance|touch/, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testIgnore: /endurance|touch/, use: { ...devices['Desktop Safari'] } },
    { name: 'touch', testMatch: /touch.spec.js/, use: { ...devices['Pixel 7'], launchOptions: chromiumLaunch } },
    { name: 'endurance', testMatch: /endurance.spec.js/, use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunch } },
  ],
});
