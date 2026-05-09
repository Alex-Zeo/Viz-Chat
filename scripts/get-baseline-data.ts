import { getCompanyBySlug, getDataProfile, getDataSlice } from '../server/db.js';
import { rankVizTypes } from '../server/ranker.js';
import { VIZ_CATALOG } from '../server/viz-catalog.js';
import type { ParsedQuery } from '../server/types.js';

const query = 'Show me revenue trends, customer segmentation, conversion funnel, and regional performance';
const lower = query.toLowerCase();

const INTENT_PATTERNS: Record<string, RegExp> = {
  trend: /\b(trend|growth|decline|over\s+time|change\s+over|trajectory)\b/i,
  comparison: /\b(compar|versus|vs\.?|between|against|benchmark)\b/i,
  composition: /\b(breakdown|composition|share|proportion|part[\s-]to[\s-]whole|makeup)\b/i,
  flow: /\b(funnel|conversion|flow|path|pipeline|stage)\b/i,
  performance: /\b(performance|kpi|metric|score|target|goal|dashboard)\b/i,
  geographic: /\b(region|geo|map|location|spatial|country|state|city)\b/i,
};
const intents: string[] = [];
for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
  if (pattern.test(lower)) intents.push(intent);
}

const ENTITY_KEYWORDS = ['revenue', 'customers', 'conversion', 'growth'];
const entities = ENTITY_KEYWORDS.filter(kw => lower.includes(kw));
const parsed: ParsedQuery = { intents, entities, rawQuery: query };

const company = getCompanyBySlug('olist')!;
const profile = getDataProfile(company.id);
const ranked = rankVizTypes(parsed, profile, VIZ_CATALOG, 4);

console.log(JSON.stringify({
  company: { id: company.id, name: company.name, slug: company.slug, sector: company.sector },
  profile: { tables: profile.tables, rows: profile.rows, timeRange: profile.timeRange, segments: profile.segments },
  rankedVizTypes: ranked.map(r => ({
    id: r.vizType.id, name: r.vizType.name, echartsType: r.vizType.echartsType,
    category: r.vizType.category, score: r.total, whenToUse: r.vizType.whenToUse,
  })),
  dataSlices: ranked.map(r => {
    const prefs: Record<string, string[]> = {
      trends: ['time_series'], comparison: ['breakdowns', 'time_series'],
      composition: ['breakdowns', 'time_series'], flow: ['flows', 'breakdowns'],
      gauge: ['time_series'], geo: ['geo_metrics'], heatmap: ['time_series'],
    };
    const categoryPrefs = prefs[r.vizType.category] ?? ['time_series'];
    let table = 'time_series';
    for (const t of categoryPrefs) { if (profile.tables.includes(t)) { table = t; break; } }
    if (r.vizType.id === 'choropleth' || r.vizType.id === 'bubble-map') {
      if (profile.tables.includes('geo_metrics')) table = 'geo_metrics';
    }
    const data = getDataSlice(company.id, table);
    return { vizType: r.vizType.name, table, rowCount: data.length, sample: data.slice(0, 8) };
  }),
}, null, 2));
