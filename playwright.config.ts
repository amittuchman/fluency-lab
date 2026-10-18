import { defineConfig } from '@playwright/test'

// Runs against the production build. Uses the installed Microsoft Edge (channel: 'msedge'), so no browser
// download is needed; switch the channel to 'chrome' or drop it after `npx playwright install chromium`.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4174/fluency-lab/', channel: 'msedge' },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4174 --strictPort',
    url: 'http://localhost:4174/fluency-lab/',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
