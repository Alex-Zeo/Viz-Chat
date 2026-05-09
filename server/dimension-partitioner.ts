import type { ParsedQuery, VizScore, Dimension } from './types.js';

const CATEGORY_GOALS: Record<string, (entity: string) => string> = {
  trends: (e) => `Show ${e} trend over time`,
  comparison: (e) => `Compare ${e} across segments or categories`,
  composition: (e) => `Break down ${e} by component or category`,
  gauge: (e) => `Show current ${e} as a KPI`,
  distribution: (e) => `Show the distribution or spread of ${e}`,
  flow: (e) => `Show ${e} flow between stages`,
  relationship: (e) => `Show correlation or relationship of ${e} with other metrics`,
  heatmap: (e) => `Show ${e} intensity across two dimensions`,
};

const DEFAULT_CATEGORIES = ['trends', 'comparison', 'composition', 'distribution'];

export function buildDimensions(query: ParsedQuery): Dimension[] {
  const { entities, intents } = query;
  const dims: Dimension[] = [];

  const relevantCategories = intents.length > 0
    ? [...new Set(intents.flatMap(i => intentToCategories(i)))]
    : DEFAULT_CATEGORIES;

  const paddedCategories = relevantCategories.length < 4
    ? [...relevantCategories, ...DEFAULT_CATEGORIES.filter(c => !relevantCategories.includes(c))]
    : relevantCategories;

  if (entities.length === 0) {
    for (const cat of paddedCategories.slice(0, 6)) {
      const goalFn = CATEGORY_GOALS[cat] ?? ((e: string) => `Analyze ${e}`);
      dims.push({ entity: 'metrics', category: cat, id: `metrics:${cat}`, goal: goalFn('key metrics') });
    }
    return dims;
  }

  for (const entity of entities) {
    for (const cat of paddedCategories.slice(0, 4)) {
      const goalFn = CATEGORY_GOALS[cat] ?? ((e: string) => `Analyze ${e}`);
      dims.push({ entity, category: cat, id: `${entity}:${cat}`, goal: goalFn(entity) });
    }
  }

  if (entities.length >= 2) {
    const crossEntity = `${entities[0]} vs ${entities[1]}`;
    dims.push({
      entity: crossEntity,
      category: 'comparison',
      id: `${crossEntity}:comparison`,
      goal: `Compare ${entities[0]} against ${entities[1]}`,
    });
  }

  return dims;
}

function intentToCategories(intent: string): string[] {
  const map: Record<string, string[]> = {
    trend: ['trends', 'gauge'],
    comparison: ['comparison', 'composition'],
    distribution: ['distribution', 'heatmap'],
    composition: ['composition', 'trends'],
    relationship: ['relationship', 'distribution'],
    risk: ['gauge', 'distribution'],
    flow: ['flow', 'composition'],
    performance: ['gauge', 'trends', 'comparison'],
    geographic: ['geographic', 'comparison'],
  };
  return map[intent] ?? ['trends'];
}

function vizCategoryMatch(vizCategory: string, dimCategory: string): boolean {
  if (vizCategory === dimCategory) return true;
  const aliases: Record<string, string[]> = {
    kpi: ['gauge'],
    ranking: ['comparison'],
    statistical: ['distribution'],
    specialty: ['trends'],
  };
  return aliases[vizCategory]?.includes(dimCategory) ?? false;
}

export function assignDimensions(ranked: VizScore[], query: ParsedQuery): (VizScore & { dimensionId: string; dimensionGoal: string })[] {
  const dims = buildDimensions(query);
  const usedDimIds = new Set<string>();
  const result: (VizScore & { dimensionId: string; dimensionGoal: string })[] = [];

  for (const vs of ranked) {
    let bestDim: Dimension | null = null;
    let bestScore = -1;

    for (const dim of dims) {
      if (usedDimIds.has(dim.id)) continue;
      let score = 0;
      if (vizCategoryMatch(vs.vizType.category, dim.category)) score += 1.0;
      else score += 0.2;
      const entityInQuery = query.entities.includes(dim.entity);
      if (entityInQuery) score += 0.5;
      if (score > bestScore) {
        bestScore = score;
        bestDim = dim;
      }
    }

    if (!bestDim) {
      const fallbackId = `fallback-${result.length}`;
      bestDim = { entity: query.entities[0] ?? 'metrics', category: vs.vizType.category, id: fallbackId, goal: `Analyze using ${vs.vizType.name}` };
    }

    usedDimIds.add(bestDim.id);
    result.push({
      ...vs,
      dimensionId: bestDim.id,
      dimensionGoal: bestDim.goal,
    });
  }

  return result;
}
