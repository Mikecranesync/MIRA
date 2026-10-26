import { defineConfig, devices } from '@playwright/test';
const DIST = process.env.REVIEW_DIST || '../dist';
const PORT = Number(process.env.REVIEW_PORT || 47911);
export default defineConfig({
  testDir: '.',
  outputDir: 'results',
  timeout: 60000,
  workers: 2,
  reporter: [['list'], ['json', { outputFile: 'results/report.json' }]],
  webServer: { command: `python3 -m http.server ${PORT} --directory ${DIST}`, port: PORT, reuseExistingServer: false },
  use: { baseURL: `http://127.0.0.1:${PORT}/` },
  projects: [
    { name: 'pixel-9a', use: { ...devices['Pixel 7'], viewport: { width: 412, height: 915 } } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],
});
