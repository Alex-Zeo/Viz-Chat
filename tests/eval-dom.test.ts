import { describe, it, expect } from 'vitest';
import { runDomEval } from '../server/eval-dom.js';

const GOOD_HTML = `<!DOCTYPE html>
<html><head>
<title>Q1 Revenue Trends by Segment</title>
<style>
:root { --bg: #0f172a; --surface: #1e293b; --text: #f1f5f9; --font: 'Inter'; }
body { font-family: 'Inter', sans-serif; }
</style>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
</head><body>
<div id="chart"></div>
<script>
var chart = echarts.init(document.getElementById('chart'), 'control-room');
chart.setOption({
  title: { text: 'Q1 Revenue' },
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'category', name: 'Month', data: ['Jan', 'Feb', 'Mar', 'Apr', 'May'] },
  yAxis: { type: 'value', name: 'Revenue ($M)' },
  color: ['#56b4e9', '#e69f00', '#009e73'],
  series: [{ type: 'line', data: [120, 132, 101, 134, 90] }]
});
</script>
</body></html>`;

const BAD_HTML = `<!DOCTYPE html>
<html><head><title>Bar Chart</title></head>
<body><div id="chart"></div></body></html>`;

describe('DOM Eval', () => {
  it('good HTML passes most checks', () => {
    const result = runDomEval(GOOD_HTML);
    expect(result.mechanicalScore).toBeGreaterThanOrEqual(0.8);
    expect(result.fixes.length).toBeLessThanOrEqual(2);
  });

  it('bad HTML fails most checks', () => {
    const result = runDomEval(BAD_HTML);
    expect(result.mechanicalScore).toBeLessThan(0.5);
    expect(result.fixes.length).toBeGreaterThan(5);
  });

  it('detects generic title', () => {
    const result = runDomEval(BAD_HTML);
    const titleCheck = result.checks.find(c => c.name === 'title-descriptive');
    expect(titleCheck?.pass).toBe(false);
  });

  it('validates Okabe-Ito palette', () => {
    const result = runDomEval(GOOD_HTML);
    const paletteCheck = result.checks.find(c => c.name === 'okabe-ito-palette');
    expect(paletteCheck?.pass).toBe(true);
  });

  it('generates fixes for failed checks', () => {
    const result = runDomEval(BAD_HTML);
    expect(result.fixes.length).toBeGreaterThan(0);
    result.fixes.forEach(fix => {
      expect(fix.length).toBeGreaterThan(0);
    });
  });

  it('returns exactly 12 checks', () => {
    const result = runDomEval(GOOD_HTML);
    expect(result.checks.length).toBe(12);
  });

  it('passes axis-labels-diverse when labels are unique', () => {
    const result = runDomEval(GOOD_HTML);
    const check = result.checks.find(c => c.name === 'axis-labels-diverse');
    expect(check?.pass).toBe(true);
  });

  it('fails axis-labels-diverse when same label repeated', () => {
    const repeatedHtml = GOOD_HTML.replace(
      "data: ['Jan', 'Feb', 'Mar', 'Apr', 'May']",
      "data: ['AUM', 'AUM', 'AUM', 'AUM', 'AUM']",
    );
    const result = runDomEval(repeatedHtml);
    const check = result.checks.find(c => c.name === 'axis-labels-diverse');
    expect(check?.pass).toBe(false);
    expect(check?.detail).toContain('AUM');
  });
});
