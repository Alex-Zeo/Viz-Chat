import puppeteer from 'puppeteer-core';
import type { EmitFn, AgentStatus, DashboardDqi } from './types.js';
import { runInteractionTests } from './interaction-tests.js';
import { computeDqi } from './dqi.js';
import type { FrameStore } from './frame-store.js';

const CHROME_URL = 'http://127.0.0.1:9222';
const DASHBOARD_URL = 'http://localhost:5173';
const MAX_VERIFY_CYCLES = 3;
const DQI_THRESHOLD = 0.90;

export async function runVerifyStage(
  agents: AgentStatus[],
  frameStore: FrameStore,
  emit: EmitFn,
): Promise<DashboardDqi> {
  emit({ type: 'STEP_STARTED', stepName: 'verify' });
  emit({
    type: 'STATE_DELTA',
    delta: [{ op: 'replace' as const, path: '/stage', value: 'verifying' }],
  });

  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: CHROME_URL });
  } catch {
    const fallback: DashboardDqi = {
      score: 0,
      dimensions: { completeness: 0, accuracy: 0, fidelity: 0, consistency: 0, interactivity: 0, consoleHealth: 1, performance: 0 },
      cycle: 0,
      issues: [{ id: 'no-chrome', severity: 'HIGH', category: 'performance', element: 'Chrome CDP', symptom: 'Chrome not reachable on port 9222', hypothesis: 'Start Chrome with --remote-debugging-port=9222', status: 'OPEN' }],
    };
    emit({ type: 'STATE_DELTA', delta: [{ op: 'add' as const, path: '/dqi', value: fallback }] });
    emit({ type: 'STEP_FINISHED', stepName: 'verify' });
    return fallback;
  }

  let bestDqi: DashboardDqi | null = null;

  try {
    // Find the existing dashboard tab or open a new one
    const pages = await browser.pages();
    let page = pages.find((p) => p.url().startsWith(DASHBOARD_URL)) ?? null;

    if (!page) {
      page = await browser.newPage();
      await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle0', timeout: 15000 });
    }

    await page.setViewport({ width: 1440, height: 900 });

    for (let cycle = 1; cycle <= MAX_VERIFY_CYCLES; cycle++) {
      // Collect console errors during this cycle
      const consoleErrors: string[] = [];
      const consoleWarnings: string[] = [];
      const consoleHandler = (msg: import('puppeteer-core').ConsoleMessage) => {
        const t = msg.type();
        if (t === 'error') consoleErrors.push(msg.text());
        if (t === 'warn') consoleWarnings.push(msg.text());
      };
      page.on('console', consoleHandler);

      // Reload to get fresh console state
      const renderStart = Date.now();
      await page.reload({ waitUntil: 'networkidle0', timeout: 15000 });
      // Wait for panels to render (ECharts canvas init)
      await page.waitForSelector('.panel-frame', { timeout: 10000 }).catch(() => {});
      await new Promise<void>((r) => setTimeout(r, 1500));
      const renderTimeMs = Date.now() - renderStart;

      page.off('console', consoleHandler);

      // Run T1, T2, T4, T5, T6, T7
      const testSuite = await runInteractionTests(
        page,
        consoleErrors,
        consoleWarnings,
        agents.length,
      );

      // Compute DQI
      const dqi = computeDqi(testSuite, agents, frameStore, renderTimeMs, cycle);

      if (!bestDqi || dqi.score >= bestDqi.score) {
        bestDqi = dqi;
      }

      // Emit DQI to frontend
      emit({
        type: 'STATE_DELTA',
        delta: [
          { op: 'add' as const, path: '/dqi', value: bestDqi },
          { op: 'add' as const, path: '/verifyIssues', value: bestDqi.issues },
        ],
      });

      if (bestDqi.score >= DQI_THRESHOLD && testSuite.criticalCount === 0) {
        break;
      }
    }
  } finally {
    browser.disconnect();
  }

  emit({ type: 'STEP_FINISHED', stepName: 'verify' });

  return bestDqi!;
}
