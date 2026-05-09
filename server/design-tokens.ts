export const COLORS = {
  bg: '#06080f',
  surface: '#0d1220',
  border: '#1a1a2e',
  text: '#e8edf5',
  muted: '#5a6580',
  blue: '#00d4ff',
  orange: '#ffd43b',
  green: '#00dfa2',
  red: '#ff4f6d',
  purple: '#a78bfa',
  yellow: '#ffd43b',
};

export const OKABE_ITO = ['#00d4ff', '#00dfa2', '#a78bfa', '#ffd43b', '#ff4f6d', '#e8b341'];

export const DESIGN_TOKENS_CSS = `:root {
  --bg: ${COLORS.bg};
  --surface: ${COLORS.surface};
  --border: ${COLORS.border};
  --text: ${COLORS.text};
  --muted: ${COLORS.muted};
  --blue: ${COLORS.blue};
  --orange: ${COLORS.orange};
  --green: ${COLORS.green};
  --red: ${COLORS.red};
  --purple: ${COLORS.purple};
  --yellow: ${COLORS.yellow};
  --font: 'Inter', system-ui, sans-serif;
  --text-base: 14px;
  --text-lg: 20px;
  --text-sm: 12px;
  --text-xs: 10px;
  --gap: 16px;
  --radius: 8px;
}`;

export const ECHARTS_THEME = {
  backgroundColor: COLORS.bg,
  textStyle: { color: COLORS.text, fontFamily: "'Inter', system-ui, sans-serif" },
  title: { textStyle: { color: COLORS.text, fontSize: 16, fontWeight: 600 } },
  legend: { textStyle: { color: COLORS.muted } },
  tooltip: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    textStyle: { color: COLORS.text },
  },
  axisPointer: { lineStyle: { color: COLORS.border } },
  categoryAxis: {
    axisLine: { lineStyle: { color: COLORS.border } },
    axisTick: { lineStyle: { color: COLORS.border } },
    axisLabel: { color: COLORS.muted },
    splitLine: { lineStyle: { color: COLORS.border, type: 'dashed' } },
  },
  valueAxis: {
    axisLine: { lineStyle: { color: COLORS.border } },
    axisTick: { lineStyle: { color: COLORS.border } },
    axisLabel: { color: COLORS.muted },
    splitLine: { lineStyle: { color: COLORS.border, type: 'dashed' } },
  },
  color: OKABE_ITO,
};

export const ECHARTS_CDN = 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js';

export const PANEL_FOOTER_CSS = `
.panel-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 36px;
  background: ${COLORS.surface};
  border-top: 1px solid ${COLORS.border};
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-family: var(--font);
  font-size: var(--text-xs);
  color: ${COLORS.muted};
  z-index: 9999;
}
.panel-footer .nav-btn {
  background: none;
  border: 1px solid ${COLORS.border};
  color: ${COLORS.text};
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}
.panel-footer .nav-btn:hover {
  background: ${COLORS.border};
}
.panel-footer .pqi-score {
  font-weight: 600;
  color: ${COLORS.text};
}
.panel-footer .pillar {
  margin: 0 4px;
}
.panel-footer .converged {
  color: ${COLORS.green};
}
.panel-footer .building {
  color: ${COLORS.yellow};
}
.panel-footer .progress-bar {
  width: 60px;
  height: 4px;
  background: ${COLORS.border};
  border-radius: 2px;
  overflow: hidden;
}
.panel-footer .progress-fill {
  height: 100%;
  background: ${COLORS.blue};
  transition: width 0.3s ease;
}
`;

export function buildAgentHTML(options: { title: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${options.title}</title>
<style>
${DESIGN_TOKENS_CSS}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: var(--text-base);
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
#chart {
  width: 100%;
  height: calc(100vh - 36px);
}
${PANEL_FOOTER_CSS}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<script src="${ECHARTS_CDN}"></script>
</head>
<body>
<div id="chart"></div>
<div class="panel-footer">
  <div>
    <button class="nav-btn" id="prev-btn">&lt;</button>
    <span id="iter-label">iter 0/0</span>
    <button class="nav-btn" id="next-btn">&gt;</button>
  </div>
  <div>
    <span class="pqi-score" id="pqi-display">PQI: —</span>
    <span class="pillar" id="pillars-display"></span>
  </div>
  <div>
    <span id="status-indicator" class="building">●</span>
    <span id="fix-description"></span>
    <div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width: 0%"></div></div>
  </div>
</div>
<script>
  echarts.registerTheme('control-room', ${JSON.stringify(ECHARTS_THEME)});
  const chart = echarts.init(document.getElementById('chart'), 'control-room');
  window.addEventListener('resize', () => chart.resize());
</script>
</body>
</html>`;
}
