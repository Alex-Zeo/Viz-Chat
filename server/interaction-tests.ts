import type { Page } from 'puppeteer-core';
import type { VerifyIssue, AgentStatus } from './types.js';
import { v4 as uuid } from 'uuid';

export interface TestResult {
  name: string;
  passed: boolean;
  issues: VerifyIssue[];
  durationMs: number;
}

// T1: Panel Render Completeness
async function t1PanelRender(page: Page): Promise<TestResult> {
  const start = Date.now();
  const issues: VerifyIssue[] = [];

  const panelResults = await page.evaluate(() => {
    const panels = document.querySelectorAll('.panel-frame');
    return Array.from(panels).map((panel, i) => {
      const isEmpty = panel.classList.contains('panel-empty');
      const hasCanvas = panel.querySelector('canvas') !== null;
      const hasSvg = panel.querySelector('svg') !== null;
      const hasError = panel.querySelector('.panel-empty-content') !== null && !isEmpty;
      const dims = panel.getBoundingClientRect();
      return {
        index: i,
        isEmpty,
        hasCanvas,
        hasSvg,
        hasError,
        width: dims.width,
        height: dims.height,
      };
    });
  });

  for (const p of panelResults) {
    if (p.isEmpty) {
      issues.push({
        id: uuid(),
        severity: 'CRITICAL',
        category: 'data',
        element: `panel-${p.index}`,
        symptom: `Panel slot ${p.index} is empty (no agent assigned or still waiting)`,
        hypothesis: 'Agent assignment or build stage did not complete for this slot',
        status: 'OPEN',
      });
    } else if (!p.hasCanvas && !p.hasSvg) {
      issues.push({
        id: uuid(),
        severity: 'CRITICAL',
        category: 'data',
        element: `panel-${p.index}`,
        symptom: `Panel ${p.index} has no canvas or SVG element`,
        hypothesis: 'ECharts failed to render or A2uiSurface did not mount',
        status: 'OPEN',
      });
    } else if (p.width === 0 || p.height === 0) {
      issues.push({
        id: uuid(),
        severity: 'HIGH',
        category: 'design',
        element: `panel-${p.index}`,
        symptom: `Panel ${p.index} has zero dimensions (${p.width}x${p.height})`,
        hypothesis: 'CSS layout issue — panel container has no size',
        status: 'OPEN',
      });
    }
  }

  if (panelResults.length < 4) {
    issues.push({
      id: uuid(),
      severity: 'HIGH',
      category: 'data',
      element: 'compositor-grid',
      symptom: `Only ${panelResults.length} panel slots found, expected 4`,
      hypothesis: 'CompositorGrid not rendering all 4 slots',
      status: 'OPEN',
    });
  }

  return {
    name: 'T1: Panel Render Completeness',
    passed: issues.length === 0,
    issues,
    durationMs: Date.now() - start,
  };
}

// T2: Console Health
async function t2ConsoleHealth(
  consoleErrors: string[],
  consoleWarnings: string[],
): Promise<TestResult> {
  const start = Date.now();
  const issues: VerifyIssue[] = [];

  for (const err of consoleErrors) {
    // Skip benign Lit dev mode warning
    if (err.includes('Lit is in dev mode')) continue;

    issues.push({
      id: uuid(),
      severity: 'HIGH',
      category: 'console',
      element: 'console',
      symptom: `Console error: ${err.slice(0, 200)}`,
      hypothesis: 'JS runtime error in dashboard',
      status: 'OPEN',
    });
  }

  return {
    name: 'T2: Console Health',
    passed: issues.length === 0,
    issues,
    durationMs: Date.now() - start,
  };
}

// T6: Design Token Consistency
async function t6DesignTokens(page: Page): Promise<TestResult> {
  const start = Date.now();
  const issues: VerifyIssue[] = [];

  const tokenResults = await page.evaluate(() => {
    const results: Array<{
      panelIndex: number;
      fontFamily: string;
      hasInter: boolean;
      bgColor: string;
      textElements: number;
      smallTextCount: number;
    }> = [];

    const panels = document.querySelectorAll('.panel-frame');
    panels.forEach((panel, i) => {
      const canvasEl = panel.querySelector('canvas');
      const computed = canvasEl
        ? window.getComputedStyle(canvasEl)
        : window.getComputedStyle(panel);
      const fontFamily = computed.fontFamily;
      const bgColor = window.getComputedStyle(panel).backgroundColor;

      let smallTextCount = 0;
      let textElements = 0;
      panel.querySelectorAll('span, div, text, p').forEach((el) => {
        const style = window.getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize);
        if (fontSize > 0) {
          textElements++;
          if (fontSize < 11) smallTextCount++;
        }
      });

      results.push({
        panelIndex: i,
        fontFamily,
        hasInter: fontFamily.includes('Inter') || fontFamily.includes('system-ui'),
        bgColor,
        textElements,
        smallTextCount,
      });
    });

    return results;
  });

  for (const r of tokenResults) {
    if (!r.hasInter) {
      issues.push({
        id: uuid(),
        severity: 'MEDIUM',
        category: 'design',
        element: `panel-${r.panelIndex}`,
        symptom: `Font family "${r.fontFamily}" does not include Inter`,
        hypothesis: 'Design token --font not applied to panel container',
        status: 'OPEN',
      });
    }
    if (r.smallTextCount > 0) {
      issues.push({
        id: uuid(),
        severity: 'MEDIUM',
        category: 'design',
        element: `panel-${r.panelIndex}`,
        symptom: `${r.smallTextCount}/${r.textElements} text elements below 11px`,
        hypothesis: 'ECharts label fontSize too small for readability',
        status: 'OPEN',
      });
    }
  }

  return {
    name: 'T6: Design Token Consistency',
    passed: issues.length === 0,
    issues,
    durationMs: Date.now() - start,
  };
}

// T7: A2UI Surface Validation
async function t7A2uiSurface(page: Page): Promise<TestResult> {
  const start = Date.now();
  const issues: VerifyIssue[] = [];

  const surfaceResults = await page.evaluate(() => {
    const panels = document.querySelectorAll('.panel-frame');
    return Array.from(panels)
      .filter((p) => !p.classList.contains('panel-empty'))
      .map((panel, i) => {
        const hasCanvas = panel.querySelector('canvas') !== null;
        const hasSurface =
          panel.querySelector('[data-a2ui]') !== null ||
          panel.querySelector('canvas') !== null;
        return { index: i, hasCanvas, hasSurface };
      });
  });

  for (const r of surfaceResults) {
    if (!r.hasSurface) {
      issues.push({
        id: uuid(),
        severity: 'HIGH',
        category: 'coupling',
        element: `panel-${r.index}`,
        symptom: 'A2uiSurface component not detected in panel',
        hypothesis: 'PanelFrame did not mount A2uiSurface or SurfaceModel failed',
        status: 'OPEN',
      });
    }
    if (!r.hasCanvas) {
      issues.push({
        id: uuid(),
        severity: 'HIGH',
        category: 'coupling',
        element: `panel-${r.index}`,
        symptom: 'No canvas element within A2uiSurface — ECharts not rendering',
        hypothesis: 'ReactECharts component did not initialize within A2uiSurface',
        status: 'OPEN',
      });
    }
  }

  return {
    name: 'T7: A2UI Surface Validation',
    passed: issues.length === 0,
    issues,
    durationMs: Date.now() - start,
  };
}

// T4: Status Bar Accuracy
async function t4StatusBar(page: Page, expectedAgents: number): Promise<TestResult> {
  const start = Date.now();
  const issues: VerifyIssue[] = [];

  const statusResults = await page.evaluate(() => {
    const items = document.querySelectorAll('.status-item');
    const values: Record<string, string> = {};
    items.forEach((item) => {
      const label = item.querySelector('.status-label')?.textContent?.trim() ?? '';
      const value = item.querySelector('.status-value')?.textContent?.trim() ?? '';
      if (label) values[label] = value;
    });
    return values;
  });

  const reportedAgents = parseInt(statusResults['agents'] ?? '0', 10);
  if (reportedAgents !== expectedAgents) {
    issues.push({
      id: uuid(),
      severity: 'HIGH',
      category: 'coupling',
      element: 'status-bar',
      symptom: `Status bar shows ${reportedAgents} agents, expected ${expectedAgents}`,
      hypothesis: 'StatusBar not reading agent count from state correctly',
      status: 'OPEN',
    });
  }

  const stage = statusResults['stage:'] ?? '';
  if (!stage || stage === 'idle') {
    issues.push({
      id: uuid(),
      severity: 'MEDIUM',
      category: 'coupling',
      element: 'status-bar',
      symptom: `Stage badge shows "${stage}" during verify — expected active stage`,
      hypothesis: 'State delta for stage transition not reaching frontend',
      status: 'OPEN',
    });
  }

  return {
    name: 'T4: Status Bar Accuracy',
    passed: issues.length === 0,
    issues,
    durationMs: Date.now() - start,
  };
}

// T5: Sidebar Chat Functional (DOM + Visual Bounds)
async function t5SidebarChat(page: Page): Promise<TestResult> {
  const start = Date.now();
  const issues: VerifyIssue[] = [];

  const chatResults = await page.evaluate(() => {
    const sidebarArea = document.querySelector('.sidebar-area');
    if (!sidebarArea) return { hasSidebar: false } as const;

    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const sidebarRect = sidebarArea.getBoundingClientRect();

    const textarea =
      sidebarArea.querySelector('textarea') ??
      sidebarArea.querySelector('input[type="text"]');
    const textContent = sidebarArea.textContent ?? '';
    const hasTitle = textContent.includes('Control Room');

    let inputVisual = null;
    if (textarea) {
      const r = textarea.getBoundingClientRect();
      // Walk ancestors to check if any overflow:hidden clips it
      let clipped = false;
      let clipper = '';
      let ancestor: HTMLElement | null = textarea.parentElement;
      while (ancestor) {
        const style = window.getComputedStyle(ancestor);
        const ancestorRect = ancestor.getBoundingClientRect();
        if (
          (style.overflow === 'hidden' || style.overflowY === 'hidden') &&
          ancestorRect.bottom < r.bottom
        ) {
          clipped = true;
          clipper = ancestor.className.slice(0, 40);
          break;
        }
        ancestor = ancestor.parentElement;
      }

      inputVisual = {
        inDOM: true,
        top: r.top,
        bottom: r.bottom,
        height: r.height,
        width: r.width,
        withinViewport: r.top >= 0 && r.bottom <= viewportH && r.left >= 0 && r.right <= viewportW,
        withinSidebar: r.top >= sidebarRect.top && r.bottom <= sidebarRect.bottom,
        clippedByAncestor: clipped,
        clipper,
        minHeightOk: r.height >= 20,
        minWidthOk: r.width >= 100,
      };
    }

    return { hasSidebar: true, hasTitle, inputVisual, sidebarWidth: sidebarRect.width };
  });

  if (!chatResults.hasSidebar) {
    issues.push({
      id: uuid(),
      severity: 'HIGH',
      category: 'coupling',
      element: 'sidebar',
      symptom: 'Sidebar area not found in DOM',
      hypothesis: 'CopilotSidebar component failed to mount',
      status: 'OPEN',
    });
    return { name: 'T5: Sidebar Chat Functional', passed: false, issues, durationMs: Date.now() - start };
  }

  if (!chatResults.hasTitle) {
    issues.push({
      id: uuid(),
      severity: 'MEDIUM',
      category: 'design',
      element: 'sidebar',
      symptom: '"Control Room" title not visible in sidebar',
      hypothesis: 'CopilotSidebar labels.title not rendering',
      status: 'OPEN',
    });
  }

  const iv = chatResults.inputVisual;
  if (!iv || !iv.inDOM) {
    issues.push({
      id: uuid(),
      severity: 'CRITICAL',
      category: 'coupling',
      element: 'sidebar-input',
      symptom: 'Chat input (textarea) not found in sidebar DOM',
      hypothesis: 'CopilotSidebar input component failed to render',
      status: 'OPEN',
    });
  } else {
    if (!iv.withinViewport) {
      issues.push({
        id: uuid(),
        severity: 'CRITICAL',
        category: 'design',
        element: 'sidebar-input',
        symptom: `Chat input is outside viewport bounds (top:${Math.round(iv.top)} bottom:${Math.round(iv.bottom)})`,
        hypothesis: 'CopilotKit layout pushes textarea below visible area — CSS overflow or position issue',
        status: 'OPEN',
      });
    }
    if (iv.clippedByAncestor) {
      issues.push({
        id: uuid(),
        severity: 'CRITICAL',
        category: 'design',
        element: 'sidebar-input',
        symptom: `Chat input clipped by ancestor overflow:hidden (${iv.clipper})`,
        hypothesis: 'Parent container clips textarea — user cannot see or interact with chat input',
        status: 'OPEN',
      });
    }
    if (!iv.minHeightOk || !iv.minWidthOk) {
      issues.push({
        id: uuid(),
        severity: 'HIGH',
        category: 'design',
        element: 'sidebar-input',
        symptom: `Chat input too small to be usable (${Math.round(iv.width)}×${Math.round(iv.height)}px)`,
        hypothesis: 'CSS collapse or zero-width container chain',
        status: 'OPEN',
      });
    }
  }

  return {
    name: 'T5: Sidebar Chat Functional',
    passed: issues.length === 0,
    issues,
    durationMs: Date.now() - start,
  };
}

// T8: Visual Bounds — all interactive elements within viewport
async function t8VisualBounds(page: Page): Promise<TestResult> {
  const start = Date.now();
  const issues: VerifyIssue[] = [];

  const boundsResults = await page.evaluate(() => {
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    function isVisuallyAccessible(el: Element): {
      visible: boolean;
      reason: string;
      rect: { t: number; b: number; l: number; r: number; w: number; h: number };
    } {
      const r = el.getBoundingClientRect();
      const rect = { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };

      if (rect.w === 0 || rect.h === 0) return { visible: false, reason: 'zero dimensions', rect };
      if (rect.b < 0 || rect.t > viewportH) return { visible: false, reason: 'outside viewport vertically', rect };
      if (rect.r < 0 || rect.l > viewportW) return { visible: false, reason: 'outside viewport horizontally', rect };

      // Check ancestor overflow clipping
      let ancestor: HTMLElement | null = el.parentElement;
      while (ancestor) {
        const style = window.getComputedStyle(ancestor);
        if (style.overflow === 'hidden' || style.overflowY === 'hidden') {
          const aRect = ancestor.getBoundingClientRect();
          if (aRect.bottom < r.bottom - 2 || aRect.top > r.top + 2) {
            return { visible: false, reason: `clipped by ${ancestor.className.slice(0, 30)} (overflow:hidden)`, rect };
          }
        }
        ancestor = ancestor.parentElement;
      }

      return { visible: true, reason: 'ok', rect };
    }

    const checks: Array<{ name: string; selector: string; severity: string }> = [
      { name: 'company-selector', selector: '.company-select, .company-selector select', severity: 'HIGH' },
      { name: 'stage-badge', selector: '.stage-badge', severity: 'MEDIUM' },
      { name: 'status-bar', selector: '.status-bar', severity: 'HIGH' },
      { name: 'chat-input', selector: '.sidebar-area textarea, .sidebar-area input[type="text"]', severity: 'CRITICAL' },
      { name: 'sidebar-header', selector: '.copilotKitHeader', severity: 'HIGH' },
    ];

    const results: Array<{ name: string; found: boolean; visible: boolean; reason: string; severity: string; rect?: { t: number; b: number; l: number; r: number; w: number; h: number } }> = [];

    for (const check of checks) {
      const el = document.querySelector(check.selector);
      if (!el) {
        results.push({ name: check.name, found: false, visible: false, reason: 'not in DOM', severity: check.severity });
        continue;
      }
      const viz = isVisuallyAccessible(el);
      results.push({ name: check.name, found: true, visible: viz.visible, reason: viz.reason, severity: check.severity, rect: viz.rect });
    }

    // Check all 4 panel frames
    const panels = document.querySelectorAll('.panel-frame');
    panels.forEach((panel, i) => {
      const viz = isVisuallyAccessible(panel);
      results.push({ name: `panel-${i}`, found: true, visible: viz.visible, reason: viz.reason, severity: 'HIGH', rect: viz.rect });
    });

    return results;
  });

  for (const r of boundsResults) {
    if (!r.found) {
      issues.push({
        id: uuid(),
        severity: r.severity as VerifyIssue['severity'],
        category: 'design',
        element: r.name,
        symptom: `${r.name} not found in DOM`,
        hypothesis: 'Component not rendered',
        status: 'OPEN',
      });
    } else if (!r.visible) {
      issues.push({
        id: uuid(),
        severity: r.severity as VerifyIssue['severity'],
        category: 'design',
        element: r.name,
        symptom: `${r.name} in DOM but NOT visually accessible: ${r.reason} (${r.rect?.t},${r.rect?.b} ${r.rect?.w}×${r.rect?.h})`,
        hypothesis: 'Element exists in DOM but user cannot see or interact with it — visual verification required',
        status: 'OPEN',
      });
    }
  }

  return {
    name: 'T8: Visual Bounds Verification',
    passed: issues.length === 0,
    issues,
    durationMs: Date.now() - start,
  };
}

export interface InteractionTestSuite {
  results: TestResult[];
  totalIssues: VerifyIssue[];
  criticalCount: number;
  highCount: number;
  allPassed: boolean;
  durationMs: number;
}

export async function runInteractionTests(
  page: Page,
  consoleErrors: string[],
  consoleWarnings: string[],
  expectedAgents: number,
): Promise<InteractionTestSuite> {
  const start = Date.now();

  const results = await Promise.all([
    t1PanelRender(page),
    t2ConsoleHealth(consoleErrors, consoleWarnings),
    t4StatusBar(page, expectedAgents),
    t5SidebarChat(page),
    t6DesignTokens(page),
    t7A2uiSurface(page),
    t8VisualBounds(page),
  ]);

  const totalIssues = results.flatMap((r) => r.issues);
  const criticalCount = totalIssues.filter((i) => i.severity === 'CRITICAL').length;
  const highCount = totalIssues.filter((i) => i.severity === 'HIGH').length;

  return {
    results,
    totalIssues,
    criticalCount,
    highCount,
    allPassed: totalIssues.length === 0,
    durationMs: Date.now() - start,
  };
}
