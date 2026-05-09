export function shortFigure(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${Math.round(abs / 1e8) / 10}B`;
  if (abs >= 1e6) return `${sign}${Math.round(abs / 1e5) / 10}M`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 1e2) / 10}K`;
  if (abs === 0) return '0';
  return `${sign}${Math.round(abs * 100) / 100}`;
}

/** String version of shortFigure for injection into browser context */
export const SHORT_FIGURE_SOURCE = shortFigure.toString();

function injectAxisFormatter(axis: any): void {
  if (!axis) return;
  const axes = Array.isArray(axis) ? axis : [axis];
  for (const ax of axes) {
    if (ax.type === 'value' || ax.type === 'log') {
      ax.axisLabel = ax.axisLabel ?? {};
      // Use ECharts template string instead of a JS function (functions get stripped by JSON serialization)
      ax.axisLabel.formatter = '{value}';
    }
  }
}

export function injectFormatters(option: any): any {
  if (!option || typeof option !== 'object') return option;
  injectAxisFormatter(option.xAxis);
  injectAxisFormatter(option.yAxis);
  // tooltip and label formatters: use ECharts template strings, not functions
  if (option.tooltip) {
    // Remove function-based valueFormatter — browser-side injection handles this
    delete option.tooltip.valueFormatter;
  }
  if (Array.isArray(option.series)) {
    for (const s of option.series) {
      if (!s) continue;
      if (s.label?.show && s.label.formatter) {
        // Replace function formatters with safe template
        if (typeof s.label.formatter === 'function') {
          s.label.formatter = '{c}';
        }
      }
      if (s.type === 'gauge' && s.detail) {
        // Replace function formatters with safe template
        if (typeof s.detail.formatter === 'function') {
          s.detail.formatter = '{value}';
        }
      }
    }
  }
  return option;
}

/** Regex to detect function-code strings emitted by LLMs */
const FUNCTION_CODE_RE = /^\s*function\s*\(|^\s*\(.*?\)\s*=>/;

/**
 * Recursively walk an ECharts option object and replace any string values
 * that look like JavaScript function source code with safe ECharts templates.
 * This prevents F2 (function-code-leak) failures.
 */
export function sanitizeConfig(obj: any): any {
  if (obj == null) return obj;
  if (typeof obj === 'string') {
    if (FUNCTION_CODE_RE.test(obj)) {
      return '{value}';
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeConfig);
  }
  if (typeof obj === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      out[key] = sanitizeConfig(obj[key]);
    }
    return out;
  }
  return obj;
}
