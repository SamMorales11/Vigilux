/**
 * Automated Headless Browser Screenshot Capture for Vigilux Command Center.
 *
 * Runs strictly in headless mode (headless: 'new') at 1920x1080 resolution,
 * capturing the two designated demonstration states without displaying any browser UI.
 */

import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FRONTEND_URL = 'http://localhost:5173';
const BACKEND_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'docs/screenshots');

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200 || res.status === 404) {
        return true;
      }
    } catch {
      // Keep waiting
    }
    await sleep(800);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function run() {
  console.log('[Capture] Ensuring target directory exists:', SCREENSHOT_DIR);
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log('[Capture] Verifying backend and frontend availability...');
  await waitForServer(`${BACKEND_URL}/health`);
  await waitForServer(FRONTEND_URL);
  console.log('[Capture] All services are online!');

  console.log('[Capture] Launching headless Chrome (1920x1080)...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080',
      '--disable-gpu',
    ],
    defaultViewport: {
      width: 1920,
      height: 1080,
    },
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`[Capture] Navigating to ${FRONTEND_URL}...`);
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle0', timeout: 30000 });

    // Step 1: Wait 16 seconds for initial 1 Hz telemetry stream to fill charts
    console.log('[Capture] Waiting 16s for normal 1 Hz telemetry to stream and stabilize...');
    await sleep(16000);

    const shot1Path = path.join(SCREENSHOT_DIR, '01-normal-command-center.png');
    await page.screenshot({ path: shot1Path, fullPage: false });
    console.log(`[Capture] Screenshot 1 saved: ${shot1Path}`);

    // Step 2: Trigger Failure Simulation
    console.log('[Capture] Triggering Simulate Failure scenario on MOTOR-03...');
    await fetch(`${BACKEND_URL}/api/v1/demo/simulate-failure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        simulate_failure: true,
        target_asset: 'MOTOR-03',
        threshold: 0.8,
      }),
    });

    // Also click button in UI if available
    try {
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) =>
          b.textContent?.includes('SIMULATE')
        );
        if (btn) btn.click();
      });
    } catch {
      // Ignore
    }

    // Step 3: Wait 25 seconds for degradation progression (vibration surge, kW spike, anomaly alarm)
    console.log('[Capture] Waiting 25s for bearing wear degradation, kW spike, and critical alert...');
    await sleep(25000);

    // Make sure MOTOR-03 is selected for chart display
    try {
      await page.evaluate(() => {
        const motor03Btn = Array.from(document.querySelectorAll('button')).find((b) =>
          b.textContent?.includes('MOTOR-03')
        );
        if (motor03Btn) motor03Btn.click();
      });
      await sleep(1500);
    } catch {
      // Ignore
    }

    const shot2Path = path.join(SCREENSHOT_DIR, '02-critical-anomaly-simulation.png');
    await page.screenshot({ path: shot2Path, fullPage: false });
    console.log(`[Capture] Screenshot 2 saved: ${shot2Path}`);

    // Reset simulation
    console.log('[Capture] Resetting failure simulation to baseline...');
    await fetch(`${BACKEND_URL}/api/v1/demo/simulate-failure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        simulate_failure: false,
        target_asset: 'MOTOR-03',
        threshold: 0.8,
      }),
    });

    console.log('[Capture] Done successfully!');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('[Capture Error]', err);
  process.exit(1);
});
