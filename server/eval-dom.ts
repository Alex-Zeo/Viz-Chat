import { OKABE_ITO } from './design-tokens.js';

interface DomCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export function runDomEval(
  html: string,
  vizType?: string,
): { mechanicalScore: number; checks: DomCheck[]; fixes: string[] } {
  const checks: DomCheck[] = [];
  const fixes: string[] = [];

  // 1. echarts-exists: div id="chart" AND echarts script tag present
  {
    const hasChartDiv = /id=["']chart["']/.test(html);
    const hasEchartsScript = /echarts/.test(html);
    const pass = hasChartDiv && hasEchartsScript;
    const missingParts: string[] = [];
    if (!hasChartDiv) missingParts.push('#chart div');
    if (!hasEchartsScript) missingParts.push('echarts script');
    checks.push({
      name: 'echarts-exists',
      pass,
      detail: pass
        ? 'ECharts container and script found'
        : `Missing: ${missingParts.join(', ')}`,
    });
  }

  // 2. title-present: non-empty <title>
  {
    const match = html.match(/<title>([^<]*)<\/title>/i);
    const pass = match != null && match[1].trim().length > 0;
    checks.push({
      name: 'title-present',
      pass,
      detail: pass
        ? `Title: "${match![1].trim()}"`
        : 'No <title> element found or title is empty',
    });
  }

  // 3. title-descriptive: not one of the generic titles
  {
    const match = html.match(/<title>([^<]*)<\/title>/i);
    const titleText = match ? match[1].trim() : '';
    const genericTitles = ['bar chart', 'line chart', 'chart', 'untitled', 'echarts'];
    const pass = titleText.length > 0 && !genericTitles.includes(titleText.toLowerCase());
    checks.push({
      name: 'title-descriptive',
      pass,
      detail: pass
        ? `Descriptive title: "${titleText}"`
        : titleText.length === 0
          ? 'No title to evaluate'
          : `Generic title: "${titleText}"`,
    });
  }

  // 4. axes-labeled: xAxis name or yAxis name, or axisLabel pattern
  {
    const xAxisName = /xAxis\s*:\s*\{[^}]*\bname\s*:/.test(html);
    const yAxisName = /yAxis\s*:\s*\{[^}]*\bname\s*:/.test(html);
    const axisLabel = /axisLabel/.test(html);
    const pass = xAxisName || yAxisName || axisLabel;
    checks.push({
      name: 'axes-labeled',
      pass,
      detail: pass
        ? `Axis labels found (xAxis.name:${xAxisName}, yAxis.name:${yAxisName}, axisLabel:${axisLabel})`
        : 'No axis name or axisLabel configuration found',
    });
  }

  // 5. tooltip-configured: tooltip config present (handles both raw JS and JSON.stringify'd)
  {
    const pass = /["']?tooltip["']?\s*:\s*\{/.test(html) || /"tooltip"\s*:\s*\{/.test(html);
    checks.push({
      name: 'tooltip-configured',
      pass,
      detail: pass
        ? 'Tooltip configuration found'
        : 'No tooltip configuration found',
    });
  }

  // 6. okabe-ito-palette: at least 2 of the 6 hex values present (case-insensitive)
  {
    const htmlLower = html.toLowerCase();
    const found = OKABE_ITO.filter((hex) => htmlLower.includes(hex.toLowerCase()));
    const pass = found.length >= 2;
    checks.push({
      name: 'okabe-ito-palette',
      pass,
      detail: pass
        ? `${found.length} Okabe-Ito colors found: ${found.join(', ')}`
        : `Only ${found.length} Okabe-Ito color(s) found; need at least 2`,
    });
  }

  // 7. mono-color-multi-series: multiple series must use at least 2 distinct Okabe-Ito colors
  {
    // Count series
    const seriesCountMatch = html.match(/["']?series["']?\s*:\s*\[/);
    let seriesCount = 0;
    if (seriesCountMatch) {
      const seriesStart = seriesCountMatch.index! + seriesCountMatch[0].length;
      const seriesBlock = html.slice(seriesStart, seriesStart + 10000);
      // Count type: occurrences as proxy for series count
      seriesCount = (seriesBlock.match(/["']?type["']?\s*:\s*["']/g) || []).length;
    }
    // Also check for stacked/grouped bar patterns
    const hasStack = /["']?stack["']?\s*:/.test(html);
    const isMultiSeries = seriesCount > 1 || hasStack;

    const htmlLowerMono = html.toLowerCase();
    const distinctOkabeColors = OKABE_ITO.filter((hex) => htmlLowerMono.includes(hex.toLowerCase()));
    const pass = !isMultiSeries || distinctOkabeColors.length >= 2;
    checks.push({
      name: 'mono-color-multi-series',
      pass,
      detail: pass
        ? isMultiSeries
          ? `${seriesCount} series with ${distinctOkabeColors.length} distinct Okabe-Ito colors`
          : 'Single series or no series — color check not applicable'
        : `${seriesCount} series detected but only ${distinctOkabeColors.length} Okabe-Ito color(s) used`,
    });
  }

  // 8. font-inter: 'Inter' in the HTML
  {
    const pass = /Inter/.test(html);
    checks.push({
      name: 'font-inter',
      pass,
      detail: pass
        ? 'Inter font reference found'
        : 'Inter font not found in HTML',
    });
  }

  // 9. data-points-sufficient: at least 3 data points in data/links/value arrays
  {
    let maxPoints = 0;
    const patterns = [/data\s*:\s*\[/g, /"data"\s*:\s*\[/g, /"links"\s*:\s*\[/g, /"value"\s*:\s*\[/g];
    for (const re of patterns) {
      let match: RegExpExecArray | null;
      while ((match = re.exec(html)) !== null) {
        let depth = 0;
        let commas = 0;
        for (let j = match.index + match[0].length - 1; j < html.length && j < match.index + 5000; j++) {
          if (html[j] === '[') depth++;
          else if (html[j] === ']') { depth--; if (depth === 0) break; }
          else if (html[j] === ',' && depth === 1) commas++;
        }
        if (commas + 1 > maxPoints) maxPoints = commas + 1;
      }
    }
    const isGauge = vizType === 'gauge' || /type["']?\s*:\s*["']gauge/.test(html);
    const minRequired = isGauge ? 1 : 3;
    const pass = maxPoints >= minRequired;
    checks.push({
      name: 'data-points-sufficient',
      pass,
      detail: pass
        ? `Max data array length: ${maxPoints}${isGauge ? ' (gauge exemption)' : ''}`
        : `Largest data array has ${maxPoints} point(s); need at least ${minRequired}`,
    });
  }

  // 10. no-error-markers: no \bNaN\b, Error:, or console.error
  {
    const hasNaN = /\bNaN\b/.test(html);
    const hasErrorColon = /Error:/.test(html);
    const hasConsoleError = /console\.error/.test(html);
    const pass = !hasNaN && !hasErrorColon && !hasConsoleError;
    const markers: string[] = [];
    if (hasNaN) markers.push('NaN');
    if (hasErrorColon) markers.push('Error:');
    if (hasConsoleError) markers.push('console.error');
    checks.push({
      name: 'no-error-markers',
      pass,
      detail: pass
        ? 'No error markers found'
        : `Error markers present: ${markers.join(', ')}`,
    });
  }

  // 11. function-code-leak: JS function source code rendered as visible text
  {
    // Strip all <script>...</script> blocks, then check remaining HTML for function patterns
    const htmlNoScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    const hasFunctionLeak = /function\s*\(|=>\s*\{|\.toFixed\s*\(/.test(htmlNoScripts);
    const pass = !hasFunctionLeak;
    checks.push({
      name: 'function-code-leak',
      pass,
      detail: pass
        ? 'No function source code leaking into visible HTML'
        : 'JavaScript function code is rendering as visible text in the chart',
    });
  }

  // 12. design-tokens: all four CSS custom properties present
  {
    const hasBg = /--bg\b/.test(html);
    const hasSurface = /--surface\b/.test(html);
    const hasText = /--text\b/.test(html);
    const hasFont = /--font\b/.test(html);
    const pass = hasBg && hasSurface && hasText && hasFont;
    const missing: string[] = [];
    if (!hasBg) missing.push('--bg');
    if (!hasSurface) missing.push('--surface');
    if (!hasText) missing.push('--text');
    if (!hasFont) missing.push('--font');
    checks.push({
      name: 'design-tokens',
      pass,
      detail: pass
        ? 'All design tokens present (--bg, --surface, --text, --font)'
        : `Missing design tokens: ${missing.join(', ')}`,
    });
  }

  // 13. series-has-values: series[].data contains non-zero numeric values with meaningful sum
  {
    const allDataArrays = [...html.matchAll(/["']?data["']?\s*:\s*\[([^\]]*)\]/g)];
    let totalAbsSum = 0;
    let foundAnyData = false;
    for (const m of allDataArrays) {
      const nums = m[1].match(/-?\d+\.?\d*/g);
      if (nums && nums.length > 0) {
        foundAnyData = true;
        for (const n of nums) totalAbsSum += Math.abs(parseFloat(n));
      }
    }
    let pass = true;
    let detail = 'Series data contains non-zero values';
    if (foundAnyData && totalAbsSum < 0.01) {
      pass = false;
      detail = `All data values sum to ~0 (abs sum: ${totalAbsSum.toFixed(4)}) — chart appears blank`;
    } else if (!foundAnyData) {
      detail = 'No data arrays found in HTML';
    } else {
      detail = `Data abs sum: ${totalAbsSum.toFixed(2)} across ${allDataArrays.length} array(s)`;
    }
    checks.push({ name: 'series-has-values', pass, detail });
  }

  // 14. blank-chart-guard: verify chart has actual visual content, not just axes
  {
    const hasSvgPath = /<path\s+d="/.test(html);
    const hasCanvas = /<canvas/.test(html);
    // Reuse data sum from all data arrays in the HTML
    const allDataForBlank = [...html.matchAll(/["']?data["']?\s*:\s*\[([^\]]*)\]/g)];
    let blankAbsSum = 0;
    for (const m of allDataForBlank) {
      const nums = m[1].match(/-?\d+\.?\d*/g);
      if (nums) for (const n of nums) blankAbsSum += Math.abs(parseFloat(n));
    }
    const hasDrawing = hasSvgPath || hasCanvas;
    const hasNonTrivialData = blankAbsSum >= 0.001;
    const pass = hasDrawing && hasNonTrivialData;
    checks.push({
      name: 'blank-chart-guard',
      pass,
      detail: pass
        ? `Chart has visual content (SVG path: ${hasSvgPath}, canvas: ${hasCanvas}, data sum: ${blankAbsSum.toFixed(2)})`
        : `Chart may render blank (SVG path: ${hasSvgPath}, canvas: ${hasCanvas}, data abs sum: ${blankAbsSum.toFixed(4)})`,
    });
  }

  // 15. axis-labels-diverse: category axis labels should not all be the same string
  {
    // Check ALL data arrays for repeated string labels, not just the first one
    const allDataMatches = [...html.matchAll(/["']?data["']?\s*:\s*\[([^\]]*)\]/g)];
    let pass = true;
    let detail = 'No category axis data found or labels are diverse';
    for (const dataMatch of allDataMatches) {
      const raw = dataMatch[1];
      const labels = raw.match(/["']([^"']+)["']/g)?.map(s => s.replace(/["']/g, '')) ?? [];
      if (labels.length >= 3) {
        const freq = new Map<string, number>();
        for (const l of labels) freq.set(l, (freq.get(l) ?? 0) + 1);
        const maxFreq = Math.max(...freq.values());
        if (maxFreq / labels.length > 0.5) {
          pass = false;
          const repeated = [...freq.entries()].find(([, c]) => c === maxFreq)![0];
          detail = `"${repeated}" appears ${maxFreq}/${labels.length} times (>${Math.round(50)}% identical)`;
          break; // fail on first problematic array
        }
      }
    }
    checks.push({ name: 'axis-labels-diverse', pass, detail });
  }

  const passCount = checks.filter((c) => c.pass).length;
  const mechanicalScore = passCount / checks.length;

  checks.forEach((c) => {
    if (!c.pass) {
      fixes.push(generateFix(c.name));
    }
  });

  return { mechanicalScore, checks, fixes };
}

function generateFix(checkName: string): string {
  const fixMap: Record<string, string> = {
    'echarts-exists': 'Initialize ECharts on the #chart container',
    'title-present': 'Set a descriptive page title',
    'title-descriptive': 'Replace generic title with one describing the data (e.g., "Q1 Revenue by Segment")',
    'axes-labeled': 'Add name property to xAxis and yAxis in ECharts config',
    'tooltip-configured': 'Add tooltip: { trigger: "axis" } or tooltip: { trigger: "item" } to config',
    'okabe-ito-palette': 'Use Okabe-Ito colorblind-safe palette: #56b4e9, #e69f00, #009e73, #d55e00, #cc79a7, #f0e442',
    'font-inter': 'Set fontFamily to "Inter" in textStyle',
    'data-points-sufficient': 'Ensure data series has at least 3 data points',
    'no-error-markers': 'Fix errors: remove NaN/undefined values from data, resolve console errors',
    'design-tokens': 'Include CSS custom properties: --bg, --surface, --text, --font from design tokens',
    'series-has-values': 'All series data values sum to approximately zero — verify that numeric columns contain non-zero values and the correct data columns are mapped to series',
    'axis-labels-diverse': 'Your category axis repeats the same label — use a different column (e.g., period, category, segment) as the x-axis data source instead of metric name',
    'function-code-leak': 'CRITICAL: JavaScript function code is rendering as visible text. Use ECharts template strings like "{value}B" or "{value}K" instead of function expressions for formatters.',
    'blank-chart-guard': 'Chart renders blank despite having data arrays. Verify that numeric columns contain non-zero values and category columns have distinct labels.',
    'mono-color-multi-series': 'Multiple series detected but only one color used. Assign each series a different color from Okabe-Ito palette: #56b4e9, #e69f00, #009e73, #d55e00, #cc79a7, #f0e442',
  };
  return fixMap[checkName] ?? `Fix: ${checkName}`;
}
