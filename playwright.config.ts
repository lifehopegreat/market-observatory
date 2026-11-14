import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const cache = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright');
const cached = existsSync(cache) ? readdirSync(cache).filter(x => /^chromium-\d+$/.test(x)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])).map(x => join(cache, x, 'chrome-win64', 'chrome.exe')).find(existsSync) : undefined;
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: process.env.CI ? 2 : 0,
  reporter: 'list', timeout: 30000, outputDir: 'test-results',
  use: { baseURL: 'http://127.0.0.1:8877', trace: 'retain-on-failure', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? cached } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'python -m uvicorn backend.app:app --host 127.0.0.1 --port 8877 --no-access-log', url: 'http://127.0.0.1:8877/api/health', reuseExistingServer: false, timeout: 30000, env: { OBSERVATORY_DATA_DIR: resolve('data', `e2e-${Date.now()}`) } }
});
