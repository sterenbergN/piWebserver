import { defineConfig, devices } from '@playwright/test';

// Page tests for Loop Lab, in a real browser: layout at phone and tablet widths, and the
// interactions the unit tests can't reach (sliders, undo, dragging, sharing).
//   npm run test:e2e              all three setups
//   npm run test:e2e -- --project=ipad
// It starts the dev server if one isn't running on port 3000 already.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    // Safari's engine on an iPad's screen with touch: the nearest thing to the iPad short of one.
    { name: 'ipad', use: { ...devices['iPad (gen 7)'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/loop-lab',
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
