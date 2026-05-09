import type { VizType, VizScore, ParsedQuery, DataProfile } from './types.js';
import { VIZ_CATALOG } from './viz-catalog.js';
import { assignDimensions } from './dimension-partitioner.js';

// ─── Intent → Category affinity matrix ────────────────────────────────────
// Maps each query intent to the viz categories most likely to answer it well.
// Scores are [0, 1] — 1.0 = perfect match, 0.0 = irrelevant.
const INTENT_CATEGORY_AFFINITY: Record<string, Record<string, number>> = {
  trend:        { trends: 1.0, comparison: 0.4, heatmap: 0.3, gauge: 0.2, distribution: 0.1 },
  comparison:   { comparison: 1.0, distribution: 0.5, heatmap: 0.4, relationship: 0.3, trends: 0.2 },
  distribution: { distribution: 1.0, relationship: 0.4, heatmap: 0.3, comparison: 0.2 },
  composition:  { composition: 1.0, flow: 0.3, comparison: 0.2 },
  relationship: { relationship: 1.0, distribution: 0.4, heatmap: 0.5, trends: 0.2 },
  risk:         { distribution: 0.8, gauge: 0.7, trends: 0.5, relationship: 0.4, heatmap: 0.3 },
  flow:         { flow: 1.0, composition: 0.3, comparison: 0.2 },
  performance:  { trends: 0.7, comparison: 0.6, distribution: 0.4, gauge: 0.3, heatmap: 0.2 },
  geographic:   { geographic: 1.0, geo: 1.0, comparison: 0.3, heatmap: 0.3 },
};

// ─── Data shape descriptors for structural matching ──────────────────────
// Each viz category has an "ideal shape" — what the data should look like.
interface ShapeProfile {
  idealRowRange: [number, number];
  needsMultipleDimensions?: boolean; // radar, parallel-coords: needs many columns as axes
  needsTimeSeries?: boolean;
  needsFlatDistribution?: boolean;   // histogram, box-plot: many scalar values
  needsFlowPairs?: boolean;          // sankey, chord: source→target pairs
  needsHierarchy?: boolean;          // treemap, sunburst
  needsGeoRegions?: boolean;
  singleValueOk?: boolean;           // gauge, kpi: works with 1 data point
}

const SHAPE_PROFILES: Record<string, ShapeProfile> = {
  'line':             { idealRowRange: [6, 500], needsTimeSeries: true },
  'area':             { idealRowRange: [6, 500], needsTimeSeries: true },
  'stacked-area':     { idealRowRange: [12, 500], needsTimeSeries: true },
  'step-line':        { idealRowRange: [4, 200], needsTimeSeries: true },
  'bar':              { idealRowRange: [3, 30] },
  'grouped-bar':      { idealRowRange: [4, 40] },
  'stacked-bar':      { idealRowRange: [4, 40] },
  'horizontal-bar':   { idealRowRange: [5, 50] },
  'histogram':        { idealRowRange: [20, 1000], needsFlatDistribution: true },
  'box-plot':         { idealRowRange: [10, 1000], needsFlatDistribution: true },
  'violin':           { idealRowRange: [20, 1000], needsFlatDistribution: true },
  'density':          { idealRowRange: [20, 1000], needsFlatDistribution: true },
  'pie':              { idealRowRange: [2, 8] },
  'donut':            { idealRowRange: [2, 8] },
  'treemap':          { idealRowRange: [5, 50], needsHierarchy: true },
  'sunburst':         { idealRowRange: [5, 30], needsHierarchy: true },
  'scatter':          { idealRowRange: [10, 1000] },
  'bubble':           { idealRowRange: [5, 200] },
  'parallel-coordinates': { idealRowRange: [10, 200], needsMultipleDimensions: true },
  'radar':            { idealRowRange: [3, 30], needsMultipleDimensions: true },
  'sankey':           { idealRowRange: [4, 50], needsFlowPairs: true },
  'chord':            { idealRowRange: [4, 30], needsFlowPairs: true },
  'funnel':           { idealRowRange: [3, 10] },
  'waterfall':        { idealRowRange: [3, 15] },
  'heatmap':          { idealRowRange: [9, 500] },
  'calendar-heatmap': { idealRowRange: [28, 400], needsTimeSeries: true },
  'matrix':           { idealRowRange: [4, 400] },
  'cluster-heatmap':  { idealRowRange: [9, 500] },
  'gauge':            { idealRowRange: [1, 5], singleValueOk: true },
  'bullet':           { idealRowRange: [1, 5], singleValueOk: true },
  'progress':         { idealRowRange: [1, 3], singleValueOk: true },
  'kpi-card':         { idealRowRange: [1, 5], singleValueOk: true },
  'choropleth':       { idealRowRange: [3, 50], needsGeoRegions: true },
  'bubble-map':       { idealRowRange: [3, 100], needsGeoRegions: true },
  'flow-map':         { idealRowRange: [3, 50], needsFlowPairs: true, needsGeoRegions: true },
  'point-map':        { idealRowRange: [3, 500], needsGeoRegions: true },
};

// ─── Table assignment (mirrors orchestrator logic) ───────────────────────
function bestTableForViz(viz: VizType, profile: DataProfile, query?: ParsedQuery): string {
  const available = new Set(profile.tables);

  if (query?.intents.includes('trend') && available.has('time_series')) {
    return 'time_series';
  }

  const categoryPrefs: Record<string, string[]> = {
    trends:       ['time_series'],
    comparison:   ['breakdowns', 'time_series'],
    distribution: ['distributions', 'time_series'],
    composition:  ['breakdowns', 'time_series'],
    flow:         ['flows', 'breakdowns'],
    relationship: ['distributions', 'time_series'],
    heatmap:      ['time_series', 'distributions'],
    gauge:        ['time_series', 'breakdowns'],
    geographic:   ['geo_metrics', 'time_series'],
    geo:          ['geo_metrics', 'time_series'],
  };

  if (viz.id === 'gauge' || viz.id === 'kpi-card' || viz.id === 'bullet' || viz.id === 'progress') {
    if (available.has('time_series')) return 'time_series';
  }
  if (viz.id === 'choropleth' || viz.id === 'bubble-map' || viz.id === 'point-map' || viz.id === 'flow-map') {
    if (available.has('geo_metrics')) return 'geo_metrics';
  }

  const prefs = categoryPrefs[viz.category] ?? ['time_series'];
  for (const table of prefs) {
    if (available.has(table)) return table;
  }
  return profile.tables[0] ?? 'time_series';
}

// ─── Get row count for a specific table from profile ─────────────────────
function getTableRowCount(table: string, profile: DataProfile): number {
  const prefix = `${table}.id`;
  const col = profile.columns[prefix];
  return col ? col.cardinality : profile.rows;
}

// ─── scoreRelevance (intent-affinity based) ──────────────────────────────
export function scoreRelevance(query: ParsedQuery, viz: VizType): number {
  const { intents } = query;
  if (intents.length === 0) return 0.3; // neutral baseline

  let totalAffinity = 0;
  for (const intent of intents) {
    const affinities = INTENT_CATEGORY_AFFINITY[intent] ?? {};
    const categoryScore = affinities[viz.category] ?? 0;
    totalAffinity += categoryScore;
  }

  // Normalize by number of intents
  let score = totalAffinity / intents.length;

  // Bonus: specific viz-level keyword match in whenToUse (up to +0.15)
  const haystack = viz.whenToUse.toLowerCase();
  const queryWords = query.rawQuery.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const wordHits = queryWords.filter(w => haystack.includes(w)).length;
  const wordBonus = Math.min(0.15, (wordHits / Math.max(queryWords.length, 1)) * 0.15);
  score += wordBonus;

  return Math.min(1, score);
}

// ─── scoreAvoidance (negative signal from whenToAvoid) ────────────────────
export function scoreAvoidance(query: ParsedQuery, viz: VizType, profile: DataProfile): number {
  const avoid = viz.whenToAvoid.toLowerCase();
  let penalty = 0;

  // Check query-level avoidance
  const queryLower = query.rawQuery.toLowerCase();
  if (avoid.includes('comparing multiple') && (queryLower.includes('compare') || queryLower.includes('metric'))) {
    if (viz.category === 'gauge') penalty += 0.2;
  }
  if (avoid.includes('more than') && avoid.includes('series')) {
    const seriesCount = profile.segments?.length ?? 1;
    const maxMatch = avoid.match(/more than (\d+)/);
    if (maxMatch && seriesCount > parseInt(maxMatch[1])) penalty += 0.3;
  }
  if (avoid.includes('not ideal for showing change over time') && query.intents.includes('trend')) {
    penalty += 0.3;
  }
  if (avoid.includes('not suitable for') && avoid.includes('time') && profile.timeRange) {
    penalty += 0.15;
  }

  return Math.min(0.5, penalty);
}

// ─── scoreFit (shape-aware structural matching) ──────────────────────────
export function scoreFit(data: DataProfile, viz: VizType, query?: ParsedQuery): number {
  const shape = SHAPE_PROFILES[viz.id];
  if (!shape) return 0.5; // unknown viz, neutral

  const table = bestTableForViz(viz, data, query);
  const tableRows = getTableRowCount(table, data);
  let score = 0;
  let checks = 0;

  // 1. Row count within ideal range (smooth falloff outside range)
  checks++;
  const [minRows, maxRows] = shape.idealRowRange;
  if (tableRows >= minRows && tableRows <= maxRows) {
    score += 1.0;
  } else if (tableRows < minRows) {
    score += Math.max(0, tableRows / minRows);
  } else {
    // Diminishing penalty for too many rows (soft upper bound)
    score += Math.max(0.3, 1 - (tableRows - maxRows) / (maxRows * 3));
  }

  // 2. Time series requirement
  if (shape.needsTimeSeries) {
    checks++;
    score += data.timeRange ? 1.0 : 0.0;
  }

  // 3. Multiple dimensions needed (radar, parallel-coords)
  if (shape.needsMultipleDimensions) {
    checks++;
    // Count distinct metrics/categories available as potential axes
    const metricCol = data.columns[`${table}.metric`] ?? data.columns[`${table}.category`];
    const dimensionCount = metricCol?.cardinality ?? 1;
    if (dimensionCount >= 3 && dimensionCount <= 8) {
      score += 1.0;
    } else if (dimensionCount >= 2) {
      score += 0.5;
    } else {
      score += 0.1; // flat data — not multi-dimensional
    }
  }

  // 4. Flat distribution (histogram, box-plot)
  if (shape.needsFlatDistribution) {
    checks++;
    const hasDistributions = data.tables.includes('distributions');
    const distRows = getTableRowCount('distributions', data);
    if (hasDistributions && distRows >= 20) {
      score += 1.0;
    } else if (hasDistributions) {
      score += 0.6;
    } else {
      score += 0.2;
    }
  }

  // 5. Flow pairs needed (sankey, chord)
  if (shape.needsFlowPairs) {
    checks++;
    const hasFlows = data.tables.includes('flows');
    score += hasFlows ? 1.0 : 0.0;
  }

  // 6. Geo regions needed
  if (shape.needsGeoRegions) {
    checks++;
    const hasGeo = data.tables.includes('geo_metrics');
    const regionCol = data.columns['geo_metrics.region'];
    if (hasGeo && regionCol && regionCol.cardinality >= 3) {
      score += 1.0;
    } else if (hasGeo) {
      score += 0.5;
    } else {
      score += 0.0;
    }
  }

  // 7. Basic data requirements from catalog
  const req = viz.dataRequirements;
  if (req.requiresTime) {
    checks++;
    score += data.timeRange ? 1.0 : 0.0;
  }
  if (req.requiresCategorical) {
    checks++;
    const hasCat = Object.entries(data.columns).some(
      ([k, col]) => k.startsWith(`${table}.`) && (col.dtype === 'TEXT' || col.dtype === 'categorical' || col.dtype === 'string')
    );
    score += hasCat ? 1.0 : 0.0;
  }
  if (req.requiresNumeric) {
    checks++;
    const hasNum = Object.entries(data.columns).some(
      ([k, col]) => k.startsWith(`${table}.`) && (col.dtype === 'REAL' || col.dtype === 'INTEGER' || col.dtype === 'numeric' || col.dtype === 'number')
    );
    score += hasNum ? 1.0 : 0.0;
  }

  return checks > 0 ? score / checks : 0.5;
}

// ─── scoreDiversity ──────────────────────────────────────────────────────
export function scoreDiversity(viz: VizType, alreadySelected: VizType[]): number {
  // Penalize same category
  const sameCategory = alreadySelected.filter(v => v.category === viz.category).length;
  let penalty = 0.35 * sameCategory;

  // Also penalize same echartsType (visual redundancy even across categories)
  const sameEchartsType = alreadySelected.filter(v => v.echartsType === viz.echartsType).length;
  penalty += 0.15 * sameEchartsType;

  return Math.max(0, 1.0 - penalty);
}

// ─── scoreQueryRelevanceToCategory ───────────────────────────────────────
// Penalize viz types from categories unrelated to query intent
function intentCategoryPenalty(viz: VizType, query: ParsedQuery): number {
  if (query.intents.length === 0) return 0;

  // If no intent maps to this viz's category, apply penalty
  let maxAffinity = 0;
  for (const intent of query.intents) {
    const affinities = INTENT_CATEGORY_AFFINITY[intent] ?? {};
    maxAffinity = Math.max(maxAffinity, affinities[viz.category] ?? 0);
  }

  // Strong penalty if category has 0 affinity with any detected intent
  if (maxAffinity === 0) return 0.4;
  if (maxAffinity < 0.3) return 0.2;
  return 0;
}

// ─── rankVizTypes (rebalanced formula) ───────────────────────────────────
export function rankVizTypes(
  query: ParsedQuery,
  data: DataProfile,
  catalog: VizType[] = VIZ_CATALOG,
  topN: number = 4
): VizScore[] {
  let baseTypes = catalog.filter(v => v.base);

  // Narrow candidate pool for strong trend intent
  if (query.intents.includes('trend') && data.timeRange) {
    const trendFriendly = ['line', 'bar', 'kpi-card', 'heatmap'];
    baseTypes = baseTypes.filter(v => trendFriendly.includes(v.id));
  }

  type Candidate = { vizType: VizType; relevance: number; fit: number; avoidance: number; intentPenalty: number };
  const candidates: Candidate[] = baseTypes.map(viz => ({
    vizType: viz,
    relevance: scoreRelevance(query, viz),
    fit: scoreFit(data, viz, query),
    avoidance: scoreAvoidance(query, viz, data),
    intentPenalty: intentCategoryPenalty(viz, query),
  }));

  const selected: VizScore[] = [];
  const remaining = new Set(candidates.map((_, i) => i));
  const limit = Math.min(topN, catalog.length);

  while (selected.length < limit && remaining.size > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (const idx of remaining) {
      const c = candidates[idx];
      const diversity = scoreDiversity(c.vizType, selected.map(s => s.vizType));

      // Rebalanced: fit matters more, relevance less dominant
      // Formula: 0.35*relevance + 0.35*fit + 0.20*diversity - avoidance - intentPenalty
      const total = 0.35 * c.relevance + 0.35 * c.fit + 0.20 * diversity - c.avoidance - c.intentPenalty;

      if (total > bestScore) {
        bestScore = total;
        bestIdx = idx;
      }
    }

    if (bestIdx === -1) break;

    const best = candidates[bestIdx];
    const diversity = scoreDiversity(best.vizType, selected.map(s => s.vizType));
    const total = 0.35 * best.relevance + 0.35 * best.fit + 0.20 * diversity - best.avoidance - best.intentPenalty;

    selected.push({
      vizType: best.vizType,
      relevance: best.relevance,
      fit: best.fit,
      diversity,
      total,
    });

    remaining.delete(bestIdx);
  }

  return assignDimensions(selected, query);
}
