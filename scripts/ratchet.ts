import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getCompanyBySlug, getDataProfile, getDataSlice } from '../server/db.js';
import { rankVizTypes } from '../server/ranker.js';
import { runDomEval } from '../server/eval-dom.js';
import { buildAgentHTML, DESIGN_TOKENS_CSS } from '../server/design-tokens.js';
import { VIZ_CATALOG } from '../server/viz-catalog.js';
import type { ParsedQuery, DataProfile, VizType } from '../server/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = join(__dirname, 'spec.json');
const LOG_DIR = join(__dirname, '..', 'ratchet-logs');
const TOTAL_ITERATIONS = 10;

const client = new Anthropic();

// ── Load / save spec ──────────────────────────────────────────────────────

interface Spec {
  version: number;
  generationPrompt: { system: string; userTemplate: string };
  evalRubric: { prompt: string; weights: Record<string, number> };
  designTokens: Record<string, unknown>;
  domChecks: Array<{ name: string; weight: number; description: string }>;
  ralphParams: Record<string, number>;
  testFixture: { query: string; companySlug: string };
}

function loadSpec(): Spec {
  return JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
}

function saveSpec(spec: Spec): void {
  writeFileSync(SPEC_PATH, JSON.stringify(spec, null, 2) + '\n');
}

// ── Intent parser (same as orchestrator) ──────────────────────────────────

const INTENT_PATTERNS: Record<string, RegExp> = {
  trend:        /\b(trend|growth|decline|over\s+time|change\s+over|trajectory)\b/i,
  comparison:   /\b(compar|versus|vs\.?|between|against|benchmark)\b/i,
  distribution: /\b(distribut|spread|histogram|frequency|density)\b/i,
  composition:  /\b(breakdown|composition|share|proportion|part[\s-]to[\s-]whole|makeup)\b/i,
  relationship: /\b(correlat|relationship|scatter|regression|association)\b/i,
  risk:         /\b(risk|anomal|outlier|threshold|deviation|alert)\b/i,
  flow:         /\b(funnel|conversion|flow|path|pipeline|stage)\b/i,
  performance:  /\b(performance|kpi|metric|score|target|goal|dashboard)\b/i,
  geographic:   /\b(region|geo|map|location|spatial|country|state|city)\b/i,
};

const ENTITY_KEYWORDS = [
  'revenue', 'churn', 'margin', 'profit', 'cost', 'sales', 'users',
  'customers', 'retention', 'growth', 'arpu', 'ltv', 'cac', 'mrr', 'arr',
  'engagement', 'conversion', 'traffic', 'sessions', 'bounce', 'nps',
];

function parseQuery(query: string): ParsedQuery {
  const lower = query.toLowerCase();
  const intents: string[] = [];
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern.test(lower)) intents.push(intent);
  }
  if (intents.length === 0) intents.push('performance');
  const entities: string[] = [];
  for (const kw of ENTITY_KEYWORDS) {
    if (lower.includes(kw)) entities.push(kw);
  }
  return { intents, entities, rawQuery: query };
}

// ── Table selector (same as orchestrator) ─────────────────────────────────

function selectTable(viz: VizType, profile: DataProfile): string {
  const available = new Set(profile.tables);
  const prefs: Record<string, string[]> = {
    trends: ['time_series'], comparison: ['breakdowns', 'time_series'],
    distribution: ['distributions', 'time_series'], composition: ['breakdowns', 'time_series'],
    flow: ['flows', 'breakdowns'], relationship: ['distributions', 'time_series'],
    gauge: ['time_series', 'breakdowns'], geo: ['geo_metrics', 'time_series'],
    heatmap: ['time_series', 'geo_metrics'],
  };
  if (viz.id === 'choropleth' || viz.id === 'bubble-map') {
    if (available.has('geo_metrics')) return 'geo_metrics';
  }
  const categoryPrefs = prefs[viz.category] ?? ['time_series'];
  for (const t of categoryPrefs) { if (available.has(t)) return t; }
  if (available.has('time_series')) return 'time_series';
  return profile.tables[0] ?? 'time_series';
}

// ── Generate ECharts config ───────────────────────────────────────────────

async function generateConfig(
  spec: Spec,
  viz: VizType,
  query: string,
  dataSlice: Record<string, unknown>[],
  goals: string[],
): Promise<object> {
  const userPrompt = spec.generationPrompt.userTemplate
    .replace('{echartsType}', viz.echartsType)
    .replace('{query}', query)
    .replace('{vizName}', viz.name)
    .replace('{whenToUse}', viz.whenToUse)
    .replace('{echartsType}', viz.echartsType)
    .replace('{dataSlice}', JSON.stringify(dataSlice, null, 2).slice(0, 4000))
    .replace('{goals}', goals.join('; '));

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: spec.generationPrompt.system,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const clean = text.replace(/```(?:json)?\n?/g, '').replace(/\n?```$/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {
      title: { text: viz.name },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: ['A', 'B', 'C'] },
      yAxis: { type: 'value' },
      series: [{ type: viz.echartsType, data: [10, 20, 30] }],
    };
  }
}

// ── Config-quality eval (vision proxy) ────────────────────────────────────

interface PillarScores {
  Q: number; D: number; F: number; I: number; A: number; P: number;
  fixes: string[];
}

async function evalConfig(
  spec: Spec,
  config: object,
  query: string,
  vizTypeName: string,
): Promise<{ pqi: number; pillars: PillarScores; domScore: number }> {
  // DOM eval on generated HTML
  const html = buildAgentHTML({ title: vizTypeName }) +
    `<script>chart.setOption(${JSON.stringify(config)});</script>`;
  const domResult = runDomEval(html, vizTypeName);

  // Config-quality eval via Claude
  const rubricPrompt = spec.evalRubric.prompt
    .replace('{vizTypeName}', vizTypeName)
    .replace('{query}', query);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `${rubricPrompt}\n\nECharts config to evaluate:\n${JSON.stringify(config, null, 2).slice(0, 6000)}`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  let pillars: PillarScores;
  try {
    const clean = text.replace(/```(?:json)?\n?/g, '').replace(/\n?```$/g, '').trim();
    const parsed = JSON.parse(clean);
    const clamp = (v: unknown) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 0.3;
      return Math.min(1, Math.max(0, v));
    };
    pillars = {
      Q: clamp(parsed.Q), D: clamp(parsed.D), F: clamp(parsed.F),
      I: clamp(parsed.I), A: clamp(parsed.A), P: clamp(parsed.P),
      fixes: Array.isArray(parsed.fixes) ? parsed.fixes.filter((f: unknown) => typeof f === 'string') : [],
    };
  } catch {
    pillars = { Q: 0.3, D: 0.3, F: 0.3, I: 0.3, A: 0.3, P: 0.3, fixes: ['eval parse error'] };
  }

  const w = spec.evalRubric.weights;
  const pqi = w.Q * pillars.Q + w.D * pillars.D + w.F * pillars.F +
              w.I * pillars.I + w.A * pillars.A + w.P * pillars.P;

  return { pqi, pillars, domScore: domResult.mechanicalScore };
}

// ── Expert reviewers ──────────────────────────────────────────────────────

interface ExpertReview {
  role: string;
  suggestions: string[];
  specPatch: Record<string, unknown>;
}

async function runExpertReview(
  role: 'data-scientist' | 'data-engineer' | 'designer',
  spec: Spec,
  results: Array<{ vizType: string; pqi: number; pillars: PillarScores; domScore: number; config: object }>,
): Promise<ExpertReview> {
  const rolePrompts: Record<string, string> = {
    'data-scientist': `You are a senior data scientist reviewing a dashboard specification.
Your focus: statistical accuracy, data storytelling, insight density, whether the right chart types surface the right patterns.
Review the current spec and the 4 panel results below. Suggest SPECIFIC changes to the generation prompt and eval rubric that would produce higher-quality data visualizations.

Key concerns:
- Are the chart types chosen correctly for the data patterns?
- Does the generation prompt guide Claude to create statistically meaningful visualizations?
- Does the eval rubric properly weight data storytelling?
- Are the axis labels, units, and number formats helping the viewer extract insights?`,

    'data-engineer': `You are a senior data engineer reviewing a dashboard specification.
Your focus: data pipeline efficiency, schema utilization, configuration robustness, error handling.
Review the current spec and the 4 panel results below. Suggest SPECIFIC changes that would produce more reliable, well-structured ECharts configurations.

Key concerns:
- Is the data slice being fully utilized (all columns, all rows)?
- Are the ECharts configs well-structured (proper series types, correct axis bindings)?
- Does the generation prompt prevent common config errors (missing data, wrong types)?
- Are edge cases handled (empty data, single data point, large numbers)?`,

    'designer': `You are a world-class data visualization designer (think Edward Tufte meets Apple).
Your focus: visual hierarchy, information density, typography, color, spacing, dark-theme polish.
Review the current spec and the 4 panel results below. Suggest SPECIFIC changes that would produce publication-quality visualizations.

Key concerns:
- Is the dark theme (#0f172a background) being used effectively? Contrast ratios?
- Are grid margins sufficient to prevent label clipping?
- Is the Okabe-Ito palette applied correctly with enough contrast?
- Does the typography hierarchy work (title > axis labels > tick labels > tooltip)?
- Data-ink ratio: any chart junk? Unnecessary gridlines, borders, decorations?
- Would these panels look good in a 2x2 grid on a projector screen?`,
  };

  const resultsSummary = results.map(r =>
    `Panel: ${r.vizType}\n  PQI: ${r.pqi.toFixed(3)} | DOM: ${r.domScore.toFixed(2)}\n  Pillars: Q=${r.pillars.Q.toFixed(2)} D=${r.pillars.D.toFixed(2)} F=${r.pillars.F.toFixed(2)} I=${r.pillars.I.toFixed(2)} A=${r.pillars.A.toFixed(2)} P=${r.pillars.P.toFixed(2)}\n  Fixes needed: ${r.pillars.fixes.join('; ') || 'none'}\n  Config (truncated): ${JSON.stringify(r.config, null, 2).slice(0, 1500)}`
  ).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `${rolePrompts[role]}

CURRENT SPEC:
Generation prompt (system): ${spec.generationPrompt.system}
Eval rubric weights: ${JSON.stringify(spec.evalRubric.weights)}

PANEL RESULTS (4 panels):
${resultsSummary}

AVERAGE PQI: ${(results.reduce((s, r) => s + r.pqi, 0) / results.length).toFixed(3)}
MAX PQI: ${Math.max(...results.map(r => r.pqi)).toFixed(3)}
MIN PQI: ${Math.min(...results.map(r => r.pqi)).toFixed(3)}

Respond with ONLY this JSON:
{
  "suggestions": ["<suggestion 1>", "<suggestion 2>", ...],
  "generationPromptSystem": "<improved full system prompt, or null if no change>",
  "generationPromptUserTemplate": "<improved full user template, or null if no change>",
  "evalRubricChanges": "<any specific rubric wording improvements, or null>",
  "designTokenChanges": { "<token>": "<value>", ... } or null,
  "ralphParamChanges": { "<param>": <value>, ... } or null
}`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  try {
    const clean = text.replace(/```(?:json)?\n?/g, '').replace(/\n?```$/g, '').trim();
    const parsed = JSON.parse(clean);
    const patch: Record<string, unknown> = {};
    if (parsed.generationPromptSystem) patch['generationPrompt.system'] = parsed.generationPromptSystem;
    if (parsed.generationPromptUserTemplate) patch['generationPrompt.userTemplate'] = parsed.generationPromptUserTemplate;
    if (parsed.evalRubricChanges) patch['evalRubric.prompt'] = parsed.evalRubricChanges;
    if (parsed.designTokenChanges) patch['designTokens'] = parsed.designTokenChanges;
    if (parsed.ralphParamChanges) patch['ralphParams'] = parsed.ralphParamChanges;
    return {
      role,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      specPatch: patch,
    };
  } catch {
    return { role, suggestions: ['parse error'], specPatch: {} };
  }
}

// ── Apply patches to spec ─────────────────────────────────────────────────

function applyPatches(spec: Spec, reviews: ExpertReview[]): Spec {
  const patched = JSON.parse(JSON.stringify(spec)) as Spec;

  for (const review of reviews) {
    for (const [key, value] of Object.entries(review.specPatch)) {
      if (key === 'generationPrompt.system' && typeof value === 'string') {
        patched.generationPrompt.system = value;
      } else if (key === 'generationPrompt.userTemplate' && typeof value === 'string') {
        patched.generationPrompt.userTemplate = value;
      } else if (key === 'evalRubric.prompt' && typeof value === 'string') {
        patched.evalRubric.prompt = value;
      } else if (key === 'designTokens' && typeof value === 'object' && value !== null) {
        Object.assign(patched.designTokens, value);
      } else if (key === 'ralphParams' && typeof value === 'object' && value !== null) {
        Object.assign(patched.ralphParams, value);
      }
    }
  }

  patched.version = spec.version + 1;
  return patched;
}

// ── Run a single build cycle ──────────────────────────────────────────────

interface BuildResult {
  panels: Array<{
    vizType: string;
    pqi: number;
    pillars: PillarScores;
    domScore: number;
    config: object;
  }>;
  avgPqi: number;
  maxPqi: number;
  minPqi: number;
}

async function runBuild(spec: Spec): Promise<BuildResult> {
  const { query, companySlug } = spec.testFixture;
  const parsed = parseQuery(query);
  const company = getCompanyBySlug(companySlug);
  if (!company) throw new Error(`Unknown company: ${companySlug}`);
  const profile = getDataProfile(company.id);
  const ranked = rankVizTypes(parsed, profile, VIZ_CATALOG, 4);

  const panels = await Promise.all(ranked.map(async (r) => {
    const dataSlice = getDataSlice(company.id, selectTable(r.vizType, profile));
    const config = await generateConfig(
      spec, r.vizType, query,
      dataSlice as unknown as Record<string, unknown>[],
      [`Answer: ${query}`, `Visualize using ${r.vizType.name}`],
    );
    const { pqi, pillars, domScore } = await evalConfig(spec, config, query, r.vizType.name);
    return { vizType: r.vizType.name, pqi, pillars, domScore, config };
  }));

  const pqis = panels.map(p => p.pqi);
  return {
    panels,
    avgPqi: pqis.reduce((s, v) => s + v, 0) / pqis.length,
    maxPqi: Math.max(...pqis),
    minPqi: Math.min(...pqis),
  };
}

// ── Main ratchet loop ─────────────────────────────────────────────────────

async function main() {
  mkdirSync(LOG_DIR, { recursive: true });

  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║  Karpathy Ratchet — Spec Optimization Loop       ║');
  console.log('║  10 iterations • 3 experts • keep-best gate      ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  let spec = loadSpec();
  let bestAvg = 0;
  let bestMax = 0;
  let bestSpec = JSON.parse(JSON.stringify(spec)) as Spec;

  // Iteration 0: baseline
  console.log('── Iteration 0: BASELINE ──────────────────────────');
  const baseline = await runBuild(spec);
  bestAvg = baseline.avgPqi;
  bestMax = baseline.maxPqi;
  logIteration(0, baseline, null, 'baseline');
  printResult(0, baseline, 'BASELINE');

  for (let i = 1; i <= TOTAL_ITERATIONS; i++) {
    console.log(`\n── Iteration ${i}/${TOTAL_ITERATIONS} ──────────────────────────────`);

    // REVIEW: 3 experts in parallel
    console.log('  [1/4] Expert review (DS, DE, Designer)...');
    const [dsReview, deReview, designerReview] = await Promise.all([
      runExpertReview('data-scientist', spec, baseline.panels),
      runExpertReview('data-engineer', spec, baseline.panels),
      runExpertReview('designer', spec, baseline.panels),
    ]);

    const allReviews = [dsReview, deReview, designerReview];
    for (const r of allReviews) {
      console.log(`    ${r.role}: ${r.suggestions.length} suggestions`);
      r.suggestions.slice(0, 2).forEach(s => console.log(`      • ${s.slice(0, 100)}`));
    }

    // PATCH: apply expert suggestions
    console.log('  [2/4] Applying patches...');
    const patchedSpec = applyPatches(spec, allReviews);

    // BUILD: re-run with patched spec
    console.log('  [3/4] Building 4 panels with patched spec...');
    const result = await runBuild(patchedSpec);

    // GATE: keep only improvements
    console.log('  [4/4] Gating...');
    const avgImproved = result.avgPqi > bestAvg;
    const maxNotRegressed = result.maxPqi >= bestMax - 0.02;

    if (avgImproved && maxNotRegressed) {
      console.log(`  ✓ KEPT: avg ${bestAvg.toFixed(3)} → ${result.avgPqi.toFixed(3)} (+${((result.avgPqi - bestAvg) * 100).toFixed(1)}%)`);
      bestAvg = result.avgPqi;
      bestMax = Math.max(bestMax, result.maxPqi);
      spec = patchedSpec;
      bestSpec = JSON.parse(JSON.stringify(patchedSpec)) as Spec;
      saveSpec(spec);
      logIteration(i, result, allReviews, 'kept');
    } else {
      const reason = !avgImproved
        ? `avg ${result.avgPqi.toFixed(3)} ≤ best ${bestAvg.toFixed(3)}`
        : `max regressed ${result.maxPqi.toFixed(3)} < ${bestMax.toFixed(3)} - 0.02`;
      console.log(`  ✗ REVERTED: ${reason}`);
      logIteration(i, result, allReviews, 'reverted');
    }

    printResult(i, result, avgImproved && maxNotRegressed ? 'KEPT' : 'REVERTED');
  }

  // Final summary
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║  RATCHET COMPLETE                                 ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`  Starting avg PQI: ${baseline.avgPqi.toFixed(3)}`);
  console.log(`  Final avg PQI:    ${bestAvg.toFixed(3)} (${bestAvg > baseline.avgPqi ? '+' : ''}${((bestAvg - baseline.avgPqi) * 100).toFixed(1)}%)`);
  console.log(`  Starting max PQI: ${baseline.maxPqi.toFixed(3)}`);
  console.log(`  Final max PQI:    ${bestMax.toFixed(3)} (${bestMax > baseline.maxPqi ? '+' : ''}${((bestMax - baseline.maxPqi) * 100).toFixed(1)}%)`);
  console.log(`  Spec version:     ${bestSpec.version}`);
  console.log(`  Spec saved to:    ${SPEC_PATH}`);

  // Save final best spec
  saveSpec(bestSpec);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function printResult(iteration: number, result: BuildResult, status: string) {
  console.log(`  ┌─ iter=${iteration} status=${status} ──────────────────────`);
  console.log(`  │ avg=${result.avgPqi.toFixed(3)} max=${result.maxPqi.toFixed(3)} min=${result.minPqi.toFixed(3)}`);
  for (const p of result.panels) {
    const bar = '█'.repeat(Math.round(p.pqi * 20)).padEnd(20, '░');
    console.log(`  │ ${bar} ${p.pqi.toFixed(3)} ${p.vizType} [Q=${p.pillars.Q.toFixed(1)} D=${p.pillars.D.toFixed(1)} F=${p.pillars.F.toFixed(1)} I=${p.pillars.I.toFixed(1)} A=${p.pillars.A.toFixed(1)} P=${p.pillars.P.toFixed(1)}]`);
  }
  console.log(`  └──────────────────────────────────────────────`);
}

function logIteration(
  iteration: number,
  result: BuildResult,
  reviews: ExpertReview[] | null,
  status: string,
) {
  const logFile = join(LOG_DIR, `iter-${String(iteration).padStart(2, '0')}.json`);
  writeFileSync(logFile, JSON.stringify({
    iteration,
    status,
    timestamp: new Date().toISOString(),
    avgPqi: result.avgPqi,
    maxPqi: result.maxPqi,
    minPqi: result.minPqi,
    panels: result.panels.map(p => ({
      vizType: p.vizType,
      pqi: p.pqi,
      pillars: p.pillars,
      domScore: p.domScore,
    })),
    reviews: reviews?.map(r => ({ role: r.role, suggestions: r.suggestions })),
  }, null, 2) + '\n');
}

main().catch(err => {
  console.error('Ratchet failed:', err);
  process.exit(1);
});
