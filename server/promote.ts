import type { VizScore, DataProfile, ParsedQuery } from './types.js';
import { VIZ_CATALOG } from './viz-catalog.js';

interface PromotionRule {
  target: string;
  test: (data: DataProfile, query: ParsedQuery) => boolean;
}

const PROMOTION_RULES: Record<string, PromotionRule[]> = {
  line: [
    { target: 'stacked-area', test: (d, q) => q.intents.includes('composition') && (d.segments?.length ?? 0) >= 2 },
    { target: 'area', test: (d) => (d.segments?.length ?? 0) <= 1 && d.rows >= 6 },
    { target: 'step-line', test: (_d, q) => /\b(tier|state|step|discrete|config)\b/i.test(q.rawQuery) },
  ],
  bar: [
    { target: 'horizontal-bar', test: (d) => {
      const catCol = Object.entries(d.columns).find(([k]) => k.includes('category') || k.includes('metric'));
      return (catCol?.[1].cardinality ?? 0) > 10;
    }},
    { target: 'stacked-bar', test: (_d, q) => q.intents.includes('composition') },
    { target: 'grouped-bar', test: (d) => (d.segments?.length ?? 0) >= 2 && (d.segments?.length ?? 0) <= 5 },
  ],
  pie: [
    { target: 'sunburst', test: (d) => {
      const cats = Object.entries(d.columns).filter(([k]) => k.includes('category') || k.includes('subcategory'));
      return cats.length >= 2;
    }},
    { target: 'donut', test: () => true },
  ],
  scatter: [
    { target: 'bubble', test: (d) => {
      const numCols = Object.entries(d.columns).filter(([, col]) =>
        col.dtype === 'REAL' || col.dtype === 'INTEGER' || col.dtype === 'numeric' || col.dtype === 'number'
      );
      return numCols.length >= 3;
    }},
  ],
  histogram: [
    { target: 'box-plot', test: (d) => (d.segments?.length ?? 0) >= 3 },
    { target: 'violin', test: (d) => d.rows >= 50 && (d.segments?.length ?? 0) >= 2 },
    { target: 'density', test: (d) => d.rows >= 30 },
  ],
  funnel: [
    { target: 'sankey', test: (d) => d.tables.includes('flows') },
    { target: 'waterfall', test: (_d, q) => /\b(contribut|incremental|bridge|buildup)\b/i.test(q.rawQuery) },
  ],
  heatmap: [
    { target: 'calendar-heatmap', test: (d) => !!d.timeRange && d.rows >= 28 },
    { target: 'matrix', test: (d) => {
      const catCols = Object.entries(d.columns).filter(([, col]) => col.dtype === 'TEXT' || col.dtype === 'categorical');
      return catCols.length >= 2;
    }},
    { target: 'cluster-heatmap', test: (d) => d.rows >= 20 },
  ],
  'kpi-card': [
    { target: 'gauge', test: (_d, q) => /\b(range|min|max|threshold|limit)\b/i.test(q.rawQuery) },
    { target: 'bullet', test: (d) => {
      const hasTarget = Object.keys(d.columns).some(k => k.includes('target'));
      return hasTarget;
    }},
    { target: 'progress', test: (_d, q) => /\b(progress|completion|percent|goal)\b/i.test(q.rawQuery) },
  ],
  choropleth: [
    { target: 'bubble-map', test: (d) => {
      const geo = d.columns['geo_metrics.region'];
      return !!geo && geo.cardinality > 10;
    }},
    { target: 'flow-map', test: (d) => d.tables.includes('flows') },
    { target: 'point-map', test: (d) => {
      const hasLat = Object.keys(d.columns).some(k => k.includes('lat'));
      return hasLat;
    }},
  ],
};

function getVizById(id: string) {
  return VIZ_CATALOG.find(v => v.id === id);
}

export function promoteVizTypes(
  ranked: VizScore[],
  data: DataProfile,
  query: ParsedQuery,
): VizScore[] {
  return ranked.map(vs => {
    const rules = PROMOTION_RULES[vs.vizType.id];
    if (!rules) return vs;

    for (const rule of rules) {
      if (rule.test(data, query)) {
        const promoted = getVizById(rule.target);
        if (!promoted) continue;
        return { ...vs, vizType: promoted };
      }
    }
    return vs;
  });
}
