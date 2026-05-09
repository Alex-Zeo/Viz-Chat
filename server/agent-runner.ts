import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import { buildAgentHTML } from './design-tokens.js';
import type { Frame, PanelEval } from './types.js';
import { injectFormatters, sanitizeConfig, SHORT_FIGURE_SOURCE } from './format-numbers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = join(__dirname, '..', 'screenshots');
const CHROME_URL = 'http://127.0.0.1:9222';

export interface AgentConnection {
  browser: Browser;
  page: Page;
  agentId: string;
}

export async function connectAgent(agentId: string): Promise<AgentConnection> {
  const browser = await puppeteer.connect({ browserURL: CHROME_URL });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  return { browser, page, agentId };
}

export async function initAgentPage(conn: AgentConnection, title: string): Promise<void> {
  const html = buildAgentHTML({ title });
  await conn.page.setContent(html, { waitUntil: 'load' });

  // Wait for ECharts CDN to load and the inline init script to run
  await conn.page.waitForFunction(
    () =>
      typeof (window as unknown as Record<string, unknown>)['echarts'] !== 'undefined' &&
      (window as unknown as Record<string, unknown>)['echarts'] !== null,
    { timeout: 15000 },
  );

  // Verify the chart instance was created by the inline script
  await conn.page.waitForFunction(
    () => {
      const echarts = (window as unknown as Record<string, unknown>)['echarts'] as {
        getInstanceByDom: (el: Element | null) => unknown;
      };
      return echarts.getInstanceByDom(document.getElementById('chart')) !== null;
    },
    { timeout: 5000 },
  );
}

export async function renderEChartsConfig(
  conn: AgentConnection,
  echartsOption: object,
): Promise<void> {
  // 1. Deep clone to avoid mutating the original
  const cloned = JSON.parse(JSON.stringify(echartsOption));
  // 2. Strip any LLM-emitted function-code strings (e.g., "function(v) { ... }")
  const sanitized = sanitizeConfig(cloned);
  // 3. Apply safe template-based formatters (no JS functions — those get stripped by JSON serialization)
  const formatted = injectFormatters(sanitized);

  // Pass shortFigure source as a string so it can be reconstructed in the browser
  const figSrc = SHORT_FIGURE_SOURCE;

  await conn.page.evaluate((option: any, shortFigureSrc: string) => {
    // Reconstruct shortFigure in the browser context where functions actually work
    // This is safe: shortFigureSrc is our own shortFigure.toString(), not user input
    const shortFigure = Function('return ' + shortFigureSrc)() as (n: number) => string;

    // Inject real formatters in the browser context (functions survive here)
    for (const axisKey of ['xAxis', 'yAxis']) {
      if (!option[axisKey]) continue;
      const axes = Array.isArray(option[axisKey]) ? option[axisKey] : [option[axisKey]];
      for (const ax of axes) {
        if (ax.type === 'value' || ax.type === 'log') {
          ax.axisLabel = ax.axisLabel ?? {};
          ax.axisLabel.formatter = (v: number) => shortFigure(v);
        }
      }
    }
    if (option.tooltip) {
      option.tooltip.valueFormatter = (v: number) =>
        typeof v === 'number' ? shortFigure(v) : v;
    }
    if (Array.isArray(option.series)) {
      for (const s of option.series) {
        if (!s) continue;
        if (s.label?.show) {
          s.label.formatter = (params: any) => {
            const val = params?.value ?? params?.data?.value ?? params?.data;
            return typeof val === 'number' ? shortFigure(val) : val;
          };
        }
        if (s.type === 'gauge' && s.detail) {
          s.detail.formatter = (v: number) => shortFigure(v);
        }
      }
    }

    const echarts = (window as unknown as Record<string, unknown>)['echarts'] as {
      getInstanceByDom: (el: Element | null) => {
        setOption: (opt: object, opts: object) => void;
        dispose: () => void;
      } | null;
      init: (el: Element | null, theme?: string) => {
        setOption: (opt: object, opts: object) => void;
      };
    };

    const chartEl = document.getElementById('chart');
    let instance = echarts.getInstanceByDom(chartEl);

    if (instance) {
      try {
        instance.setOption(option, { notMerge: true });
        return;
      } catch {
        instance.dispose();
        instance = null;
      }
    }

    const fresh = echarts.init(chartEl, 'dark');
    fresh.setOption(option, { notMerge: true });
  }, formatted, figSrc);

  await new Promise<void>((resolve) => setTimeout(resolve, 150));
}

export async function captureFrame(
  conn: AgentConnection,
  iteration: number,
  echartsOption: object,
  eval_: PanelEval,
): Promise<Frame> {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const screenshotPath = join(SCREENSHOTS_DIR, `${conn.agentId}-iter${iteration}.png`);

  await conn.page.screenshot({ path: screenshotPath, type: 'png' });
  const html = await conn.page.content();

  return {
    iteration,
    timestamp: Date.now(),
    html,
    echartsOption: JSON.parse(JSON.stringify(echartsOption)),
    eval: eval_,
    screenshotPath,
  };
}

export async function updateFooter(
  conn: AgentConnection,
  iteration: number,
  totalIterations: number,
  pqi: number,
  pillars: PanelEval['pillars'],
  status: 'building' | 'converged',
  fixDescription?: string,
): Promise<void> {
  await conn.page.evaluate(
    (
      iter: number,
      total: number,
      pqiVal: number,
      pillarsVal: PanelEval['pillars'],
      statusVal: 'building' | 'converged',
      fixDesc: string | undefined,
    ) => {
      const iterLabel = document.getElementById('iter-label');
      if (iterLabel) iterLabel.textContent = `iter ${iter}/${total}`;

      const pqiDisplay = document.getElementById('pqi-display');
      if (pqiDisplay) pqiDisplay.textContent = `PQI: ${pqiVal.toFixed(2)}`;

      const pillarsDisplay = document.getElementById('pillars-display');
      if (pillarsDisplay) {
        const parts = (Object.keys(pillarsVal) as Array<keyof typeof pillarsVal>).map(
          (k) => `${k}:${(pillarsVal[k] * 10).toFixed(0)}`,
        );
        pillarsDisplay.textContent = parts.join(' ');
      }

      const statusIndicator = document.getElementById('status-indicator');
      if (statusIndicator) {
        statusIndicator.className = statusVal;
        statusIndicator.textContent = '●';
      }

      const fixDescEl = document.getElementById('fix-description');
      if (fixDescEl) fixDescEl.textContent = fixDesc ?? '';

      const progressFill = document.getElementById('progress-fill');
      if (progressFill) {
        const pct = total > 0 ? (iter / total) * 100 : 0;
        (progressFill as HTMLElement).style.width = `${pct}%`;
      }
    },
    iteration,
    totalIterations,
    pqi,
    pillars,
    status,
    fixDescription,
  );
}

export async function disconnectAgent(conn: AgentConnection): Promise<void> {
  conn.browser.disconnect();
}
