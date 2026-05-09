import { v4 as uuid } from 'uuid';
import { spawn } from 'child_process';
import type { ParsedQuery, AgentSpec, EmitFn, VizType, DataProfile, DashboardDqi, ControlRoomState, WireFrame, AgentStatus } from './types.js';
import { getCompanyBySlug, getDataProfile, getDataSlice, getKpiContext } from './db.js';
import { rankVizTypes } from './ranker.js';
import { promoteVizTypes } from './promote.js';
import { DESIGN_TOKENS_CSS } from './design-tokens.js';
import { runRalphLoop } from './ralph.js';
import { createToolEmitters } from './agent.js';
import { FrameStore } from './frame-store.js';
import { runVerifyStage } from './verify.js';
import { publishState, getCurrentState } from './state-bus.js';

function claudeCli(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn('/Users/pluto/.nvm/versions/node/v22.22.1/bin/claude', ['-p', '--dangerously-skip-permissions', '--effort', 'max', '--model', 'claude-opus-4-6'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300_000,
    });
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    const errChunks: Buffer[] = [];
    child.stderr.on('data', (d: Buffer) => errChunks.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      const out = Buffer.concat(chunks).toString();
      const err = Buffer.concat(errChunks).toString();
      if (code !== 0 && !out) reject(new Error(`claude exited ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

let lastRunSpecs: AgentSpec[] = [];
let lastRunFrameStore: FrameStore | null = null;

export function getLastRunSpecs(): AgentSpec[] { return lastRunSpecs; }
export function getLastRunFrameStore(): FrameStore | null { return lastRunFrameStore; }

// ── Intent keywords for local parser ─────────────────────────────────────
const INTENT_PATTERNS: Record<string, RegExp> = {
  trend:        /\b(trends?|growth|decline|over\s+time|change\s+over|trajectory)\b/i,
  comparison:   /\b(compar|versus|vs\.?|between|against|benchmark)\b/i,
  distribution: /\b(distribut|spread|histogram|frequency|density)\b/i,
  composition:  /\b(breakdown|composition|share|proportion|part[\s-]to[\s-]whole|makeup)\b/i,
  relationship: /\b(correlat|relationship|scatter|regression|association)\b/i,
  risk:         /\b(risk|anomal|outlier|threshold|deviation|alert)\b/i,
  flow:         /\b(funnel|conversion|flow|path|pipeline|stage)\b/i,
  performance:  /\b(performance|kpi|metric|score|target|goal|dashboard)\b/i,
  geographic:   /\b(region|geo|map|location|spatial|country|state|city)\b/i,
};

// Entity keywords to detect in queries
const ENTITY_KEYWORDS = [
  'revenue', 'churn', 'margin', 'profit', 'cost', 'sales', 'users',
  'customers', 'retention', 'growth', 'arpu', 'ltv', 'cac', 'mrr', 'arr',
  'engagement', 'conversion', 'traffic', 'sessions', 'bounce', 'nps',
  'headcount', 'turnover', 'salary', 'pipeline', 'deals', 'quota',
  'inventory', 'orders', 'shipments', 'returns', 'satisfaction',
];

async function llmGenerate(systemPrompt: string, userPrompt: string): Promise<string> {
  return claudeCli(`${systemPrompt}\n\n${userPrompt}`);
}

// ── Format large numbers for gauge display ─────────────────────────────
function formatGaugeValue(raw: number): { display: number; max: number } {
  if (raw >= 1e9) return { display: Math.round(raw / 1e9 * 10) / 10, max: Math.ceil(raw / 1e9 * 1.2 * 10) / 10 };
  if (raw >= 1e6) return { display: Math.round(raw / 1e6 * 10) / 10, max: Math.ceil(raw / 1e6 * 1.2 * 10) / 10 };
  if (raw >= 1e3) return { display: Math.round(raw / 1e3 * 10) / 10, max: Math.ceil(raw / 1e3 * 1.2 * 10) / 10 };
  return { display: Math.round(raw * 100) / 100, max: Math.ceil(raw * 1.2) || 100 };
}

// ── Build a minimal valid chart from real data (never synthetic) ────────
function buildFallbackFromData(spec: AgentSpec): object {
  const rows = Array.isArray(spec.dataSlice)
    ? spec.dataSlice as Record<string, unknown>[]
    : [];
  const echartsType = spec.vizType.echartsType;

  if (echartsType === 'gauge') {
    const rawVal = rows.length > 0
      ? Number(rows[0]['value'] ?? rows[0]['amount'] ?? 0)
      : 0;
    const { display, max } = formatGaugeValue(rawVal);
    return {
      title: { text: spec.vizType.name, textStyle: { color: '#f1f5f9', fontSize: 13 } },
      series: [{
        type: 'gauge',
        data: [{ value: display }],
        max,
        startAngle: 200,
        endAngle: -20,
        detail: { formatter: rawVal >= 1e9 ? `{value}B` : rawVal >= 1e6 ? `{value}M` : rawVal >= 1e3 ? `{value}K` : `{value}` },
      }],
    };
  }

  if (echartsType === 'radar') {
    const metrics = [...new Set(rows.map(r => String(r['metric'] ?? r['category'] ?? '')))].slice(0, 8);
    const values = metrics.map(m => {
      const row = rows.find(r => String(r['metric'] ?? r['category'] ?? '') === m);
      return Number(row?.['value'] ?? row?.['amount'] ?? 0);
    });
    return {
      title: { text: spec.vizType.name, textStyle: { color: '#f1f5f9', fontSize: 13 } },
      radar: { indicator: metrics.map(m => ({ name: m })) },
      series: [{ type: 'radar', data: [{ value: values, name: spec.query.rawQuery }] }],
    };
  }

  // Default: bar/line from real data
  const labelKey = Object.keys(rows[0] ?? {}).find(k => !['company_id', 'id', 'value', 'amount'].includes(k)) ?? 'category';
  const valueKey = Object.keys(rows[0] ?? {}).find(k => ['value', 'amount'].includes(k)) ?? 'value';
  const labels = rows.slice(0, 20).map(r => String(r[labelKey] ?? ''));
  const values = rows.slice(0, 20).map(r => Number(r[valueKey] ?? 0));

  return {
    title: { text: `${spec.vizType.name} — ${spec.query.rawQuery}`, textStyle: { color: '#f1f5f9', fontSize: 13 } },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value' },
    series: [{ type: echartsType === 'scatter' ? 'scatter' : echartsType === 'line' ? 'line' : 'bar', data: values }],
  };
}

// ── Humanize raw DB column names in chart labels ─────────────────────
function humanizeLabel(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b(aum|nav|roi|esg|etf|yoy|qoq|pnl|ltv|cac|arpu|mrr|arr|nps|kpi)\b/gi, m => m.toUpperCase())
    .replace(/\b\w/g, c => c.toUpperCase());
}

function humanizeConfig(config: any): any {
  if (!config || typeof config !== 'object') return config;

  // Humanize axis data labels
  for (const axis of ['xAxis', 'yAxis']) {
    const ax = config[axis];
    if (ax && Array.isArray(ax.data)) {
      ax.data = ax.data.map((d: unknown) => typeof d === 'string' ? humanizeLabel(d) : d);
    }
  }

  // Humanize radar indicators
  if (config.radar?.indicator && Array.isArray(config.radar.indicator)) {
    config.radar.indicator = config.radar.indicator.map((ind: any) => ({
      ...ind,
      name: typeof ind.name === 'string' ? humanizeLabel(ind.name) : ind.name,
    }));
  }

  // Humanize series names, legend data, and gauge values
  if (Array.isArray(config.series)) {
    for (const s of config.series) {
      if (s && typeof s.name === 'string') s.name = humanizeLabel(s.name);
      if (s && s.type === 'gauge' && Array.isArray(s.data)) {
        for (const d of s.data) {
          if (d && typeof d.value === 'number' && d.value > 1e4) {
            const { display, max } = formatGaugeValue(d.value);
            const raw = d.value;
            d.value = display;
            if (!s.max || s.max < max) s.max = max;
            if (!s.detail?.formatter) {
              s.detail = { ...s.detail, formatter: raw >= 1e9 ? `{value}B` : raw >= 1e6 ? `{value}M` : `{value}K` };
            }
          }
        }
      }
    }
  }
  if (config.legend?.data && Array.isArray(config.legend.data)) {
    config.legend.data = config.legend.data.map((d: unknown) => typeof d === 'string' ? humanizeLabel(d) : d);
  }

  config.color = ['#00d4ff', '#00dfa2', '#a78bfa', '#ffd43b', '#ff4f6d', '#e8b341'];

  return config;
}

// ── Enforce series type matches assigned viz type ──────────────────────
function enforceSeriesType(config: any, expectedType: string): any {
  if (!config || typeof config !== 'object') return config;
  if (Array.isArray(config.series)) {
    for (const s of config.series) {
      if (s && typeof s === 'object' && s.type && s.type !== expectedType) {
        s.type = expectedType;
      }
    }
  }
  return config;
}

// ── Type compliance check on raw LLM output ──────────────────────────────
function checkTypeCompliance(config: any, expectedType: string): boolean {
  if (!config || typeof config !== 'object') return false;
  if (!Array.isArray(config.series) || config.series.length === 0) return false;

  for (const s of config.series) {
    if (!s || typeof s !== 'object') return false;
    if (s.type !== expectedType) return false;

    if (expectedType === 'boxplot') {
      if (!Array.isArray(s.data) || s.data.length === 0) return false;
      const sample = s.data[0];
      if (!Array.isArray(sample) || sample.length !== 5) return false;
    }

    if (expectedType === 'custom') {
      if (!s.renderItem) return false;
    }
  }
  return true;
}

// ── Generate ECharts config via Claude ──────────────────────────────────
async function generateEChartsConfig(
  spec: AgentSpec,
  fixes?: string[],
  previousConfig?: object
): Promise<{ config: object; typeCompliant: boolean }> {
  const systemPrompt = `You are an expert ECharts configuration generator producing publication-quality dashboard panels for a dark-theme control room.

Generate a complete, valid ECharts option object as JSON.

CRITICAL ANTI-PATTERNS — NEVER DO THESE:
1. ECHO-TITLE: title.text MUST describe the DATA INSIGHT (e.g., "Revenue Grew 23% YoY to $4.2M"). NEVER echo the user query or chart type name (e.g., NEVER "Grouped Bar Chart — Show me revenue trends").
2. FUNCTION CODE LEAK: NEVER use function expressions or arrow functions in ANY field. For formatters, use ECharts template strings: "{value}B", "{value}K", "{value}%". NEVER write formatter: "function(v) {...}" or formatter: "(v) => ...". These render as visible garbage text.
3. MONO-COLOR GROUPING: Each series in a multi-series chart MUST have a DIFFERENT color from the palette. Set itemStyle.color explicitly on each series, cycling through the palette.
4. RAW NUMBER FORMATTING: Large numbers on axes and labels MUST use abbreviated suffixes. Show "$2.8B" not "2800000000". Use axisLabel.formatter with template strings like "{value} M".
5. BUBBLE-AS-SCATTER: For bubble/scatter charts where size encodes a dimension, symbolSize MUST vary with data. Use a numeric mapping, NOT a fixed constant. Each point must have [x, y, size] data.
6. MISSING LEGEND: Multi-series charts MUST include legend: { data: [...seriesNames], textStyle: { color: "#94a3b8" } }. Always.
7. BLANK CHART: NEVER emit an empty data array. If data does not perfectly fit, reshape it — do NOT leave series.data as []. Every series must have at least one data point.
8. BROKEN SERIES CONTINUITY: Line series must have ALL data points defined for every x-axis category. Use null for gaps — NEVER truncate the array mid-series or switch to scatter points.

CRITICAL DATA RULES:
- You MUST use the ACTUAL DATA provided in the data slice below. NEVER invent, fabricate, or use placeholder data.
- NEVER use synthetic values like [10, 20, 30] or categories like ["A", "B", "C"]. Every data point must come from the provided data slice.
- The chart type MUST be "${spec.vizType.echartsType}". Do NOT change the series type to a different chart type.
- If the data slice doesn't perfectly fit the chart type, reshape the data — do NOT switch chart types.

MUST INCLUDE:
- title.text: A short DATA INSIGHT (under 60 chars). Summarize what the data shows, not what chart type it is.
- title.textStyle: { color: "#e8edf5", fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13 }
- tooltip: { trigger: "item" or "axis" } — use ECharts template strings for formatter, NEVER function bodies
- grid: { left: 60, right: 40, top: 50, bottom: 40, containLabel: true } (for cartesian charts)
- series[].type MUST be "${spec.vizType.echartsType}"
- legend (when 2+ series): { data: [...seriesNames], textStyle: { color: "#5a6580" } }

COLOR RULES:
- Do NOT include a top-level "color" array. The chart uses a registered ECharts theme that provides the color palette automatically.
- Deep Space palette (for explicit series colors only when needed): ["#00d4ff", "#00dfa2", "#a78bfa", "#ffd43b", "#ff4f6d", "#e8b341"]
- Text: #e8edf5 (primary), #5a6580 (muted/labels)
- All axisLabel.color: "#5a6580"
- Each series MUST get a distinct color from the palette: series[0] → "#00d4ff", series[1] → "#00dfa2", series[2] → "#a78bfa", etc.

POLISH:
- Format large numbers using ECharts template strings: "{value} K", "{value} M", "{value} B". NEVER use function bodies for formatting.
- axisTick.alignWithLabel: true for category axes
- barWidth: "45%" with borderRadius: [4, 4, 0, 0] for bar charts
- lineStyle.width: 2 for line series
- Keep title SHORT (under 60 chars). No subtext — space is limited.

IMPORTANT: Respond with ONLY valid JSON. No markdown code fences, no explanation.`;

  const rows = Array.isArray(spec.dataSlice) ? spec.dataSlice as Record<string, unknown>[] : [];
  const firstRow = rows[0] ?? {};
  const dataSummary = rows.length > 0
    ? `\nData columns: ${Object.keys(firstRow).join(', ')}\nRow count: ${rows.length}\nSample values: ${JSON.stringify(firstRow)}`
    : '\nData format: aggregated object (non-tabular)';

  let userPrompt = `Generate an ECharts ${spec.vizType.echartsType} config for: "${spec.query.rawQuery}"

Viz type: ${spec.vizType.name} (${spec.vizType.whenToUse})
ECharts series type (MANDATORY): ${spec.vizType.echartsType}
${dataSummary}

Data slice — USE THIS DATA, do NOT invent values:
${JSON.stringify(spec.dataSlice, null, 2).slice(0, 4000)}

Goals: ${spec.goals.join('; ')}`;

  if (previousConfig) {
    userPrompt += `\n\nPrevious config (needs improvement — keep the same chart type "${spec.vizType.echartsType}"):\n${JSON.stringify(previousConfig, null, 2).slice(0, 2000)}`;
  }

  if (fixes && fixes.length > 0) {
    userPrompt += `\n\nRequired fixes (keep chart type as ${spec.vizType.echartsType}):\n${fixes.map((f, i) => `${i + 1}. ${f}`).join('\n')}`;
  }

  userPrompt += `\n\nReminder: series[].type MUST be "${spec.vizType.echartsType}". Use ONLY the data provided above. Respond with ONLY valid JSON.`;

  // Retry once on parse failure
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await llmGenerate(systemPrompt, userPrompt);
    try {
      const clean = text.replace(/```(?:json)?\n?/g, '').replace(/\n?```$/g, '').trim();
      const rawConfig = JSON.parse(clean);
      const typeCompliant = checkTypeCompliance(rawConfig, spec.vizType.echartsType);
      const config = humanizeConfig(enforceSeriesType(rawConfig, spec.vizType.echartsType));
      return { config, typeCompliant };
    } catch {
      if (attempt === 0) continue;
    }
  }

  // Both attempts failed — fallback to real data, never synthetic
  return { config: humanizeConfig(buildFallbackFromData(spec)), typeCompliant: false };
}

// ── Generate synthesis narrative via Gemini ──────────────────────────────
async function generateSynthesis(
  query: string,
  companyName: string,
  specs: AgentSpec[],
  frameStore: FrameStore
): Promise<string> {
  const panelSummaries = specs.map(s => {
    const best = frameStore.getBestFrame(s.agentId);
    return `- ${s.vizType.name}: PQI ${best?.eval.pqi.toFixed(2) ?? 'N/A'}`;
  }).join('\n');

  const text = await llmGenerate(
    'You are a data analyst. Write in plain text — no markdown, no headings, no bold/italic formatting.',
    `You are analyzing ${companyName}'s data. The user asked: "${query}"

Four visualizations were built:
${panelSummaries}

Write a concise 2-3 sentence synthesis answering the user's question based on what these visualizations would reveal. Be specific about insights, not about the charts themselves.`
  );

  return text || 'Analysis complete.';
}

// ── Helper: emit a text message triplet ──────────────────────────────────
function emitText(emit: EmitFn, text: string): void {
  const messageId = uuid();
  emit({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
  emit({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text });
  emit({ type: 'TEXT_MESSAGE_END', messageId });
}

function emitStageTool(emit: EmitFn, stageName: string, summary: string): void {
  const toolCallId = uuid();
  emit({ type: 'TOOL_CALL_START', toolCallId, toolCallName: stageName });
  emit({ type: 'TOOL_CALL_ARGS', toolCallId, delta: JSON.stringify({ summary }) });
  emit({ type: 'TOOL_CALL_END', toolCallId });
  emit({ type: 'TOOL_CALL_RESULT', toolCallId, messageId: uuid(), content: summary, role: 'tool' });
}

// ── Local query parser (no LLM call) ─────────────────────────────────────
function parseQueryLocal(query: string): ParsedQuery {
  const lower = query.toLowerCase();

  // Detect intents
  const intents: string[] = [];
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern.test(lower)) {
      intents.push(intent);
    }
  }
  if (intents.length === 0) {
    intents.push('comparison');
  }

  // Detect entities: known keywords + capitalized words (proper nouns)
  const entities: string[] = [];
  for (const kw of ENTITY_KEYWORDS) {
    if (lower.includes(kw)) {
      entities.push(kw);
    }
  }
  // Extract capitalized words that could be proper nouns (2+ chars, not at sentence start)
  const properNouns = query.match(/(?<=\s)[A-Z][a-z]{2,}/g) ?? [];
  for (const noun of properNouns) {
    if (!entities.includes(noun.toLowerCase())) {
      entities.push(noun);
    }
  }

  return { intents, entities, rawQuery: query };
}

// ── Table selector ───────────────────────────────────────────────────────
function selectTableForViz(viz: VizType, profile: DataProfile, parsed?: ParsedQuery): string {
  const available = new Set(profile.tables);

  // Intent override: trend queries should always use time_series
  if (parsed?.intents.includes('trend') && available.has('time_series')) {
    return 'time_series';
  }

  // Map viz categories/types to preferred tables
  const categoryPrefs: Record<string, string[]> = {
    trends:       ['time_series'],
    comparison:   ['breakdowns', 'time_series'],
    distribution: ['distributions', 'time_series'],
    composition:  ['breakdowns', 'time_series'],
    flow:         ['flows', 'breakdowns'],
    relationship: ['distributions', 'time_series'],
    statistical:  ['distributions', 'time_series'],
    ranking:      ['breakdowns', 'time_series'],
    kpi:          ['time_series', 'breakdowns'],
    geographic:   ['geo_metrics', 'time_series'],
    specialty:    ['time_series', 'breakdowns'],
  };

  // Special overrides for specific viz types
  if (viz.id === 'heatmap' || viz.id === 'calendar-heatmap') {
    if (available.has('time_series')) return 'time_series';
    if (available.has('geo_metrics')) return 'geo_metrics';
  }
  if (viz.id === 'gauge' || viz.id === 'kpi-card') {
    if (available.has('time_series')) return 'time_series';
  }
  if (viz.id === 'choropleth' || viz.id === 'bubble-map') {
    if (available.has('geo_metrics')) return 'geo_metrics';
  }

  // Look up preferred tables by category
  const prefs = categoryPrefs[viz.category] ?? ['time_series'];
  for (const table of prefs) {
    if (available.has(table)) return table;
  }

  // Fallback: return any available table, preferring time_series
  if (available.has('time_series')) return 'time_series';
  return profile.tables[0] ?? 'time_series';
}

// ── Geo data transformer for choropleth/map viz types ────────────────
function transformGeoForMap(
  rows: Array<Record<string, unknown>>
): Record<string, unknown> {
  const regions: Record<string, Record<string, number>> = {};
  const metrics = new Set<string>();
  let latestPeriod = '';

  for (const row of rows) {
    const region = row['region'] as string;
    const metric = row['metric'] as string;
    const value = row['value'] as number;
    const period = row['period'] as string;

    if (!regions[region]) regions[region] = {};
    metrics.add(metric);

    if (period > latestPeriod) latestPeriod = period;
    if (period === latestPeriod || !regions[region][metric]) {
      regions[region][metric] = value;
    }
  }

  const primaryMetric = metrics.values().next().value as string;

  return {
    _format: 'geo_aggregated',
    regions: Object.entries(regions).map(([name, vals]) => ({
      name,
      value: vals[primaryMetric] ?? 0,
      metrics: vals,
    })),
    availableMetrics: [...metrics],
    period: latestPeriod,
  } as unknown as Record<string, unknown>;
}

// ── Data-query alignment validation (F13) ───────────────────────────────
function validateDataQueryAlignment(
  dataSlice: Record<string, unknown>[] | Record<string, unknown>,
  parsed: ParsedQuery
): { aligned: boolean; availableMetrics: string[] } {
  if (parsed.entities.length === 0) return { aligned: true, availableMetrics: [] };

  const rows = Array.isArray(dataSlice) ? dataSlice : [];
  if (rows.length === 0) return { aligned: true, availableMetrics: [] };

  // Collect unique string values from key columns (metric, category, segment)
  const keyColumns = ['metric', 'category', 'segment'];
  const uniqueValues = new Set<string>();
  for (const row of rows) {
    for (const col of keyColumns) {
      const val = row[col];
      if (typeof val === 'string' && val.length > 0) {
        uniqueValues.add(val.toLowerCase());
      }
    }
  }

  if (uniqueValues.size === 0) return { aligned: true, availableMetrics: [] };

  const availableMetrics = [...new Set(rows.map(r => String(r['metric'] ?? '')).filter(Boolean))];

  // Check if ANY entity matches ANY value (case-insensitive substring match both ways)
  const lowerEntities = parsed.entities.map(e => e.toLowerCase());
  const aligned = lowerEntities.some(entity =>
    [...uniqueValues].some(val => val.includes(entity) || entity.includes(val))
  );

  return { aligned, availableMetrics };
}

// ── Main orchestrator pipeline ───────────────────────────────────────────
export async function runOrchestrator(
  query: string,
  companySlug: string,
  emit: EmitFn,
  threadId: string,
  runId: string,
): Promise<void> {
  const startTime = Date.now();

  // Shared mutable state — emitted as STATE_SNAPSHOT on every change
  const state: ControlRoomState = {
    query,
    company: companySlug,
    stage: 'parsing',
    agents: [],
    frames: {},
  };

  function emitSnapshot(): void {
    emit({ type: 'STATE_SNAPSHOT', snapshot: { ...state } });
    publishState({ ...state });
  }

  function toWireFrame(f: { iteration: number; echartsOption: object; eval: import('./types.js').PanelEval }): WireFrame {
    return { iteration: f.iteration, echartsOption: f.echartsOption, eval: f.eval };
  }

  emitSnapshot();

  // STAGE 1: PARSE
  emit({ type: 'STEP_STARTED', stepName: 'parse' });
  const parsed = parseQueryLocal(query);
  emitStageTool(
    emit,
    'parse',
    `Analyzing: "${query}" — intents: ${parsed.intents.join(', ')}, entities: ${parsed.entities.length > 0 ? parsed.entities.join(', ') : 'none detected'}`,
  );
  emit({ type: 'STEP_FINISHED', stepName: 'parse' });

  // STAGE 2: PROBE
  state.stage = 'probing';
  emitSnapshot();
  emit({ type: 'STEP_STARTED', stepName: 'probe' });
  const company = getCompanyBySlug(companySlug);
  if (!company) throw new Error(`Unknown company: ${companySlug}`);
  const profile = getDataProfile(company.id);
  let probeText = `Probing ${company.name} data: ${profile.rows} rows across ${profile.tables.length} tables.`;
  if (profile.timeRange) {
    probeText += ` Time range: ${profile.timeRange.start} to ${profile.timeRange.end}.`;
  }
  emitStageTool(emit, 'probe', probeText);
  emit({ type: 'STEP_FINISHED', stepName: 'probe' });

  // STAGE 3: RANK
  state.stage = 'ranking';
  emitSnapshot();
  emit({ type: 'STEP_STARTED', stepName: 'rank' });
  const LLM_FRIENDLY_TYPES = new Set(['bar', 'line', 'pie', 'scatter', 'gauge', 'radar', 'heatmap', 'funnel']);

  const baseRanked = rankVizTypes(parsed, profile, undefined, 4);
  const promoted = promoteVizTypes(baseRanked, profile, parsed);
  // Demote viz types the LLM can't reliably generate (boxplot, custom renderItem, sankey, etc.)
  // Keep them as fallbacks but push to the back of the rankings
  const friendly = promoted.filter(r => LLM_FRIENDLY_TYPES.has(r.vizType.echartsType));
  const unfriendly = promoted.filter(r => !LLM_FRIENDLY_TYPES.has(r.vizType.echartsType));
  const ranked = [...friendly, ...unfriendly].slice(0, 4);
  emitStageTool(
    emit,
    'rank',
    `Ranked: ${ranked.map((r, i) => `${i + 1}. ${r.vizType.name} (${r.total.toFixed(2)})`).join(', ')}`,
  );
  emit({ type: 'STEP_FINISHED', stepName: 'rank' });

  // STAGE 4: ASSIGN
  state.stage = 'assigning';
  emit({ type: 'STEP_STARTED', stepName: 'assign' });
  const kpiContext = profile.tables.includes('time_series') ? getKpiContext(company.id) : [];

  // Map query entities to time_series metric names for filtering
  const ENTITY_METRIC_MAP: Record<string, string> = {
    revenue: 'revenue', sales: 'revenue', orders: 'order_count',
    delivery: 'avg_delivery_days', 'order value': 'avg_order_value',
    review: 'avg_review_score', reviews: 'avg_review_score',
  };
  const matchedMetric = parsed.entities
    .map(e => ENTITY_METRIC_MAP[e.toLowerCase()])
    .find(Boolean);

  const specs: AgentSpec[] = ranked.map((r, i) => {
    const table = selectTableForViz(r.vizType, profile, parsed);
    const filters: Record<string, string> = {};
    if (table === 'time_series' && matchedMetric) {
      filters.metric = matchedMetric;
    }
    let dataSlice = getDataSlice(company.id, table, Object.keys(filters).length > 0 ? filters : undefined) as unknown as Record<string, unknown>;

    // F13: Validate data-query alignment before proceeding
    const alignment = validateDataQueryAlignment(dataSlice as unknown as Record<string, unknown>[], parsed);
    let alignmentNote = '';
    if (!alignment.aligned) {
      // Try alternative tables from the profile
      let foundAligned = false;
      for (const altTable of profile.tables) {
        if (altTable === table) continue;
        try {
          const altSlice = getDataSlice(company.id, altTable) as unknown as Record<string, unknown>;
          const altAlignment = validateDataQueryAlignment(altSlice as unknown as Record<string, unknown>[], parsed);
          if (altAlignment.aligned) {
            dataSlice = altSlice;
            foundAligned = true;
            break;
          }
        } catch { /* skip tables that fail */ }
      }

      if (!foundAligned && table === 'time_series' && alignment.availableMetrics.length > 0) {
        // Try to find a metric that matches an entity via substring
        const lowerEntities = parsed.entities.map(e => e.toLowerCase());
        const matchedAltMetric = alignment.availableMetrics.find(m =>
          lowerEntities.some(e => m.toLowerCase().includes(e) || e.includes(m.toLowerCase()))
        );
        if (matchedAltMetric) {
          try {
            const refilteredSlice = getDataSlice(company.id, 'time_series', { metric: matchedAltMetric });
            if (refilteredSlice.length > 0) {
              dataSlice = refilteredSlice as unknown as Record<string, unknown>;
              foundAligned = true;
            }
          } catch { /* keep original */ }
        }
      }

      if (!foundAligned) {
        // Last resort: keep data but tell the LLM what columns are available
        const entityStr = parsed.entities.join(', ');
        const metricStr = alignment.availableMetrics.length > 0
          ? alignment.availableMetrics.join(', ')
          : Object.keys((Array.isArray(dataSlice) ? (dataSlice as any)[0] : dataSlice) ?? {}).filter(k => k !== 'company_id' && k !== 'id').join(', ');
        alignmentNote = `NOTE: Available data columns are [${metricStr}]. Map the closest column to the user's question about [${entityStr}].`;
      }
    }

    if (table === 'geo_metrics' && r.vizType.echartsType !== 'bar' && (r.vizType.id === 'bubble-map' || r.vizType.id === 'flow-map')) {
      dataSlice = transformGeoForMap(dataSlice as unknown as Array<Record<string, unknown>>);
    }

    const isKpiType = r.vizType.category === 'gauge';
    const kpiGoals: string[] = [];
    if (isKpiType && kpiContext.length > 0) {
      (dataSlice as any)._kpiContext = kpiContext;
      kpiGoals.push('Include MoM (month-over-month) delta values from _kpiContext. Show the change as +/- percentage.');
      if (kpiContext.some(k => k.yoyValue !== null)) {
        kpiGoals.push('Include YoY (year-over-year) delta values from _kpiContext when yoyValue is not null. Show as +/- percentage alongside MoM.');
      }
      if (kpiContext.some(k => k.target !== null)) {
        kpiGoals.push('Show target comparison when target data is available.');
      }
    }

    return {
      agentId: `agent-${i}`,
      vizType: r.vizType,
      dataSlice,
      goals: [
        `Answer: ${query}`,
        `Visualize using ${r.vizType.name}`,
        ...(r.dimensionId ? [`Dimension: ${r.dimensionId}`] : []),
        ...(r.dimensionGoal ? [r.dimensionGoal] : []),
        ...kpiGoals,
        ...(alignmentNote ? [alignmentNote] : []),
      ],
      designTokens: DESIGN_TOKENS_CSS,
      query: parsed,
      companySlug,
    };
  });

  state.agents = specs.map((s) => ({
    agentId: s.agentId,
    vizType: s.vizType.name,
    status: 'waiting' as const,
    iteration: 0,
    maxIterations: 4,
  }));
  for (const s of specs) state.frames[s.agentId] = [];
  emitSnapshot();

  emitStageTool(
    emit,
    'assign',
    `Assigned ${specs.length} agents: ${specs.map((s) => `${s.agentId} → ${s.vizType.name}`).join(', ')}`,
  );
  emit({ type: 'STEP_FINISHED', stepName: 'assign' });

  // STAGE 5: BUILD — spawn 4 CDP agents in parallel
  state.stage = 'building';
  emitSnapshot();
  emit({ type: 'STEP_STARTED', stepName: 'build' });

  const frameStore = new FrameStore();

  // Callback for ralph loop to update shared state
  function updateAgentState(agentId: string, update: Partial<AgentStatus>): void {
    const idx = state.agents.findIndex(a => a.agentId === agentId);
    if (idx >= 0) {
      state.agents[idx] = { ...state.agents[idx], ...update };
    }
  }

  function pushFrame(agentId: string, frame: { iteration: number; echartsOption: object; eval: import('./types.js').PanelEval }): void {
    if (!state.frames[agentId]) state.frames[agentId] = [];
    state.frames[agentId].push(toWireFrame(frame));
    emitSnapshot();
  }

  emitStageTool(emit, 'build', 'Spawning 4 panel agents...');

  const toolEmitters = createToolEmitters(emit);

  const BATCH_SIZE = 4;
  const results: (Awaited<ReturnType<typeof runRalphLoop>> | null)[] = [];
  for (let i = 0; i < specs.length; i += BATCH_SIZE) {
    const batch = specs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(spec =>
        runRalphLoop(spec, frameStore, emit, (s, fixes, prev) => generateEChartsConfig(s, fixes, prev), updateAgentState, pushFrame, toolEmitters)
          .catch(err => {
            emit({ type: 'CUSTOM', name: 'agent_error', value: { agentId: spec.agentId, error: (err as Error).message } });
            return null;
          })
      )
    );
    results.push(...batchResults);
  }

  emit({ type: 'STEP_FINISHED', stepName: 'build' });

  lastRunSpecs = specs;
  lastRunFrameStore = frameStore;

  // STAGE 6: COMPOSE
  state.stage = 'composing';
  for (const spec of specs) {
    const frames = frameStore.getFrames(spec.agentId);
    state.frames[spec.agentId] = frames.map(toWireFrame);
  }
  emitSnapshot();
  emit({ type: 'STEP_STARTED', stepName: 'compose' });

  // Emit render_a2ui tool calls so A2UIMiddleware surfaces panels inline in chat
  for (const spec of specs) {
    const bestFrame = frameStore.getBestFrame(spec.agentId);
    if (!bestFrame) continue;
    const toolCallId = `a2ui-${spec.agentId}`;
    emit({ type: 'TOOL_CALL_START', toolCallId, toolCallName: 'render_a2ui' });
    emit({
      type: 'TOOL_CALL_ARGS',
      toolCallId,
      delta: JSON.stringify({
        surfaceId: spec.agentId,
        catalogId: 'control-room-catalog',
        components: [
          {
            id: 'root',
            component: 'EChartsPanel',
            option: bestFrame.echartsOption,
            height: '360px',
          },
        ],
      }),
    });
    emit({ type: 'TOOL_CALL_END', toolCallId });
    emit({ type: 'TOOL_CALL_RESULT', toolCallId, messageId: uuid(), content: `Panel ${spec.agentId} rendered`, role: 'tool' });
  }

  emitStageTool(emit, 'compose', `${results.filter(Boolean).length}/4 panels composed`);
  emit({ type: 'STEP_FINISHED', stepName: 'compose' });

  // STAGE 6.5: VERIFY
  state.stage = 'verifying';
  emitSnapshot();

  let dqi: DashboardDqi | undefined;
  try {
    dqi = await runVerifyStage(state.agents, frameStore, emit);
  } catch (err) {
    emit({ type: 'CUSTOM', name: 'verify_error', value: { error: (err as Error).message } });
    emit({ type: 'STEP_FINISHED', stepName: 'verify' });
  }

  if (dqi) {
    emitStageTool(emit, 'verify', `DQI: ${dqi.score.toFixed(2)}`);
  }

  // STAGE 7: ANSWER
  state.stage = 'answering';
  emitSnapshot();
  emit({ type: 'STEP_STARTED', stepName: 'answer' });

  const synthesis = await generateSynthesis(query, company.name, specs, frameStore);

  state.stage = 'done';
  state.wallClockMs = Date.now() - startTime;
  state.synthesis = synthesis;
  if (dqi) state.dqi = dqi;

  emitText(emit, synthesis);
  emitSnapshot();

  emit({ type: 'STEP_FINISHED', stepName: 'answer' });
}

// ── Panel refinement (single-agent re-run with user feedback) ────────────
export async function runPanelRefine(
  panelIndex: number,
  feedback: string,
  emit: EmitFn,
  threadId: string,
  runId: string,
): Promise<void> {
  const spec = lastRunSpecs[panelIndex];
  const frameStore = lastRunFrameStore;
  if (!spec || !frameStore) {
    emitText(emit, `No panel ${panelIndex + 1} found. Run a query first to generate panels.`);
    return;
  }

  const currentState = getCurrentState();
  if (!currentState) {
    emitText(emit, 'No active dashboard state. Run a query first.');
    return;
  }

  const state: ControlRoomState = { ...currentState, stage: 'building' };

  function emitSnapshot(): void {
    emit({ type: 'STATE_SNAPSHOT', snapshot: { ...state } });
    publishState({ ...state });
  }

  function toWireFrame(f: { iteration: number; echartsOption: object; eval: import('./types.js').PanelEval }): WireFrame {
    return { iteration: f.iteration, echartsOption: f.echartsOption, eval: f.eval };
  }

  const agentId = spec.agentId;
  const agentIdx = state.agents.findIndex(a => a.agentId === agentId);
  if (agentIdx >= 0) {
    state.agents[agentIdx] = { ...state.agents[agentIdx], status: 'building', iteration: 0 };
  }
  emitSnapshot();

  emit({ type: 'STEP_STARTED', stepName: `refine-panel-${panelIndex + 1}` });
  emitText(emit, `Refining panel ${panelIndex + 1} (${spec.vizType.name}): "${feedback}"`);

  const toolEmitters = createToolEmitters(emit);

  const bestFrame = frameStore.getBestFrame(agentId);
  const userFixes = [
    `USER FEEDBACK: ${feedback}`,
    'Apply the user\'s requested changes while keeping the chart type and data intact.',
  ];

  function updateAgentState(_agentId: string, update: Partial<AgentStatus>): void {
    if (agentIdx >= 0) {
      state.agents[agentIdx] = { ...state.agents[agentIdx], ...update };
    }
  }

  function pushFrame(_agentId: string, frame: { iteration: number; echartsOption: object; eval: import('./types.js').PanelEval }): void {
    if (!state.frames[agentId]) state.frames[agentId] = [];
    state.frames[agentId].push(toWireFrame(frame));
    emitSnapshot();
  }

  const refineSpec: AgentSpec = {
    ...spec,
    goals: [...spec.goals, `User refinement: ${feedback}`],
  };

  const result = await runRalphLoop(
    refineSpec,
    frameStore,
    emit,
    (s, fixes, prev) => generateEChartsConfig(s, fixes ? [...userFixes, ...fixes] : userFixes, prev ?? bestFrame?.echartsOption),
    updateAgentState,
    pushFrame,
    toolEmitters,
  ).catch(err => {
    emitText(emit, `Refinement failed: ${(err as Error).message}`);
    return null;
  });

  if (result) {
    state.frames[agentId] = frameStore.getFrames(agentId).map(toWireFrame);
    if (agentIdx >= 0) {
      state.agents[agentIdx] = { ...state.agents[agentIdx], status: 'converged' };
    }

    const toolCallId = `a2ui-${agentId}`;
    emit({ type: 'TOOL_CALL_START', toolCallId, toolCallName: 'render_a2ui' });
    emit({
      type: 'TOOL_CALL_ARGS',
      toolCallId,
      delta: JSON.stringify({
        surfaceId: agentId,
        catalogId: 'control-room-catalog',
        components: [{
          id: 'root',
          component: 'EChartsPanel',
          option: result.echartsOption,
          height: '360px',
        }],
      }),
    });
    emit({ type: 'TOOL_CALL_END', toolCallId });
    emit({ type: 'TOOL_CALL_RESULT', toolCallId, messageId: uuid(), content: `Panel ${panelIndex + 1} refined`, role: 'tool' });
  }

  state.stage = 'done';
  emitSnapshot();
  emit({ type: 'STEP_FINISHED', stepName: `refine-panel-${panelIndex + 1}` });

  emitText(emit, result
    ? `Panel ${panelIndex + 1} refined — PQI ${result.eval.pqi.toFixed(2)}`
    : `Panel ${panelIndex + 1} refinement failed.`);
}
