import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runDomEval } from '../server/eval-dom.js';
import { buildAgentHTML } from '../server/design-tokens.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = join(__dirname, '..', 'ratchet-configs');

interface ConfigScore {
  vizType: string;
  domScore: number;
  domChecks: Array<{ name: string; pass: boolean; detail: string }>;
  structuralScore: number;
  structuralChecks: Array<{ name: string; pass: boolean; detail: string }>;
  pqi: number;
}

function scoreStructural(config: Record<string, unknown>, vizType: string): { score: number; checks: Array<{ name: string; pass: boolean; detail: string }> } {
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
  const str = JSON.stringify(config);

  // 1. Title exists and is descriptive
  const title = config.title as Record<string, unknown> | undefined;
  const titleText = title?.text as string | undefined;
  const genericTitles = ['chart', 'line chart', 'bar chart', 'sankey', 'radar', 'gauge', 'map', 'untitled'];
  const titleDescriptive = !!titleText && titleText.length > 5 && !genericTitles.includes(titleText.toLowerCase());
  checks.push({ name: 'title-descriptive', pass: titleDescriptive, detail: titleText ?? 'missing' });

  // 2. Tooltip configured with trigger
  const tooltip = config.tooltip as Record<string, unknown> | undefined;
  const hasTooltip = !!tooltip && ('trigger' in tooltip || 'formatter' in tooltip);
  checks.push({ name: 'tooltip-configured', pass: hasTooltip, detail: hasTooltip ? `trigger: ${tooltip?.trigger}` : 'missing' });

  // 3. Series present and non-empty
  const series = config.series as unknown[] | undefined;
  const hasSeries = Array.isArray(series) && series.length > 0;
  checks.push({ name: 'series-present', pass: hasSeries, detail: `${series?.length ?? 0} series` });

  // 4. Data present in series (gauge exemption: single KPI is valid)
  let maxDataPoints = 0;
  let isGaugeType = false;
  if (Array.isArray(series)) {
    for (const s of series) {
      const sType = (s as Record<string, unknown>).type;
      if (sType === 'gauge') isGaugeType = true;
      const d = (s as Record<string, unknown>).data;
      if (Array.isArray(d) && d.length > maxDataPoints) maxDataPoints = d.length;
      const links = (s as Record<string, unknown>).links;
      if (Array.isArray(links) && links.length > maxDataPoints) maxDataPoints = links.length;
    }
  }
  const dataPass = isGaugeType ? maxDataPoints >= 1 : maxDataPoints >= 3;
  checks.push({ name: 'data-sufficient', pass: dataPass, detail: isGaugeType ? `gauge: ${maxDataPoints} KPI(s)` : `max ${maxDataPoints} points` });

  // 5. Color palette uses Okabe-Ito
  const okabeIto = ['#56b4e9', '#e69f00', '#009e73', '#d55e00', '#cc79a7', '#f0e442'];
  const lowerStr = str.toLowerCase();
  const paletteHits = okabeIto.filter(c => lowerStr.includes(c)).length;
  checks.push({ name: 'okabe-ito-palette', pass: paletteHits >= 2 || !!config.color, detail: `${paletteHits} colors found` });

  // 6. Grid margins configured (prevents clipping)
  const grid = config.grid as Record<string, unknown> | undefined;
  const hasGrid = !!grid && (grid.left || grid.right || grid.top || grid.bottom || grid.containLabel);
  checks.push({ name: 'grid-margins', pass: !!hasGrid, detail: hasGrid ? 'configured' : 'missing — risk of label clipping' });

  // 7. Axis names with units (for cartesian charts)
  const xAxis = config.xAxis as Record<string, unknown> | undefined;
  const yAxis = config.yAxis as Record<string, unknown> | undefined;
  const hasAxisNames = !!(xAxis?.name || yAxis?.name);
  const isCartesian = !!xAxis || !!yAxis;
  checks.push({ name: 'axis-names', pass: !isCartesian || hasAxisNames, detail: isCartesian ? (hasAxisNames ? 'present' : 'missing') : 'n/a (non-cartesian)' });

  // 8. Number formatting (formatter in tooltip or axisLabel)
  const hasFormatter = str.includes('formatter') || str.includes('toLocaleString') || str.includes('.toFixed');
  checks.push({ name: 'number-formatting', pass: hasFormatter, detail: hasFormatter ? 'formatter found' : 'raw numbers — needs formatting' });

  // 9. Legend for multi-series
  const legend = config.legend as Record<string, unknown> | undefined;
  const needsLegend = Array.isArray(series) && series.length > 1;
  const hasLegend = !!legend;
  checks.push({ name: 'legend-for-multi-series', pass: !needsLegend || hasLegend, detail: needsLegend ? (hasLegend ? 'present' : 'missing for multi-series') : 'single series' });

  // 10. Font family set to Inter
  const hasInter = str.includes('Inter');
  checks.push({ name: 'font-inter', pass: hasInter, detail: hasInter ? 'Inter found' : 'missing' });

  // 11. Text color uses light values for dark theme
  const textStyle = config.textStyle as Record<string, unknown> | undefined;
  const textColor = textStyle?.color as string | undefined;
  const isDarkFriendly = !textColor || ['#f1f5f9', '#e2e8f0', '#fff', '#ffffff', '#f8fafc'].includes(textColor?.toLowerCase() ?? '');
  checks.push({ name: 'dark-theme-text', pass: isDarkFriendly, detail: textColor ?? 'using theme default' });

  // 12. Background transparent or matches theme
  const bg = config.backgroundColor as string | undefined;
  const bgOk = !bg || bg === 'transparent' || bg === '#0f172a';
  checks.push({ name: 'background-correct', pass: bgOk, detail: bg ?? 'using theme default' });

  // === EXPERT-LEVEL CHECKS (hackathon differentiators) ===

  // 13. Subtitle with context/insight
  const subtitle = (config.title as Record<string, unknown>)?.subtext as string | undefined;
  const hasSubtitle = !!subtitle && subtitle.length > 10;
  checks.push({ name: 'subtitle-insight', pass: hasSubtitle, detail: hasSubtitle ? subtitle!.slice(0, 60) : 'no subtitle — add contextual insight' });

  // 14. Emphasis/highlight interaction configured
  const hasEmphasis = str.includes('"emphasis"') || str.includes('"focus"');
  checks.push({ name: 'emphasis-interaction', pass: hasEmphasis, detail: hasEmphasis ? 'emphasis configured' : 'no emphasis — add focus interaction' });

  // 15. Series styling beyond defaults (lineStyle width, itemStyle borderRadius, symbolSize, areaStyle)
  const stylingSignals = ['lineStyle', 'borderRadius', 'symbolSize', 'areaStyle', 'shadowBlur'].filter(s => str.includes(s));
  checks.push({ name: 'custom-styling', pass: stylingSignals.length >= 2, detail: `${stylingSignals.length} styling signals: ${stylingSignals.join(', ')}` });

  // 16. Data sorted for readability (bar charts should be sorted by value)
  let dataSorted = true;
  if (Array.isArray(series) && series.length === 1) {
    const s = series[0] as Record<string, unknown>;
    if (s.type === 'bar' && Array.isArray(s.data)) {
      const vals = (s.data as Array<unknown>).map(d => typeof d === 'number' ? d : (d as Record<string, unknown>)?.value as number ?? 0);
      if (vals.length >= 3) {
        const isAsc = vals.every((v, i) => i === 0 || v >= vals[i - 1]);
        const isDesc = vals.every((v, i) => i === 0 || v <= vals[i - 1]);
        dataSorted = isAsc || isDesc;
      }
    }
  }
  checks.push({ name: 'data-sorted', pass: dataSorted, detail: dataSorted ? 'sorted or n/a' : 'bar data not sorted — sort descending for readability' });

  // 17. Visual encoding (visualMap, gradient, or gauge color bands)
  const hasVisualMap = !!config.visualMap;
  const hasGradient = str.includes('"gradient"') || str.includes('"inRange"');
  const hasGaugeColorBands = isGaugeType && str.includes('"color"') && str.includes('"axisLine"');
  checks.push({ name: 'visual-encoding', pass: hasVisualMap || hasGradient || hasGaugeColorBands, detail: hasVisualMap ? 'visualMap configured' : (hasGradient ? 'gradient encoding' : (hasGaugeColorBands ? 'gauge color bands' : 'no visual encoding')) });

  // 18. Axis tick alignment
  const hasTickAlign = str.includes('alignWithLabel');
  const needsTickAlign = !!xAxis;
  checks.push({ name: 'tick-alignment', pass: !needsTickAlign || hasTickAlign, detail: hasTickAlign ? 'aligned' : (needsTickAlign ? 'missing alignWithLabel' : 'n/a') });

  const passCount = checks.filter(c => c.pass).length;
  return { score: passCount / checks.length, checks };
}

// Read iteration arg
const iterArg = process.argv[2] ?? 'current';
const configPath = join(configDir, `iter-${iterArg}.json`);
const raw = readFileSync(configPath, 'utf8');
const configs: Array<{ vizType: string; config: Record<string, unknown> }> = JSON.parse(raw);

const results: ConfigScore[] = [];
for (const { vizType, config } of configs) {
  const html = buildAgentHTML({ title: vizType }) +
    `<script>chart.setOption(${JSON.stringify(config)});</script>`;
  const domResult = runDomEval(html, vizType);
  const structural = scoreStructural(config, vizType);

  const pqi = 0.4 * structural.score + 0.6 * domResult.mechanicalScore;

  results.push({
    vizType,
    domScore: domResult.mechanicalScore,
    domChecks: domResult.checks,
    structuralScore: structural.score,
    structuralChecks: structural.checks,
    pqi,
  });
}

const avgPqi = results.reduce((s, r) => s + r.pqi, 0) / results.length;
const maxPqi = Math.max(...results.map(r => r.pqi));
const minPqi = Math.min(...results.map(r => r.pqi));

console.log(JSON.stringify({ iteration: iterArg, avgPqi, maxPqi, minPqi, panels: results }, null, 2));
